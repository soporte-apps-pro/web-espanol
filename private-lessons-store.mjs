// The same transaction implementation runs in the browser and emulator tests.
// Firestore rules, not this client, authorize every balance and schedule change.
export function createLessonStore(db, sdk, getActor) {
  const { doc, collection, query, where, getDocs, runTransaction, serverTimestamp, Timestamp } = sdk;
  const need = (ok, message) => { if (!ok) throw new Error(message); };
  const validId = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(id);
  return async input => {
    const actor = getActor();
    need(actor?.uid, "Sign in first.");
    const action = input.action;
    need(["open","credit","book","reschedule","cancel","complete","no_show","late_cancel"].includes(action), "Unknown action.");
    if (["open","credit","complete","no_show","late_cancel"].includes(action)) need(actor.admin, "Only Elkin can do this.");
    const reason = String(input.reason || "").trim();
    need(reason.length <= 500 && (!actor.admin || reason.length >= 3), "Add a reason or payment reference (3–500 characters).");
    need(validId(input.operationId) && input.operationId.length >= 16, "Invalid operation ID.");
    let uid = actor.admin ? input.studentUid : actor.uid;
    let email = "", fullName = "";
    if (action === "open") {
      email = String(input.email || "").trim().toLowerCase();
      fullName = String(input.fullName || "").trim();
      need(fullName.length >= 2 && fullName.length <= 80 && email.length >= 5 && email.length <= 120, "Enter the student's name and registered email.");
      const matches = await Promise.all(["privateEnrollments","studentProfiles"].map(name => getDocs(query(collection(db,name),where("email","==",email)))));
      const ids = [...new Set(matches.flatMap(result => result.docs.map(item => item.id)))];
      need(ids.length === 1, "Student account not found. Ask the student to register for private classes first, using this email.");
      uid = ids[0];
    }
    need(validId(uid), "Select a student.");
    const quantity = ["open","credit"].includes(action) ? input.quantity : 0;
    const paymentReportId = input.paymentReportId || "";
    if (paymentReportId) need(action === "credit" && actor.admin && validId(paymentReportId), "Invalid payment approval.");
    need(Number.isSafeInteger(quantity) && Math.abs(quantity) <= 10000 && (action !== "open" || quantity >= 0) && (action !== "credit" || quantity !== 0), "Enter a valid whole number of classes.");
    const hasLesson = !["open","credit"].includes(action);
    const lessonId = action === "book" ? `${actor.uid}_${input.operationId}` : hasLesson ? input.lessonId : "";
    if (hasLesson) need(validId(lessonId), "Invalid lesson.");
    if (["book","reschedule"].includes(action)) need(validId(input.slotId), "Select an available time.");
    const operationId = `${actor.uid}_${input.operationId}`;
    const accountRef = doc(db,"privateAccounts",uid);
    const historyRef = doc(db,"privateAccounts",uid,"history",operationId);
    const lessonRef = hasLesson ? doc(db,"privateLessons",lessonId) : null;
    const fingerprint = JSON.stringify({ action,uid,quantity,lessonId,slotId:input.slotId || "",reason,fullName,email,...(paymentReportId?{paymentReportId}:{}) });
    return runTransaction(db,async tx => {
      const receipt = await tx.get(historyRef);
      if (receipt.exists()) {
        need(receipt.data().fingerprint === fingerprint, "This operation ID was used for another change.");
        return {data:{studentUid:uid,lessonId}};
      }
      const snapshot = await tx.get(accountRef);
      const stamp = serverTimestamp();
      let account;
      if (action === "open") {
        need(!snapshot.exists(), "This student already has a balance. Use Add classes / adjustment.");
        account = {fullName,email,credited:quantity,used:0,reserved:0,createdAt:stamp};
      } else {
        need(snapshot.exists(), "Elkin has not activated this balance yet.");
        account = snapshot.data();
      }
      let reportRef, report, claimRef;
      if (paymentReportId) {
        reportRef = doc(db,"privateTopups",paymentReportId);
        report = (await tx.get(reportRef)).data();
        need(report?.studentUid === uid && report.status === "pending" && report.quantity === quantity, "This payment has changed or was already reviewed.");
        claimRef = doc(db,"privateTopupClaims",report.referenceKey);
        need(!(await tx.get(claimRef)).exists(), "This payment reference has already credited classes. Check it before adding more.");
      }
      let before, oldRef, targetRef, target;
      if (hasLesson && action !== "book") {
        const lesson = await tx.get(lessonRef);
        before = lesson.data();
        need(before?.studentUid === uid && before.status === "reserved", "This lesson has changed. Refresh the page.");
        oldRef = doc(db,"privateAvailability",before.slotId);
        const old = (await tx.get(oldRef)).data();
        need(old?.lessonId === lessonId && old.status === "confirmed", "The schedule changed. Contact Elkin.");
      }
      if (["book","reschedule"].includes(action)) {
        targetRef = doc(db,"privateAvailability",input.slotId);
        target = (await tx.get(targetRef)).data();
        need(target?.status === "available" && !target.lessonId, "This time is no longer available.");
      }
      if (action === "credit") account.credited += quantity;
      if (action === "book") account.reserved++;
      if (["cancel","complete","no_show","late_cancel"].includes(action)) account.reserved--;
      if (["complete","no_show","late_cancel"].includes(action)) account.used++;
      need([account.credited,account.used,account.reserved].every(n => Number.isSafeInteger(n) && n >= 0) && account.credited >= account.used + account.reserved, "Not enough available classes for this change.");
      tx.set(accountRef,{...account,updatedAt:stamp,lastOperation:operationId});
      if (targetRef) {
        tx.update(targetRef,{status:"confirmed",lessonId,heldBy:"",bookingRequestId:lessonId,holdExpiresAt:stamp});
        tx.set(lessonRef,{studentUid:uid,fullName:account.fullName,email:account.email,slotId:input.slotId,startAt:target.startAt,durationMinutes:50,status:"reserved",createdAt:before?.createdAt || stamp,updatedAt:stamp,operationId});
      }
      if (oldRef && ["cancel","reschedule","late_cancel"].includes(action)) {
        tx.update(oldRef,{status:"available",lessonId:"",heldBy:"",bookingRequestId:"",holdExpiresAt:stamp,googleCalendarCheckedAt:Timestamp.fromMillis(0)});
      }
      if (["cancel","complete","no_show","late_cancel"].includes(action)) {
        tx.update(lessonRef,{status:({cancel:"cancelled",complete:"completed",no_show:"no_show",late_cancel:"late_cancelled"})[action],updatedAt:stamp,operationId});
      }
      if (hasLesson) {
        // Projection consumed by the existing Google Calendar sync; no Apps Script changes needed.
        const scheduled = target || before;
        tx.set(doc(db,"privateBookingRequests",lessonId),{studentUid:uid,fullName:account.fullName,email:account.email,
          slotId:target?input.slotId:before.slotId,colombiaStart:scheduled.startAt,
          status:["cancel","late_cancel"].includes(action)?"cancelled":"confirmed",packageLabel:"Prepaid class balance",lessonId});
      }
      if (reportRef) {
        tx.update(reportRef,{status:"confirmed",reviewedAt:stamp,reviewedBy:actor.uid,reviewNote:reason,reviewOperationId:operationId});
        tx.set(claimRef,{reportId:paymentReportId,studentUid:uid,createdAt:stamp});
        tx.set(doc(db,"privateTopupMail",`${paymentReportId}_student_confirmed`),{reportId:paymentReportId,studentUid:uid,kind:"student_confirmed",status:"pending",createdAt:stamp});
      }
      tx.set(historyRef,{action,quantity,reason,actorUid:actor.uid,actorRole:actor.admin?"admin":"student",createdAt:stamp,
        lessonId,fromSlotId:before?.slotId || "",toSlotId:target?input.slotId:"",fromStartAt:before?.startAt || null,toStartAt:target?.startAt || null,
        credited:account.credited,used:account.used,reserved:account.reserved,fingerprint,...(paymentReportId?{paymentReportId}:{})});
      return {data:{studentUid:uid,lessonId}};
    });
  };
}

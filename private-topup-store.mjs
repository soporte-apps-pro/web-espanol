export const TOPUP_PACKAGES = {
  single:{label:"1 private class",quantity:1,amountUsd:25,wiseUrl:"https://wise.com/pay/r/1By27Avdd7FtOHo"},
  pack4:{label:"4 private classes",quantity:4,amountUsd:84,wiseUrl:"https://wise.com/pay/r/_QkFPSyF9SuYEwg"},
  pack8:{label:"8 private classes",quantity:8,amountUsd:152,wiseUrl:"https://wise.com/pay/r/-r1YnKwtgKPqFT8"}
};
export function packagesForAccount(account) {
  const t=account?.terms;
  return t ? {custom:{label:t.packageQuantity+' private classes · '+t.durationMinutes+' minutes',quantity:t.packageQuantity,amountUsd:t.packageAmountUsd,wiseUrl:t.paymentUrl,durationMinutes:t.durationMinutes,paymentNote:t.paymentNote}} : TOPUP_PACKAGES;
}
export function createTopupStore(db,sdk,getActor,lessonStore) {
  const {doc,runTransaction,serverTimestamp}=sdk;
  const need=(ok,message)=>{if(!ok)throw new Error(message);};
  const job=(id,uid,kind,custom=false)=>({reportId:id,studentUid:uid,kind,status:custom?"terms_pending":"pending",createdAt:serverTimestamp()});
  return async input=>{
    const actor=getActor();need(actor?.uid,"Sign in first.");
    if(input.action==="approve") {
      need(actor.admin,"Only Elkin can confirm payments.");
      return lessonStore({action:"credit",studentUid:input.studentUid,paymentReportId:input.reportId,operationId:input.operationId,quantity:input.quantity,reason:input.reason});
    }
    if(input.action==="reject") {
      need(actor.admin,"Only Elkin can review payments.");
      const reason=String(input.reason||"").trim();need(reason.length>=3&&reason.length<=500,"Explain what the student should check (3–500 characters).");
      const ref=doc(db,"privateTopups",input.reportId);
      return runTransaction(db,async tx=>{
        const snap=await tx.get(ref);const report=snap.data();need(report,"Payment report not found.");
        if(report.status==="rejected"&&report.reviewOperationId===input.operationId)return {data:{reportId:ref.id}};
        need(report.status==="pending","This payment has already been reviewed. Refresh the page.");
        tx.update(ref,{status:"rejected",reviewedAt:serverTimestamp(),reviewedBy:actor.uid,reviewNote:reason,reviewOperationId:input.operationId});
        tx.set(doc(db,"privateTopupMail",`${ref.id}_student_rejected`),job(ref.id,report.studentUid,"student_rejected",report.packageId==="custom"));
        return {data:{reportId:ref.id}};
      });
    }
    need(input.action==="report","Unknown action.");

    need(["wise","paypal","transfer","other"].includes(input.paymentMethod),"Select a payment method.");
    const paymentReference=String(input.paymentReference||"").trim().replace(/\s/g,"").toUpperCase();
    need(/^[A-Z0-9_-]{4,100}$/.test(paymentReference),"Use the payment transaction reference: 4–100 letters, numbers, hyphens or underscores.");
    const payerName=String(input.payerName||"").trim();need(payerName.length>=2&&payerName.length<=100,"Enter the payer's name.");
    const referenceKey=`${input.paymentMethod}_${paymentReference}`;
    const reportId=`${actor.uid}_${referenceKey}`;
    const ref=doc(db,"privateTopups",reportId);
    return runTransaction(db,async tx=>{
      const existing=await tx.get(ref);
      if(existing.exists()) {
        need(existing.data().packageId===input.packageId&&existing.data().payerName===payerName,"This payment reference was already reported with different details. Contact Elkin.");
        return {data:{reportId,alreadyReported:true}};
      }
      const account=(await tx.get(doc(db,"privateAccounts",actor.uid))).data();need(account,"Ask Elkin to activate your private class account first.");
      const pack=packagesForAccount(account)[input.packageId];need(pack,"Your package has changed. Refresh the page to see your agreed conditions.");
      tx.set(ref,{studentUid:actor.uid,fullName:account.fullName,email:account.email,packageId:input.packageId,
        packageLabel:pack.label,...(pack.durationMinutes?{durationMinutes:pack.durationMinutes}:{}),quantity:pack.quantity,amountUsd:pack.amountUsd,paymentMethod:input.paymentMethod,paymentReference,referenceKey,payerName,status:"pending",createdAt:serverTimestamp()});
      for(const kind of ["admin_received","student_received"])tx.set(doc(db,"privateTopupMail",`${reportId}_${kind}`),job(reportId,actor.uid,kind,input.packageId==="custom"));
      return {data:{reportId}};
    });
  };
}

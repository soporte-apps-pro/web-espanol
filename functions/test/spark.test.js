const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore');
const {doc,getDoc,setDoc,updateDoc,writeBatch,Timestamp,serverTimestamp,collection,getDocs}=sdk;
const ADMIN='QrpHgMUCY6dy7Gl6VX0r4orauqo1',DAY=86400000;
test('Spark transactions enforce balances, roles, deadlines and atomicity without Cloud Functions',async t=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/,'Run with npm run test:lessons');
  const {createLessonStore}=await import('../../private-lessons-store.mjs');
  const env=await initializeTestEnvironment({projectId:'demo-private-spark',firestore:{rules:readFileSync(resolve(__dirname,'../../firestore.rules'),'utf8')}});
  const adminDB=env.authenticatedContext(ADMIN,{email_verified:true}).firestore();
  const aliceDB=env.authenticatedContext('alice',{email_verified:true,email:'alice@example.test'}).firestore();
  const bobDB=env.authenticatedContext('bob',{email_verified:true,email:'bob@example.test'}).firestore();
  const admin=createLessonStore(adminDB,sdk,()=>({uid:ADMIN,admin:true}));
  const alice=createLessonStore(aliceDB,sdk,()=>({uid:'alice',admin:false}));
  const bob=createLessonStore(bobDB,sdk,()=>({uid:'bob',admin:false}));
  const command=(action,extra={})=>({action,operationId:randomUUID(),studentUid:'alice',reason:'Reviewed by teacher',...extra});
  async function seed(path,data){await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),data));}
  async function slot(offset=3*DAY,extra={}){
    const id=randomUUID();await seed(`privateAvailability/${id}`,{status:'available',durationMinutes:50,startAt:Timestamp.fromMillis(Date.now()+offset),googleCalendarBlocked:false,googleCalendarCheckedAt:Timestamp.now(),...extra});return id;
  }
  const balance=async()=> (await getDoc(doc(aliceDB,'privateAccounts','alice'))).data();
  async function init(credits=2){
    await env.clearFirestore();
    await seed('privateEnrollments/alice',{fullName:'Alice Student',email:'alice@example.test',createdAt:Timestamp.now()});
    await admin(command('open',{email:'alice@example.test',fullName:'Alice Student',quantity:credits}));
  }
  async function book(offset=3*DAY){return (await alice(command('book',{slotId:await slot(offset)}))).data.lessonId;}
  async function moveTime(lessonId,offset){
    await env.withSecurityRulesDisabled(async c=>{
      const db=c.firestore(),ref=doc(db,'privateLessons',lessonId),l=(await getDoc(ref)).data();
      const startAt=Timestamp.fromMillis(Date.now()+offset);
      await updateDoc(ref,{startAt});await updateDoc(doc(db,'privateAvailability',l.slotId),{startAt});
    });
  }
  try {
    await t.test('booking and rescheduling each queue one notice per recipient, retries do not duplicate them',async()=>{
      await init();const op=command('book',{slotId:await slot()});const id=(await alice(op)).data.lessonId;await alice(op);
      let jobs=(await getDocs(collection(adminDB,'privateTopupMail'))).docs.map(x=>x.data()).filter(x=>x.status==='lesson_pending');assert.equal(jobs.length,2);assert.deepEqual(jobs.map(x=>x.kind).sort(),['admin_booking','student_booking']);
      const change=command('reschedule',{lessonId:id,slotId:await slot(5*DAY)});await alice(change);await alice(change);
      jobs=(await getDocs(collection(adminDB,'privateTopupMail'))).docs.map(x=>x.data()).filter(x=>x.status==='lesson_pending');assert.equal(jobs.length,4);
      const fake={reportId:'made-up-operation',studentUid:'alice',kind:'admin_booking',status:'lesson_pending',createdAt:serverTimestamp()};await assertFails(setDoc(doc(aliceDB,'privateTopupMail','made-up-operation_admin_booking'),fake));
      const existing=jobs.find(x=>x.kind==='admin_booking');await assertFails(setDoc(doc(aliceDB,'privateTopupMail',existing.reportId+'_admin_booking'),{...existing,status:'lesson_pending',createdAt:serverTimestamp()}));
    });

    await t.test('opening balance and package replay each credit only once',async()=>{
      await init();const op=command('credit',{quantity:3});await admin(op);await admin(op);assert.equal((await balance()).credited,5);
      await assert.rejects(admin({...op,quantity:4}));
      assert.equal((await getDocs(collection(aliceDB,'privateAccounts','alice','history'))).size,2);
    });
    await t.test('student reserves and cancels with exactly one credit returned',async()=>{
      await init();const id=await book();assert.equal((await balance()).reserved,1);
      const op=command('cancel',{lessonId:id});await alice(op);await alice(op);
      assert.equal((await balance()).reserved,0);await assert.rejects(alice(command('cancel',{lessonId:id})));
    });
    await t.test('rescheduling is atomic and does not spend another credit',async()=>{
      await init(1);const id=await book(),target=await slot(5*DAY);
      await alice(command('reschedule',{lessonId:id,slotId:target}));
      assert.equal((await balance()).reserved,1);
      assert.equal((await getDoc(doc(aliceDB,'privateLessons',id))).data().slotId,target);
      await assert.rejects(alice(command('reschedule',{lessonId:id,slotId:'missing'})));
      assert.equal((await balance()).reserved,1);
    });
    await t.test('concurrent attempts to reserve the same slot create one booking',async()=>{
      await init();const id=await slot();const results=await Promise.allSettled([alice(command('book',{slotId:id})),alice(command('book',{slotId:id}))]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await balance()).reserved,1);
    });
    await t.test('concurrent different bookings cannot spend the last credit twice',async()=>{
      await init(1);const a=await slot(),b=await slot(4*DAY);
      const results=await Promise.allSettled([alice(command('book',{slotId:a})),alice(command('book',{slotId:b}))]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await balance()).reserved,1);
    });
    await t.test('server rejects changes inside 24 hours even if client clock is falsified',async()=>{
      await init();const id=await book();await moveTime(id,DAY-10000);
      await assert.rejects(alice(command('cancel',{lessonId:id})));
      await assert.rejects(alice(command('reschedule',{lessonId:id,slotId:await slot(6*DAY)})));
      assert.equal((await balance()).reserved,1);
      await admin(command('reschedule',{lessonId:id,slotId:await slot(7*DAY)}));
      await moveTime(id,DAY-10000);await admin(command('cancel',{lessonId:id}));assert.equal((await balance()).reserved,0);
    });
    await t.test('student may cancel just before the 24-hour deadline',async()=>{
      await init();const id=await book();await moveTime(id,DAY+30000);await alice(command('cancel',{lessonId:id}));assert.equal((await balance()).reserved,0);
    });
    await t.test('only admin completes an ended lesson, once',async()=>{
      await init();const id=await book();await assert.rejects(admin(command('complete',{lessonId:id})));
      await moveTime(id,-60*60000);await assert.rejects(alice(command('complete',{lessonId:id})));
      const op=command('complete',{lessonId:id});await admin(op);await admin(op);
      assert.equal((await balance()).used,1);assert.equal((await balance()).reserved,0);
      await assert.rejects(admin(command('complete',{lessonId:id})));
    });
    await t.test('late cancellation and absence are admin-only, with one consumed credit',async()=>{
      await init();const id=await book();await assert.rejects(admin(command('late_cancel',{lessonId:id})));
      await moveTime(id,60000);await admin(command('late_cancel',{lessonId:id}));assert.equal((await balance()).used,1);
      const other=await book();await moveTime(other,-60*60000);await admin(command('no_show',{lessonId:other}));assert.equal((await balance()).used,2);
    });
    await t.test('stale, blocked, past and distant slots cannot be booked',async()=>{
      await init();
      for(const id of [await slot(-1000),await slot(22*DAY),await slot(3*DAY,{googleCalendarBlocked:true}),await slot(3*DAY,{googleCalendarCheckedAt:Timestamp.fromMillis(0)})])await assert.rejects(alice(command('book',{slotId:id})));
      assert.equal((await balance()).reserved,0);
    });
    await t.test('forged admin client cannot add credits or change another student',async()=>{
      await init();const forged=createLessonStore(aliceDB,sdk,()=>({uid:'alice',admin:true}));
      await assert.rejects(forged(command('credit',{quantity:100})));
      const id=await book();await assert.rejects(bob(command('cancel',{lessonId:id})));
      await assertFails(getDoc(doc(bobDB,'privateAccounts','alice')));
    });
    await t.test('omitting a balance update or its audit record rejects the entire booking',async()=>{
      await init();
      for(const omit of ['privateAccounts/alice','/history/','privateBookingRequests/']){
        const evilSDK={...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,tx=>fn({get:ref=>tx.get(ref),update:(ref,data)=>tx.update(ref,data),set:(ref,data)=>{if(omit==='privateAccounts/alice'?ref.path===omit:ref.path.includes(omit))return;tx.set(ref,data);}}))};
        const evil=createLessonStore(aliceDB,evilSDK,()=>({uid:'alice',admin:false}));
        await assert.rejects(evil(command('book',{slotId:await slot()})));
      }
      assert.equal((await balance()).reserved,0);
    });
    await t.test('forged balance deltas, history edits and lesson times are denied',async()=>{
      await init();
      const evilSDK={...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,tx=>fn({get:ref=>tx.get(ref),update:(ref,data)=>tx.update(ref,data),set:(ref,data)=>tx.set(ref,ref.path==='privateAccounts/alice'?{...data,credited:100}:data)}))};
      await assert.rejects(createLessonStore(aliceDB,evilSDK,()=>({uid:'alice',admin:false}))(command('book',{slotId:await slot()})));
      const id=await book();await assertFails(updateDoc(doc(aliceDB,'privateLessons',id),{startAt:Timestamp.fromMillis(Date.now()+10*DAY)}));
      const h=(await getDocs(collection(aliceDB,'privateAccounts','alice','history'))).docs[0];await assertFails(updateDoc(h.ref,{quantity:100}));
      await assertFails(updateDoc(doc(aliceDB,'privateAccounts','alice'),{reserved:0}));
    });
    await t.test('legacy public reservation holds still work',async()=>{
      await init();const id=await slot();await assertSucceeds(updateDoc(doc(aliceDB,'privateAvailability',id),{status:'held',heldBy:'alice',holdExpiresAt:Timestamp.fromMillis(Date.now()+5*60000),bookingRequestId:''}));
    });
  } finally {await env.cleanup();}
});

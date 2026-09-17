const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore');
const {doc,getDoc,getDocs,collection,setDoc,updateDoc,Timestamp,serverTimestamp}=sdk;
const ADMIN='QrpHgMUCY6dy7Gl6VX0r4orauqo1';
test('reported payments, atomic approvals and protected email jobs',async t=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/);
  const {createLessonStore}=await import('../../private-lessons-store.mjs');
  const {createTopupStore}=await import('../../private-topup-store.mjs');
  const env=await initializeTestEnvironment({projectId:'demo-private-topups',firestore:{rules:readFileSync(resolve(__dirname,'../../firestore.rules'),'utf8')}});
  const contexts={admin:env.authenticatedContext(ADMIN,{email_verified:true}).firestore(),alice:env.authenticatedContext('alice',{email_verified:true,email:'alice@example.test'}).firestore(),bob:env.authenticatedContext('bob',{email_verified:true,email:'bob@example.test'}).firestore()};
  const actors={admin:{uid:ADMIN,admin:true},alice:{uid:'alice',admin:false},bob:{uid:'bob',admin:false}};
  const store=who=>createTopupStore(contexts[who],sdk,()=>actors[who],createLessonStore(contexts[who],sdk,()=>actors[who]));
  const admin=store('admin'),alice=store('alice'),bob=store('bob');
  const input=(extra={})=>({action:'report',packageId:'pack4',paymentMethod:'wise',paymentReference:'TRX1234',payerName:'Alice Student',...extra});
  const approve=(reportId,extra={})=>({action:'approve',reportId,studentUid:'alice',quantity:4,operationId:randomUUID(),reason:'Ingreso comprobado',...extra});
  async function init(){await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{for(const uid of ['alice','bob'])await setDoc(doc(c.firestore(),'privateAccounts',uid),{fullName:uid+' Student',email:uid+'@example.test',credited:0,used:0,reserved:0,createdAt:Timestamp.now(),updatedAt:Timestamp.now(),lastOperation:'initial-import-test'});});}
  const balance=async()=> (await getDoc(doc(contexts.alice,'privateAccounts','alice'))).data();
  try{
    await t.test('new general prices queue safely until the pricing email update is installed',async()=>{
      await init();
      for(const [packageId,amountUsd]of [['single',18],['pack4',68],['pack8',128]]){
        const id=(await alice(input({packageId,paymentReference:'NEW_'+packageId.toUpperCase()}))).data.reportId;
        assert.equal((await getDoc(doc(contexts.admin,'privateTopups',id))).data().amountUsd,amountUsd);
        assert.equal((await getDoc(doc(contexts.admin,'privateTopupMail',id+'_student_received'))).data().status,'pricing_pending');
      }
    });
    await t.test('previously reported payments retain their original amount and can still be approved',async()=>{
      await init();const id=(await alice(input())).data.reportId;
      await env.withSecurityRulesDisabled(async c=>{await updateDoc(doc(c.firestore(),'privateTopups',id),{amountUsd:84});});
      await admin(approve(id));
      assert.equal((await getDoc(doc(contexts.admin,'privateTopups',id))).data().amountUsd,84);
      assert.equal((await balance()).credited,4);
      assert.equal((await getDoc(doc(contexts.admin,'privateTopupMail',id+'_student_confirmed'))).data().status,'pending');
    });
    await t.test('activation request queues one immutable teacher notice and denies forged recipients',async()=>{
      await env.clearFirestore();
      const db=env.authenticatedContext('newstudent',{email:'new@example.test',email_verified:false}).firestore();
      const job={reportId:'newstudent',studentUid:'newstudent',kind:'admin_activation',status:'activation_pending',createdAt:serverTimestamp()};
      await assertFails(setDoc(doc(db,'privateTopupMail','newstudent_admin_activation'),job));
      const batch=sdk.writeBatch(db);
      batch.set(doc(db,'privateEnrollments','newstudent'),{fullName:'New Student',email:'new@example.test',createdAt:serverTimestamp()});
      batch.set(doc(db,'privateTopupMail','newstudent_admin_activation'),job);await batch.commit();
      await assertFails(setDoc(doc(db,'privateTopupMail','newstudent_admin_activation'),job));
      await assertFails(updateDoc(doc(db,'privateTopupMail','newstudent_admin_activation'),{status:'pending',to:'attacker@example.test'}));
      assert.equal((await getDocs(collection(contexts.admin,'privateTopupMail'))).size,1);
    });
    await t.test('report queues two emails but adds no classes; duplicate submission is idempotent',async()=>{
      await init();const r=await alice(input());const again=await alice(input());assert.equal(r.data.reportId,again.data.reportId);assert.equal(again.data.alreadyReported,true);
      assert.equal((await balance()).credited,0);assert.equal((await getDocs(collection(contexts.admin,'privateTopupMail'))).size,2);
      assert.equal((await getDoc(doc(contexts.admin,'privateTopups',r.data.reportId))).data().status,'pending');
    });
    await t.test('approving adds the correct package and confirmation email together, once',async()=>{
      await init();const id=(await alice(input())).data.reportId;const op=approve(id);await admin(op);await admin(op);
      assert.equal((await balance()).credited,4);assert.equal((await getDocs(collection(contexts.admin,'privateTopupMail'))).size,3);
      assert.equal((await getDoc(doc(contexts.alice,'privateTopups',id))).data().status,'confirmed');
      await assert.rejects(admin(approve(id)));assert.equal((await balance()).credited,4);
    });
    await t.test('simultaneous approvals cannot credit twice',async()=>{
      await init();const id=(await alice(input())).data.reportId;
      const results=await Promise.allSettled([admin(approve(id)),admin(approve(id))]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await balance()).credited,4);
    });
    await t.test('same transaction reference cannot credit two different student reports',async()=>{
      await init();const a=(await alice(input())).data.reportId,b=(await bob(input({payerName:'Bob Student'}))).data.reportId;
      await admin(approve(a));await assert.rejects(admin(approve(b,{studentUid:'bob'})));
      assert.equal((await getDoc(doc(contexts.bob,'privateAccounts','bob'))).data().credited,0);
    });
    await t.test('requesting review queues a message without changing the balance',async()=>{
      await init();const id=(await alice(input())).data.reportId;
      const op={action:'reject',reportId:id,operationId:randomUUID(),reason:'Please check the transaction reference.'};await admin(op);await admin(op);
      assert.equal((await balance()).credited,0);assert.equal((await getDocs(collection(contexts.admin,'privateTopupMail'))).size,3);
      assert.equal((await getDoc(doc(contexts.alice,'privateTopups',id))).data().reviewNote,op.reason);
    });
    await t.test('students cannot approve, alter payment details, read others or redirect emails',async()=>{
      await init();const id=(await alice(input())).data.reportId;
      await assert.rejects(alice(approve(id)));await assertFails(updateDoc(doc(contexts.alice,'privateTopups',id),{amountUsd:1}));
      await assertFails(getDoc(doc(contexts.bob,'privateTopups',id)));
      await assertFails(updateDoc(doc(contexts.alice,'privateTopupMail',id+'_admin_received'),{to:'attacker@example.test'}));
      await assertFails(setDoc(doc(contexts.alice,'privateTopupMail',id+'_student_confirmed'),{reportId:id,studentUid:'alice',kind:'student_confirmed',status:'pending',createdAt:serverTimestamp()}));
    });
    await t.test('approval without ledger change or without confirmation mail is rejected',async()=>{
      for(const omitted of ['privateAccounts/alice','privateTopupMail/']){
        await init();const id=(await alice(input())).data.reportId;
        const evilSdk={...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,tx=>fn({get:ref=>tx.get(ref),update:(ref,data)=>tx.update(ref,data),set:(ref,data)=>{if(ref.path.startsWith(omitted))return;tx.set(ref,data);}}))};
        const evil=createTopupStore(contexts.admin,evilSdk,()=>actors.admin,createLessonStore(contexts.admin,evilSdk,()=>actors.admin));
        await assert.rejects(evil(approve(id)));assert.equal((await balance()).credited,0);
        assert.equal((await getDoc(doc(contexts.alice,'privateTopups',id))).data().status,'pending');
      }
    });
    await t.test('report without both queued receipts or with a falsified package is rejected',async()=>{
      await init();
      for(const mode of ['omit','price']){
        const evilSdk={...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,tx=>fn({get:ref=>tx.get(ref),set:(ref,data)=>{if(mode==='omit'&&ref.path.endsWith('_admin_received'))return;tx.set(ref,mode==='price'&&ref.path.startsWith('privateTopups/')?{...data,quantity:100}:data);}}))};
        const evil=createTopupStore(contexts.alice,evilSdk,()=>actors.alice,null);await assert.rejects(evil(input()));
      }
      assert.equal((await getDocs(collection(contexts.admin,'privateTopupMail'))).size,0);
    });
  }finally{await env.cleanup();}
});

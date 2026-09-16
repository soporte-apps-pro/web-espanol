const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{readFileSync}=require('node:fs'),{resolve}=require('node:path');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore');
const ADMIN='QrpHgMUCY6dy7Gl6VX0r4orauqo1',DAY=86400000;
test('personal conditions preserve prices, durations and prepaid balances',async t=>{
 const {createLessonStore}=await import('../../private-lessons-store.mjs');
 const {createTopupStore,packagesForAccount}=await import('../../private-topup-store.mjs');
 const env=await initializeTestEnvironment({projectId:'demo-private-terms',firestore:{rules:readFileSync(resolve(__dirname,'../../firestore.rules'),'utf8')}});
 const adminDB=env.authenticatedContext(ADMIN,{email_verified:true}).firestore(),db=env.authenticatedContext('alice',{email_verified:true,email:'alice@example.test'}).firestore();
 const admin=createLessonStore(adminDB,sdk,()=>({uid:ADMIN,admin:true})),student=createLessonStore(db,sdk,()=>({uid:'alice',admin:false}));
 const topups=createTopupStore(db,sdk,()=>({uid:'alice',admin:false}),student),reviews=createTopupStore(adminDB,sdk,()=>({uid:ADMIN,admin:true}),admin);
 const terms={durationMinutes:30,packageQuantity:6,packageAmountUsd:99.5,paymentUrl:'https://wise.com/',paymentNote:'Use our agreed payment method.'};
 const command=(action,extra={})=>({action,operationId:randomUUID(),studentUid:'alice',reason:'Agreed with student',...extra});
 const read=async(c,id)=>(await sdk.getDoc(sdk.doc(adminDB,c,id))).data();
 async function seed(c,id,data){await env.withSecurityRulesDisabled(x=>sdk.setDoc(sdk.doc(x.firestore(),c,id),data));}
 async function init(quantity=2){await env.clearFirestore();await seed('privateEnrollments','alice',{fullName:'Alice Student',email:'alice@example.test',createdAt:sdk.Timestamp.now()});await admin(command('open',{fullName:'Alice Student',email:'alice@example.test',quantity,terms}));}
 async function slot(){const id=randomUUID();await seed('privateAvailability',id,{status:'available',durationMinutes:50,startAt:sdk.Timestamp.fromMillis(Date.now()+3*DAY),googleCalendarBlocked:false,googleCalendarCheckedAt:sdk.Timestamp.now()});return id;}
 const report=()=>topups({action:'report',packageId:'custom',paymentMethod:'wise',paymentReference:'TEST1234',payerName:'Alice Student'});
 const approve=id=>reviews({action:'approve',reportId:id,studentUid:'alice',quantity:6,reason:'Bank payment verified',operationId:randomUUID()});
 try {
  await t.test('activation saves personal conditions and hides general packages',async()=>{await init();const a=await read('privateAccounts','alice');assert.deepEqual(a.terms,terms);assert.deepEqual(Object.keys(packagesForAccount(a)),['custom']);assert.equal(packagesForAccount(a).custom.amountUsd,99.5);await assertFails(sdk.updateDoc(sdk.doc(db,'privateAccounts','alice'),{terms:{...terms,packageAmountUsd:1}}));});
  await t.test('30 minute booking and calendar slot agree, reschedule releases capacity, cancellation refunds once',async()=>{await init();const first=await slot();const id=(await student(command('book',{slotId:first}))).data.lessonId;assert.equal((await read('privateLessons',id)).durationMinutes,30);assert.equal((await read('privateAvailability',first)).durationMinutes,30);const second=await slot();await student(command('reschedule',{lessonId:id,slotId:second}));assert.equal((await read('privateAvailability',first)).durationMinutes,50);assert.equal((await read('privateAvailability',second)).durationMinutes,30);await student(command('cancel',{lessonId:id}));assert.equal((await read('privateAccounts','alice')).reserved,0);assert.equal((await read('privateAvailability',second)).durationMinutes,50);await assert.rejects(student(command('cancel',{lessonId:id})));});
  await t.test('teacher can complete a 30 minute lesson after 30 minutes',async()=>{await init();const id=(await student(command('book',{slotId:await slot()}))).data.lessonId;await env.withSecurityRulesDisabled(x=>sdk.updateDoc(sdk.doc(x.firestore(),'privateLessons',id),{startAt:sdk.Timestamp.fromMillis(Date.now()-31*60000)}));await admin(command('complete',{lessonId:id}));assert.equal((await read('privateAccounts','alice')).used,1);});
  await t.test('custom report uses stored price and retains it after price changes',async()=>{await init();const id=(await report()).data.reportId;assert.equal((await read('privateTopups',id)).amountUsd,99.5);assert.equal((await read('privateTopupMail',id+'_admin_received')).status,'terms_pending');await admin(command('configure',{terms:{...terms,packageAmountUsd:120}}));await approve(id);assert.equal((await read('privateTopups',id)).amountUsd,99.5);assert.equal((await read('privateAccounts','alice')).credited,8);assert.equal((await read('privateTopupMail',id+'_student_confirmed')).status,'terms_pending');await assert.rejects(approve(id));});
  await t.test('duration cannot change while prepaid or reserved classes remain; configuration replay is idempotent',async()=>{await init();await assert.rejects(admin(command('configure',{terms:{...terms,durationMinutes:50}})));await assert.rejects(student(command('configure',{terms})));await init(0);const op=command('configure',{terms:{...terms,durationMinutes:50}});await admin(op);await admin(op);assert.equal((await read('privateAccounts','alice')).terms.durationMinutes,50);});
  await t.test('old pending payment cannot credit a different class duration',async()=>{await init(0);const id=(await report()).data.reportId;await admin(command('configure',{terms:{...terms,durationMinutes:50}}));await assert.rejects(approve(id));assert.equal((await read('privateAccounts','alice')).credited,0);});
  await t.test('forged custom amount and duration are rejected even using a modified client',async()=>{await init();const badSdk={...sdk,runTransaction:(d,fn)=>sdk.runTransaction(d,tx=>fn(new Proxy(tx,{get(target,key){if(key==='set')return(ref,data,...rest)=>target.set(ref,ref.parent.id==='privateTopups'?{...data,amountUsd:1}:data,...rest);const value=target[key];return typeof value==='function'?value.bind(target):value;}})))};const bad=createTopupStore(db,badSdk,()=>({uid:'alice',admin:false}),student);await assert.rejects(bad({action:'report',packageId:'custom',paymentMethod:'wise',paymentReference:'FORGED1',payerName:'Alice Student'}));await assert.rejects(topups({action:'report',packageId:'single',paymentMethod:'wise',paymentReference:'FORGED2',payerName:'Alice Student'}));});

  await t.test('rules reject changing duration or price during a student booking',async()=>{
    await init();
    for(const attack of ['duration','terms']){
      const badSdk={...sdk,runTransaction:(d,fn)=>sdk.runTransaction(d,tx=>fn(new Proxy(tx,{get(target,key){
        if(key==='set')return(ref,data,...rest)=>target.set(ref,attack==='duration'&&ref.parent.id==='privateLessons'?{...data,durationMinutes:50}:attack==='terms'&&ref.parent.id==='privateAccounts'?{...data,terms:{...terms,packageAmountUsd:1}}:data,...rest);
        if(key==='update')return(ref,data,...rest)=>target.update(ref,attack==='duration'&&ref.parent.id==='privateAvailability'?{...data,durationMinutes:50}:data,...rest);
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }})))};
      const bad=createLessonStore(db,badSdk,()=>({uid:'alice',admin:false}));await assert.rejects(bad(command('book',{slotId:await slot()})));
    }
    assert.equal((await read('privateAccounts','alice')).reserved,0);
  });

  await t.test('teacher corrects legacy duration with two credits, keeping price, balance and an audit trail',async()=>{
    await init(2);await env.withSecurityRulesDisabled(x=>sdk.updateDoc(sdk.doc(x.firestore(),'privateAccounts','alice'),{terms:sdk.deleteField()}));
    const op=command('correct_duration',{durationMinutes:30});await admin(op);await admin(op);
    const a=await read('privateAccounts','alice');assert.equal(a.durationMinutes,30);assert.equal(a.credited,2);assert.equal(a.reserved,0);assert.equal(a.terms,undefined);
    const h=await read('privateAccounts/alice/history',a.lastOperation);assert.equal(h.previousDurationMinutes,50);assert.equal(h.durationMinutes,30);
    const id=(await student(command('book',{slotId:await slot()}))).data.lessonId;assert.equal((await read('privateLessons',id)).durationMinutes,30);
    await assert.rejects(admin(command('correct_duration',{durationMinutes:50})));
  });
  await t.test('correction keeps custom prices and cannot be performed by students',async()=>{
    await init(2);await assert.rejects(student(command('correct_duration',{durationMinutes:50})));await admin(command('correct_duration',{durationMinutes:50}));
    const a=await read('privateAccounts','alice');assert.equal(a.terms.durationMinutes,50);assert.equal(a.terms.packageAmountUsd,99.5);assert.equal(a.credited,2);
  });
 } finally {await env.cleanup();}
});

const test=require("node:test");
const assert=require("node:assert/strict");
const { readFileSync }=require("node:fs");
const { resolve }=require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds }=require("@firebase/rules-unit-testing");
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp }=require("firebase/firestore");
test("Firestore rules isolate student records and forbid balance manipulation",{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST,/^(127\.0\.0\.1|localhost):\d+$/);
  const env=await initializeTestEnvironment({projectId:"demo-private-lessons-rules",firestore:{rules:readFileSync(resolve(__dirname,"../../firestore.rules"),"utf8")}});
  try {
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await setDoc(doc(db,"privateAccounts","alice"),{credited:5,used:1,reserved:1});
      await setDoc(doc(db,"privateAccounts","bob"),{credited:3,used:0,reserved:0});
      await setDoc(doc(db,"privateAccounts","alice","history","entry"),{action:"open"});
      await setDoc(doc(db,"privateLessons","lesson"),{studentUid:"alice",status:"reserved"});
    });
    const alice=env.authenticatedContext("alice",{email_verified:true,email:"alice@example.test"}).firestore();
    const bob=env.authenticatedContext("bob",{email_verified:true}).firestore();
    const unverified=env.authenticatedContext("alice",{email_verified:false}).firestore();
    const guest=env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(alice,"privateAccounts","alice")));
    await assertFails(getDoc(doc(alice,"privateAccounts","bob")));
    await assertFails(getDoc(doc(guest,"privateAccounts","alice")));
    await assertFails(getDoc(doc(unverified,"privateAccounts","alice")));
    await assertSucceeds(getDocs(query(collection(alice,"privateLessons"),where("studentUid","==","alice"))));
    await assertFails(getDocs(collection(alice,"privateLessons")));
    await assertFails(getDoc(doc(bob,"privateLessons","lesson")));
    await assertSucceeds(getDocs(collection(alice,"privateAccounts","alice","history")));
    await assertFails(getDocs(collection(bob,"privateAccounts","alice","history")));
    await assertFails(updateDoc(doc(alice,"privateAccounts","alice"),{credited:100}));
    await assertFails(updateDoc(doc(alice,"privateLessons","lesson"),{status:"cancelled"}));
    await assertFails(setDoc(doc(alice,"privateLessonOperations","fake"),{result:{}}));
    await assertSucceeds(setDoc(doc(alice,"privateEnrollments","alice"),{fullName:"Alice Student",email:"alice@example.test",createdAt:serverTimestamp()}));
    await assertFails(setDoc(doc(alice,"privateEnrollments","bob"),{fullName:"Alice Student",email:"alice@example.test",createdAt:serverTimestamp()}));
  } finally {await env.cleanup();}
});

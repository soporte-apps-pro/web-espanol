const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs'),{resolve}=require('node:path');
function element(){const events={},classes=new Set();return {events,value:'',hidden:false,disabled:false,textContent:'',className:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,b)=>b?classes.add(x):classes.delete(x),contains:x=>classes.has(x)},addEventListener:(n,f)=>events[n]=f,querySelector:()=>element(),reset(){},checkValidity:()=>true,focus(){}};}
function accessFixture(user){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};get('#access-type').value='private';
 const auth={currentUser:user},calls=[],listeners=[];const location={replace:url=>calls.push(['route',url])};
 const context=vm.createContext({console,document:{querySelector:get,querySelectorAll:()=>[]},window:{addEventListener(){}},location,getStudentApp:()=>({}),initializeAppCheck:()=>({}),ReCaptchaEnterpriseProvider:function(){},getAuth:()=>auth,getFirestore:()=>({}),firebaseConfig:{},recaptchaEnterpriseSiteKey:'test',adminUid:'teacher',onAuthStateChanged:(a,fn)=>listeners.push(fn),setPersistence:async(a,p)=>calls.push(['persistence',p]),browserLocalPersistence:'LOCAL',signInWithEmailAndPassword:async()=>{calls.push(['login']);auth.currentUser={uid:'student',emailVerified:true};return {user:auth.currentUser};},sendEmailVerification:async()=>calls.push(['verify']),signOut:async()=>{calls.push(['logout']);auth.currentUser=null;listeners.forEach(fn=>fn(null));},reload:async u=>{u.emailVerified=true;},getToken:async()=>({})});
 const source=readFileSync(resolve(__dirname,'../../student-access.js'),'utf8').replace(/^import .*;\r?\n/gm,'');vm.runInContext(source,context);
 return {context,auth,calls,get,emit:()=>listeners.forEach(fn=>fn(auth.currentUser))};
}
test('returning verified student resumes portal without requesting credentials',()=>{const f=accessFixture({uid:'student',emailVerified:true});f.emit();assert.deepEqual(f.calls,[['route','student-portal.html']]);});
test('administrator credentials in student access show an account choice without redirecting',()=>{const f=accessFixture({uid:'teacher',emailVerified:true});f.emit();assert.deepEqual(f.calls,[]);assert.equal(f.get('#access-forms').classList.contains('hidden'),false);assert.equal(f.get('#verification-actions').hidden,true);assert.equal(f.get('#session-sign-out').hidden,false);});
test('unverified session is retained and verification can complete without another login',async()=>{const user={uid:'student',email:'student@example.test',emailVerified:false,getIdToken:async()=>{}};const f=accessFixture(user);f.emit();assert.equal(f.calls.length,0);assert.equal(f.get('#verification-actions').hidden,false);await f.get('#check-verification').events.click({currentTarget:element()});assert.deepEqual(f.calls,[['route','student-portal.html']]);});
test('explicit sign out reveals access forms',async()=>{const f=accessFixture({uid:'student',emailVerified:false});f.emit();await f.get('#session-sign-out').events.click();assert.equal(f.auth.currentUser,null);assert.equal(f.get('#session-panel').hidden,true);assert.equal(f.get('#access-forms').classList.contains('hidden'),false);});
test('login sets persistent storage before authentication',async()=>{const f=accessFixture(null);f.emit();const form=element();await f.get('#login-form').events.submit({preventDefault(){},currentTarget:form});assert.deepEqual(f.calls.slice(0,2),[['persistence','LOCAL'],['login']]);assert.equal(f.calls.some(c=>c[0]==='logout'),false);});
test('an open admin tab denies student access without signing the student out',async()=>{
 const source=readFileSync(resolve(__dirname,'../../admin.js'),'utf8');const start=source.indexOf('onAuthStateChanged(auth, async (user) =>');const end=source.indexOf('refreshButton.addEventListener',start);
 let listener,signouts=0;const dashboard=element(),login=element(),button=element();
 vm.runInNewContext(source.slice(start,end),{auth:{},adminUid:'teacher',onAuthStateChanged:(a,fn)=>listener=fn,signOut:()=>signouts++,loginView:login,dashboardView:dashboard,signOutButton:button,loginMessage:element(),setMessage(){},clearMessage(){},showAdminPanel(){},location:{hash:''},loadApplications:async()=>{}});
 await listener({uid:'student'});assert.equal(signouts,0);assert.equal(dashboard.classList.contains('hidden'),true);assert.equal(button.classList.contains('hidden'),false);
 await listener({uid:'teacher'});assert.equal(dashboard.classList.contains('hidden'),false);
 button.events.click();assert.equal(signouts,1);
});

test('public booking anonymous session does not block registration or require verification',()=>{const f=accessFixture({uid:'visitor',isAnonymous:true,emailVerified:false});f.emit();assert.equal(f.get('#session-panel').hidden,true);assert.equal(f.get('#access-forms').classList.contains('hidden'),false);assert.equal(f.calls.length,0);});

test('admin and student use independent stable Firebase apps',()=>{
 const apps=[],auths=new Map();const context=vm.createContext({firebaseConfig:{apiKey:'same-project-key'},getApps:()=>apps,initializeApp:(config,name)=>{const app={name,config};apps.push(app);return app;}});
 const source=readFileSync(resolve(__dirname,'../../firebase-sessions.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export const','var');vm.runInContext(source,context);
 const admin=context.getAdminApp(),student=context.getStudentApp();assert.notEqual(admin.name,student.name);assert.equal(context.getAdminApp(),admin);assert.equal(context.getStudentApp(),student);
 const getAuth=app=>{if(!auths.has(app.name))auths.set(app.name,{currentUser:null});return auths.get(app.name);};getAuth(admin).currentUser={uid:'teacher'};getAuth(student).currentUser={uid:'test-student'};
 getAuth(student).currentUser=null;assert.equal(getAuth(admin).currentUser.uid,'teacher');getAuth(student).currentUser={uid:'test-student'};getAuth(admin).currentUser=null;assert.equal(getAuth(student).currentUser.uid,'test-student');
 for(const file of ['admin.js','admin-calendar.js','private-lessons-admin.js','private-booking-admin.js'])assert.match(readFileSync(resolve(__dirname,'../../'+file),'utf8'),/const app\s*=\s*getAdminApp\(\)/);
 for(const file of ['student-access.js','student-portal.js'])assert.match(readFileSync(resolve(__dirname,'../../'+file),'utf8'),/const app\s*=\s*getStudentApp\(\)/);
});

import { getStudentApp } from "./firebase-sessions.js?v=20260917-pricing-1";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getDoc, getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { adminUid, firebaseConfig, recaptchaEnterpriseSiteKey } from "./firebase-config.js";
import { mountPrivateLessons } from "./private-lessons-ui.js?v=20260917-pricing-1";

const app=getStudentApp();
const appCheck=initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),isTokenAutoRefreshEnabled:true});
const auth=getAuth(app), database=getFirestore(app);
const slotLabels={"monday-1000":"Mondays · 10:00 a.m. Colombia time","monday-1100":"Mondays · 11:00 a.m. Colombia time","monday-1300":"Mondays · 1:00 p.m. Colombia time","monday-1800":"Mondays · 6:00 p.m. Colombia time","monday-1900":"Mondays · 7:00 p.m. Colombia time","tuesday-1400":"Tuesdays · 2:00 p.m. Colombia time","tuesday-1700":"Tuesdays · 5:00 p.m. Colombia time","tuesday-1900":"Tuesdays · 7:00 p.m. Colombia time","wednesday-0800":"Wednesdays · 8:00 a.m. Colombia time","thursday-0800":"Thursdays · 8:00 a.m. Colombia time","thursday-1300":"Thursdays · 1:00 p.m. Colombia time","thursday-1400":"Thursdays · 2:00 p.m. Colombia time","friday-1100":"Fridays · 11:00 a.m. Colombia time","friday-1400":"Fridays · 2:00 p.m. Colombia time","friday-1500":"Fridays · 3:00 p.m. Colombia time","saturday-1130":"Saturdays · 11:30 a.m. Colombia time","saturday-1330":"Saturdays · 1:30 p.m. Colombia time"};
const hide=(id)=>document.querySelector(id).classList.add("hidden"), show=(id)=>document.querySelector(id).classList.remove("hidden");
const formatDate=(value)=>new Intl.DateTimeFormat("en-US",{dateStyle:"full",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));

let stopPrivateLessons,authRevision=0;
onAuthStateChanged(auth,async(user)=>{
  const revision=++authRevision;
  stopPrivateLessons?.();stopPrivateLessons=undefined;
  hide('#active');hide('#pending');hide('#error');show('#loading');
  document.querySelector('#private-lessons').hidden=true;
  if(!user){location.href="student-access.html";return;}
  if(user.uid===adminUid){location.replace("student-access.html");return;}
  if(!user.emailVerified){location.replace("student-access.html");return;}
  try{
    await getToken(appCheck,true);
    if(revision!==authRevision)return;
    const privateRoot=document.querySelector("#private-lessons");
    privateRoot.hidden=false;
    stopPrivateLessons=mountPrivateLessons(privateRoot,app);
    const snapshot=await getDoc(doc(database,"studentProfiles",user.uid));
    if(revision!==authRevision)return;
    hide("#loading");
    if(!snapshot.exists())return;
    const profile=snapshot.data();
    if(profile.status!=="active"){show("#pending");return;}
    document.querySelector("#group-name").textContent=profile.groupName;
    document.querySelector("#group-slot").textContent=slotLabels[profile.slot]||profile.slot;
    const meetingLink=document.querySelector("#meeting-link");
    meetingLink.href=profile.meetingUrl;
    document.querySelector("#sessions").innerHTML=(profile.sessionDates||[]).map((date,index)=>`<div class="session"><small>Session ${index+1}</small><strong>${formatDate(date)}</strong></div>`).join("");
    show("#active");
  }catch(error){if(revision!==authRevision)return;console.error(error);hide("#loading");document.querySelector("#error").textContent="We could not load your access. Please contact Elkin.";show("#error");}
});
document.querySelector("#sign-out").addEventListener("click",async()=>{await signOut(auth);location.href="student-access.html";});

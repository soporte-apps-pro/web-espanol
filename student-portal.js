import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getDoc, getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { firebaseConfig, recaptchaEnterpriseSiteKey } from "./firebase-config.js";

const app=initializeApp(firebaseConfig);
const appCheck=initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),isTokenAutoRefreshEnabled:true});
const auth=getAuth(app), database=getFirestore(app);
const slotLabels={"monday-1000":"Lunes · 10:00 a. m. (hora Colombia)","tuesday-1700":"Martes · 5:00 p. m. (hora Colombia)","wednesday-0800":"Miércoles · 8:00 a. m. (hora Colombia)","thursday-1400":"Jueves · 2:00 p. m. (hora Colombia)","friday-1100":"Viernes · 11:00 a. m. (hora Colombia)"};
const hide=(id)=>document.querySelector(id).classList.add("hidden"), show=(id)=>document.querySelector(id).classList.remove("hidden");
const formatDate=(value)=>new Intl.DateTimeFormat("es-CO",{dateStyle:"full",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));

onAuthStateChanged(auth,async(user)=>{
  if(!user){location.href="student-access.html";return;}
  if(!user.emailVerified){await signOut(auth);location.href="student-access.html";return;}
  try{
    await getToken(appCheck,true);
    const snapshot=await getDoc(doc(database,"studentProfiles",user.uid));
    hide("#loading");
    if(!snapshot.exists())throw new Error("profile-not-found");
    const profile=snapshot.data();
    if(profile.status!=="active"){show("#pending");return;}
    document.querySelector("#group-name").textContent=profile.groupName;
    document.querySelector("#group-slot").textContent=slotLabels[profile.slot]||profile.slot;
    const meetingLink=document.querySelector("#meeting-link");
    meetingLink.href=profile.meetingUrl;
    document.querySelector("#sessions").innerHTML=(profile.sessionDates||[]).map((date,index)=>`<div class="session"><small>Sesión ${index+1}</small><strong>${formatDate(date)}</strong></div>`).join("");
    show("#active");
  }catch(error){console.error(error);hide("#loading");document.querySelector("#error").textContent="No fue posible cargar tu acceso. Contacta a Elkin.";show("#error");}
});
document.querySelector("#sign-out").addEventListener("click",async()=>{await signOut(auth);location.href="student-access.html";});

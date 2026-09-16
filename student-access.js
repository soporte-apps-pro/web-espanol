import { getStudentApp } from "./firebase-sessions.js?v=20260916-separated-1";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import { createUserWithEmailAndPassword, getAuth, onAuthStateChanged, reload, setPersistence, browserLocalPersistence, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getFirestore, serverTimestamp, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { adminUid, firebaseConfig, recaptchaEnterpriseSiteKey } from "./firebase-config.js";

const app = getStudentApp();
const appCheck = initializeAppCheck(app, { provider:new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey), isTokenAutoRefreshEnabled:true });
const auth = getAuth(app);
const database = getFirestore(app);
let authBusy=false;
const PAYMENT_NOTIFICATION_URL = "https://script.google.com/macros/s/AKfycbwW0dtawkiixLv6akVE2mdPIO8AZwKCRtrRut1D_Hn8QWN7yrPeG9_33JtvaK3Yy7xC/exec";

function message(element, text, type="error") { element.textContent=text; element.className=`message ${type}`; }
async function notifyPaymentReceipt(documentId) {
  try {
    await fetch(PAYMENT_NOTIFICATION_URL, {
      method:"POST",
      mode:"no-cors",
      headers:{ "Content-Type":"text/plain;charset=UTF-8" },
      body:JSON.stringify({ type:"group", documentId }),
    });
  } catch (error) { console.error("Payment acknowledgement email could not be requested", error); }
}

const accessType = document.querySelector("#access-type");
function updateAccessType() {
  const privateAccess=accessType.value==="private",groupAccess=accessType.value==="group";
  document.querySelector("#group-access-info").hidden=!groupAccess;
  document.querySelector("#register-form").hidden=!privateAccess&&!groupAccess;
  document.querySelector('label[for="register-email"]').textContent=privateAccess?"Email":"Email used for your Speaking Club application";
  document.querySelector("#group-payment-fields").hidden=!groupAccess;
  document.querySelector("#private-access-note").hidden=!privateAccess;
  document.querySelector("#payment-reference").required=groupAccess;
  document.querySelector("#payer-name").required=!privateAccess;
  document.querySelectorAll("#group-payment-fields input").forEach(input=>{input.disabled=!groupAccess;});
}
accessType.addEventListener("change",updateAccessType);
updateAccessType();

document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const output = document.querySelector("#register-message");
  if(!["private","group"].includes(accessType.value)){message(output,"Choose Speaking Club or Private classes first.");return;}
  button.disabled=true; button.textContent="Creating account…";
  authBusy=true;
  try {
    await setPersistence(auth,browserLocalPersistence);
    await getToken(appCheck, true);
    const email=document.querySelector("#register-email").value.trim().toLowerCase();
    const credential=await createUserWithEmailAndPassword(auth,email,document.querySelector("#register-password").value);
    const privateAccess=accessType.value==="private";
    if (privateAccess) {
      const batch = writeBatch(database);
      batch.set(doc(database,"privateEnrollments",credential.user.uid),{
        fullName:document.querySelector("#register-name").value.trim(),email,createdAt:serverTimestamp()
      });
      batch.set(doc(database,"privateTopupMail",credential.user.uid+"_admin_activation"),{reportId:credential.user.uid,studentUid:credential.user.uid,kind:"admin_activation",status:"activation_pending",createdAt:serverTimestamp()});
      await batch.commit();
    } else {
    await setDoc(doc(database,"studentProfiles",credential.user.uid),{
      fullName:document.querySelector("#register-name").value.trim(), email,
      paymentMethod:document.querySelector("#payment-method").value,
      paymentReference:document.querySelector("#payment-reference").value.trim(),
      payerName:document.querySelector("#payer-name").value.trim(),
      amountSubmitted:Number(document.querySelector("#amount-submitted").value),
      status:"pending", createdAt:serverTimestamp()
    });
    await notifyPaymentReceipt(credential.user.uid);
    }
    let verificationEmailSent = true;
    try {
      await sendEmailVerification(credential.user);
    } catch (verificationError) {
      verificationEmailSent = false;
      console.error("Verification email could not be sent", verificationError);
    }
    form.reset();
    message(
      output,
      privateAccess
        ? verificationEmailSent
          ? "Account created. Check your inbox and Spam for your verification email, then sign in. Elkin will activate your remaining private classes."
          : "Account created, but we could not send your verification email. Try signing in to request another one. Elkin will activate your class balance."
        : verificationEmailSent
        ? "Information submitted successfully. Check for two emails: Payment information received from Spanish with Elkin, and a separate Firebase verification email from noreply@spanish-with-elkin.firebaseapp.com. Open the verification link and check Spam if necessary. Elkin will notify you after reviewing your payment."
        : "Information submitted successfully. We could not send the verification email now, but you can request another one when you try to sign in.",
      "success"
    );
  } catch(error) {
    console.error(error); message(output,`We could not create the account (${error?.code || "error"}).`);
  } finally { authBusy=false;button.disabled=false; button.textContent="Create account and request access";renderSession(auth.currentUser); }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector("button");
  const output=document.querySelector("#login-message");
  button.disabled=true; button.textContent="Signing in…";
  authBusy=true;
  try {
    await setPersistence(auth,browserLocalPersistence);
    const credential=await signInWithEmailAndPassword(auth,document.querySelector("#login-email").value.trim(),document.querySelector("#login-password").value);
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user);
      message(output,"You must verify your email address. We sent you a new verification message."); return;
    }
    renderSession(credential.user);
  } catch(error) { console.error(error); message(output,"We could not sign you in. Check your email and password."); }
  finally { authBusy=false;button.disabled=false; button.textContent="Open student portal";renderSession(auth.currentUser); }
});

document.querySelector("#forgot-password").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const emailInput = document.querySelector("#login-email");
  const output = document.querySelector("#login-message");
  const email = emailInput.value.trim().toLowerCase();
  if (!email || !emailInput.checkValidity()) {
    message(output, "Enter a valid email address above, then select Forgot your password?");
    emailInput.focus();
    return;
  }

  button.disabled = true;
  button.textContent = "Sending reset email…";
  try {
    await sendPasswordResetEmail(auth, email);
    message(output, "If an account exists for this email, Firebase sent a password reset link. Check your inbox and Spam folder.", "success");
  } catch (error) {
    console.error("Password reset email could not be sent", error);
    const tooManyRequests = error?.code === "auth/too-many-requests";
    message(output, tooManyRequests
      ? "Too many attempts. Please wait a few minutes before trying again."
      : "We could not send the reset email. Check the address and try again.");
  } finally {
    button.disabled = false;
    button.textContent = "Forgot your password?";
  }
});

function renderSession(user) {
  const panel=document.querySelector('#session-panel'),forms=document.querySelector('#access-forms');
  if(!user||user.isAnonymous){panel.hidden=true;forms.classList.remove('hidden');return;}
  forms.classList.add('hidden');panel.hidden=false;
  document.querySelector('#session-sign-out').hidden=false;
  if(user.uid===adminUid){
    forms.classList.remove('hidden');
    document.querySelector('#session-heading').textContent='Choose a student account';
    document.querySelector('#session-status').textContent='You entered your administrator account here. Sign in below with the student account you want to use. Your separate administration session will stay open.';
    document.querySelector('#verification-actions').hidden=true;
    return;
  }
  if(user.emailVerified){location.replace('student-portal.html');return;}
  document.querySelector('#session-heading').textContent='Verify your email';
  document.querySelector('#session-status').textContent='You are signed in as '+user.email+'. Open the verification link in your inbox or Spam, then press Continue. You do not need to enter your password again.';
  document.querySelector('#verification-actions').hidden=false;
}
onAuthStateChanged(auth,user=>{if(!authBusy)renderSession(user);});
document.querySelector('#session-sign-out').addEventListener('click',()=>signOut(auth));
document.querySelector('#check-verification').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{const user=auth.currentUser;if(!user){renderSession(null);return;}await reload(user);if(auth.currentUser?.uid!==user.uid)return;await user.getIdToken(true);renderSession(user);if(!user.emailVerified)document.querySelector('#session-status').textContent='Your email is not verified yet. Open the link from your verification email, then try Continue again.';}
  catch(error){console.error(error);document.querySelector('#session-status').textContent='We could not check verification. Please try again.';}
  finally{button.disabled=false;}
});
document.querySelector('#resend-verification').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{if(!auth.currentUser){renderSession(null);return;}await sendEmailVerification(auth.currentUser);document.querySelector('#session-status').textContent='Verification email sent. Check your inbox and Spam.';}
  catch(error){console.error(error);document.querySelector('#session-status').textContent='Could not resend the email. Please wait a moment and try again.';}
  finally{button.disabled=false;}
});
window.addEventListener('pageshow',()=>{if(!authBusy&&auth.currentUser)renderSession(auth.currentUser);});

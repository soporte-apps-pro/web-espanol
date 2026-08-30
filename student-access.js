import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import { createUserWithEmailAndPassword, getAuth, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { doc, getFirestore, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { firebaseConfig, recaptchaEnterpriseSiteKey } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const appCheck = initializeAppCheck(app, { provider:new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey), isTokenAutoRefreshEnabled:true });
const auth = getAuth(app);
const database = getFirestore(app);
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

document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const output = document.querySelector("#register-message");
  button.disabled=true; button.textContent="Creating account…";
  try {
    await getToken(appCheck, true);
    const email=document.querySelector("#register-email").value.trim().toLowerCase();
    const credential=await createUserWithEmailAndPassword(auth,email,document.querySelector("#register-password").value);
    await setDoc(doc(database,"studentProfiles",credential.user.uid),{
      fullName:document.querySelector("#register-name").value.trim(), email,
      paymentMethod:document.querySelector("#payment-method").value,
      paymentReference:document.querySelector("#payment-reference").value.trim(),
      payerName:document.querySelector("#payer-name").value.trim(),
      amountSubmitted:Number(document.querySelector("#amount-submitted").value),
      status:"pending", createdAt:serverTimestamp()
    });
    await notifyPaymentReceipt(credential.user.uid);
    let verificationEmailSent = true;
    try {
      await sendEmailVerification(credential.user);
    } catch (verificationError) {
      verificationEmailSent = false;
      console.error("Verification email could not be sent", verificationError);
    }
    await signOut(auth);
    form.reset();
    message(
      output,
      verificationEmailSent
        ? "Information submitted successfully. Check for two emails: Payment information received from Spanish with Elkin, and a separate Firebase verification email from noreply@spanish-with-elkin.firebaseapp.com. Open the verification link and check Spam if necessary. Elkin will notify you after reviewing your payment."
        : "Information submitted successfully. We could not send the verification email now, but you can request another one when you try to sign in.",
      "success"
    );
  } catch(error) {
    console.error(error); message(output,`We could not create the account (${error?.code || "error"}).`);
  } finally { button.disabled=false; button.textContent="Create account and request access"; }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector("button");
  const output=document.querySelector("#login-message");
  button.disabled=true; button.textContent="Signing in…";
  try {
    const credential=await signInWithEmailAndPassword(auth,document.querySelector("#login-email").value.trim(),document.querySelector("#login-password").value);
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user); await signOut(auth);
      message(output,"You must verify your email address. We sent you a new verification message."); return;
    }
    location.href="student-portal.html";
  } catch(error) { console.error(error); message(output,"We could not sign you in. Check your email and password."); }
  finally { button.disabled=false; button.textContent="Open student portal"; }
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

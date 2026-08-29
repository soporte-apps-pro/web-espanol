import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import { createUserWithEmailAndPassword, getAuth, sendEmailVerification, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
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
  button.disabled=true; button.textContent="Creando cuenta…";
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
        ? "Solicitud enviada correctamente. Enviamos la recepción del pago y la verificación de tu dirección al correo. Elkin te avisará cuando tu acceso esté activo."
        : "Solicitud enviada correctamente. No pudimos enviar ahora el correo de verificación, pero puedes solicitar uno nuevo al intentar iniciar sesión.",
      "success"
    );
  } catch(error) {
    console.error(error); message(output,`No fue posible crear la cuenta (${error?.code || "error"}).`);
  } finally { button.disabled=false; button.textContent="Crear cuenta y solicitar acceso"; }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector("button");
  const output=document.querySelector("#login-message");
  button.disabled=true; button.textContent="Ingresando…";
  try {
    const credential=await signInWithEmailAndPassword(auth,document.querySelector("#login-email").value.trim(),document.querySelector("#login-password").value);
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user); await signOut(auth);
      message(output,"Debes verificar tu correo. Enviamos un nuevo mensaje de verificación."); return;
    }
    location.href="student-portal.html";
  } catch(error) { console.error(error); message(output,"No fue posible iniciar sesión. Revisa el correo y la contraseña."); }
  finally { button.disabled=false; button.textContent="Entrar al portal"; }
});

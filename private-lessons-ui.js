import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, doc, getFirestore, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import * as firestore from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { adminUid } from "./firebase-config.js";
import { createLessonStore, privateDuration } from "./private-lessons-store.mjs?v=20260916-duration-fix-1";
import { mountPrivateTopups } from "./private-topups-ui.js?v=20260916-duration-fix-1";

const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const DAY = 86400000;
export function mountPrivateLessons(root, app, admin = false) {
  const db = getFirestore(app), auth = getAuth(app);
  const call = createLessonStore(db,firestore,()=>({uid:auth.currentUser?.uid,admin:auth.currentUser?.uid===adminUid}));
  const t = (es, en) => admin ? es : en;
  const zone = admin ? "America/Bogota" : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const format = stamp => stamp?.toDate ? new Intl.DateTimeFormat(admin ? "es-CO" : "en-US", { dateStyle:"medium", timeStyle:"short", timeZone:zone }).format(stamp.toDate()) : "—";
  const status = value => ({ reserved:t("Reservada","Reserved"), completed:t("Realizada","Completed"), cancelled:t("Cancelada · clase devuelta","Cancelled · credit returned"), late_cancelled:t("Cancelación tardía · clase consumida","Late cancellation · credit used"), no_show:t("Ausencia · clase consumida","Missed · credit used") })[value] || value;
  const actionLabel = value => ({correct_duration:t("Duración corregida","Class duration corrected"),configure:t("Condiciones actualizadas","Conditions updated"),open:t("Saldo inicial","Opening balance"),credit:t("Pago / ajuste","Payment / adjustment"),book:t("Reserva","Booking"),reschedule:t("Reprogramación","Reschedule"),cancel:t("Cancelación","Cancellation"),late_cancel:t("Cancelación tardía","Late cancellation"),complete:t("Clase realizada","Lesson completed"),no_show:t("Ausencia","Missed lesson")})[value] || value;
  let uid = admin ? "" : auth.currentUser.uid, account, lessons = [], slots = [], accounts = [], enrollments = [], busy = false;
  let studentStops = [], stops = [];
  const pending = new Map();
  const termsFields=()=>`<label>Condiciones<select name="termsMode"><option value="general">Tarifas generales</option><option value="custom">Condiciones personales</option></select></label><fieldset data-terms-fields hidden disabled><label>Duración de cada clase<select name="durationMinutes"><option value="50">50 minutos</option><option value="30">30 minutos</option></select></label><label>Clases del paquete<input name="packageQuantity" type="number" min="1" max="100" step="1" value="1" required></label><label>Precio total del paquete (USD)<input name="packageAmountUsd" type="number" min="0.01" max="10000" step="0.01" required></label><label>Enlace de pago acordado (opcional)<input name="paymentUrl" type="url" pattern="https://.*" maxlength="500" placeholder="https://..."></label><label>Instrucciones de pago para el estudiante (opcional)<textarea name="paymentNote" maxlength="500" placeholder="Escribe las instrucciones en el idioma del estudiante"></textarea></label><p class="lesson-note">Para una tarifa por clase, indica 1 clase. El estudiante verá únicamente este paquete. Sin enlace, utilizará el método que hayan acordado.</p></fieldset>`;
  function readTerms(values){return values.termsMode==='custom'?{durationMinutes:Number(values.durationMinutes),packageQuantity:Number(values.packageQuantity),packageAmountUsd:Number(values.packageAmountUsd),paymentUrl:values.paymentUrl,paymentNote:values.paymentNote}:null;}
  function toggleTerms(form){const fields=form.querySelector('[data-terms-fields]');fields.hidden=fields.disabled=form.elements.termsMode.value!=='custom';}

  root.classList.add("lesson-panel");
  root.innerHTML = `<h2>${t("Clases personales · saldos y reservas","My private classes")}</h2>
    <p class="lesson-note">${t("El estudiante puede cancelar o reprogramar hasta 24 horas antes. Después, solo tú puedes hacerlo. Puedes devolver la clase como excepción o registrar una cancelación tardía que consume la clase.","You can cancel or reschedule at least 24 hours before the lesson. After that, only Elkin can make changes. Cancelling on time returns the credit. Late cancellations and missed lessons use one credit, unless Elkin makes an exception.")}</p>
    <p class="lesson-note">${t("Horarios en","Times shown in")} <strong>${escape(zone)}</strong>. ${t("Disponibilidad para los próximos 21 días.","Availability for the next 21 days.")}</p>
    <p class="lesson-notice" data-message role="status" aria-live="polite"></p>
    ${admin ? `<div class="lesson-forms"><form data-open><h3>Activar estudiante</h3><p class="lesson-note">Primero debe crear su cuenta en Acceso a estudiantes. Introduce solo las clases que le quedan pendientes; no vuelvas a cargar un pago ya registrado.</p><label>Nombre<input name="fullName" required minlength="2" maxlength="80"></label><label>Correo de su cuenta<input name="email" type="email" required maxlength="120"></label>${termsFields()}<label>Clases pendientes al empezar<input name="quantity" type="number" min="0" max="10000" step="1" value="0" required></label><label>Nota de saldo inicial<input name="reason" required minlength="3" maxlength="500" placeholder="Saldo revisado con el estudiante"></label><button class="primary" type="submit">Activar y guardar saldo y condiciones</button></form><div><h3>Estudiantes</h3><label for="lesson-student">Seleccionar estudiante</label><select id="lesson-student" data-student><option value="">Selecciona un estudiante</option></select><details><summary>Cuentas pendientes de activar</summary><div data-enrollments></div></details></div></div>` : ""}
    <div data-account><p>${t("Selecciona o activa un estudiante.","Loading your class balance…")}</p></div>
    <section data-settings hidden>${admin ? `<form data-duration><h3>Corregir duración de las clases</h3><label>Duración acordada<select name="durationMinutes"><option value="30">30 minutos</option><option value="50">50 minutos</option></select></label><p class="lesson-note">Conserva el número de clases disponibles y el precio. Si hay reservas, resuélvelas primero. Escribe el motivo para dejar constancia.</p><label>Motivo de la corrección<input name="reason" required minlength="3" maxlength="500" placeholder="Corrección de la duración acordada"></label><button class="primary" type="submit">Guardar duración sin cambiar el saldo</button></form><form data-configure><h3>Condiciones de este estudiante</h3>${termsFields()}<p class="lesson-note">Los cambios de precio se aplican a reportes nuevos. Para corregir una duración con saldo pendiente, utiliza el formulario de corrección de arriba.</p><label>Motivo del cambio<input name="reason" required minlength="3" maxlength="500"></label><button type="submit">Guardar condiciones</button></form>` : ""}</section>
    <section data-topups aria-label="Payment reports"></section>
    <div data-content hidden>
      ${admin ? `<form data-credit><h3>Registrar paquete pagado o ajuste</h3><p class="lesson-note">Verifica el pago antes de añadir clases. Usa un número negativo para corregir un saldo disponible.</p><label>Clases (+ / −)<input name="quantity" type="number" min="-10000" max="10000" step="1" required></label><label>Referencia de pago o motivo<input name="reason" required minlength="3" maxlength="500"></label><button type="submit">Guardar clases</button></form>` : ""}
      <form data-book><h3>${t("Programar una clase","Book a class")}</h3><p class="lesson-note" data-availability></p><label>${t("Horario disponible","Available time")}<select name="slotId" data-slot required></select></label><button class="primary" type="submit">${t("Reservar · usar 1 clase disponible","Book · use 1 available class")}</button></form>
      <h3 style="margin-top:28px">${t("Clases reservadas e historial","Upcoming classes and history")}</h3><div data-lessons></div>
      <details><summary>${t("Movimientos del saldo","Balance activity")}</summary><div class="lesson-history" data-history></div></details>
    </div>`;
  const message = (text, error = false) => { const el = root.querySelector("[data-message]"); el.textContent = text; el.classList.toggle("error", error); };
  const failure = error => { console.error(error); message(t("No se pudo confirmar el cambio. ","The change could not be confirmed. ") + (error.message || "") + t(" Actualiza antes de repetirlo si tienes dudas."," Refresh before repeating it if you are unsure."), true); };
  function usableSlots() { const now = Date.now(); return slots.filter(s => s.status === "available" && !s.lessonId && s.startAt?.toMillis() > now && s.startAt.toMillis() <= now + 21 * DAY && s.googleCalendarBlocked === false && s.googleCalendarCheckedAt?.toMillis() >= now - 35 * 60000).sort((a,b) => a.startAt.toMillis()-b.startAt.toMillis()); }
  function slotOptions() { return `<option value="">${t("Selecciona un horario","Select a time")}</option>` + usableSlots().map(s => `<option value="${escape(s.id)}">${escape(format(s.startAt))}</option>`).join(""); }
  function renderSlots() { root.querySelectorAll("[data-slot]").forEach(select => { const value = select.value; select.innerHTML = slotOptions(); select.value = value; }); root.querySelector("[data-availability]").textContent=usableSlots().length?"":t("No hay horarios verificados disponibles. Publica disponibilidad o espera a la próxima revisión del calendario.","No verified times are available right now. Contact Elkin or check again later."); }
  function renderAccount() {
    root.querySelector("[data-settings]").hidden=!admin||!account;
    if(admin&&account){const form=root.querySelector("[data-duration]");if(!form.contains(document.activeElement))form.elements.durationMinutes.value=privateDuration(account);}
    root.querySelector('[data-topups]').hidden=!admin&&!account;
    root.querySelector("[data-content]").hidden = !account;
    root.querySelector("[data-account]").innerHTML = !account ? `<p>${t("Selecciona o activa un estudiante.","Elkin is preparing your account with your agreed price, class duration and remaining classes. You will receive an email when it is ready.")}</p>` :
      `<h3 style="margin-top:24px">${escape(account.fullName)}</h3><p><strong>${privateDuration(account)} ${t("minutos por clase","minutes per class")}</strong>${account.terms?` · ${account.terms.packageQuantity} ${t("clases por","classes for")} US$${account.terms.packageAmountUsd}`:""}</p><div class="lesson-stats">${[[account.credited,t("Clases acreditadas","Classes credited")],[account.used,t("Consumidas","Used")],[account.reserved,t("Reservadas","Reserved")],[account.credited-account.used-account.reserved,t("Disponibles","Available")]].map(([n,label]) => `<div class="lesson-stat"><strong>${n}</strong><span>${label}</span></div>`).join("")}</div><p class="lesson-note">${t("Las clases acreditadas incluyen el saldo inicial, los paquetes y los ajustes. Las reservadas siguen pendientes de realizar.","Classes credited include your opening balance, packages and adjustments. Reserved classes are still waiting to take place.")}</p>`;
    if(admin && account){const form=root.querySelector('[data-configure]');if(!form.contains(document.activeElement)){form.elements.termsMode.value=account.terms?'custom':'general';for(const key of ['durationMinutes','packageQuantity','packageAmountUsd','paymentUrl','paymentNote'])form.elements[key].value=account.terms?.[key]??({durationMinutes:privateDuration(account),packageQuantity:1}[key]??'');toggleTerms(form);}}
    const button = root.querySelector("[data-book] button"); button.disabled = busy || !account || account.credited-account.used-account.reserved < 1;
  }
  function renderLessons() {
    const ordered = [...lessons].sort((a,b) => (a.status === "reserved" ? 0 : 1) - (b.status === "reserved" ? 0 : 1) || (a.status === "reserved" ? a.startAt.toMillis()-b.startAt.toMillis() : b.startAt.toMillis()-a.startAt.toMillis()));
    root.querySelector("[data-lessons]").innerHTML = ordered.length ? ordered.map(lesson => {
      const allowed = admin || lesson.startAt.toMillis()-Date.now() >= DAY;
      return `<article class="lesson-row" data-lesson="${escape(lesson.id)}"><strong>${escape(format(lesson.startAt))}</strong> <span class="lesson-badge">${escape(status(lesson.status))}</span><p class="lesson-note">${lesson.durationMinutes||50} ${t("minutos","minutes")}</p>
        ${lesson.status === "reserved" ? allowed ? `<form data-change><label>${t("Nuevo horario para reprogramar","New time to reschedule")}<select name="slotId" data-slot>${slotOptions()}</select></label>${admin ? '<label>Motivo del cambio<input name="reason" minlength="3" maxlength="500" placeholder="Motivo para el historial"></label>' : ""}<button type="submit" name="action" value="reschedule">${t("Reprogramar","Reschedule")}</button><button type="submit" name="action" value="cancel">${t("Cancelar y devolver clase","Cancel and return credit")}</button>${admin && lesson.startAt.toMillis()-Date.now()<DAY ? '<button type="submit" name="action" value="late_cancel">Cancelación tardía · consumir clase</button>' : ""}${admin && lesson.startAt.toMillis()+(lesson.durationMinutes||50)*60000 <= Date.now() ? '<button type="submit" name="action" value="complete">Marcar realizada</button><button type="submit" name="action" value="no_show">Registrar ausencia · consumir clase</button>' : ""}</form>` : `<p class="lesson-note">${t("Quedan menos de 24 horas. Solo tú puedes hacer cambios.","Less than 24 hours remain. Contact Elkin to cancel or reschedule.")}</p>` : ""}</article>`;
    }).join("") : `<p class="lesson-note">${t("Todavía no hay clases registradas.","No lessons booked yet.")}</p>`;
  }
  function renderStudents() {
    const select = root.querySelector("[data-student]");
    select.innerHTML = '<option value="">Selecciona un estudiante</option>' + accounts.map(a => `<option value="${escape(a.id)}">${escape(a.fullName)} · ${a.credited-a.used-a.reserved} disponibles</option>`).join(""); select.value = uid;
    root.querySelector("[data-enrollments]").innerHTML = enrollments.filter(e => !accounts.some(a => a.id === e.id)).map(e => `<p>${escape(e.fullName)}<br>${escape(e.email)}</p>`).join("") || '<p>No hay cuentas pendientes.</p>';
  }
  function watchStudent(value) {
    studentStops.forEach(stop => stop()); studentStops = []; uid = value; account = undefined; lessons = []; renderAccount(); renderLessons();
    root.querySelector("[data-history]").textContent = "";
    if (!uid) return;
    studentStops.push(onSnapshot(doc(db,"privateAccounts",uid), snap => { account = snap.data(); renderAccount(); }, failure));
    studentStops.push(onSnapshot(query(collection(db,"privateLessons"),where("studentUid","==",uid)), snap => { lessons=snap.docs.map(d=>({id:d.id,...d.data()})); renderLessons(); }, failure));
    studentStops.push(onSnapshot(collection(db,"privateAccounts",uid,"history"), snap => {
      const history=snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt.toMillis()-a.createdAt.toMillis());
      root.querySelector("[data-history]").innerHTML=history.map(h=>`<div class="lesson-row"><strong>${escape(actionLabel(h.action))}${h.quantity ? ` · ${h.quantity>0?"+":""}${h.quantity}` : ""}</strong><small>${escape(format(h.createdAt))} · ${h.actorRole==="admin"?"Elkin":t("Estudiante","Student")}</small>${h.fromStartAt?`<p>${escape(format(h.fromStartAt))}${h.toStartAt?` → ${escape(format(h.toStartAt))}`:""}</p>`:h.toStartAt?`<p>${escape(format(h.toStartAt))}</p>`:""}<p>${escape(h.reason)}</p><small>${t("Disponibles después del cambio","Available after change")}: ${h.credited-h.used-h.reserved}</small></div>`).join("") || `<p>${t("Sin movimientos.","No activity yet.")}</p>`;
    }, failure));
  }
  async function execute(data, form) {
    if (busy) return;
    busy=true;
    if(admin)root.querySelector("[data-student]").disabled=true;
    root.querySelectorAll("button").forEach(b=>b.disabled=true);
    const key=JSON.stringify(data);
    if(!pending.has(key)) pending.set(key,crypto.randomUUID());
    message(t("Guardando…","Saving…"));
    try {
      const result=await call({...data,operationId:pending.get(key)});
      pending.delete(key); form?.reset();
      if(data.action==="correct_duration")form.elements.durationMinutes.value=data.durationMinutes;
      if(form?.elements.termsMode){if(data.action==="configure"){form.elements.termsMode.value=data.terms?"custom":"general";for(const key of ["durationMinutes","packageQuantity","packageAmountUsd","paymentUrl","paymentNote"])form.elements[key].value=data.terms?.[key]??({durationMinutes:privateDuration(account),packageQuantity:1}[key]??"");}toggleTerms(form);}
      document.dispatchEvent(new CustomEvent("private-lessons-changed"));
      message(t("Cambio guardado. El saldo y el historial se han actualizado.","Saved. Your balance and history have been updated."));
      if(data.action==="open") { watchStudent(result.data.studentUid); renderStudents(); }
    } catch(error) { failure(error); }
    finally { busy=false;if(admin)root.querySelector("[data-student]").disabled=false;root.querySelectorAll("button").forEach(b=>b.disabled=false);renderAccount(); }
  }
  function handleSubmit(event) {
    event.preventDefault(); const form=event.target;
    const values=Object.fromEntries(new FormData(form));
    if(form.matches("[data-open]")) return void execute({action:"open",...values,terms:readTerms(values),quantity:Number(values.quantity)},form);
    if(form.matches("[data-duration]")) return void execute({action:"correct_duration",studentUid:uid,durationMinutes:Number(values.durationMinutes),reason:values.reason},form);
    if(form.matches("[data-configure]")) return void execute({action:"configure",studentUid:uid,terms:readTerms(values),reason:values.reason},form);
    if(form.matches("[data-credit]")) return void execute({action:"credit",studentUid:uid,...values,quantity:Number(values.quantity)},form);
    if(form.matches("[data-book]")) return void execute({action:"book",studentUid:uid,slotId:values.slotId,reason:admin?"Reserva registrada por Elkin":""},form);
    if(form.matches("[data-change]")) {
      const action=event.submitter?.value;
      if(!action)return;
      if(action==="reschedule"&&!values.slotId) {message(t("Selecciona el nuevo horario.","Select the new time."),true);return;}
      if(admin && (!values.reason || values.reason.trim().length<3)) {message("Añade un motivo para el historial.",true);return;}
      if(!confirm(action==="cancel"?t("¿Cancelar esta clase y devolverla al saldo?","Cancel this lesson and return its credit?"):action==="late_cancel"?"¿Cancelar y consumir esta clase por cancelación tardía?":action==="no_show"?"¿Registrar ausencia y consumir esta clase?":t("¿Guardar este cambio?","Save this change?")))return;
      void execute({action,studentUid:uid,lessonId:form.closest("[data-lesson]").dataset.lesson,reason:values.reason||"",...(action==="reschedule"?{slotId:values.slotId}:{})},form);
    }
  }
  root.addEventListener("change",event=>{if(event.target.name==="termsMode")toggleTerms(event.target.form);});
  root.addEventListener("submit",handleSubmit);
  stops.push(onSnapshot(query(collection(db,"privateAvailability"),where("status","==","available")),snap=>{slots=snap.docs.map(d=>({id:d.id,...d.data()}));renderSlots();},failure));
  if(admin) {
    root.querySelector("[data-student]").addEventListener("change",event=>watchStudent(event.target.value));
    stops.push(onSnapshot(collection(db,"privateAccounts"),snap=>{accounts=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.fullName.localeCompare(b.fullName));renderStudents();},failure));
    stops.push(onSnapshot(collection(db,"privateEnrollments"),snap=>{enrollments=snap.docs.map(d=>({id:d.id,...d.data()}));renderStudents();},failure));
  } else watchStudent(uid);
  const interval=setInterval(()=>{if(!busy && !root.contains(document.activeElement)){renderSlots();renderLessons();}},30000);
  const stopTopups=mountPrivateTopups(root.querySelector('[data-topups]'),app,admin);
  return ()=>{clearInterval(interval);stopTopups();root.removeEventListener("submit",handleSubmit);studentStops.forEach(stop=>stop());stops.forEach(stop=>stop());root.replaceChildren();};
}

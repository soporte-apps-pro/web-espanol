import { getApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, deleteDoc, doc, getDocsFromServer, getFirestore, orderBy, query, serverTimestamp, Timestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { adminUid } from "./firebase-config.js";

const app = getApp();
const auth = getAuth(app);
const database = getFirestore(app);
const form = document.querySelector("#private-slot-form");
const slotType = document.querySelector("#private-slot-type");
const recurrenceFields = document.querySelector("#private-recurrence-fields");
const recurrenceWeeks = document.querySelector("#private-recurrence-weeks");
const list = document.querySelector("#private-bookings");
const message = document.querySelector("#private-message");
const GOOGLE_CHECK_MAX_AGE_MINUTES = 10;
let slots = [];
let requests = [];

slotType.addEventListener("change", () => {
  const recurring = slotType.value === "weekly";
  recurrenceFields.hidden = !recurring;
  recurrenceWeeks.required = recurring;
});

function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function setMessage(text, type="error") { message.textContent=text; message.className=`message ${type}`; }
function formatColombia(timestamp) { return timestamp?.toDate ? new Intl.DateTimeFormat("es-CO", { dateStyle:"medium", timeStyle:"short", timeZone:"America/Bogota" }).format(timestamp.toDate()) : "Sin fecha"; }
function requestFor(slot) {
  if (slot.status === "available") return undefined;
  return requests.find((item) => item.slotId === slot.id && item.status !== "rejected");
}
function statusLabel(status) { return ({available:"Disponible",held:"Retención temporal",payment_review:"Pago por verificar",confirmed:"Confirmado",rejected:"Rechazado",closed:"Cerrado",cancelled_by_admin:"Cancelado por fuerza mayor"})[status] || status; }
function googleCleared(slot) { const checkedAt=slot.googleCalendarCheckedAt?.toDate?.(); return slot.googleCalendarBlocked === false && checkedAt && checkedAt.getTime() >= Date.now() - GOOGLE_CHECK_MAX_AGE_MINUTES*60000; }
function googleStatus(slot) { if (slot.googleCalendarBlocked === true) return "Google Calendar: bloqueado"; if (googleCleared(slot)) return "Google Calendar: libre y verificado"; return "Google Calendar: pendiente de revisión"; }

function render() {
  document.querySelector("#private-tab-count").textContent = requests.filter((item) => item.status === "payment_review").length;
  list.innerHTML = slots.length ? slots.map((slot) => {
    const request = requestFor(slot);
    return `<details class="private-card" data-slot-id="${escapeHtml(slot.id)}" ${request?.status === "payment_review" ? "open" : ""}>
      <summary class="group-card-head"><div><h3>${escapeHtml(formatColombia(slot.startAt))}</h3><span class="muted">50 minutos · hora Colombia<br>${escapeHtml(googleStatus(slot))}</span></div><span class="pill">${escapeHtml(statusLabel(slot.status))}</span></summary>
      <div class="private-card-body">
      ${request ? `<div class="private-meta"><div><small>Estudiante</small><strong>${escapeHtml(request.fullName)}</strong><br><a href="mailto:${escapeHtml(request.email)}">${escapeHtml(request.email)}</a></div><div><small>Paquete</small><strong>${escapeHtml(request.packageLabel)}</strong><br>US$${Number(request.amountUsd).toFixed(2)}</div><div><small>Zona del estudiante</small><strong>${escapeHtml(request.studentTimeZone)}</strong></div><div><small>Método</small><strong>${escapeHtml(request.paymentMethod)}</strong></div><div><small>Referencia</small><strong>${escapeHtml(request.paymentReference)}</strong></div><div><small>Pagador</small><strong>${escapeHtml(request.payerName)}</strong></div></div>
      ${request.status === "payment_review" ? '<div class="card-actions"><button class="button secondary" type="button" data-reject>Rechazar / liberar</button><button class="button" type="button" data-confirm>Pago verificado · confirmar</button></div>' : ""}` : '<p class="muted">Nadie ha iniciado el pago para este horario.</p>'}
      ${request?.status === "confirmed" && slot.status === "confirmed" ? `<div class="group-member-editor"><strong>Acciones excepcionales</strong><p class="muted">Úsalas únicamente por fuerza mayor. Requieren confirmación escrita.</p><label for="reschedule-${escapeHtml(slot.id)}">Nuevo horario disponible</label><select id="reschedule-${escapeHtml(slot.id)}" data-reschedule-target><option value="">Selecciona un horario</option>${slots.filter((item) => item.status === "available" && googleCleared(item) && item.startAt?.toDate() > new Date()).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(formatColombia(item.startAt))}</option>`).join("")}</select><div class="card-actions"><button class="button secondary" type="button" data-cancel-booking>Cancelar por fuerza mayor</button><button class="button" type="button" data-reschedule-booking>Reagendar reserva</button></div></div>` : ""}
      ${slot.status === "available" && !request ? '<div class="card-actions"><button class="button secondary" type="button" data-close-slot>Cerrar horario disponible</button></div>' : ""}
      </div>
    </details>`;
  }).join("") : '<div class="empty">Aún no has publicado horarios privados.</div>';
  list.querySelectorAll("[data-confirm]").forEach((button) => button.addEventListener("click", () => decide(button.closest("[data-slot-id]").dataset.slotId, true)));
  list.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", () => decide(button.closest("[data-slot-id]").dataset.slotId, false)));
  list.querySelectorAll("[data-close-slot]").forEach((button) => button.addEventListener("click", () => closeAvailableSlot(button.closest("[data-slot-id]").dataset.slotId, button)));
  list.querySelectorAll("[data-cancel-booking]").forEach((button) => button.addEventListener("click", () => cancelConfirmedBooking(button.closest("[data-slot-id]").dataset.slotId, button)));
  list.querySelectorAll("[data-reschedule-booking]").forEach((button) => button.addEventListener("click", () => rescheduleConfirmedBooking(button.closest("[data-slot-id]").dataset.slotId, button)));
}

function exceptionalReason(actionLabel) {
  const reason = window.prompt(`Describe brevemente el motivo de fuerza mayor para ${actionLabel.toLowerCase()}. Este texto quedará registrado.`)?.trim();
  if (!reason) return null;
  if (!window.confirm(`${actionLabel}: esta acción afecta una reserva confirmada y requerirá avisar al estudiante. ¿Deseas continuar?`)) return null;
  const confirmation = window.prompt(`Para confirmar definitivamente, escribe ${actionLabel.toUpperCase()}.`);
  return confirmation === actionLabel.toUpperCase() ? reason : null;
}

async function cancelConfirmedBooking(slotId, button) {
  const slot = slots.find((item) => item.id === slotId); const request = requestFor(slot);
  if (!slot || slot.status !== "confirmed" || request?.status !== "confirmed") return;
  const reason = exceptionalReason("CANCELAR");
  if (!reason) { setMessage("Cancelación detenida. No se realizó ningún cambio."); return; }
  button.disabled = true;
  const batch = writeBatch(database);
  batch.update(doc(database,"privateAvailability",slotId), { status:"closed" });
  batch.update(doc(database,"privateBookingRequests",request.id), { status:"cancelled_by_admin", cancellationReason:reason, cancelledAt:serverTimestamp() });
  try { await batch.commit(); setMessage("Reserva cancelada por fuerza mayor. El registro fue conservado; debes notificar al estudiante.","success"); await load(); }
  catch(error) { console.error(error); setMessage(`No fue posible cancelar (${error?.code || "error"}).`); button.disabled=false; }
}

async function rescheduleConfirmedBooking(slotId, button) {
  const card = button.closest("[data-slot-id]"); const targetId = card.querySelector("[data-reschedule-target]").value;
  const slot = slots.find((item) => item.id === slotId); const target = slots.find((item) => item.id === targetId); const request = requestFor(slot);
  if (!targetId) { setMessage("Selecciona primero el nuevo horario disponible."); return; }
  if (!slot || slot.status !== "confirmed" || request?.status !== "confirmed" || !target || target.status !== "available" || !googleCleared(target)) { setMessage("El nuevo horario no está libre y verificado por Google Calendar. Actualiza el panel."); return; }
  const reason = exceptionalReason("REAGENDAR");
  if (!reason) { setMessage("Reagendamiento detenido. No se realizó ningún cambio."); return; }
  button.disabled = true;
  const batch = writeBatch(database);
  batch.update(doc(database,"privateAvailability",slotId), { status:"closed" });
  batch.update(doc(database,"privateAvailability",targetId), { status:"confirmed", heldBy:request.studentUid, bookingRequestId:request.id });
  batch.update(doc(database,"privateBookingRequests",request.id), { slotId:targetId, colombiaStart:target.startAt, rescheduleReason:reason, rescheduledAt:serverTimestamp() });
  try { await batch.commit(); setMessage("Reserva reagendada y registro actualizado. Debes notificar al estudiante con la nueva hora local.","success"); await load(); }
  catch(error) { console.error(error); setMessage(`No fue posible reagendar (${error?.code || "error"}).`); button.disabled=false; }
}

async function closeAvailableSlot(slotId, button) {
  const slot = slots.find((item) => item.id === slotId);
  if (!slot || slot.status !== "available" || requestFor(slot)) return;
  if (!window.confirm(`¿Cerrar el horario ${formatColombia(slot.startAt)}? Dejará de aparecer públicamente.`)) return;
  button.disabled = true;
  try {
    await deleteDoc(doc(database, "privateAvailability", slotId));
    setMessage("Horario disponible cerrado correctamente.", "success");
    await load();
  } catch (error) {
    console.error(error);
    setMessage(`No fue posible cerrar el horario (${error?.code || "error"}).`);
    button.disabled = false;
  }
}

async function load() {
  const [slotSnapshot, requestSnapshot] = await Promise.all([
    getDocsFromServer(query(collection(database,"privateAvailability"), orderBy("startAt","asc"))),
    getDocsFromServer(query(collection(database,"privateBookingRequests"), orderBy("createdAt","desc"))),
  ]);
  slots = slotSnapshot.docs.map((item) => ({id:item.id,...item.data()}));
  requests = requestSnapshot.docs.map((item) => ({id:item.id,...item.data()}));
  render();
}

async function decide(slotId, confirmed) {
  const slot = slots.find((item) => item.id === slotId); const request = requestFor(slot);
  if (!request || request.status !== "payment_review") return;
  const batch = writeBatch(database);
  batch.update(doc(database,"privateBookingRequests",request.id), { status:confirmed ? "confirmed" : "rejected", reviewedAt:serverTimestamp() });
  batch.update(doc(database,"privateAvailability",slotId), confirmed
    ? { status:"confirmed", bookingRequestId:request.id }
    : { status:"available", heldBy:"", bookingRequestId:"", holdExpiresAt:Timestamp.fromMillis(0) });
  try { await batch.commit(); setMessage(confirmed ? "Pago verificado y horario confirmado." : "Solicitud rechazada y horario liberado.", "success"); await load(); }
  catch (error) { console.error(error); setMessage(`No fue posible actualizar (${error?.code || "error"}).`); }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); const data = new FormData(form); const date=String(data.get("date")); const time=String(data.get("time"));
  const type = String(data.get("slotType"));
  const weeks = type === "weekly" ? Number(data.get("weeks")) : 1;
  const start = new Date(`${date}T${time}:00-05:00`);
  if (!Number.isFinite(start.getTime()) || start <= new Date()) { setMessage("Selecciona una fecha y hora futuras."); return; }
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52 || (type === "weekly" && weeks < 2)) { setMessage("Selecciona una cantidad válida de semanas, entre 2 y 52."); return; }
  const starts = Array.from({length:weeks}, (_, index) => new Date(start.getTime() + index * 7 * 24 * 60 * 60 * 1000));
  const activeTimes = new Set(slots.filter((slot) => slot.status !== "closed").map((slot) => slot.startAt?.toMillis?.()));
  const newStarts = starts.filter((item) => !activeTimes.has(item.getTime()));
  const duplicates = starts.length - newStarts.length;
  if (!newStarts.length) { setMessage("Todos esos horarios ya están publicados."); return; }
  const description = type === "weekly" ? `${newStarts.length} horarios semanales` : "el horario individual";
  const duplicateNotice = duplicates ? ` Se omitirán ${duplicates} que ya existen.` : "";
  if (!window.confirm(`Vas a publicar ${description}, siempre en hora Colombia.${duplicateNotice} ¿Deseas continuar?`)) return;
  const submit=form.querySelector('[type="submit"]'); submit.disabled=true;
  try {
    const batch = writeBatch(database);
    const seriesId = type === "weekly" ? crypto.randomUUID() : "";
    newStarts.forEach((item) => batch.set(doc(collection(database,"privateAvailability")), { startAt:Timestamp.fromDate(item), durationMinutes:50, colombiaTimeZone:"America/Bogota", availabilityType:type, recurrenceSeriesId:seriesId, status:"available", heldBy:"", holdExpiresAt:Timestamp.fromMillis(0), bookingRequestId:"", googleCalendarBlocked:true, googleCalendarCheckedAt:Timestamp.fromMillis(0), createdAt:serverTimestamp() }));
    await batch.commit();
    form.reset(); slotType.dispatchEvent(new Event("change"));
    setMessage(`${newStarts.length} horario${newStarts.length === 1 ? "" : "s"} publicado${newStarts.length === 1 ? "" : "s"}. Aparecerá${newStarts.length === 1 ? "" : "n"} públicamente cuando Google Calendar lo verifique.${duplicates ? ` Se omitieron ${duplicates} duplicados.` : ""}`,"success");
    await load();
  }
  catch(error){ console.error(error); setMessage(`No fue posible publicar (${error?.code || "error"}).`); }
  finally { submit.disabled=false; }
});

onAuthStateChanged(auth, (user) => { if (user?.uid === adminUid) load().catch((error) => { console.error(error); setMessage("No fue posible cargar el calendario privado."); }); });

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
const weekGrid = document.querySelector("#private-week-grid");
const weekTitle = document.querySelector("#private-week-title");
const mobileWeek = document.querySelector("#private-week-mobile");
const GOOGLE_CHECK_MAX_AGE_MINUTES = 10;
const START_HOUR = 7;
const END_HOUR = 19;
let slots = [];
let requests = [];
let visibleWeek = mondayOf(colombiaToday());

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
function colombiaToday() { const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map((part)=>[part.type,part.value])); return new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),12)); }
function mondayOf(date) { const result=new Date(date); result.setUTCDate(result.getUTCDate()-((result.getUTCDay()+6)%7)); return result; }
function addDays(date, days) { const result=new Date(date); result.setUTCDate(result.getUTCDate()+days); return result; }
function dateKey(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`; }
function colombiaParts(timestamp) { const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(timestamp.toDate()).map((part)=>[part.type,part.value])); return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute)}; }
function privateWeekHeading() { const end=addDays(visibleWeek,6); return `${new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short",timeZone:"UTC"}).format(visibleWeek)} – ${new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(end)}`; }
function weekStatusClass(slot) { if (slot.googleCalendarBlocked === true || slot.status === "closed") return "blocked"; if (slot.status === "confirmed") return "confirmed"; if (["held","payment_review"].includes(slot.status)) return "pending"; return "available"; }
function statusLabel(status) { return ({available:"Disponible",held:"Retención temporal",payment_review:"Pago por verificar",confirmed:"Confirmado",rejected:"Rechazado",closed:"Cerrado",cancelled_by_admin:"Cancelado por fuerza mayor"})[status] || status; }
function googleCleared(slot) { const checkedAt=slot.googleCalendarCheckedAt?.toDate?.(); return slot.googleCalendarBlocked === false && checkedAt && checkedAt.getTime() >= Date.now() - GOOGLE_CHECK_MAX_AGE_MINUTES*60000; }
function googleStatus(slot) { if (slot.googleCalendarBlocked === true) return "Google Calendar: bloqueado"; if (googleCleared(slot)) return "Google Calendar: libre y verificado"; return "Google Calendar: pendiente de revisión"; }

function renderPrivateWeek() {
  weekTitle.textContent=privateWeekHeading(); const today=dateKey(colombiaToday()); const rows=(END_HOUR-START_HOUR)*2; let html='<div class="week-corner"></div>';
  for(let day=0;day<7;day++){const date=addDays(visibleWeek,day),key=dateKey(date);html+=`<div class="week-day-head ${key===today?"today":""}" style="grid-column:${day+2};grid-row:1">${new Intl.DateTimeFormat("es-CO",{weekday:"short",timeZone:"UTC"}).format(date)}<small>${new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short",timeZone:"UTC"}).format(date)}</small></div>`;}
  for(let row=0;row<rows;row++){const total=START_HOUR*60+row*30,time=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;html+=`<div class="week-time" style="grid-column:1;grid-row:${row+2}">${row%2===0?time:""}</div>`;for(let day=0;day<7;day++){const date=dateKey(addDays(visibleWeek,day));html+=`<button class="week-cell" type="button" data-week-date="${date}" data-week-time="${time}" style="grid-column:${day+2};grid-row:${row+2}" aria-label="Preparar ${date} ${time}"></button>`;}}
  slots.forEach(slot=>{if(!slot.startAt?.toDate)return;const parts=colombiaParts(slot.startAt),offset=Math.round((new Date(`${parts.date}T12:00:00Z`)-visibleWeek)/86400000);if(offset<0||offset>6||parts.hour<START_HOUR||parts.hour>=END_HOUR)return;const row=2+(parts.hour-START_HOUR)*2+(parts.minute>=30?1:0),request=requestFor(slot);html+=`<button class="week-event private-week-event ${weekStatusClass(slot)}" type="button" data-week-slot="${escapeHtml(slot.id)}" style="grid-column:${offset+2};grid-row:${row}/span 2"><strong>${String(parts.hour).padStart(2,"0")}:${String(parts.minute).padStart(2,"0")}</strong><br>${escapeHtml(request?.fullName||statusLabel(slot.status))}</button>`;});
  weekGrid.innerHTML=html;
  weekGrid.querySelectorAll("[data-week-date]").forEach(button=>button.addEventListener("click",()=>{form.elements.date.value=button.dataset.weekDate;form.elements.time.value=button.dataset.weekTime;form.scrollIntoView({behavior:"smooth",block:"center"});form.elements.slotType.focus();setMessage("Horario preparado. Elige si será individual o recurrente y publícalo.","success");}));
  weekGrid.querySelectorAll("[data-week-slot]").forEach(button=>button.addEventListener("click",()=>{const card=list.querySelector(`[data-slot-id="${CSS.escape(button.dataset.weekSlot)}"]`);if(!card)return;card.closest(".private-series-card")?.setAttribute("open","");card.setAttribute("open","");card.scrollIntoView({behavior:"smooth",block:"center"});}));
  const slotsByDate=new Map();slots.forEach(slot=>{if(!slot.startAt?.toDate)return;const parts=colombiaParts(slot.startAt);if(!slotsByDate.has(parts.date))slotsByDate.set(parts.date,[]);slotsByDate.get(parts.date).push({slot,parts});});
  mobileWeek.innerHTML=Array.from({length:7},(_,day)=>{const date=addDays(visibleWeek,day),key=dateKey(date),daySlots=slotsByDate.get(key)||[];const rows=Array.from({length:(END_HOUR-START_HOUR)*2},(_,row)=>{const total=START_HOUR*60+row*30,time=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`,match=daySlots.find(item=>item.parts.hour===Math.floor(total/60)&&item.parts.minute===total%60);if(match){const request=requestFor(match.slot);return `<button class="mobile-time-row ${weekStatusClass(match.slot)}" type="button" data-mobile-slot="${escapeHtml(match.slot.id)}"><strong>${time}</strong><span>${escapeHtml(request?.fullName||statusLabel(match.slot.status))}</span></button>`;}return `<button class="mobile-time-row available" type="button" data-mobile-date="${key}" data-mobile-time="${time}"><strong>${time}</strong><span>Preparar disponibilidad</span></button>`;}).join("");return `<details class="mobile-day ${key===today?"today":""}" ${key===today?"open":""}><summary>${new Intl.DateTimeFormat("es-CO",{weekday:"long",day:"numeric",month:"short",timeZone:"UTC"}).format(date)}</summary><div class="mobile-day-body">${rows}</div></details>`;}).join("");
  mobileWeek.querySelectorAll("[data-mobile-date]").forEach(button=>button.addEventListener("click",()=>{form.elements.date.value=button.dataset.mobileDate;form.elements.time.value=button.dataset.mobileTime;form.scrollIntoView({behavior:"smooth",block:"center"});setMessage("Horario preparado. Elige si será individual o recurrente y publícalo.","success");}));
  mobileWeek.querySelectorAll("[data-mobile-slot]").forEach(button=>button.addEventListener("click",()=>{const card=list.querySelector(`[data-slot-id="${CSS.escape(button.dataset.mobileSlot)}"]`);if(!card)return;card.closest(".private-series-card")?.setAttribute("open","");card.setAttribute("open","");card.scrollIntoView({behavior:"smooth",block:"center"});}));
}

function slotCard(slot) {
  const request = requestFor(slot);
  return `<details class="private-card private-slot-card" data-slot-id="${escapeHtml(slot.id)}" ${request?.status === "payment_review" ? "open" : ""}>
    <summary class="group-card-head"><div><h3>${escapeHtml(formatColombia(slot.startAt))}</h3><span class="muted">50 minutos · hora Colombia<br>${escapeHtml(googleStatus(slot))}</span></div><span class="pill">${escapeHtml(statusLabel(slot.status))}</span></summary>
    <div class="private-card-body">
    ${request ? `<div class="private-meta"><div><small>Estudiante</small><strong>${escapeHtml(request.fullName)}</strong><br><a href="mailto:${escapeHtml(request.email)}">${escapeHtml(request.email)}</a></div><div><small>Paquete</small><strong>${escapeHtml(request.packageLabel)}</strong><br>US$${Number(request.amountUsd).toFixed(2)}</div><div><small>Zona del estudiante</small><strong>${escapeHtml(request.studentTimeZone)}</strong></div><div><small>Método</small><strong>${escapeHtml(request.paymentMethod)}</strong></div><div><small>Referencia</small><strong>${escapeHtml(request.paymentReference)}</strong></div><div><small>Pagador</small><strong>${escapeHtml(request.payerName)}</strong></div></div>
    ${request.status === "payment_review" ? '<div class="card-actions"><button class="button secondary" type="button" data-reject>Rechazar / liberar</button><button class="button" type="button" data-confirm>Pago verificado · confirmar</button></div>' : ""}` : '<p class="muted">Nadie ha iniciado el pago para este horario.</p>'}
    ${request?.status === "confirmed" && slot.status === "confirmed" ? `<div class="group-member-editor"><strong>Acciones excepcionales</strong><p class="muted">Úsalas únicamente por fuerza mayor. Requieren confirmación escrita.</p><label for="reschedule-${escapeHtml(slot.id)}">Nuevo horario disponible</label><select id="reschedule-${escapeHtml(slot.id)}" data-reschedule-target><option value="">Selecciona un horario</option>${slots.filter((item) => item.status === "available" && googleCleared(item) && item.startAt?.toDate() > new Date()).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(formatColombia(item.startAt))}</option>`).join("")}</select><div class="card-actions"><button class="button secondary" type="button" data-cancel-booking>Cancelar por fuerza mayor</button><button class="button" type="button" data-reschedule-booking>Reagendar reserva</button></div></div>` : ""}
    ${slot.status === "available" && !request ? '<div class="card-actions"><button class="button secondary" type="button" data-close-slot>Cerrar horario disponible</button></div>' : ""}
    </div>
  </details>`;
}

function seriesLabel(seriesSlots) {
  const first = seriesSlots[0].startAt.toDate();
  return new Intl.DateTimeFormat("es-CO", { weekday:"long", hour:"numeric", minute:"2-digit", hour12:true, timeZone:"America/Bogota" }).format(first);
}

function render() {
  document.querySelector("#private-tab-count").textContent = requests.filter((item) => item.status === "payment_review").length;
  const series = new Map();
  const individual = [];
  slots.forEach((slot) => {
    if (slot.recurrenceSeriesId) {
      if (!series.has(slot.recurrenceSeriesId)) series.set(slot.recurrenceSeriesId, []);
      series.get(slot.recurrenceSeriesId).push(slot);
    } else individual.push(slot);
  });
  const seriesCards = [...series.values()].map((items) => {
    const pending = items.some((slot) => requestFor(slot)?.status === "payment_review");
    const availableCount = items.filter((slot) => slot.status === "available").length;
    return `<details class="private-card private-series-card" ${pending ? "open" : ""}>
      <summary class="group-card-head"><div><p class="eyebrow">Serie recurrente</p><h3>${escapeHtml(seriesLabel(items))}</h3><span class="muted">${items.length} fechas · ${escapeHtml(formatColombia(items[0].startAt))} — ${escapeHtml(formatColombia(items.at(-1).startAt))}</span></div><span class="pill">${availableCount} disponibles</span></summary>
      <div class="private-series-slots">${items.map(slotCard).join("")}</div>
    </details>`;
  }).join("");
  const individualPending = individual.some((slot) => requestFor(slot)?.status === "payment_review");
  const individualCards = individual.length ? `<details class="private-card private-series-card private-individual-group" ${individualPending ? "open" : ""}>
    <summary class="group-card-head"><div><p class="eyebrow">Fechas individuales</p><h3>Horarios individuales</h3><span class="muted">${individual.length} fecha${individual.length === 1 ? "" : "s"} publicada${individual.length === 1 ? "" : "s"}</span></div><span class="pill">Abrir</span></summary>
    <div class="private-series-slots">${individual.map(slotCard).join("")}</div>
  </details>` : "";
  const summary = slots.length ? `<p class="private-list-summary">${series.size} serie${series.size === 1 ? "" : "s"} recurrente${series.size === 1 ? "" : "s"} · ${individual.length} horario${individual.length === 1 ? "" : "s"} individual${individual.length === 1 ? "" : "es"}</p>` : "";
  list.innerHTML = slots.length ? `${summary}${seriesCards}${individualCards}` : '<div class="empty">Aún no has publicado horarios privados.</div>';
  list.querySelectorAll("[data-confirm]").forEach((button) => button.addEventListener("click", () => decide(button.closest("[data-slot-id]").dataset.slotId, true)));
  list.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", () => decide(button.closest("[data-slot-id]").dataset.slotId, false)));
  list.querySelectorAll("[data-close-slot]").forEach((button) => button.addEventListener("click", () => closeAvailableSlot(button.closest("[data-slot-id]").dataset.slotId, button)));
  list.querySelectorAll("[data-cancel-booking]").forEach((button) => button.addEventListener("click", () => cancelConfirmedBooking(button.closest("[data-slot-id]").dataset.slotId, button)));
  list.querySelectorAll("[data-reschedule-booking]").forEach((button) => button.addEventListener("click", () => rescheduleConfirmedBooking(button.closest("[data-slot-id]").dataset.slotId, button)));
  renderPrivateWeek();
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
document.querySelector("#private-week-prev").addEventListener("click",()=>{ visibleWeek=addDays(visibleWeek,-7); renderPrivateWeek(); });
document.querySelector("#private-week-next").addEventListener("click",()=>{ visibleWeek=addDays(visibleWeek,7); renderPrivateWeek(); });
document.querySelector("#private-week-today").addEventListener("click",()=>{ visibleWeek=mondayOf(colombiaToday()); renderPrivateWeek(); });

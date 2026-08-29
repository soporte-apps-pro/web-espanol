import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDocsFromServer,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  adminUid,
  firebaseConfig,
  recaptchaEnterpriseSiteKey,
} from "./firebase-config.js";

const PAYMENT_NOTIFICATION_URL = "https://script.google.com/macros/s/AKfycbwW0dtawkiixLv6akVE2mdPIO8AZwKCRtrRut1D_Hn8QWN7yrPeG9_33JtvaK3Yy7xC/exec";

const app = initializeApp(firebaseConfig);
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),
  isTokenAutoRefreshEnabled: true,
});

const auth = getAuth(app);
const database = getFirestore(app);
const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const signOutButton = document.querySelector("#sign-out");
const refreshButton = document.querySelector("#refresh-applications");
const searchInput = document.querySelector("#search-applications");
const statusFilter = document.querySelector("#filter-status");
const applicationsContainer = document.querySelector("#applications");
const emptyState = document.querySelector("#empty-state");
const resultCount = document.querySelector("#result-count");
const groupForm = document.querySelector("#group-form");
const groupMemberOptions = document.querySelector("#group-member-options");
const groupsList = document.querySelector("#groups-list");
const groupsMessage = document.querySelector("#groups-message");
const adminTabs = [...document.querySelectorAll("[data-admin-tab]")];
const adminPanels = [...document.querySelectorAll("[data-admin-panel]")];
const paymentLists = document.querySelector("#payment-lists");
const accessList = document.querySelector("#access-list");
const accessMessage = document.querySelector("#access-message");

const statusLabels = {
  new: "Nueva",
  contacted: "Contactada",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

const slotLabels = {
  "monday-1000": "Lunes · 10:00 Colombia",
  "tuesday-1700": "Martes · 17:00 Colombia",
  "wednesday-0800": "Miércoles · 08:00 Colombia",
  "thursday-1400": "Jueves · 14:00 Colombia",
  "friday-1100": "Viernes · 11:00 Colombia",
};

let applications = [];
let groups = [];
let studentProfiles = [];

async function notifyAccessActivation(documentId) {
  try {
    await fetch(PAYMENT_NOTIFICATION_URL, {
      method: "POST", mode: "no-cors", headers: { "Content-Type":"text/plain;charset=UTF-8" },
      body: JSON.stringify({ type:"activation", documentId }),
    });
  } catch (error) { console.error("Activation email could not be requested", error); }
}

function setMessage(element, text, type = "error") {
  element.textContent = text;
  element.className = `message ${type}`;
}

function clearMessage(element) {
  element.textContent = "";
  element.className = "message hidden";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(timestamp.toDate());
}

function updateStats() {
  document.querySelector("#applications-tab-count").textContent = applications.length;
  document.querySelector("#stat-total").textContent = applications.length;
  document.querySelector("#stat-new").textContent = applications.filter((item) => item.status === "new").length;
  document.querySelector("#stat-contacted").textContent = applications.filter((item) => item.status === "contacted").length;
  document.querySelector("#stat-accepted").textContent = applications.filter((item) => item.status === "accepted").length;
}

function applicationCard(application) {
  const statusOptions = Object.entries(statusLabels)
    .map(([value, label]) => `<option value="${value}" ${application.status === value ? "selected" : ""}>${label}</option>`)
    .join("");
  const slots = (application.candidateSlots || []).map((slot) => slotLabels[slot] || slot).join(" · ");

  return `
    <details class="application" id="application-${escapeHtml(application.id)}" data-application-id="${escapeHtml(application.id)}">
      <summary>
      <div class="application-top">
        <div>
          <h2>${escapeHtml(application.fullName)}</h2>
          <a href="mailto:${escapeHtml(application.email)}">${escapeHtml(application.email)}</a>
          <div class="application-summary-meta">
            <span><strong>${escapeHtml(application.spanishLevel)}</strong></span>
            <span>${escapeHtml(application.country)}</span>
            <span>${escapeHtml(slots)}</span>
          </div>
        </div>
        <span class="pill">${escapeHtml(statusLabels[application.status] || application.status)}</span>
      </div>
      </summary>
      <div class="application-body">
      <div class="details">
        <div class="detail"><b>País</b><span>${escapeHtml(application.country)}</span></div>
        <div class="detail"><b>Nivel</b><span>${escapeHtml(application.spanishLevel)}</span></div>
        <div class="detail"><b>Zona horaria</b><span>${escapeHtml(application.timeZone)}</span></div>
        <div class="detail"><b>Disponibilidad</b><span>${escapeHtml(slots)}</span></div>
        <div class="detail"><b>Recibida</b><span>${escapeHtml(formatDate(application.createdAt))}</span></div>
        <div class="detail"><b>Cohorte</b><span>${escapeHtml(application.cohort)}</span></div>
      </div>
      <p class="goal"><strong>Objetivo:</strong> ${escapeHtml(application.goal)}</p>
      <section class="admin-fields" aria-label="Seguimiento administrativo">
        <h3>Seguimiento privado</h3>
        <div>
          <label for="contact-date-${escapeHtml(application.id)}">Fecha de contacto</label>
          <input id="contact-date-${escapeHtml(application.id)}" type="date" data-contact-date value="${escapeHtml(application.contactDate || "")}">
        </div>
        <div>
          <label for="assigned-group-${escapeHtml(application.id)}">Grupo asignado</label>
          <input id="assigned-group-${escapeHtml(application.id)}" type="text" data-assigned-group maxlength="80" placeholder="Ej. Grupo B1 · Lunes 10:00" value="${escapeHtml(application.assignedGroup || "")}">
        </div>
        <div class="admin-notes">
          <label for="admin-notes-${escapeHtml(application.id)}">Notas administrativas</label>
          <textarea id="admin-notes-${escapeHtml(application.id)}" data-admin-notes maxlength="2000" placeholder="Seguimiento, necesidades y acuerdos con el estudiante">${escapeHtml(application.adminNotes || "")}</textarea>
        </div>
        <div class="payment-fields">
          <h3>Inscripción y pago</h3>
          <div>
            <label for="payment-status-${escapeHtml(application.id)}">Estado del pago</label>
            <select id="payment-status-${escapeHtml(application.id)}" data-payment-status>
              <option value="pending" ${(application.paymentStatus || "pending") === "pending" ? "selected" : ""}>Pendiente</option>
              <option value="paid" ${application.paymentStatus === "paid" ? "selected" : ""}>Pagado</option>
              <option value="refunded" ${application.paymentStatus === "refunded" ? "selected" : ""}>Reembolsado</option>
            </select>
          </div>
          <div>
            <label for="expected-amount-${escapeHtml(application.id)}">Valor esperado (USD)</label>
            <input id="expected-amount-${escapeHtml(application.id)}" type="number" data-expected-amount min="0" max="10000" step="0.01" value="${escapeHtml(application.expectedAmount ?? 84)}">
          </div>
          <div>
            <label for="paid-amount-${escapeHtml(application.id)}">Valor recibido (USD)</label>
            <input id="paid-amount-${escapeHtml(application.id)}" type="number" data-paid-amount min="0" max="10000" step="0.01" value="${escapeHtml(application.paidAmount ?? 0)}">
          </div>
          <div>
            <label for="payment-date-${escapeHtml(application.id)}">Fecha de pago</label>
            <input id="payment-date-${escapeHtml(application.id)}" type="date" data-payment-date value="${escapeHtml(application.paymentDate || "")}">
          </div>
          <div>
            <label for="payment-method-${escapeHtml(application.id)}">Método</label>
            <select id="payment-method-${escapeHtml(application.id)}" data-payment-method>
              <option value="" ${!application.paymentMethod ? "selected" : ""}>Sin registrar</option>
              <option value="transfer" ${application.paymentMethod === "transfer" ? "selected" : ""}>Transferencia</option>
              <option value="paypal" ${application.paymentMethod === "paypal" ? "selected" : ""}>PayPal</option>
              <option value="cash" ${application.paymentMethod === "cash" ? "selected" : ""}>Efectivo</option>
              <option value="other" ${application.paymentMethod === "other" ? "selected" : ""}>Otro</option>
            </select>
          </div>
          <div class="payment-reference">
            <label for="payment-reference-${escapeHtml(application.id)}">Referencia o nota del pago</label>
            <input id="payment-reference-${escapeHtml(application.id)}" type="text" data-payment-reference maxlength="160" value="${escapeHtml(application.paymentReference || "")}">
          </div>
        </div>
        <div class="admin-save">
          <button class="button" type="button" data-save-admin>Guardar seguimiento y pago</button>
        </div>
      </section>
      <div class="card-actions">
        <label for="status-${escapeHtml(application.id)}">Estado</label>
        <select id="status-${escapeHtml(application.id)}" data-status-select>${statusOptions}</select>
      </div>
      </div>
    </details>`;
}

function renderApplications() {
  const search = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const filtered = applications.filter((application) => {
    const matchesStatus = status === "all" || application.status === status;
    const haystack = `${application.fullName} ${application.email} ${application.country}`.toLowerCase();
    return matchesStatus && (!search || haystack.includes(search));
  });

  applicationsContainer.innerHTML = filtered.map(applicationCard).join("");
  emptyState.classList.toggle("hidden", filtered.length > 0);
  resultCount.textContent = `${filtered.length} resultado${filtered.length === 1 ? "" : "s"}`;

  applicationsContainer.querySelectorAll("[data-status-select]").forEach((select) => {
    select.addEventListener("change", updateApplicationStatus);
  });
  applicationsContainer.querySelectorAll("[data-save-admin]").forEach((button) => {
    button.addEventListener("click", saveAdministrativeDetails);
  });
  renderAcceptedMemberOptions();
}

function renderAcceptedMemberOptions() {
  const assignedApplicationIds = new Set(
    groups.flatMap((group) => group.memberApplicationIds || [])
  );
  const accepted = applications.filter((application) =>
    application.status === "accepted" && !assignedApplicationIds.has(application.id)
  );
  groupMemberOptions.innerHTML = accepted.length
    ? accepted.map((application) => `
      <label class="member-option">
        <input type="checkbox" name="memberApplicationIds" value="${escapeHtml(application.id)}">
        <span><strong>${escapeHtml(application.fullName)}</strong><br>${escapeHtml(application.email)}</span>
      </label>`).join("")
    : '<p class="muted">No hay estudiantes aceptados pendientes de asignación.</p>';
}

function createSessionDates(startDate) {
  const firstSession = new Date(`${startDate}T12:00:00Z`);
  return Array.from({ length: 6 }, (_, index) => {
    const session = new Date(firstSession);
    session.setUTCDate(firstSession.getUTCDate() + (index * 7));
    return session.toISOString().slice(0, 10);
  });
}

function formatStoredDate(date) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function editableMembersForGroup(group) {
  const membersOfOtherGroups = new Set(
    groups.filter((item) => item.id !== group.id).flatMap((item) => item.memberApplicationIds || [])
  );
  return applications.filter((application) =>
    (group.memberApplicationIds || []).includes(application.id) ||
    (application.status === "accepted" && !membersOfOtherGroups.has(application.id))
  );
}

function groupStatusOptions(status, memberCount) {
  if (status === "forming" && memberCount < 4) return '<option value="forming" selected>En formación · faltan integrantes</option>';
  if (status === "forming") return '<option value="forming" selected>En formación</option><option value="confirmed">Confirmado</option>';
  if (status === "confirmed" && memberCount < 4) return '<option value="confirmed" selected>Confirmado · incompleto</option><option value="forming">Reabrir formación</option>';
  if (status === "confirmed") return '<option value="confirmed" selected>Confirmado</option><option value="completed">Finalizado</option>';
  return '<option value="completed" selected>Finalizado</option>';
}

function validMeetUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "meet.google.com" && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(url.pathname);
  } catch { return false; }
}

async function saveGroupMeetingUrl(event) {
  const button = event.currentTarget;
  const card = button.closest("[data-group-id]");
  const group = groups.find((item) => item.id === card?.dataset.groupId);
  const meetingUrl = card?.querySelector("[data-group-meeting-url]")?.value.trim() || "";
  if (!group || !validMeetUrl(meetingUrl)) {
    setMessage(groupsMessage, "Pega un enlace válido de Google Meet, por ejemplo https://meet.google.com/abc-defg-hij.");
    return;
  }
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    await updateDoc(doc(database, "speakingClubGroups", group.id), { meetingUrl, meetingUrlUpdatedAt:serverTimestamp() });
    group.meetingUrl = meetingUrl;
    renderGroups();
    renderStudentAccess();
    setMessage(groupsMessage, "Enlace de Google Meet guardado. Ya puede incluirse al activar estudiantes.", "success");
  } catch (error) {
    console.error("Could not save Google Meet link", error);
    setMessage(groupsMessage, `No fue posible guardar el enlace (${error?.code || "error"}).`);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar enlace de Meet";
  }
}

function renderGroups() {
  document.querySelector("#groups-tab-count").textContent = groups.length;
  if (!groups.length) {
    groupsList.innerHTML = '<div class="empty">Aún no has creado grupos.</div>';
    return;
  }
  groupsList.innerHTML = groups.map((group) => {
    const memberApplications = (group.memberApplicationIds || []).map((id) =>
      applications.find((application) => application.id === id)
    ).filter(Boolean);
    const memberNames = (group.memberApplicationIds || []).map((id) =>
      applications.find((application) => application.id === id)?.fullName || "Solicitud no disponible"
    );
    const paidCount = memberApplications.filter((application) => application.paymentStatus === "paid").length;
    const expectedTotal = memberApplications.reduce((total, application) => total + Number(application.expectedAmount ?? 84), 0);
    const receivedTotal = memberApplications.reduce((total, application) =>
      total + (application.paymentStatus === "paid" ? Number(application.paidAmount || 0) : 0), 0
    );
    const memberEditor = group.status === "forming" ? `
      <div class="group-member-editor">
        <strong>Editar integrantes mientras está en formación</strong>
        <div class="member-options">
          ${editableMembersForGroup(group).map((application) => `
            <label class="member-option">
              <input type="checkbox" data-group-member value="${escapeHtml(application.id)}" ${(group.memberApplicationIds || []).includes(application.id) ? "checked" : ""}>
              <span><strong>${escapeHtml(application.fullName)}</strong><br>${escapeHtml(application.email)}</span>
            </label>`).join("")}
        </div>
        <button class="button secondary" type="button" data-save-group-members>Guardar integrantes</button>
      </div>` : '<p class="locked-note">Integrantes bloqueados porque el grupo ya fue confirmado.</p>';
    return `
      <article class="group-card" data-group-id="${escapeHtml(group.id)}">
        <div class="group-card-head">
          <div><h3>${escapeHtml(group.name)}</h3><span class="muted">${escapeHtml(slotLabels[group.slot] || group.slot)}</span></div>
          <span class="pill">${escapeHtml(group.status === "forming" ? "En formación" : group.status === "confirmed" ? "Confirmado" : "Finalizado")}</span>
        </div>
        <ul class="session-dates">${(group.sessionDates || []).map((date, index) => `<li><strong>Sesión ${index + 1}</strong><br>${escapeHtml(formatStoredDate(date))}</li>`).join("")}</ul>
        <p class="group-members"><strong>Estudiantes (${memberNames.length}/5):</strong> ${escapeHtml(memberNames.join(", ") || "Sin estudiantes")}</p>
        <div class="payment-summary" aria-label="Resumen de pagos">
          <div><strong>${paidCount}/${memberNames.length}</strong>pagados</div>
          <div><strong>US$${expectedTotal.toFixed(2)}</strong>esperado</div>
          <div><strong>US$${receivedTotal.toFixed(2)}</strong>recibido</div>
        </div>
        <div class="group-member-editor">
          <strong>Google Meet para las seis sesiones</strong>
          <p class="muted">Crea el evento recurrente en Google Calendar y pega aquí su enlace antes de activar estudiantes.</p>
          <input type="url" data-group-meeting-url value="${escapeHtml(group.meetingUrl || "")}" placeholder="https://meet.google.com/abc-defg-hij" aria-label="Enlace de Google Meet para ${escapeHtml(group.name)}">
          <button class="button secondary" type="button" data-save-meeting-url>Guardar enlace de Meet</button>
        </div>
        ${memberEditor}
        <div class="group-status">
          <label for="group-status-${escapeHtml(group.id)}">Estado</label>
          <select id="group-status-${escapeHtml(group.id)}" data-group-status>
            ${groupStatusOptions(group.status, memberNames.length)}
          </select>
        </div>
      </article>`;
  }).join("");
  groupsList.querySelectorAll("[data-group-status]").forEach((select) => {
    select.addEventListener("change", updateGroupStatus);
  });
  groupsList.querySelectorAll("[data-save-group-members]").forEach((button) => {
    button.addEventListener("click", updateGroupMembers);
  });
  groupsList.querySelectorAll("[data-save-meeting-url]").forEach((button) => {
    button.addEventListener("click", saveGroupMeetingUrl);
  });
}

function paymentStudents() {
  const groupedIds = new Set(groups.flatMap((group) => group.memberApplicationIds || []));
  return applications.filter((application) => groupedIds.has(application.id));
}

function paymentRow(application) {
  const status = application.paymentStatus || "pending";
  const statusText = status === "paid" ? "Pagado" : status === "refunded" ? "Reembolsado" : "Pendiente";
  return `
    <div class="payment-row">
      <div><strong>${escapeHtml(application.fullName)}</strong><small>${escapeHtml(application.email)}</small></div>
      <div><small>Estado</small><strong>${statusText}</strong></div>
      <div><small>Recibido</small><strong>US$${Number(application.paidAmount || 0).toFixed(2)}</strong></div>
      <button class="button secondary" type="button" data-open-payment="${escapeHtml(application.id)}">Ver / registrar pago</button>
    </div>`;
}

function renderPayments() {
  const students = paymentStudents();
  const paid = students.filter((application) => application.paymentStatus === "paid");
  const refunded = students.filter((application) => application.paymentStatus === "refunded");
  const pending = students.filter((application) => !application.paymentStatus || application.paymentStatus === "pending");
  const received = paid.reduce((total, application) => total + Number(application.paidAmount || 0), 0);
  document.querySelector("#payments-tab-count").textContent = students.length;
  document.querySelector("#payments-total").textContent = students.length;
  document.querySelector("#payments-paid").textContent = paid.length;
  document.querySelector("#payments-pending").textContent = pending.length;
  document.querySelector("#payments-received").textContent = `US$${received.toFixed(2)}`;
  const sections = [
    ["Pendientes", pending, true],
    ["Pagados", paid, false],
    ["Reembolsados", refunded, false],
  ];
  paymentLists.innerHTML = sections.map(([label, items, open]) => `
    <details class="payment-list-section" ${open ? "open" : ""}>
      <summary>${label} (${items.length})</summary>
      <div class="payment-list">${items.length ? items.map(paymentRow).join("") : '<p class="muted">No hay estudiantes en esta categoría.</p>'}</div>
    </details>`).join("");
  paymentLists.querySelectorAll("[data-open-payment]").forEach((button) => {
    button.addEventListener("click", () => openStudentPayment(button.dataset.openPayment));
  });
}

function openStudentPayment(applicationId) {
  searchInput.value = "";
  statusFilter.value = "all";
  renderApplications();
  showAdminPanel("applications");
  const card = [...applicationsContainer.querySelectorAll("[data-application-id]")]
    .find((item) => item.dataset.applicationId === applicationId);
  if (!card) return;
  card.open = true;
  requestAnimationFrame(() => card.querySelector("[data-payment-status]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function accessContext(profile) {
  const application = applications.find((item) =>
    String(item.email).toLowerCase() === String(profile.email).toLowerCase()
  );
  const group = application && groups.find((item) =>
    (item.memberApplicationIds || []).includes(application.id)
  );
  const duplicateReference = studentProfiles.some((item) =>
    item.id !== profile.id && item.paymentReference &&
    item.paymentReference.toLowerCase() === String(profile.paymentReference).toLowerCase()
  );
  const canActivate = profile.status === "pending" && application?.paymentStatus === "paid" && group?.status === "confirmed" && validMeetUrl(group?.meetingUrl || "") && !duplicateReference;
  return { application, group, duplicateReference, canActivate };
}

function renderStudentAccess() {
  document.querySelector("#access-tab-count").textContent = studentProfiles.filter((profile) => profile.status === "pending").length;
  if (!studentProfiles.length) {
    accessList.innerHTML = '<div class="empty">No hay solicitudes de acceso.</div>';
    return;
  }
  accessList.innerHTML = studentProfiles.map((profile) => {
    const { application, group, duplicateReference, canActivate } = accessContext(profile);
    const reason = profile.status === "active" ? "Acceso activo" : duplicateReference ? "Referencia repetida: revisar" : !application ? "No coincide con una solicitud" : application.paymentStatus !== "paid" ? "Pago aún no verificado" : group?.status !== "confirmed" ? "Grupo no confirmado" : !validMeetUrl(group?.meetingUrl || "") ? "Falta guardar el enlace de Google Meet del grupo" : "Listo para activar";
    return `
      <article class="access-card" data-profile-id="${escapeHtml(profile.id)}">
        <div class="access-card-head">
          <div><h2>${escapeHtml(profile.fullName)}</h2><a href="mailto:${escapeHtml(profile.email)}">${escapeHtml(profile.email)}</a></div>
          <span class="pill">${profile.status === "active" ? "Activo" : "Pendiente"}</span>
        </div>
        <div class="access-details">
          <div><small>Método declarado</small><strong>${escapeHtml(profile.paymentMethod)}</strong></div>
          <div><small>Referencia declarada</small><strong>${escapeHtml(profile.paymentReference)}</strong></div>
          <div><small>Importe declarado</small><strong>US$${Number(profile.amountSubmitted || 0).toFixed(2)}</strong></div>
          <div><small>Nombre del pagador</small><strong>${escapeHtml(profile.payerName)}</strong></div>
          <div><small>Pago en panel</small><strong>${escapeHtml(application?.paymentStatus === "paid" ? "Pagado" : "Pendiente")}</strong></div>
          <div><small>Grupo</small><strong>${escapeHtml(group?.name || "Sin grupo confirmado")}</strong></div>
        </div>
        <div class="access-action">
          <span class="muted">${escapeHtml(reason)}</span>
          ${profile.status === "pending" ? `<button class="button" type="button" data-activate-access ${canActivate ? "" : "disabled"}>Verificar y activar</button>` : ""}
        </div>
      </article>`;
  }).join("");
  accessList.querySelectorAll("[data-activate-access]").forEach((button) => {
    button.addEventListener("click", activateStudentAccess);
  });
}

async function loadStudentProfiles() {
  const snapshot = await getDocsFromServer(query(
    collection(database, "studentProfiles"),
    orderBy("createdAt", "desc")
  ));
  studentProfiles = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  renderStudentAccess();
}

async function activateStudentAccess(event) {
  const button = event.currentTarget;
  const card = button.closest("[data-profile-id]");
  const profile = studentProfiles.find((item) => item.id === card?.dataset.profileId);
  if (!profile) return;
  const { application, group, canActivate } = accessContext(profile);
  if (!canActivate) {
    renderStudentAccess();
    setMessage(accessMessage, "No se puede activar: vuelve a verificar pago, referencia y grupo.");
    return;
  }
  button.disabled = true;
  button.textContent = "Activando…";
  try {
    await updateDoc(doc(database, "studentProfiles", profile.id), {
      status: "active",
      applicationId: application.id,
      groupName: group.name,
      slot: group.slot,
      sessionDates: group.sessionDates,
      meetingUrl: group.meetingUrl,
      activatedAt: serverTimestamp(),
    });
    await notifyAccessActivation(profile.id);
    Object.assign(profile, { status: "active", applicationId: application.id, groupName: group.name, slot: group.slot, sessionDates: group.sessionDates, meetingUrl:group.meetingUrl });
    renderStudentAccess();
    setMessage(accessMessage, `Acceso de ${profile.fullName} activado. Solicitamos el correo automático con sus próximos pasos.`, "success");
  } catch (error) {
    setMessage(accessMessage, `No fue posible activar el acceso (${error?.code || "error"}).`);
  }
}

function showAdminPanel(panelName, updateHash = true) {
  const selectedPanel = ["groups", "payments", "access", "private", "calendar"].includes(panelName) ? panelName : "applications";
  adminTabs.forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.adminTab === selectedPanel));
  });
  adminPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.adminPanel !== selectedPanel);
  });
  if (updateHash) history.replaceState(null, "", `#${selectedPanel}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function updateGroupMembers(event) {
  const button = event.currentTarget;
  const card = button.closest("[data-group-id]");
  const group = groups.find((item) => item.id === card?.dataset.groupId);
  if (!group || group.status !== "forming") return;
  const memberApplicationIds = [...card.querySelectorAll("[data-group-member]:checked")].map((input) => input.value);
  if (!memberApplicationIds.length || memberApplicationIds.length > 5) {
    setMessage(groupsMessage, "El grupo debe tener entre 1 y 5 estudiantes.");
    return;
  }
  const membersOfOtherGroups = new Set(
    groups.filter((item) => item.id !== group.id).flatMap((item) => item.memberApplicationIds || [])
  );
  if (memberApplicationIds.some((id) => membersOfOtherGroups.has(id))) {
    await loadGroups();
    setMessage(groupsMessage, "Un estudiante ya pertenece a otro grupo. La lista fue actualizada.");
    return;
  }
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    await updateDoc(doc(database, "speakingClubGroups", group.id), { memberApplicationIds });
    group.memberApplicationIds = memberApplicationIds;
    renderGroups();
    renderAcceptedMemberOptions();
    renderPayments();
    renderStudentAccess();
    setMessage(groupsMessage, `Integrantes de ${group.name} actualizados.`, "success");
  } catch (error) {
    setMessage(groupsMessage, `No fue posible actualizar los integrantes (${error?.code || "error"}).`);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar integrantes";
  }
}

async function loadGroups() {
  const snapshot = await getDocsFromServer(query(
    collection(database, "speakingClubGroups"),
    orderBy("createdAt", "desc")
  ));
  groups = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  renderGroups();
  renderAcceptedMemberOptions();
  renderPayments();
}

async function updateGroupStatus(event) {
  const select = event.currentTarget;
  const card = select.closest("[data-group-id]");
  const group = groups.find((item) => item.id === card?.dataset.groupId);
  if (!group) return;
  const previousStatus = group.status;
  select.disabled = true;
  try {
    await updateDoc(doc(database, "speakingClubGroups", group.id), { status: select.value });
    group.status = select.value;
    renderGroups();
    renderStudentAccess();
    setMessage(groupsMessage, `Estado de ${group.name} actualizado.`, "success");
  } catch (error) {
    select.value = previousStatus;
    setMessage(groupsMessage, `No fue posible actualizar el grupo (${error?.code || "error"}).`);
  } finally {
    select.disabled = false;
  }
}

async function saveAdministrativeDetails(event) {
  const button = event.currentTarget;
  const card = button.closest("[data-application-id]");
  const application = applications.find((item) => item.id === card?.dataset.applicationId);
  if (!application) return;

  const administrativeDetails = {
    contactDate: card.querySelector("[data-contact-date]").value,
    assignedGroup: card.querySelector("[data-assigned-group]").value.trim(),
    adminNotes: card.querySelector("[data-admin-notes]").value.trim(),
    paymentStatus: card.querySelector("[data-payment-status]").value,
    expectedAmount: Number(card.querySelector("[data-expected-amount]").value),
    paidAmount: Number(card.querySelector("[data-paid-amount]").value),
    paymentDate: card.querySelector("[data-payment-date]").value,
    paymentMethod: card.querySelector("[data-payment-method]").value,
    paymentReference: card.querySelector("[data-payment-reference]").value.trim(),
  };

  if (administrativeDetails.paymentStatus === "paid" &&
      (administrativeDetails.paidAmount <= 0 || !administrativeDetails.paymentDate || !administrativeDetails.paymentMethod)) {
    setMessage(dashboardMessage, "Para marcar como Pagado, registra valor recibido, fecha y método.");
    return;
  }

  button.disabled = true;
  button.textContent = "Guardando…";
  clearMessage(dashboardMessage);
  try {
    await updateDoc(doc(database, "speakingClubApplications", application.id), administrativeDetails);
    Object.assign(application, administrativeDetails);
    renderGroups();
    renderPayments();
    renderStudentAccess();
    setMessage(dashboardMessage, `Seguimiento de ${application.fullName} guardado.`, "success");
  } catch (error) {
    console.error("Could not save administrative details", error);
    const errorCode = error?.code ? ` (${error.code})` : "";
    setMessage(dashboardMessage, `No fue posible guardar el seguimiento${errorCode}.`);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar seguimiento y pago";
  }
}

async function loadApplications() {
  clearMessage(dashboardMessage);
  refreshButton.disabled = true;
  refreshButton.textContent = "Cargando…";
  try {
    await getToken(appCheck, true);
    const snapshot = await getDocsFromServer(query(
      collection(database, "speakingClubApplications"),
      orderBy("createdAt", "desc")
    ));
    applications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    updateStats();
    renderApplications();
    await loadGroups();
    await loadStudentProfiles();
  } catch (error) {
    console.error("Could not load applications", error);
    const errorCode = error?.code ? ` (${error.code})` : "";
    setMessage(dashboardMessage, `No fue posible cargar las solicitudes${errorCode}. Pulsa Actualizar para intentarlo de nuevo.`);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Actualizar";
  }
}

async function updateApplicationStatus(event) {
  const select = event.currentTarget;
  const card = select.closest("[data-application-id]");
  const application = applications.find((item) => item.id === card.dataset.applicationId);
  if (!application) return;
  const previousStatus = application.status;
  select.disabled = true;
  try {
    await updateDoc(doc(database, "speakingClubApplications", application.id), {
      status: select.value,
    });
    application.status = select.value;
    updateStats();
    renderApplications();
    setMessage(dashboardMessage, `Estado de ${application.fullName} actualizado.`, "success");
  } catch (error) {
    console.error("Could not update application", error);
    select.value = previousStatus;
    setMessage(dashboardMessage, "No fue posible actualizar el estado.");
  } finally {
    select.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage(loginMessage);
  const email = document.querySelector("#admin-email").value.trim();
  const password = document.querySelector("#admin-password").value;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (!adminUid || credential.user.uid !== adminUid) {
      await signOut(auth);
      throw new Error("unauthorized-admin");
    }
  } catch (error) {
    console.error("Admin sign in failed", error);
    setMessage(loginMessage, "Acceso denegado. Verifica el correo y la contraseña.");
  }
});

onAuthStateChanged(auth, async (user) => {
  const authorized = Boolean(user && adminUid && user.uid === adminUid);
  if (user && !authorized) await signOut(auth);
  loginView.classList.toggle("hidden", authorized);
  dashboardView.classList.toggle("hidden", !authorized);
  signOutButton.classList.toggle("hidden", !authorized);
  if (authorized) {
    showAdminPanel(location.hash.slice(1), false);
    await loadApplications();
  }
});

signOutButton.addEventListener("click", () => signOut(auth));
refreshButton.addEventListener("click", loadApplications);
searchInput.addEventListener("input", renderApplications);
statusFilter.addEventListener("change", renderApplications);
adminTabs.forEach((tab) => {
  tab.addEventListener("click", () => showAdminPanel(tab.dataset.adminTab));
});
window.addEventListener("hashchange", () => showAdminPanel(location.hash.slice(1), false));
groupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage(groupsMessage);
  const data = new FormData(groupForm);
  const memberApplicationIds = data.getAll("memberApplicationIds");
  if (!memberApplicationIds.length || memberApplicationIds.length > 5) {
    setMessage(groupsMessage, "Selecciona entre 1 y 5 estudiantes aceptados.");
    return;
  }
  const assignedApplicationIds = new Set(
    groups.flatMap((group) => group.memberApplicationIds || [])
  );
  if (memberApplicationIds.some((id) => assignedApplicationIds.has(id))) {
    renderAcceptedMemberOptions();
    setMessage(groupsMessage, "Uno de los estudiantes ya pertenece a otro grupo. Actualizamos la lista disponible.");
    return;
  }
  const slot = String(data.get("slot"));
  const startDate = String(data.get("startDate"));
  const expectedWeekday = { "monday-1000": 1, "tuesday-1700": 2, "wednesday-0800": 3, "thursday-1400": 4, "friday-1100": 5 }[slot];
  if (new Date(`${startDate}T12:00:00Z`).getUTCDay() !== expectedWeekday) {
    setMessage(groupsMessage, "La primera sesión debe coincidir con el día del horario elegido.");
    return;
  }
  const submit = groupForm.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Creando…";
  try {
    await getToken(appCheck, true);
    await addDoc(collection(database, "speakingClubGroups"), {
      name: String(data.get("name")).trim(),
      slot,
      startDate,
      sessionDates: createSessionDates(startDate),
      memberApplicationIds,
      status: "forming",
      createdAt: serverTimestamp(),
    });
    groupForm.reset();
    await loadGroups();
    setMessage(groupsMessage, "Grupo creado con sus seis fechas.", "success");
  } catch (error) {
    console.error("Could not create group", error);
    setMessage(groupsMessage, `No fue posible crear el grupo (${error?.code || "error"}).`);
  } finally {
    submit.disabled = false;
    submit.textContent = "Crear grupo de seis sesiones";
  }
});

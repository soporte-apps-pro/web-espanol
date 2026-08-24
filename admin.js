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
    <article class="application" data-application-id="${escapeHtml(application.id)}">
      <div class="application-top">
        <div>
          <h2>${escapeHtml(application.fullName)}</h2>
          <a href="mailto:${escapeHtml(application.email)}">${escapeHtml(application.email)}</a>
        </div>
        <span class="pill">${escapeHtml(statusLabels[application.status] || application.status)}</span>
      </div>
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
        <div class="admin-save">
          <button class="button" type="button" data-save-admin>Guardar seguimiento</button>
        </div>
      </section>
      <div class="card-actions">
        <label for="status-${escapeHtml(application.id)}">Estado</label>
        <select id="status-${escapeHtml(application.id)}" data-status-select>${statusOptions}</select>
      </div>
    </article>`;
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

function groupStatusOptions(status) {
  if (status === "forming") return '<option value="forming" selected>En formación</option><option value="confirmed">Confirmado</option>';
  if (status === "confirmed") return '<option value="confirmed" selected>Confirmado</option><option value="completed">Finalizado</option>';
  return '<option value="completed" selected>Finalizado</option>';
}

function renderGroups() {
  if (!groups.length) {
    groupsList.innerHTML = '<div class="empty">Aún no has creado grupos.</div>';
    return;
  }
  groupsList.innerHTML = groups.map((group) => {
    const memberNames = (group.memberApplicationIds || []).map((id) =>
      applications.find((application) => application.id === id)?.fullName || "Solicitud no disponible"
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
        ${memberEditor}
        <div class="group-status">
          <label for="group-status-${escapeHtml(group.id)}">Estado</label>
          <select id="group-status-${escapeHtml(group.id)}" data-group-status>
            ${groupStatusOptions(group.status)}
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
  };

  button.disabled = true;
  button.textContent = "Guardando…";
  clearMessage(dashboardMessage);
  try {
    await updateDoc(doc(database, "speakingClubApplications", application.id), administrativeDetails);
    Object.assign(application, administrativeDetails);
    setMessage(dashboardMessage, `Seguimiento de ${application.fullName} guardado.`, "success");
  } catch (error) {
    console.error("Could not save administrative details", error);
    const errorCode = error?.code ? ` (${error.code})` : "";
    setMessage(dashboardMessage, `No fue posible guardar el seguimiento${errorCode}.`);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar seguimiento";
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
  if (authorized) await loadApplications();
});

signOutButton.addEventListener("click", () => signOut(auth));
refreshButton.addEventListener("click", loadApplications);
searchInput.addEventListener("input", renderApplications);
statusFilter.addEventListener("change", renderApplications);
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

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
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
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  adminUid,
  firebaseConfig,
  recaptchaEnterpriseSiteKey,
} from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
initializeAppCheck(app, {
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
}

async function loadApplications() {
  clearMessage(dashboardMessage);
  refreshButton.disabled = true;
  refreshButton.textContent = "Cargando…";
  try {
    const snapshot = await getDocs(query(
      collection(database, "speakingClubApplications"),
      orderBy("createdAt", "desc")
    ));
    applications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    updateStats();
    renderApplications();
  } catch (error) {
    console.error("Could not load applications", error);
    setMessage(dashboardMessage, "No fue posible cargar las solicitudes. Revisa la autorización del administrador.");
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

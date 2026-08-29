import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, doc, getDocsFromServer, getFirestore, runTransaction, serverTimestamp, Timestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { firebaseConfig, recaptchaEnterpriseSiteKey } from "./firebase-config.js";

const COLOMBIA_ZONE = "America/Bogota";
const HOLD_MINUTES = 10;
const GOOGLE_CHECK_MAX_AGE_MINUTES = 35;
const BOOKING_WINDOW_DAYS = 21;
const packages = {
  single: { label: "1 private class", amount: 25 },
  pack4: { label: "4 private classes", amount: 84 },
  pack8: { label: "8 private classes", amount: 152 },
};
const app = initializeApp(firebaseConfig);
initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey), isTokenAutoRefreshEnabled: true });
const auth = getAuth(app);
const database = getFirestore(app);
const zoneSelect = document.querySelector("#student-time-zone");
const slotsElement = document.querySelector("#slots");
const selectionPanel = document.querySelector("#selection-panel");
const holdPanel = document.querySelector("#hold-panel");
const message = document.querySelector("#booking-message");
let slots = [];
let selectedSlot = null;
let holdExpiresAt = null;
let countdownTimer = null;

function setMessage(text, type = "error") { message.textContent = text; message.className = `message ${type} mt-5 rounded-xl p-4 text-sm font-semibold`; }
function formatAt(date, timeZone) { return new Intl.DateTimeFormat("en-US", { weekday:"long", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true, timeZone }).format(date); }
function googleCleared(slot) {
  const checkedAt = slot.googleCalendarCheckedAt?.toDate?.();
  return slot.googleCalendarBlocked === false && checkedAt && checkedAt.getTime() >= Date.now() - GOOGLE_CHECK_MAX_AGE_MINUTES * 60000;
}
function insideBookingWindow(slot) {
  const start = slot.startAt?.toDate?.();
  return start && start > new Date() && start.getTime() <= Date.now() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
function available(slot) { return insideBookingWindow(slot) && googleCleared(slot) && (slot.status === "available" || (slot.status === "held" && slot.holdExpiresAt?.toDate() <= new Date())); }

function configureZones() {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || COLOMBIA_ZONE;
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [COLOMBIA_ZONE, detected];
  [...new Set([detected, COLOMBIA_ZONE, ...zones])].forEach((zone) => zoneSelect.add(new Option(zone.replaceAll("_", " "), zone)));
  zoneSelect.value = detected;
}

function renderSlots() {
  const zone = zoneSelect.value || COLOMBIA_ZONE;
  const visible = slots.filter(available).sort((a,b) => a.startAt.seconds - b.startAt.seconds);
  slotsElement.innerHTML = visible.length ? visible.map((slot) => {
    const start = slot.startAt.toDate();
    return `<button type="button" class="slot text-left rounded-2xl border border-gray-200 p-4 hover:border-orange-400" data-slot="${slot.id}" aria-pressed="${selectedSlot?.id === slot.id}"><strong class="block text-blue-950">${formatAt(start, zone)}</strong><span class="text-xs text-gray-500">${formatAt(start, COLOMBIA_ZONE)} · Colombia time</span><span class="block text-xs text-gray-500 mt-1">50 minutes</span></button>`;
  }).join("") : '<p class="rounded-xl bg-gray-50 p-5 text-gray-500">No private times are currently available. Please check again soon.</p>';
  slotsElement.querySelectorAll("[data-slot]").forEach((button) => button.addEventListener("click", () => selectSlot(button.dataset.slot)));
}

function selectSlot(slotId) {
  selectedSlot = slots.find((slot) => slot.id === slotId);
  if (!selectedSlot) return;
  document.querySelector("#selected-time").textContent = `${formatAt(selectedSlot.startAt.toDate(), zoneSelect.value)} (${formatAt(selectedSlot.startAt.toDate(), COLOMBIA_ZONE)} Colombia)`;
  selectionPanel.classList.remove("hidden");
  renderSlots();
}

function updateCountdown() {
  if (!holdExpiresAt) return;
  const remaining = Math.max(0, holdExpiresAt.getTime() - Date.now());
  if (!remaining) {
    clearInterval(countdownTimer); holdPanel.classList.add("hidden"); selectedSlot = null; holdExpiresAt = null;
    setMessage("The 10-minute hold expired. Choose the time again if it is still available."); loadSlots(); return;
  }
  const minutes = Math.floor(remaining / 60000); const seconds = Math.floor((remaining % 60000) / 1000);
  document.querySelector("#hold-countdown").textContent = `Temporary hold: ${minutes}:${String(seconds).padStart(2,"0")}`;
}

async function ensureAnonymousUser() {
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) { unsubscribe(); resolve(user); return; }
      try { await signInAnonymously(auth); } catch (error) { unsubscribe(); reject(error); }
    });
  });
}

async function startHold(slotId) {
  message.className = "message hidden";
  try {
    const user = await ensureAnonymousUser();
    const slotRef = doc(database, "privateAvailability", slotId);
    const expiry = Timestamp.fromMillis(Date.now() + HOLD_MINUTES * 60000);
    await runTransaction(database, async (transaction) => {
      const snapshot = await transaction.get(slotRef);
      if (!snapshot.exists()) throw new Error("slot-not-found");
      const data = snapshot.data();
      const isExpired = data.status === "held" && data.holdExpiresAt?.toMillis() <= Date.now();
      if (data.status !== "available" && !isExpired) throw new Error("slot-unavailable");
      if (!insideBookingWindow(data)) throw new Error("outside-booking-window");
      if (data.googleCalendarBlocked !== false || !data.googleCalendarCheckedAt?.toMillis() || data.googleCalendarCheckedAt.toMillis() < Date.now() - GOOGLE_CHECK_MAX_AGE_MINUTES * 60000) throw new Error("calendar-unavailable");
      transaction.update(slotRef, { status:"held", heldBy:user.uid, holdExpiresAt:expiry, bookingRequestId:"" });
    });
    selectedSlot = slots.find((slot) => slot.id === slotId); holdExpiresAt = expiry.toDate();
    selectedSlot.status = "held"; selectedSlot.heldBy = user.uid; selectedSlot.holdExpiresAt = expiry;
    selectionPanel.classList.add("hidden"); holdPanel.classList.remove("hidden"); renderSlots(); clearInterval(countdownTimer); updateCountdown(); countdownTimer = setInterval(updateCountdown, 1000);
    holdPanel.scrollIntoView({ behavior:"smooth", block:"start" });
  } catch (error) {
    console.error(error); setMessage(error.message === "slot-unavailable" ? "Someone else is already completing payment for this time. Please choose another." : error.message === "outside-booking-window" ? "Private classes can only be booked within the next three weeks. Please choose a closer date." : error.message === "calendar-unavailable" ? "This time is being checked against the live calendar. Please refresh in a few minutes." : "We could not hold this time. Refresh the page and try again.");
    await loadSlots();
  }
}

async function loadSlots() {
  try {
    const snapshot = await getDocsFromServer(collection(database, "privateAvailability"));
    slots = snapshot.docs.map((item) => ({ id:item.id, ...item.data() })); renderSlots();
  } catch (error) { console.error(error); slotsElement.innerHTML = '<p class="text-red-700">Availability could not be loaded.</p>'; }
}

document.querySelector("#booking-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedSlot || !holdExpiresAt || holdExpiresAt <= new Date()) { setMessage("Your temporary hold expired. Choose the time again."); return; }
  const button = document.querySelector("#submit-booking"); button.disabled = true; button.textContent = "Sending…";
  try {
    const user = await ensureAnonymousUser();
    const selectedPackage = packages[document.querySelector("#package").value];
    const requestRef = doc(collection(database, "privateBookingRequests"));
    const slotRef = doc(database, "privateAvailability", selectedSlot.id);
    const batch = writeBatch(database);
    batch.set(requestRef, {
      slotId:selectedSlot.id, studentUid:user.uid, fullName:document.querySelector("#full-name").value.trim(), email:document.querySelector("#email").value.trim(),
      studentTimeZone:zoneSelect.value, colombiaStart:selectedSlot.startAt, packageId:document.querySelector("#package").value, packageLabel:selectedPackage.label,
      amountUsd:selectedPackage.amount, paymentMethod:document.querySelector("#payment-method").value, paymentReference:document.querySelector("#payment-reference").value.trim(),
      payerName:document.querySelector("#payer-name").value.trim(), status:"payment_review", createdAt:serverTimestamp(),
    });
    batch.update(slotRef, { status:"payment_review", heldBy:user.uid, holdExpiresAt:Timestamp.fromDate(holdExpiresAt), bookingRequestId:requestRef.id });
    await batch.commit(); clearInterval(countdownTimer); holdPanel.classList.add("hidden");
    setMessage("Payment reference received. The time is pending verification and is not available to anyone else. Elkin will email you after checking the payment.", "success");
    await loadSlots();
  } catch (error) { console.error(error); setMessage("We could not submit the payment reference. Confirm that the hold is still active and try again."); }
  finally { button.disabled = false; button.textContent = "Send Payment for Verification"; }
});

zoneSelect.addEventListener("change", renderSlots);
document.querySelector("#start-payment").addEventListener("click", () => selectedSlot && startHold(selectedSlot.id));
configureZones();
loadSlots();

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  addDoc,
  collection,
  getFirestore,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const form = document.querySelector("#club-interest-form");
const message = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-interest");
const submitLabel = submitButton?.querySelector(".submit-label");
const timeZoneInput = document.querySelector("#time-zone");
const formLoadedAt = Date.now();

const configured = Object.values(firebaseConfig).every(
  (value) => value && !String(value).startsWith("REPLACE_WITH_")
);

let database = null;
if (configured) {
  database = getFirestore(initializeApp(firebaseConfig));
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = `mt-5 rounded-xl px-4 py-3 text-sm font-semibold ${
    type === "success"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700"
  }`;
  message.focus?.();
}

function setSubmitting(submitting) {
  submitButton.disabled = submitting;
  submitLabel.textContent = submitting
    ? "Sending your information…"
    : "Submit Free Application";
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    const firstInvalidField = form.querySelector(":invalid");
    const invalidSection = firstInvalidField?.closest("details[data-form-section]");
    if (invalidSection) invalidSection.open = true;
    form.reportValidity();
    return;
  }

  const data = new FormData(form);
  const candidateSlots = data.getAll("candidateSlots");
  const scheduleAcknowledged = data.get("scheduleAcknowledged") === "on";

  if (!candidateSlots.length) {
    window.clubFormFlow?.showStep(2);
    showMessage("Please select at least one proposed group time.", "error");
    return;
  }

  if (!scheduleAcknowledged) {
    window.clubFormFlow?.showStep(2);
    showMessage("Please review the six dates and confirm the schedule notice.", "error");
    return;
  }

  if (data.get("website")) return;

  if (Date.now() - formLoadedAt < 3000) {
    showMessage("Please review your information before sending.", "error");
    return;
  }

  if (!configured || !database) {
    showMessage(
      "The form is ready, but Firebase still needs to be connected. Please contact ontalkingspanish@gmail.com for now.",
      "error"
    );
    return;
  }

  const previousSubmission = Number(localStorage.getItem("clubFormSubmittedAt") || 0);
  if (Date.now() - previousSubmission < 60000) {
    showMessage("Your information was already sent. Please wait before trying again.", "error");
    return;
  }

  const application = {
    fullName: String(data.get("fullName")).trim(),
    email: String(data.get("email")).trim().toLowerCase(),
    country: String(data.get("country")).trim(),
    spanishLevel: String(data.get("spanishLevel")),
    timeZone: String(data.get("timeZone")).trim(),
    candidateSlots,
    scheduleAcknowledged,
    scheduleTimeZone: "America/Bogota",
    cohort: "founding-2026-09",
    goal: String(data.get("goal")).trim(),
    consent: data.get("consent") === "on",
    status: "new",
    source: "speaking-club-page",
    createdAt: serverTimestamp(),
  };

  setSubmitting(true);
  try {
    await addDoc(collection(database, "speakingClubApplications"), application);
    localStorage.setItem("clubFormSubmittedAt", String(Date.now()));
    form.reset();
    if (timeZoneInput) {
      timeZoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      timeZoneInput.dispatchEvent(new Event("change"));
    }
    window.clubFormFlow?.showStep(1);
    showMessage(
      "Thank you! Your availability was received. When a compatible group is formed, Elkin will send you one fixed weekly schedule to review before you decide whether to enroll.",
      "success"
    );
  } catch (error) {
    console.error("Speaking Club form submission failed", error);
    showMessage(
      "We could not send your information. Please try again or email ontalkingspanish@gmail.com.",
      "error"
    );
  } finally {
    setSubmitting(false);
  }
});

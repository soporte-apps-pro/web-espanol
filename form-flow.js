(() => {
  const form = document.querySelector("#club-interest-form");
  if (!form) return;

  const stepLabel = document.querySelector("#form-step-label");
  const stepName = document.querySelector("#form-step-name");
  const progress = document.querySelector("#form-progress");
  const message = document.querySelector("#form-message");
  const stepNames = ["Check your fit", "Choose possible groups", "Contact details"];
  let currentStep = 1;

  function showLocalError(text) {
    message.textContent = text;
    message.className = "mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700";
  }

  function clearLocalError() {
    message.textContent = "";
    message.className = "hidden mt-5 rounded-xl px-4 py-3 text-sm font-semibold";
  }

  function showStep(step) {
    currentStep = Math.min(3, Math.max(1, step));
    form.querySelectorAll("[data-form-step]").forEach((element) => {
      element.classList.toggle("hidden", Number(element.dataset.formStep) !== currentStep);
    });
    stepLabel.textContent = `Step ${currentStep} of 3`;
    stepName.textContent = stepNames[currentStep - 1];
    progress.style.width = `${(currentStep / 3) * 100}%`;
    clearLocalError();
  }

  function validateCurrentStep() {
    if (currentStep === 1) {
      const fields = form.querySelectorAll('[data-form-step="1"] select, [data-form-step="1"] input');
      for (const field of fields) {
        if (!field.checkValidity()) {
          field.reportValidity();
          return false;
        }
      }
    }

    if (currentStep === 2 && !form.querySelector('input[name="candidateSlots"]:checked')) {
      showLocalError("Please select at least one proposed group time.");
      return false;
    }

    if (currentStep === 2 && !form.querySelector('#schedule-acknowledgement:checked')) {
      showLocalError("Please review the six dates and confirm the schedule notice.");
      return false;
    }

    return true;
  }

  form.addEventListener("click", (event) => {
    const nextButton = event.target.closest("[data-next-step]");
    const previousButton = event.target.closest("[data-previous-step]");

    if (nextButton && validateCurrentStep()) showStep(currentStep + 1);
    if (previousButton) showStep(currentStep - 1);
  });

  window.clubFormFlow = { showStep };
  showStep(1);
})();

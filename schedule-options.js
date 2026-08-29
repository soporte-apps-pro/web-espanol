(() => {
  const timeZoneSelect = document.querySelector("#time-zone");
  const countrySelect = document.querySelector("#country");
  const timeOptions = document.querySelector("#available-time-options");
  if (!timeZoneSelect || !timeOptions) return;

  const countryByTimeZone = {
    "America/Argentina/Buenos_Aires": "Argentina",
    "America/Asuncion": "Paraguay",
    "America/Bogota": "Colombia",
    "America/Caracas": "Venezuela",
    "America/Chicago": "United States",
    "America/Costa_Rica": "Costa Rica",
    "America/Denver": "United States",
    "America/El_Salvador": "El Salvador",
    "America/Guatemala": "Guatemala",
    "America/Guayaquil": "Ecuador",
    "America/La_Paz": "Bolivia",
    "America/Lima": "Peru",
    "America/Los_Angeles": "United States",
    "America/Managua": "Nicaragua",
    "America/Mexico_City": "Mexico",
    "America/Montevideo": "Uruguay",
    "America/New_York": "United States",
    "America/Panama": "Panama",
    "America/Phoenix": "United States",
    "America/Santiago": "Chile",
    "America/Santo_Domingo": "Dominican Republic",
    "America/Sao_Paulo": "Brazil",
    "America/Tegucigalpa": "Honduras",
    "America/Toronto": "Canada",
    "America/Vancouver": "Canada",
    "Europe/Amsterdam": "Netherlands",
    "Europe/Berlin": "Germany",
    "Europe/Lisbon": "Portugal",
    "Europe/London": "United Kingdom",
    "Europe/Madrid": "Spain",
    "Europe/Paris": "France",
    "Europe/Rome": "Italy",
    "Europe/Warsaw": "Poland",
  };

  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Bogota";

  if (typeof Intl.supportedValuesOf === "function") {
    const currentOptions = new Set(
      Array.from(timeZoneSelect.options, (option) => option.value).filter(Boolean)
    );

    Intl.supportedValuesOf("timeZone").forEach((timeZone) => {
      if (currentOptions.has(timeZone)) return;
      const option = document.createElement("option");
      option.value = timeZone;
      option.textContent = timeZone.replaceAll("_", " ");
      timeZoneSelect.append(option);
    });
  }

  if (!Array.from(timeZoneSelect.options).some((option) => option.value === detectedTimeZone)) {
    const detectedOption = document.createElement("option");
    detectedOption.value = detectedTimeZone;
    detectedOption.textContent = detectedTimeZone.replaceAll("_", " ");
    timeZoneSelect.append(detectedOption);
  }
  timeZoneSelect.value = detectedTimeZone;

  const candidateSlots = [
    { id: "monday-1000", label: "Monday", date: "2026-09-21", hour: 10 },
    { id: "tuesday-1700", label: "Tuesday", date: "2026-09-22", hour: 17 },
    { id: "wednesday-0800", label: "Wednesday", date: "2026-09-23", hour: 8 },
    { id: "thursday-1400", label: "Thursday", date: "2026-09-24", hour: 14 },
    { id: "friday-1100", label: "Friday", date: "2026-09-25", hour: 11 },
  ];

  function formatTime(date, timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(date);
  }

  function formatClock(date, timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(date);
  }

  function formatSession(date, timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(date);
  }

  function localTimeKey(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).formatToParts(date);
    return parts
      .filter((part) => ["hour", "minute", "dayPeriod"].includes(part.type))
      .map((part) => part.value)
      .join(":");
  }

  function renderTimes() {
    const selectedValues = new Set(
      Array.from(timeOptions.querySelectorAll("input:checked"), (input) => input.value)
    );
    const targetTimeZone = timeZoneSelect.value || detectedTimeZone;
    timeOptions.replaceChildren();

    candidateSlots.forEach((slot) => {
      const [year, month, day] = slot.date.split("-").map(Number);
      const colombiaStart = new Date(Date.UTC(year, month - 1, day, slot.hour + 5));
      const localLabel = formatTime(colombiaStart, targetTimeZone);
      const colombiaLabel = formatClock(colombiaStart, "America/Bogota");
      const sessions = Array.from(
        { length: 6 },
        (_, index) => new Date(colombiaStart.getTime() + index * 7 * 24 * 60 * 60 * 1000)
      );
      const firstLocalTime = localTimeKey(sessions[0], targetTimeZone);
      const hasLocalTimeChange = sessions.some(
        (session) => localTimeKey(session, targetTimeZone) !== firstLocalTime
      );

      const card = document.createElement("div");
      card.className = "rounded-xl border border-gray-200 bg-white px-4 py-4";
      const label = document.createElement("label");
      label.className = "flex items-start gap-3";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "candidateSlots";
      checkbox.value = slot.id;
      checkbox.className = "mt-1 accent-orange-500";
      checkbox.checked = selectedValues.has(slot.id);
      const text = document.createElement("span");
      text.innerHTML = `<strong>${slot.label} · ${colombiaLabel} Colombia</strong><br><span class="text-xs text-gray-500">${localLabel} in your selected zone</span>`;
      label.append(checkbox, text);

      const details = document.createElement("details");
      details.className = "group mt-3 border-t border-gray-100 pt-3";
      const summary = document.createElement("summary");
      summary.className = "cursor-pointer list-none text-xs font-bold text-blue-700";
      summary.textContent = "View all 6 dates";
      const sessionList = document.createElement("ul");
      sessionList.className = "mt-3 space-y-2 text-xs text-gray-600";

      sessions.forEach((session, index) => {
        const item = document.createElement("li");
        const changed = localTimeKey(session, targetTimeZone) !== firstLocalTime;
        item.className = changed ? "font-bold text-orange-600" : "";
        item.textContent = `${index + 1}. ${formatSession(session, targetTimeZone)}${
          changed ? " — local time change" : ""
        }`;
        sessionList.append(item);
      });

      const notice = document.createElement("p");
      notice.className = hasLocalTimeChange
        ? "mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-600"
        : "mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700";
      notice.textContent = hasLocalTimeChange
        ? "Your local time changes during this program because of daylight saving time. Colombia time remains fixed."
        : "Your local time remains the same for all six sessions under current time-zone rules.";

      details.append(summary, sessionList, notice);
      card.append(label, details);
      timeOptions.append(card);
    });
  }

  function updateCountryFromTimeZone() {
    if (!countrySelect) return;
    const matchingCountry = countryByTimeZone[timeZoneSelect.value];
    if (matchingCountry) countrySelect.value = matchingCountry;
  }

  timeZoneSelect.addEventListener("change", () => {
    updateCountryFromTimeZone();
    renderTimes();
  });
  updateCountryFromTimeZone();
  renderTimes();
})();

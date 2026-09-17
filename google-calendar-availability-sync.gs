// Replace the contents of Código.gs with this file. Do not add a second CONFIG.
const CONFIG = {
  projectId: 'spanish-with-elkin',
  databaseId: '(default)',
  timeZone: 'America/Bogota',
  classDurationMinutes: 50, // Only a fallback for old slots without a duration.
  classesCalendarId: 'f16b5381e904f28935f94ccd7174aee357896c58c1dacc8e968c8315b2e8ded5@group.calendar.google.com',
  blockingCalendarNames: ['Horario en Preply', 'Horarios semanales de Preply']
};

function syncPrivateAvailability() {
  const calendars = getBlockingCalendars();
  const documents = getAvailabilityDocuments();
  let checked = 0;
  let blocked = 0;
  let changed = 0;

  documents.forEach(function (document) {
    const fields = document.fields || {};
    const status = getString(fields.status);
    const startValue = getTimestamp(fields.startAt);
    if (!startValue || ['available', 'held'].indexOf(status) === -1) return;

    const rawDuration = fields.durationMinutes;
    const minutes = rawDuration
      ? Number(rawDuration.integerValue || rawDuration.doubleValue)
      : CONFIG.classDurationMinutes;
    if ([30, 50].indexOf(minutes) === -1) throw new Error('Invalid duration: ' + document.name);
    const start = new Date(startValue);
    if (isNaN(start.getTime())) throw new Error('Invalid date: ' + document.name);
    const end = new Date(start.getTime() + minutes * 60000);

    const hasConflict = calendars.some(function (calendar) {
      return calendar.getEvents(start, end).some(function (event) {
        if (typeof event.getTransparency === 'function' &&
            event.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT) return false;
        // Adjacent events are not overlaps: [start, end).
        return event.getStartTime().getTime() < end.getTime() &&
          event.getEndTime().getTime() > start.getTime();
      });
    });

    const saved = updateAvailabilityDocument(document.name, hasConflict, new Date(), minutes, document.updateTime);
    if (!saved) { changed++; return; }
    checked++;
    if (hasConflict) blocked++;
  });
  console.log('Horarios revisados: ' + checked + '. Bloqueados por Google Calendar: ' + blocked +
    '. Cambiaron durante la revisión: ' + changed + '. Se usó la duración de cada espacio.');
}

function getBlockingCalendars() {
  const calendars = [];
  const addedIds = {};
  addCalendar(calendars, addedIds, CalendarApp.getDefaultCalendar());
  CONFIG.blockingCalendarNames.forEach(function (name) {
    CalendarApp.getCalendarsByName(name).forEach(function (calendar) {
      addCalendar(calendars, addedIds, calendar);
    });
  });
  addCalendar(calendars, addedIds, CalendarApp.getCalendarById(CONFIG.classesCalendarId));
  if (!calendars.length) throw new Error('No calendars available for verification.');
  return calendars;
}

function addCalendar(calendars, addedIds, calendar) {
  if (!calendar) return;
  const id = calendar.getId();
  if (!addedIds[id]) { addedIds[id] = true; calendars.push(calendar); }
}

function getAvailabilityDocuments() {
  const base = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(CONFIG.projectId) +
    '/databases/' + encodeURIComponent(CONFIG.databaseId) + '/documents/privateAvailability?pageSize=500';
  const documents = [];
  let pageToken = '';
  do {
    const response = firestoreRequest(base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), {method: 'get'});
    Array.prototype.push.apply(documents, response.documents || []);
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return documents;
}

function updateAvailabilityDocument(documentName, blocked, checkedAt, minutes, updateTime) {
  const values = {
    googleCalendarBlocked: {booleanValue: blocked},
    googleCalendarCheckedAt: {timestampValue: checkedAt.toISOString()},
    googleCalendarCheckedDurationMinutes: {integerValue: String(minutes)},
    googleCalendarSyncVersion: {stringValue: '20260917-duration-1'}
  };
  const masks = Object.keys(values).map(function (key) { return 'updateMask.fieldPaths=' + key; });
  if (updateTime) masks.push('currentDocument.updateTime=' + encodeURIComponent(updateTime));
  try {
    firestoreRequest('https://firestore.googleapis.com/v1/' + documentName + '?' + masks.join('&'), {
      method: 'patch', contentType: 'application/json', payload: JSON.stringify({fields: values})
    });
    return true;
  } catch (error) {
    // A booking or edit happened meanwhile. Leave it for the next check.
    if (error.httpStatus === 409 || error.httpStatus === 412) return false;
    throw error;
  }
}

function firestoreRequest(url, options) {
  const response = UrlFetchApp.fetch(url, Object.assign({}, options, {
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true
  }));
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    const error = new Error('Firestore respondió ' + status + ': ' + text);
    error.httpStatus = status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

function getString(field) { return field && field.stringValue ? field.stringValue : ''; }
function getTimestamp(field) { return field && field.timestampValue ? field.timestampValue : ''; }

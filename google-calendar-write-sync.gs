/**
 * Spanish with Elkin -> Google Calendar
 * Add this file to the existing Apps Script project.
 * It reuses CONFIG.classesCalendarId from Código.gs.
 */
const SWE_FIRESTORE_PROJECT_ID = 'spanish-with-elkin';
const SWE_MARKER_PREFIX = '[SWE_EVENT:';

function syncSpanishWithElkinCalendars() {
  syncConfirmedClassesToGoogleCalendar();
  syncPrivateAvailability();
}

function syncConfirmedClassesToGoogleCalendar() {
  const calendar = CalendarApp.getCalendarById(CONFIG.classesCalendarId);
  if (!calendar) throw new Error('No se encontró CONFIG.classesCalendarId.');

  const now = new Date();
  const rangeStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(now.getTime() + 370 * 24 * 60 * 60 * 1000);
  const requests = indexFirestoreDocuments_('privateBookingRequests');
  const desired = {};

  listFirestoreDocuments_('privateAvailability').forEach(function (document) {
    const fields = document.fields || {};
    if (firestoreString_(fields.status) !== 'confirmed') return;
    const start = firestoreTimestamp_(fields.startAt);
    if (!start || start < rangeStart || start > rangeEnd) return;
    const slotId = firestoreDocumentId_(document.name);
    const requestId = firestoreString_(fields.bookingRequestId);
    const request = requests[requestId] || {};
    const marker = 'private:' + slotId;
    desired[marker] = {
      title: 'Clase privada · ' + (firestoreString_(request.fullName) || 'Estudiante'),
      start: start,
      end: new Date(start.getTime() + (firestoreNumber_(fields.durationMinutes) || 50) * 60000),
      description: [
        SWE_MARKER_PREFIX + marker + ']',
        'Tipo: Clase privada',
        'Estudiante: ' + (firestoreString_(request.fullName) || ''),
        'Correo: ' + (firestoreString_(request.email) || ''),
        'Paquete: ' + (firestoreString_(request.packageLabel) || ''),
        'Referencia de pago: ' + (firestoreString_(request.paymentReference) || '')
      ].join('\n')
    };
  });

  const groupTimes = {
    'monday-1000': [10, 0],
    'monday-1100': [11, 0],
    'monday-1300': [13, 0],
    'monday-1800': [18, 0],
    'monday-1900': [19, 0],
    'tuesday-1400': [14, 0],
    'tuesday-1700': [17, 0],
    'tuesday-1900': [19, 0],
    'wednesday-0800': [8, 0],
    'thursday-0800': [8, 0],
    'thursday-1300': [13, 0],
    'thursday-1400': [14, 0],
    'friday-1100': [11, 0],
    'friday-1400': [14, 0],
    'friday-1500': [15, 0],
    'saturday-1130': [11, 30],
    'saturday-1330': [13, 30]
  };

  listFirestoreDocuments_('speakingClubGroups').forEach(function (document) {
    const fields = document.fields || {};
    const status = firestoreString_(fields.status);
    if (status !== 'confirmed' && status !== 'completed') return;
    const groupId = firestoreDocumentId_(document.name);
    const groupName = firestoreString_(fields.name) || 'Speaking Club';
    const time = groupTimes[firestoreString_(fields.slot)];
    if (!time) return;
    firestoreStringArray_(fields.sessionDates).forEach(function (dateValue, index) {
      const start = new Date(dateValue + 'T' + pad2_(time[0]) + ':' + pad2_(time[1]) + ':00-05:00');
      if (isNaN(start.getTime()) || start < rangeStart || start > rangeEnd) return;
      const marker = 'group:' + groupId + ':session:' + (index + 1);
      desired[marker] = {
        title: groupName + ' · Sesión ' + (index + 1),
        start: start,
        end: new Date(start.getTime() + 55 * 60000),
        description: [
          SWE_MARKER_PREFIX + marker + ']',
          'Tipo: Speaking Club',
          'Grupo: ' + groupName,
          'Sesión: ' + (index + 1) + ' de 4'
        ].join('\n')
      };
    });
  });

  const existing = {};
  calendar.getEvents(rangeStart, rangeEnd).forEach(function (event) {
    const marker = extractSweMarker_(event.getDescription());
    if (!marker) return;
    if (!existing[marker]) existing[marker] = [];
    existing[marker].push(event);
  });

  let created = 0;
  let updated = 0;
  let removed = 0;
  Object.keys(desired).forEach(function (marker) {
    const item = desired[marker];
    const matches = existing[marker] || [];
    const event = matches.shift();
    matches.forEach(function (duplicate) { duplicate.deleteEvent(); removed++; });
    if (!event) {
      calendar.createEvent(item.title, item.start, item.end, { description: item.description });
      created++;
      return;
    }
    if (event.getTitle() !== item.title) event.setTitle(item.title);
    if (event.getStartTime().getTime() !== item.start.getTime() || event.getEndTime().getTime() !== item.end.getTime()) event.setTime(item.start, item.end);
    if (event.getDescription() !== item.description) event.setDescription(item.description);
    updated++;
  });

  Object.keys(existing).forEach(function (marker) {
    if (desired[marker]) return;
    existing[marker].forEach(function (event) { event.deleteEvent(); removed++; });
  });

  console.log('Google Calendar: ' + created + ' creados, ' + updated + ' revisados, ' + removed + ' eliminados.');
}

function listFirestoreDocuments_(collectionName) {
  const documents = [];
  let pageToken = '';
  do {
    const base = 'https://firestore.googleapis.com/v1/projects/' + SWE_FIRESTORE_PROJECT_ID + '/databases/(default)/documents/' + collectionName + '?pageSize=300';
    const url = base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error('Firestore ' + collectionName + ': ' + response.getContentText());
    const payload = JSON.parse(response.getContentText());
    Array.prototype.push.apply(documents, payload.documents || []);
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return documents;
}

function indexFirestoreDocuments_(collectionName) {
  const result = {};
  listFirestoreDocuments_(collectionName).forEach(function (document) {
    result[firestoreDocumentId_(document.name)] = document.fields || {};
  });
  return result;
}

function firestoreDocumentId_(name) { return String(name || '').split('/').pop(); }
function firestoreString_(field) { return field && field.stringValue ? field.stringValue : ''; }
function firestoreNumber_(field) { return field ? Number(field.integerValue || field.doubleValue || 0) : 0; }
function firestoreTimestamp_(field) { return field && field.timestampValue ? new Date(field.timestampValue) : null; }
function firestoreStringArray_(field) { return field && field.arrayValue && field.arrayValue.values ? field.arrayValue.values.map(firestoreString_) : []; }
function pad2_(value) { return String(value).padStart(2, '0'); }
function extractSweMarker_(description) {
  const match = String(description || '').match(/\[SWE_EVENT:([^\]]+)\]/);
  return match ? match[1] : '';
}

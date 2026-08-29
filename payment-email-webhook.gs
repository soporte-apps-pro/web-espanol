/**
 * Free payment-receipt email webhook for Spanish with Elkin.
 * Add this file to the existing Apps Script calendar project and deploy it as a web app.
 */
const SWE_PAYMENT_PROJECT_ID = 'spanish-with-elkin';
const SWE_SUPPORT_EMAIL = 'hello@spanishwithelkin.com';

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const type = String(payload.type || '');
    const documentId = String(payload.documentId || '');
    if (!['private', 'group'].includes(type) || !/^[A-Za-z0-9_-]{10,160}$/.test(documentId)) {
      return swePaymentResponse_({ ok: false, error: 'invalid-request' });
    }

    const collectionName = type === 'private' ? 'privateBookingRequests' : 'studentProfiles';
    const document = swePaymentGetDocument_(collectionName, documentId);
    const fields = document.fields || {};
    const expectedStatus = type === 'private' ? 'payment_review' : 'pending';
    if (swePaymentString_(fields.status) !== expectedStatus) {
      return swePaymentResponse_({ ok: false, error: 'payment-not-pending' });
    }
    if (fields.receiptEmailSentAt && fields.receiptEmailSentAt.timestampValue) {
      return swePaymentResponse_({ ok: true, alreadySent: true });
    }

    const email = swePaymentString_(fields.email).trim().toLowerCase();
    const fullName = swePaymentString_(fields.fullName).trim();
    const reference = swePaymentString_(fields.paymentReference).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !reference) {
      return swePaymentResponse_({ ok: false, error: 'incomplete-payment' });
    }

    const description = type === 'private'
      ? (swePaymentString_(fields.packageLabel) || 'private Spanish classes')
      : 'Speaking Club · 6 sessions';
    const amount = type === 'private'
      ? swePaymentNumber_(fields.amountUsd)
      : swePaymentNumber_(fields.amountSubmitted);
    if (type === 'group' && amount !== 84) {
      return swePaymentResponse_({ ok: false, error: 'incorrect-amount' });
    }

    const safeName = swePaymentEscapeHtml_(fullName);
    const safeDescription = swePaymentEscapeHtml_(description);
    const safeReference = swePaymentEscapeHtml_(reference);
    const amountLabel = amount ? 'US$' + amount : '';
    const subject = 'We received your Wise payment information';
    const plainText = [
      'Hi ' + fullName + ',',
      '',
      'We received your Wise payment information for ' + description + (amountLabel ? ' (' + amountLabel + ')' : '') + '.',
      'Reference: ' + reference,
      '',
      'Your payment is now being reviewed. Your class or group access is not confirmed yet. We will email you again as soon as the payment has been verified.',
      '',
      'If you need help, reply to this email or contact ' + SWE_SUPPORT_EMAIL + '.',
      '',
      'Spanish with Elkin'
    ].join('\n');
    const html = '<div style="font-family:Arial,sans-serif;color:#172554;line-height:1.6;max-width:600px">' +
      '<h2 style="color:#1e3a8a">Payment information received</h2>' +
      '<p>Hi ' + safeName + ',</p>' +
      '<p>We received your Wise payment information for <strong>' + safeDescription +
      (amountLabel ? ' (' + amountLabel + ')' : '') + '</strong>.</p>' +
      '<p><strong>Reference:</strong> ' + safeReference + '</p>' +
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px">' +
      '<strong>Your payment is being reviewed.</strong><br>Your class or group access is not confirmed yet. We will email you again as soon as the payment has been verified.</div>' +
      '<p>If you need help, reply to this email or contact <a href="mailto:' + SWE_SUPPORT_EMAIL + '">' + SWE_SUPPORT_EMAIL + '</a>.</p>' +
      '<p>Spanish with Elkin</p></div>';

    if (MailApp.getRemainingDailyQuota() < 1) {
      return swePaymentResponse_({ ok: false, error: 'email-quota-exhausted' });
    }
    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: plainText,
      htmlBody: html,
      name: 'Spanish with Elkin',
      replyTo: SWE_SUPPORT_EMAIL
    });
    swePaymentMarkSent_(collectionName, documentId);
    return swePaymentResponse_({ ok: true });
  } catch (error) {
    console.error(error);
    return swePaymentResponse_({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function swePaymentGetDocument_(collectionName, documentId) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + SWE_PAYMENT_PROJECT_ID +
    '/databases/(default)/documents/' + encodeURIComponent(collectionName) + '/' + encodeURIComponent(documentId);
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Firestore read failed: ' + response.getResponseCode());
  return JSON.parse(response.getContentText());
}

function swePaymentMarkSent_(collectionName, documentId) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + SWE_PAYMENT_PROJECT_ID +
    '/databases/(default)/documents/' + encodeURIComponent(collectionName) + '/' + encodeURIComponent(documentId) +
    '?updateMask.fieldPaths=receiptEmailSentAt&updateMask.fieldPaths=receiptEmailStatus';
  const response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: {
      receiptEmailSentAt: { timestampValue: new Date().toISOString() },
      receiptEmailStatus: { stringValue: 'sent' }
    }}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Firestore email marker failed: ' + response.getResponseCode());
}

function swePaymentString_(field) { return field && field.stringValue ? field.stringValue : ''; }
function swePaymentNumber_(field) { return field ? Number(field.integerValue || field.doubleValue || 0) : 0; }
function swePaymentEscapeHtml_(value) {
  return String(value || '').replace(/[&<>"']/g, function(character) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
  });
}
function swePaymentResponse_(payload) {
  console.log(JSON.stringify(payload));
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

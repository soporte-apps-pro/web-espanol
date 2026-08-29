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
    if (!['private', 'group', 'activation', 'application', 'group_invitation'].includes(type) || !/^[A-Za-z0-9_-]{10,160}$/.test(documentId)) {
      return swePaymentResponse_({ ok: false, error: 'invalid-request' });
    }
    if (type === 'activation') return sweSendActivationEmail_(documentId);
    if (type === 'application') return sweSendApplicationEmail_(documentId);
    if (type === 'group_invitation') return sweSendGroupInvitations_(documentId);

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

function sweSendGroupInvitations_(groupId) {
  const groupDocument = swePaymentGetDocument_('speakingClubGroups', groupId);
  const groupFields = groupDocument.fields || {};
  if (swePaymentString_(groupFields.status) !== 'confirmed') {
    return swePaymentResponse_({ ok:false, error:'group-not-confirmed' });
  }

  const groupName = swePaymentString_(groupFields.name).trim();
  const slot = swePaymentString_(groupFields.slot).trim();
  const memberIds = swePaymentStrings_(groupFields.memberApplicationIds);
  const sessionDates = swePaymentStrings_(groupFields.sessionDates);
  if (!groupName || !slot || !memberIds.length || sessionDates.length !== 6) {
    return swePaymentResponse_({ ok:false, error:'incomplete-group' });
  }

  const slotConfig = {
    'monday-1000': { utc:'15:00', colombia:'Mondays at 10:00 a.m. Colombia time' },
    'tuesday-1700': { utc:'22:00', colombia:'Tuesdays at 5:00 p.m. Colombia time' },
    'wednesday-0800': { utc:'13:00', colombia:'Wednesdays at 8:00 a.m. Colombia time' },
    'thursday-1400': { utc:'19:00', colombia:'Thursdays at 2:00 p.m. Colombia time' },
    'friday-1100': { utc:'16:00', colombia:'Fridays at 11:00 a.m. Colombia time' }
  }[slot];
  if (!slotConfig) return swePaymentResponse_({ ok:false, error:'invalid-group-slot' });

  const paymentUrl = 'https://wise.com/pay/r/fG7w5Ne0IQCt3hA';
  const accessUrl = 'https://spanishwithelkin.com/student-access.html';
  const deadline = new Date(Date.now() + (48 * 60 * 60 * 1000));
  let sent = 0;
  let alreadySent = 0;

  memberIds.forEach(function(applicationId) {
    const application = swePaymentGetDocument_('speakingClubApplications', applicationId);
    const fields = application.fields || {};
    if (swePaymentString_(fields.groupInvitationGroupId) === groupId && fields.groupInvitationSentAt && fields.groupInvitationSentAt.timestampValue) {
      alreadySent += 1;
      return;
    }
    const email = swePaymentString_(fields.email).trim().toLowerCase();
    const fullName = swePaymentString_(fields.fullName).trim();
    const timeZone = swePaymentString_(fields.timeZone).trim() || 'America/Bogota';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) throw new Error('Incomplete application: ' + applicationId);

    let localDates;
    let deadlineLabel;
    let localSchedule;
    try {
      localDates = sessionDates.map(function(date) {
        return Utilities.formatDate(new Date(date + 'T' + slotConfig.utc + ':00Z'), timeZone, 'EEEE, MMMM d, yyyy \'at\' h:mm a z');
      });
      localSchedule = Utilities.formatDate(new Date(sessionDates[0] + 'T' + slotConfig.utc + ':00Z'), timeZone, 'EEEE \'at\' h:mm a z');
      deadlineLabel = Utilities.formatDate(deadline, timeZone, 'EEEE, MMMM d, yyyy \'at\' h:mm a z');
    } catch (error) {
      localDates = sessionDates.map(function(date) {
        return Utilities.formatDate(new Date(date + 'T' + slotConfig.utc + ':00Z'), 'America/Bogota', 'EEEE, MMMM d, yyyy \'at\' h:mm a z');
      });
      localSchedule = slotConfig.colombia;
      deadlineLabel = Utilities.formatDate(deadline, 'America/Bogota', 'EEEE, MMMM d, yyyy \'at\' h:mm a z');
    }

    const safeName = swePaymentEscapeHtml_(fullName);
    const safeGroup = swePaymentEscapeHtml_(groupName);
    const dateItems = localDates.map(function(date, index) {
      return '<li style="margin:6px 0"><strong>Session ' + (index + 1) + ':</strong> ' + swePaymentEscapeHtml_(date) + '</li>';
    }).join('');
    const subject = 'Your Speaking Club group is ready';
    const plainText = [
      'Hi ' + fullName + ',', '',
      'Good news! We found a compatible Speaking Club group for you.', '',
      'GROUP: ' + groupName,
      'WEEKLY SCHEDULE IN YOUR TIME ZONE: ' + localSchedule,
      'COLOMBIA SCHEDULE: ' + slotConfig.colombia, '',
      'YOUR SIX SESSIONS IN YOUR TIME ZONE:',
      localDates.map(function(date, index) { return 'Session ' + (index + 1) + ': ' + date; }).join('\n'), '',
      'PRICE: US$84 for all six 55-minute sessions.',
      'PAYMENT DEADLINE: ' + deadlineLabel, '',
      'WHAT TO DO NOW:',
      '1. Pay US$84 with Wise: ' + paymentUrl,
      '2. Return to ' + accessUrl,
      '3. Create your account and enter the Wise payment reference.',
      '4. Verify your email address.',
      '5. Wait while Elkin verifies the payment. You will receive another email when your access is active.', '',
      'Your place is confirmed only after your payment has been verified.', '',
      'If you need help, reply to this email or contact ' + SWE_SUPPORT_EMAIL + '.', '',
      'Spanish with Elkin'
    ].join('\n');
    const html = '<div style="font-family:Arial,sans-serif;color:#172554;line-height:1.6;max-width:620px">' +
      '<h2 style="color:#1e3a8a">Your Speaking Club group is ready</h2><p>Hi ' + safeName + ',</p>' +
      '<p><strong>Good news! We found a compatible Speaking Club group for you.</strong></p>' +
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px"><strong>Group:</strong> ' + safeGroup + '<br><strong>Weekly schedule in your time zone:</strong> ' + swePaymentEscapeHtml_(localSchedule) + '<br><span style="font-size:14px">Colombia schedule: ' + swePaymentEscapeHtml_(slotConfig.colombia) + '</span></div>' +
      '<h3 style="color:#1e3a8a">Your six sessions in your time zone</h3><ol style="padding-left:22px">' + dateItems + '</ol>' +
      '<div style="background:#ecfdf5;border:1px solid #86efac;border-radius:12px;padding:16px"><strong>Price:</strong> US$84 for all six 55-minute sessions.<br><strong>Payment deadline:</strong> ' + swePaymentEscapeHtml_(deadlineLabel) + '</div>' +
      '<h3 style="color:#1e3a8a">What to do now</h3><ol style="padding-left:22px"><li>Pay US$84 using Wise.</li><li>Return to the student access page.</li><li>Create your account and enter your Wise payment reference.</li><li>Verify your email address.</li><li>Wait while Elkin verifies the payment. You will receive another email when your access is active.</li></ol>' +
      '<p><a href="' + paymentUrl + '" style="display:inline-block;background:#15803d;color:white;text-decoration:none;font-weight:bold;border-radius:10px;padding:13px 20px;margin-right:8px">Pay US$84 with Wise</a> <a href="' + accessUrl + '" style="display:inline-block;background:#f97316;color:white;text-decoration:none;font-weight:bold;border-radius:10px;padding:13px 20px">Register my payment</a></p>' +
      '<p><strong>Your place is confirmed only after your payment has been verified.</strong></p>' +
      '<p>If you need help, reply to this email or contact <a href="mailto:' + SWE_SUPPORT_EMAIL + '">' + SWE_SUPPORT_EMAIL + '</a>.</p><p>Spanish with Elkin</p></div>';

    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Email quota exhausted');
    MailApp.sendEmail({ to:email, subject:subject, body:plainText, htmlBody:html, name:'Spanish with Elkin', replyTo:SWE_SUPPORT_EMAIL });
    sweGroupInvitationMarkSent_(applicationId, groupId, deadline);
    sent += 1;
  });
  return swePaymentResponse_({ ok:true, sent:sent, alreadySent:alreadySent });
}

function sweSendApplicationEmail_(documentId) {
  const document = swePaymentGetDocument_('speakingClubApplications', documentId);
  const fields = document.fields || {};
  if (fields.applicationEmailSentAt && fields.applicationEmailSentAt.timestampValue) {
    return swePaymentResponse_({ ok: true, alreadySent: true });
  }

  const email = swePaymentString_(fields.email).trim().toLowerCase();
  const fullName = swePaymentString_(fields.fullName).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) {
    return swePaymentResponse_({ ok: false, error: 'incomplete-application' });
  }

  const subject = 'We received your Speaking Club application';
  const plainText = [
    'Hi ' + fullName + ',', '',
    'We received your free application for the B1 Spanish Speaking Club.', '',
    'IMPORTANT: You do not need to pay yet.', '',
    'WHAT HAPPENS NEXT:',
    '1. Elkin reviews your B1 level, availability, country, and time zone.',
    '2. He looks for a compatible group of 3 to 5 learners.',
    '3. By September 18, you will receive an email telling you whether a compatible group was found.',
    '4. If you are matched, that email will show the exact weekly schedule and guide you through payment.', '',
    'Applications close September 15. Groups begin during the week of September 21.', '',
    'Submitting an application does not reserve a place. Your place is confirmed only after you are assigned to a group and your payment is verified.', '',
    'If you need help, reply to this email or contact ' + SWE_SUPPORT_EMAIL + '.', '',
    'Spanish with Elkin'
  ].join('\n');

  const safeName = swePaymentEscapeHtml_(fullName);
  const html = '<div style="font-family:Arial,sans-serif;color:#172554;line-height:1.6;max-width:620px">' +
    '<h2 style="color:#1e3a8a">We received your Speaking Club application</h2>' +
    '<p>Hi ' + safeName + ',</p>' +
    '<p>We received your free application for the <strong>B1 Spanish Speaking Club</strong>.</p>' +
    '<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:16px"><strong>Important: You do not need to pay yet.</strong></div>' +
    '<h3 style="color:#1e3a8a">What happens next</h3><ol style="padding-left:22px">' +
    '<li>Elkin reviews your B1 level, availability, country, and time zone.</li>' +
    '<li>He looks for a compatible group of 3 to 5 learners.</li>' +
    '<li>By <strong>September 18</strong>, you will receive an email telling you whether a compatible group was found.</li>' +
    '<li>If you are matched, that email will show the exact weekly schedule and guide you through payment.</li></ol>' +
    '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px">' +
    '<strong>Applications close:</strong> September 15<br><strong>Groups begin:</strong> the week of September 21</div>' +
    '<p><strong>Submitting an application does not reserve a place.</strong> Your place is confirmed only after you are assigned to a group and your payment is verified.</p>' +
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
  sweApplicationMarkSent_(documentId);
  return swePaymentResponse_({ ok: true });
}

function sweSendActivationEmail_(documentId) {
  const document = swePaymentGetDocument_('studentProfiles', documentId);
  const fields = document.fields || {};
  if (swePaymentString_(fields.status) !== 'active') {
    return swePaymentResponse_({ ok: false, error: 'access-not-active' });
  }
  if (fields.activationEmailSentAt && fields.activationEmailSentAt.timestampValue) {
    return swePaymentResponse_({ ok: true, alreadySent: true });
  }

  const email = swePaymentString_(fields.email).trim().toLowerCase();
  const fullName = swePaymentString_(fields.fullName).trim();
  const groupName = swePaymentString_(fields.groupName).trim();
  const slot = swePaymentString_(fields.slot).trim();
  const meetingUrl = swePaymentString_(fields.meetingUrl).trim();
  const dates = ((fields.sessionDates || {}).arrayValue || {}).values || [];
  const sessionDates = dates.map(function(value) { return swePaymentString_(value); }).filter(Boolean);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !groupName || !/^https:\/\/meet\.google\.com\/[A-Za-z]{3}-[A-Za-z]{4}-[A-Za-z]{3}\/?$/.test(meetingUrl) || sessionDates.length !== 6) {
    return swePaymentResponse_({ ok: false, error: 'incomplete-activation' });
  }

  const slotLabels = {
    'monday-1000':'Mondays at 10:00 a.m. Colombia time',
    'tuesday-1700':'Tuesdays at 5:00 p.m. Colombia time',
    'wednesday-0800':'Wednesdays at 8:00 a.m. Colombia time',
    'thursday-1400':'Thursdays at 2:00 p.m. Colombia time',
    'friday-1100':'Fridays at 11:00 a.m. Colombia time'
  };
  const schedule = slotLabels[slot] || slot;
  const formattedDates = sessionDates.map(function(date) {
    return Utilities.formatDate(new Date(date + 'T12:00:00Z'), 'UTC', 'EEEE, MMMM d, yyyy');
  });
  const portalUrl = 'https://spanishwithelkin.com/student-access.html';
  const safeName = swePaymentEscapeHtml_(fullName);
  const safeGroup = swePaymentEscapeHtml_(groupName);
  const safeSchedule = swePaymentEscapeHtml_(schedule);
  const dateItems = formattedDates.map(function(date, index) {
    return '<li style="margin:6px 0"><strong>Session ' + (index + 1) + ':</strong> ' + swePaymentEscapeHtml_(date) + '</li>';
  }).join('');

  const subject = 'Your Speaking Club access is active';
  const plainText = [
    'Hi ' + fullName + ',', '',
    'Your payment has been verified, your group has been confirmed, and your student portal is now active.', '',
    'GROUP: ' + groupName,
    'WEEKLY SCHEDULE: ' + schedule, '',
    'YOUR SIX SESSIONS:',
    formattedDates.map(function(date, index) { return 'Session ' + (index + 1) + ': ' + date; }).join('\n'), '',
    'GOOGLE MEET: ' + meetingUrl,
    'Use this same link for all six sessions. Join about 5 minutes before the scheduled start.', '',
    'WHAT TO DO NOW:',
    '1. Open ' + portalUrl,
    '2. Choose “I already have an account” and sign in with ' + email + '.',
    '3. Use the password you created when you submitted your payment information.',
    '4. Review your group and save all six dates in your calendar.', '',
    'WHAT TO EXPECT NEXT:',
    'Elkin will send the online meeting link and any preparation details before your first session. Your group meets at the same weekly time for all six sessions.', '',
    'If you need help, reply to this email or contact ' + SWE_SUPPORT_EMAIL + '.', '',
    'Spanish with Elkin'
  ].join('\n');
  const html = '<div style="font-family:Arial,sans-serif;color:#172554;line-height:1.6;max-width:620px">' +
    '<h2 style="color:#1e3a8a">Your Speaking Club access is active</h2>' +
    '<p>Hi ' + safeName + ',</p>' +
    '<p><strong>Your payment has been verified, your group has been confirmed, and your student portal is now active.</strong></p>' +
    '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px">' +
    '<strong>Group:</strong> ' + safeGroup + '<br><strong>Weekly schedule:</strong> ' + safeSchedule + '</div>' +
    '<h3 style="color:#1e3a8a">Your six sessions</h3><ol style="padding-left:22px">' + dateItems + '</ol>' +
    '<div style="background:#ecfdf5;border:1px solid #86efac;border-radius:12px;padding:16px"><strong>Your Google Meet link</strong><br>' +
    '<a href="' + meetingUrl + '" style="display:inline-block;background:#15803d;color:white;text-decoration:none;font-weight:bold;border-radius:10px;padding:12px 18px;margin:10px 0">Join Google Meet</a><br>' +
    '<span style="font-size:14px">Use this same link for all six sessions. Join about 5 minutes before the scheduled start.</span></div>' +
    '<h3 style="color:#1e3a8a">What to do now</h3><ol style="padding-left:22px">' +
    '<li>Open your student access page.</li><li>Choose <strong>I already have an account</strong> and sign in with <strong>' + swePaymentEscapeHtml_(email) + '</strong>.</li>' +
    '<li>Use the password you created when you submitted your payment information.</li><li>Review your group and save all six dates in your calendar.</li></ol>' +
    '<p><a href="' + portalUrl + '" style="display:inline-block;background:#f97316;color:white;text-decoration:none;font-weight:bold;border-radius:10px;padding:13px 20px">Open my student portal</a></p>' +
    '<h3 style="color:#1e3a8a">What to expect next</h3>' +
    '<p>Elkin will send the online meeting link and any preparation details before your first session. Your group meets at the same weekly time for all six sessions.</p>' +
    '<p>If you need help, reply to this email or contact <a href="mailto:' + SWE_SUPPORT_EMAIL + '">' + SWE_SUPPORT_EMAIL + '</a>.</p><p>Spanish with Elkin</p></div>';

  if (MailApp.getRemainingDailyQuota() < 1) {
    return swePaymentResponse_({ ok: false, error: 'email-quota-exhausted' });
  }
  MailApp.sendEmail({ to:email, subject:subject, body:plainText, htmlBody:html, name:'Spanish with Elkin', replyTo:SWE_SUPPORT_EMAIL });
  sweActivationMarkSent_(documentId);
  return swePaymentResponse_({ ok: true });
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

function sweActivationMarkSent_(documentId) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + SWE_PAYMENT_PROJECT_ID +
    '/databases/(default)/documents/studentProfiles/' + encodeURIComponent(documentId) +
    '?updateMask.fieldPaths=activationEmailSentAt&updateMask.fieldPaths=activationEmailStatus';
  const response = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: {
      activationEmailSentAt: { timestampValue: new Date().toISOString() },
      activationEmailStatus: { stringValue: 'sent' }
    }}), muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Firestore activation email marker failed: ' + response.getResponseCode());
}

function sweApplicationMarkSent_(documentId) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + SWE_PAYMENT_PROJECT_ID +
    '/databases/(default)/documents/speakingClubApplications/' + encodeURIComponent(documentId) +
    '?updateMask.fieldPaths=applicationEmailSentAt&updateMask.fieldPaths=applicationEmailStatus';
  const response = UrlFetchApp.fetch(url, {
    method: 'patch', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: {
      applicationEmailSentAt: { timestampValue: new Date().toISOString() },
      applicationEmailStatus: { stringValue: 'sent' }
    }}), muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Firestore application email marker failed: ' + response.getResponseCode());
}

function sweGroupInvitationMarkSent_(documentId, groupId, deadline) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + SWE_PAYMENT_PROJECT_ID +
    '/databases/(default)/documents/speakingClubApplications/' + encodeURIComponent(documentId) +
    '?updateMask.fieldPaths=groupInvitationSentAt&updateMask.fieldPaths=groupInvitationStatus&updateMask.fieldPaths=groupInvitationGroupId&updateMask.fieldPaths=paymentDeadline';
  const response = UrlFetchApp.fetch(url, {
    method:'patch', contentType:'application/json',
    headers:{ Authorization:'Bearer ' + ScriptApp.getOAuthToken() },
    payload:JSON.stringify({ fields:{
      groupInvitationSentAt:{ timestampValue:new Date().toISOString() },
      groupInvitationStatus:{ stringValue:'sent' },
      groupInvitationGroupId:{ stringValue:groupId },
      paymentDeadline:{ timestampValue:deadline.toISOString() }
    }}), muteHttpExceptions:true
  });
  if (response.getResponseCode() !== 200) throw new Error('Firestore group invitation marker failed: ' + response.getResponseCode());
}

function swePaymentString_(field) { return field && field.stringValue ? field.stringValue : ''; }
function swePaymentStrings_(field) {
  return ((((field || {}).arrayValue || {}).values) || []).map(swePaymentString_).filter(Boolean);
}
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

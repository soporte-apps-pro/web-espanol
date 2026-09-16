/**
 * Add this entire file to the SAME Apps Script project as payment-email-webhook.gs.
 * Run sweInstallPrivateTopupEmails once and authorize it. No web app redeploy is needed.
 * Uses Firestore + MailApp under the existing Google account, without Cloud Functions.
 */
const SWE_TOPUP_MAIL = {
  projectId: 'spanish-with-elkin',
  adminEmail: 'hello@spanishwithelkin.com',
  replyTo: 'hello@spanishwithelkin.com',
  adminUrl: 'https://spanishwithelkin.com/admin.html',
  portalUrl: 'https://spanishwithelkin.com/student-portal.html'
};

function sweInstallPrivateTopupEmails() {
  // Only replace this module's own trigger; preserve calendar and existing mail triggers.
  const existing = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'sweProcessPrivateTopupEmails'; });
  if (!existing.length) ScriptApp.newTrigger('sweProcessPrivateTopupEmails').timeBased().everyMinutes(15).create();
  existing.slice(1).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  sweTopupPatch_('privateTopupSettings', 'emailDelivery', { enabled:true, adminEmail:SWE_TOPUP_MAIL.adminEmail, installedAt:new Date() });
  sweProcessPrivateTopupEmails();
}

function sweProcessPrivateTopupEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const jobs = sweTopupRequest_(':runQuery', 'post', { structuredQuery: {
      from:[{collectionId:'privateTopupMail'}],
      where:{fieldFilter:{field:{fieldPath:'status'},op:'IN',value:{arrayValue:{values:['pending','retry','sending','activation_pending','terms_pending'].map(function(s){return {stringValue:s};})}}}},
      limit:30
    }}).filter(function(row){return row.document;}).map(function(row){return row.document;});
    jobs.sort(function(a,b){return String(sweTopupValue_(a.fields.createdAt)).localeCompare(String(sweTopupValue_(b.fields.createdAt)));});
    jobs.forEach(function(job) {
      try { sweTopupDeliver_(job); }
      catch(error) { console.error('Payment email queue: ' + String(error.message || error)); }
    });
    sweTopupPatch_('privateTopupSettings','emailDelivery',{enabled:true,adminEmail:SWE_TOPUP_MAIL.adminEmail,lastRunAt:new Date(),remainingQuota:MailApp.getRemainingDailyQuota()});
  } finally { lock.releaseLock(); }
}

function sweTopupDeliver_(job) {
  const id = job.name.split('/').pop(), f = job.fields || {};
  const status = sweTopupValue_(f.status);
  if (['sent','uncertain','failed'].indexOf(status) !== -1) return;
  if (status === 'sending') {
    if (Date.now() - new Date(sweTopupValue_(f.attemptStartedAt)).getTime() > 15*60000) {
      sweTopupPatch_('privateTopupMail',id,{status:'uncertain',lastError:'An earlier send did not record its result. Review before retrying.'},job.updateTime);
    }
    return;
  }
  if (f.nextAttemptAt && new Date(sweTopupValue_(f.nextAttemptAt)).getTime() > Date.now()) return;
  const reportId = sweTopupValue_(f.reportId), kind = sweTopupValue_(f.kind);
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(reportId) || id !== reportId + '_' + kind) throw new Error('Invalid email job');
  const report = sweTopupGet_(kind === 'admin_activation' ? 'privateEnrollments' : kind === 'student_activated' ? 'privateAccounts' : 'privateTopups',reportId);
  if (!report) { sweTopupPatch_('privateTopupMail',id,{status:'failed',lastError:'Payment report not found'},job.updateTime); return; }
  // Deliver the student acknowledgement before its confirmation/review email.
  if (kind === 'student_confirmed' || kind === 'student_rejected') {
    let receipt = sweTopupGet_('privateTopupMail',reportId + '_student_received');
    if (!receipt) return;
    if (sweTopupValue_(receipt.fields.status) !== 'sent') {
      sweTopupDeliver_(receipt);
      receipt = sweTopupGet_('privateTopupMail',reportId + '_student_received');
      if (sweTopupValue_(receipt.fields.status) !== 'sent') return;
    }
  }
  let mail;
  try { mail = kind === 'admin_activation' ? sweActivationCompose_(report.fields) : kind === 'student_activated' ? sweActivatedCompose_(report.fields) : sweTopupCompose_(report.fields,kind); }
  catch(error) { sweTopupPatch_('privateTopupMail',id,{status:'failed',lastError:String(error.message)},job.updateTime); return; }
  if (MailApp.getRemainingDailyQuota() < 1) {
    sweTopupPatch_('privateTopupMail',id,{status:'retry',nextAttemptAt:new Date(Date.now()+60*60000),lastError:'Waiting for email quota'},job.updateTime);
    return;
  }
  // Conditional claim prevents two worker copies from sending the same job concurrently.
  const claimed = sweTopupPatch_('privateTopupMail',id,{status:'sending',attemptStartedAt:new Date()},job.updateTime);
  try {
    MailApp.sendEmail(mail);
  } catch(error) {
    // A mail transport error can have an ambiguous result. Never automatically resend it.
    sweTopupPatch_('privateTopupMail',id,{status:'uncertain',lastError:'Mail service result requires review: '+String(error.message||error).slice(0,200)},claimed.updateTime);
    return;
  }
  // If this write fails, the stale 'sending' job is quarantined rather than sent twice.
  sweTopupPatch_('privateTopupMail',id,{status:'sent',sentAt:new Date(),lastError:''},claimed.updateTime);
}

function sweTopupCompose_(fields,kind) {
  const r = {};
  Object.keys(fields || {}).forEach(function(key){r[key]=sweTopupValue_(fields[key]);});
  const packs={single:{quantity:1,amount:25},pack4:{quantity:4,amount:84},pack8:{quantity:8,amount:152}};
  const pack=r.packageId==='custom'&&Number.isInteger(r.quantity)&&r.quantity>=1&&r.quantity<=100&&r.amountUsd>0&&r.amountUsd<=10000&&[30,50].includes(r.durationMinutes)?{quantity:r.quantity,amount:r.amountUsd}:packs[r.packageId];
  if (!pack || pack.quantity !== r.quantity || pack.amount !== r.amountUsd || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email || '') || !r.fullName || !r.paymentReference) throw new Error('Invalid stored payment data');
  let to=r.email,subject,title,paragraphs,link=SWE_TOPUP_MAIL.portalUrl,button='Open my student portal';
  const reference = r.paymentMethod + ' · ' + r.paymentReference;
  if (kind === 'admin_received') {
    to=SWE_TOPUP_MAIL.adminEmail;subject='Pago reportado: '+r.fullName+' · '+r.quantity+' clases';title='Nuevo pago reportado';
    paragraphs=['Estudiante: '+r.fullName+' ('+r.email+')','Paquete: '+r.quantity+' clases · US$'+r.amountUsd,
      'Método y referencia: '+reference,'Pagador: '+r.payerName,'Estado actual: '+({pending:'pendiente de verificar',confirmed:'confirmado',rejected:'revisión solicitada'}[r.status]||r.status),
      'Este aviso corresponde a un reporte del estudiante; no confirma que el dinero llegó. Comprueba el ingreso antes de añadir las clases.'];
    link=SWE_TOPUP_MAIL.adminUrl;button='Revisar pago en Administración';
  } else if (kind === 'student_received') {
    subject='We received your payment report';title='Payment report received';
    paragraphs=['Hi '+r.fullName+',','We received your report for '+r.quantity+' private classes (US$'+r.amountUsd+').','Payment reference: '+reference,
      r.status==='pending'?'Elkin will verify the payment. Your new classes are not active yet.':'Elkin has reviewed your report. Your review result is sent in a separate email and is also available in your portal.',
      'Reporting a payment does not confirm that the money arrived. You will receive a separate message after verification.'];
  } else if (kind === 'student_confirmed') {
    if (r.status !== 'confirmed') throw new Error('Payment not confirmed');
    subject='Payment confirmed · your classes are ready';title='Your new classes are ready';button='Book my classes';
    paragraphs=['Hi '+r.fullName+',','Elkin confirmed your payment and added '+r.quantity+' private classes to your account.','Payment reference: '+reference,'You can now sign in and book your next available times using your class balance.'];
  } else if (kind === 'student_rejected') {
    if (r.status !== 'rejected' || !r.reviewNote) throw new Error('Payment review is incomplete');
    subject='Please check your payment report';title='Your payment report needs a review';
    paragraphs=['Hi '+r.fullName+',','Elkin could not confirm this payment report. No classes were added.','Payment reference: '+reference,'Message from Elkin: '+r.reviewNote,
      'Please check the reference and contact Elkin by replying to this email.'];
  } else throw new Error('Unknown email type');
  if(r.durationMinutes) paragraphs.push('Class duration: '+r.durationMinutes+' minutes.');
  const body=paragraphs.join('\n\n')+'\n\n'+button+': '+link+'\n\nSpanish with Elkin · '+SWE_TOPUP_MAIL.replyTo;
  const htmlBody='<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172554;max-width:600px"><h2>'+sweTopupEscape_(title)+'</h2>'+paragraphs.map(function(p){return '<p>'+sweTopupEscape_(p)+'</p>';}).join('')+
    '<p><a href="'+link+'" style="display:inline-block;padding:12px 18px;background:#1e3a8a;color:#fff;border-radius:10px;text-decoration:none">'+sweTopupEscape_(button)+'</a></p><p>Spanish with Elkin<br>'+sweTopupEscape_(SWE_TOPUP_MAIL.replyTo)+'</p></div>';
  return {to:to,subject:subject,body:body,htmlBody:htmlBody,name:'Spanish with Elkin',replyTo:SWE_TOPUP_MAIL.replyTo};
}

function sweTopupValue_(field) {
  if (!field) return null;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('timestampValue' in field) return field.timestampValue;
  if ('booleanValue' in field) return field.booleanValue;
  return null;
}
function sweTopupEscape_(value) {
  return String(value || '').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function sweTopupRequest_(suffix,method,payload) {
  const base='https://firestore.googleapis.com/v1/projects/'+SWE_TOPUP_MAIL.projectId+'/databases/(default)/documents';
  const options={method:method,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true};
  if(payload){options.contentType='application/json';options.payload=JSON.stringify(payload);}
  const response=UrlFetchApp.fetch(base+suffix,options),code=response.getResponseCode();
  if(code===404&&method==='get')return null;
  if(code<200||code>=300)throw new Error('Firestore email operation failed ('+code+')');
  return JSON.parse(response.getContentText());
}
function sweTopupGet_(collection,id) {
  return sweTopupRequest_('/'+collection+'/'+encodeURIComponent(id),'get');
}
function sweTopupPatch_(collection,id,values,updateTime) {
  const fields={},masks=[];
  Object.keys(values).forEach(function(key){
    const v=values[key];fields[key]=v instanceof Date?{timestampValue:v.toISOString()}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:String(v)};
    masks.push('updateMask.fieldPaths='+encodeURIComponent(key));
  });
  if(updateTime)masks.push('currentDocument.updateTime='+encodeURIComponent(updateTime));
  return sweTopupRequest_('/'+collection+'/'+encodeURIComponent(id)+'?'+masks.join('&'),'patch',{fields:fields});
}

function sweActivationCompose_(fields) {
  const name=sweTopupValue_(fields.fullName),email=sweTopupValue_(fields.email);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new Error('Invalid enrollment data');
  const body='Un estudiante solicita activar sus clases personales.\n\nNombre: '+name+'\nCorreo: '+email+'\n\nRevisa su cuenta y activa el saldo que corresponda en el panel. Este aviso no confirma un pago ni la verificación del correo.\n\n'+SWE_TOPUP_MAIL.adminUrl+'#private';
  return {to:SWE_TOPUP_MAIL.adminEmail,subject:'Solicitud de activación: '+name,body:body,htmlBody:'<p>'+sweTopupEscape_(body).replace(/\n/g,'<br>')+'</p>',name:'Spanish with Elkin',replyTo:SWE_TOPUP_MAIL.replyTo};
}

function sweActivatedCompose_(fields) {
  const name=sweTopupValue_(fields.fullName),email=sweTopupValue_(fields.email);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new Error('Invalid account data');
  const available=Number(sweTopupValue_(fields.credited))-Number(sweTopupValue_(fields.used))-Number(sweTopupValue_(fields.reserved));
  const terms=fields.terms?.mapValue?.fields;
  const conditions=terms?'Your agreed conditions: '+sweTopupValue_(terms.packageQuantity)+' classes of '+sweTopupValue_(terms.durationMinutes)+' minutes for USD '+sweTopupValue_(terms.packageAmountUsd)+'.\n\n':'';
  const next=available>0?'You have '+available+' available classes. Sign in to your student portal and choose an available time to book your next class.':'Sign in to your student portal. If you have paid for a package, report your payment there so Elkin can verify it and add your classes. If you have not paid yet, choose your package and follow its payment instructions.';
  const body='Hi '+name+',\n\nElkin has activated your private class account.\n\n'+conditions+next+'\n\nYou can cancel or reschedule at least 24 hours before your class. After that, contact Elkin.\n\nOpen your student portal: '+SWE_TOPUP_MAIL.portalUrl;
  return {to:email,subject:'Your private class account is active',body:body,htmlBody:'<p>'+sweTopupEscape_(body).replace(/\n/g,'<br>')+'</p>',name:'Spanish with Elkin',replyTo:SWE_TOPUP_MAIL.replyTo};
}

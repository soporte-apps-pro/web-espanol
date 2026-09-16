import {getAuth} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import * as sdk from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {adminUid} from "./firebase-config.js";
import {createLessonStore} from "./private-lessons-store.mjs?v=20260916-booking-mail-1";
import {createTopupStore,packagesForAccount} from "./private-topup-store.mjs?v=20260916-booking-mail-1";

const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountPrivateTopups(root,app,admin=false) {
  const db=sdk.getFirestore(app),auth=getAuth(app),actor=()=>({uid:auth.currentUser?.uid,admin:auth.currentUser?.uid===adminUid});
  const store=createTopupStore(db,sdk,actor,createLessonStore(db,sdk,actor));
  const t=(es,en)=>admin?es:en;
  const stops=[];const pending=new Map();let busy=false,reports=[],packages={};
  root.innerHTML=`<h3>${t('Nuevos pagos de clases','Add more classes')}</h3>
    <p class="lesson-note">${t('Revisa el ingreso en tu cuenta antes de aprobar. Confirmar añade las clases una sola vez y prepara el correo para el estudiante.','Already paid for another package? Report your payment below. Elkin will verify it before adding classes to your balance.')}</p>
    <p class="lesson-notice" data-topup-message role="status" aria-live="polite"></p>
    ${admin?'<p class="lesson-note" data-mail-health>Cargando estado del correo…</p><p class="lesson-note" data-mail-queue></p><p><a href="private-topup-email-setup.html" target="_blank" rel="noopener noreferrer">Activar los avisos por correo</a></p>':`<details><summary>Report a new payment</summary><form data-topup-form>
      <label>Package<select name="packageId" required disabled><option value="">Loading your conditions…</option></select></label>
      <p><a data-wise-link hidden target="_blank" rel="noopener noreferrer"></a></p><p data-payment-note class="lesson-note"></p>
      <label>Payment method<select name="paymentMethod" required><option value="wise">Wise</option><option value="paypal">PayPal</option><option value="transfer">Bank transfer</option><option value="other">Other method agreed with Elkin</option></select></label>
      <label>Transaction reference<input name="paymentReference" required minlength="4" maxlength="100" autocomplete="off" placeholder="Reference from your payment receipt"></label>
      <p class="lesson-note">Use the transaction reference, not your account number. Letters, numbers, hyphens and underscores; spaces are removed.</p>
      <label>Name of the person who paid<input name="payerName" required minlength="2" maxlength="100" autocomplete="name"></label>
      <label class="topup-consent"><input name="paid" type="checkbox" required> I have already paid. This report does not confirm that the money has arrived.</label>
      <button class="primary" type="submit">Submit payment report</button></form></details>`}
    <div data-topup-reports></div>`;
  const message=(text,error=false)=>{const el=root.querySelector('[data-topup-message]');el.textContent=text;el.classList.toggle('error',error);};
  const date=value=>value?.toDate?new Intl.DateTimeFormat(admin?'es-CO':'en-US',{dateStyle:'medium',timeStyle:'short',...(admin?{timeZone:'America/Bogota'}:{})}).format(value.toDate()):'';
  const label=status=>({pending:t('Pendiente de verificar','Pending verification'),confirmed:t('Confirmado · clases añadidas','Confirmed · classes added'),rejected:t('Necesita revisión · sin recarga','Needs review · no classes added')})[status]||status;
  function render() {
    const items=[...reports].sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||(b.createdAt?.toMillis()||0)-(a.createdAt?.toMillis()||0));
    root.querySelector('[data-topup-reports]').innerHTML=items.length?items.map(r=>`<article class="lesson-row"><span class="lesson-badge">${esc(label(r.status))}</span>
      <h4>${admin?`${esc(r.fullName)} · `:''}${esc(r.packageLabel)} · US$${r.amountUsd}</h4>
      <p class="lesson-note">${esc(date(r.createdAt))}<br>${esc(r.paymentMethod)} · ${esc(r.paymentReference)}<br>${t('Pagador','Payer')}: ${esc(r.payerName)}${admin?`<br>${esc(r.email)}`:''}</p>
      ${r.status==='rejected'?`<p>${t('Mensaje para el estudiante','Message from Elkin')}: ${esc(r.reviewNote)}</p>`:''}
      ${admin&&r.status==='pending'?`<form data-topup-review="${esc(r.id)}"><label>Nota o mensaje para el estudiante<input name="reason" maxlength="500" placeholder="Obligatorio si no puedes verificar el pago"></label>
      <button class="primary" type="submit" name="action" value="approve">Confirmar pago y añadir ${r.quantity} clases</button>
      <button type="submit" name="action" value="reject">Solicitar revisión · no añadir clases</button></form>`:''}</article>`).join(''):`<p class="lesson-note">${t('No hay nuevos pagos reportados.','No payment reports yet.')}</p>`;
  }
  async function submit(event) {
    if(!event.target.matches('[data-topup-form],[data-topup-review]'))return;
    event.preventDefault();event.stopPropagation();if(busy)return;
    const form=event.target,values=Object.fromEntries(new FormData(form));let input;
    if(form.matches('[data-topup-form]'))input={action:'report',...values};
    else {
      const report=reports.find(r=>r.id===form.dataset.topupReview);if(!report)return;
      const action=event.submitter?.value;if(!['approve','reject'].includes(action))return;
      const reason=String(values.reason||'').trim()||(action==='approve'?`Pago verificado: ${report.paymentMethod} ${report.paymentReference}`:'');
      if(reason.length<3){message('Escribe qué debe revisar el estudiante.',true);return;}
      if(!confirm(action==='approve'?`¿Has comprobado que llegó el pago de ${report.fullName}? Se añadirán ${report.quantity} clases.`:'¿Solicitar al estudiante que revise este pago sin añadir clases?'))return;
      input={action,reportId:report.id,studentUid:report.studentUid,quantity:report.quantity,reason};
    }
    const key=JSON.stringify(input);if(!pending.has(key))pending.set(key,crypto.randomUUID());
    busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);message(t('Guardando…','Saving…'));
    try{
      const result=await store({...input,operationId:pending.get(key)});pending.delete(key);form.reset();if(!admin)paymentInfo();
      message(input.action==='report'?(result.data.alreadyReported?'This reference was already reported. Check its status below.':'Payment report saved. Your new classes are pending verification.'):
        input.action==='approve'?'Pago confirmado. Las clases se añadieron y el aviso quedó preparado para enviar.':'Revisión registrada. El mensaje para el estudiante quedó preparado para enviar.');
      document.dispatchEvent(new CustomEvent('private-lessons-changed'));
    }catch(error){console.error(error);message(t('No se pudo guardar. ','Could not save. ')+(error.message||'')+t(' Comprueba el estado antes de repetir.',' Check the status before trying again.'),true);}
    finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  root.addEventListener('submit',submit);
  function paymentInfo(){const select=root.querySelector('[name="packageId"]'),p=packages[select.value],link=root.querySelector('[data-wise-link]');link.hidden=!p?.wiseUrl;if(p?.wiseUrl){link.href=p.wiseUrl;link.textContent=`Pay US$${p.amountUsd}`;}root.querySelector('[data-payment-note]').textContent=p?(p.paymentNote||(!p.wiseUrl?'Use the payment method you agreed with Elkin. Contact Elkin if you need the payment details.':'')):'';}
  if(!admin){const select=root.querySelector('[name="packageId"]');select.addEventListener('change',paymentInfo);stops.push(sdk.onSnapshot(sdk.doc(db,'privateAccounts',auth.currentUser.uid),snap=>{packages=snap.exists()?packagesForAccount(snap.data()):{};const old=select.value;select.innerHTML=Object.entries(packages).map(([id,p])=>`<option value="${id}">${esc(p.label)} · US$${p.amountUsd}</option>`).join('');if(packages[old])select.value=old;select.disabled=!snap.exists();paymentInfo();},error=>{packages={};select.replaceChildren();select.disabled=true;message('Could not load your agreed conditions. Refresh before reporting a payment.',true);}));}
  const q=admin?sdk.collection(db,'privateTopups'):sdk.query(sdk.collection(db,'privateTopups'),sdk.where('studentUid','==',auth.currentUser.uid));
  stops.push(sdk.onSnapshot(q,snap=>{reports=snap.docs.map(d=>({id:d.id,...d.data()}));render();},error=>message(t('No se pudieron cargar los pagos. ','Could not load payment reports. ')+error.message,true)));
  if(admin){
    stops.push(sdk.onSnapshot(sdk.doc(db,'privateTopupSettings','emailDelivery'),snap=>{const s=snap.data();root.querySelector('[data-mail-health]').textContent=s?.enabled?`Avisos por correo configurados para ${s.adminEmail}. Última comprobación: ${date(s.lastRunAt)||'pendiente'}.`:'El correo automático está pendiente de activar en Google. Los reportes se guardan aquí y los avisos esperan su envío.';},()=>{root.querySelector('[data-mail-health]').textContent='No se pudo comprobar el estado de envío de correos.';}));
    stops.push(sdk.onSnapshot(sdk.query(sdk.collection(db,'privateTopupMail'),sdk.where('status','in',['pending','retry','sending','activation_pending','terms_pending','lesson_pending','uncertain','failed'])),snap=>{
      const uncertain=snap.docs.filter(d=>['uncertain','failed'].includes(d.data().status)).length;
      root.querySelector('[data-mail-queue]').textContent=snap.size?`${snap.size} avisos en espera.${uncertain?' Hay un envío cuyo resultado necesita revisión en Google.':''}`:'No hay avisos pendientes.';
    },()=>{}));
  }
  return()=>{stops.forEach(stop=>stop());root.removeEventListener('submit',submit);root.replaceChildren();};
}

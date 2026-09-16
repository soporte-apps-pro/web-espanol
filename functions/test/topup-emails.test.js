const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
const source=readFileSync(resolve(__dirname,'../../private-topup-emails.gs'),'utf8');
const fields=data=>Object.fromEntries(Object.entries(data).map(([k,v])=>[k,typeof v==='number'?{integerValue:String(v)}:v instanceof Date?{timestampValue:v.toISOString()}:{stringValue:v}]));
function fixture(){
  const records=new Map(),sent=[];let quota=100;let transportError=false;let markerError=false;
  const ctx=vm.createContext({console,Date,MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:m=>{sent.push(m);if(transportError)throw Error('Network result unknown');}}});vm.runInContext(source,ctx);
  ctx.sweTopupGet_=(c,id)=>records.get(c+'/'+id)||null;
  ctx.sweTopupPatch_=(c,id,v,expected)=>{
    const key=c+'/'+id,b=records.get(key);if(expected&&b.updateTime!==expected)throw Error('Conflict');
    if(markerError&&v.status==='sent')throw Error('Marker failed');
    const a={name:key,fields:{...b?.fields,...fields(v)},updateTime:String(Number(b?.updateTime||0)+1)};records.set(key,a);return a;
  };
  const reportId='alice_wise_TX1234';records.set('privateTopups/'+reportId,{fields:fields({studentUid:'alice',fullName:'Alice <Student>',email:'alice@example.test',packageId:'pack4',quantity:4,amountUsd:84,paymentMethod:'wise',paymentReference:'TX1234',payerName:'Alice',status:'pending'})});
  const job=kind=>{const key='privateTopupMail/'+reportId+'_'+kind,record={name:key,fields:fields({reportId,studentUid:'alice',kind,status:'pending',createdAt:new Date()}),updateTime:'1'};records.set(key,record);return record;};
  return {ctx,records,sent,job,reportId,setQuota:v=>quota=v,setTransportError:()=>transportError=true,setMarkerError:()=>markerError=true};
}
test('email recipients, copy and HTML escaping use stored payment data',()=>{
  const f=fixture();f.ctx.sweTopupDeliver_(f.job('admin_received'));f.ctx.sweTopupDeliver_(f.job('student_received'));
  assert.equal(f.sent[0].to,'hello@spanishwithelkin.com');assert.match(f.sent[0].body,/no confirma/);
  assert.equal(f.sent[1].to,'alice@example.test');assert.match(f.sent[1].body,/not active yet/);
  assert.match(f.sent[1].htmlBody,/Alice &lt;Student&gt;/);assert.doesNotMatch(f.sent[1].htmlBody,/Alice <Student>/);
});
test('successful jobs are not resent and confirmed students receive booking link',()=>{
  const f=fixture(),j=f.job('student_received');f.ctx.sweTopupDeliver_(j);f.ctx.sweTopupDeliver_(f.records.get(j.name));assert.equal(f.sent.length,1);
  f.records.get('privateTopups/'+f.reportId).fields.status={stringValue:'confirmed'};f.ctx.sweTopupDeliver_(f.job('student_confirmed'));
  assert.equal(f.sent.length,2);assert.match(f.sent[1].body,/added 4 private classes/);assert.match(f.sent[1].body,/student-portal.html/);
});
test('confirmation ensures the student receipt is delivered first',()=>{
  const f=fixture();f.job('student_received');f.records.get('privateTopups/'+f.reportId).fields.status={stringValue:'confirmed'};
  f.ctx.sweTopupDeliver_(f.job('student_confirmed'));assert.equal(f.sent.length,2);assert.match(f.sent[0].subject,/received/);assert.match(f.sent[1].subject,/confirmed/);
});
test('quota exhaustion queues a retry without attempting to send',()=>{
  const f=fixture(),j=f.job('admin_received');f.setQuota(0);f.ctx.sweTopupDeliver_(j);assert.equal(f.sent.length,0);assert.equal(f.records.get(j.name).fields.status.stringValue,'retry');
});
test('ambiguous transport errors and failed sent markers never automatically duplicate mail',()=>{
  const f=fixture(),j=f.job('admin_received');f.setTransportError();f.ctx.sweTopupDeliver_(j);f.ctx.sweTopupDeliver_(f.records.get(j.name));assert.equal(f.sent.length,1);assert.equal(f.records.get(j.name).fields.status.stringValue,'uncertain');
  const g=fixture(),k=g.job('admin_received');g.setMarkerError();assert.throws(()=>g.ctx.sweTopupDeliver_(k));g.ctx.sweTopupDeliver_(g.records.get(k.name));assert.equal(g.sent.length,1);
});
test('confirmation is never sent for an unconfirmed report',()=>{
  const f=fixture();const receipt=f.job('student_received');f.ctx.sweTopupDeliver_(receipt);
  const j=f.job('student_confirmed');f.ctx.sweTopupDeliver_(j);assert.equal(f.sent.length,1);assert.equal(f.records.get(j.name).fields.status.stringValue,'failed');
});

test('activation notice is addressed to teacher, escaped and sent once',()=>{
 const f=fixture();f.records.set('privateEnrollments/'+f.reportId,{fields:fields({fullName:'Test <Student>',email:'test@example.test'})});
 const j=f.job('admin_activation');f.ctx.sweTopupDeliver_(j);f.ctx.sweTopupDeliver_(f.records.get(j.name));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,'hello@spanishwithelkin.com');assert.match(f.sent[0].body,/admin.html#private/);assert.match(f.sent[0].htmlBody,/Test &lt;Student&gt;/);
});

test('activated student receives next steps for zero or positive balance, once',()=>{
 for(const credited of [0,4]){const f=fixture();f.records.set('privateAccounts/'+f.reportId,{fields:fields({fullName:'Test Student',email:'test@example.test',credited,used:0,reserved:0})});const j=f.job('student_activated');f.ctx.sweTopupDeliver_(j);f.ctx.sweTopupDeliver_(f.records.get(j.name));assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,'test@example.test');assert.match(f.sent[0].body,credited?/choose an available time/:/report your payment/);}
});

test('custom payment emails retain the agreed amount and lesson duration',()=>{
 const f=fixture();const r=f.records.get('privateTopups/'+f.reportId);Object.assign(r.fields,fields({packageId:'custom',quantity:6,amountUsd:99.5,durationMinutes:30}));
 f.ctx.sweTopupDeliver_(f.job('admin_received'));assert.equal(f.sent.length,1);assert.match(f.sent[0].body,/99.5/);assert.match(f.sent[0].body,/30 minutes/);
});
test('activation email explains the assigned package and duration',()=>{
 const f=fixture();const data=fields({fullName:'Alice',email:'alice@example.test',credited:0,used:0,reserved:0});data.terms={mapValue:{fields:fields({durationMinutes:30,packageQuantity:6,packageAmountUsd:99.5})}};
 const mail=f.ctx.sweActivatedCompose_(data);assert.match(mail.body,/6 classes of 30 minutes for USD 99.5/);assert.match(mail.body,/report your payment/);
});

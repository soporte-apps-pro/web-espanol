const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs'),{resolve}=require('node:path');
const source=readFileSync(resolve(__dirname,'../../private-lessons-ui.js'),'utf8');
async function submit(action,values={},confirmed=true){
 const {lessonChangeReason,lessonChangeConfirmation}=await import('../../private-lesson-actions.mjs');
 const calls=[],messages=[],questions=[];let focused=false;
 const form={values,matches:s=>s==='[data-change]',closest:()=>({dataset:{lesson:'lesson-1'}}),elements:{reason:{focus:()=>{focused=true;}}}};
 const context=vm.createContext({lessonChangeReason,lessonChangeConfirmation,admin:true,uid:'student-1',FormData:class {constructor(f){return Object.entries(f.values);}},message:(...args)=>messages.push(args),t:es=>es,confirm:text=>{questions.push(text);return confirmed;},execute:payload=>calls.push(payload)});
 vm.runInContext(source.slice(source.indexOf('  function handleSubmit(event)'),source.indexOf("  root.addEventListener('click',async event")),context);
 context.handleSubmit({preventDefault(){},target:form,submitter:{value:action}});
 return {calls,messages,questions,focused};
}
test('Completar una clase sin motivo ni horario nuevo alcanza el guardado con motivo automático',async()=>{
 const result=await submit('complete');assert.equal(result.calls.length,1);
 assert.equal(result.calls[0].action,'complete');assert.equal(result.calls[0].lessonId,'lesson-1');assert.equal(result.calls[0].studentUid,'student-1');
 assert.equal(result.calls[0].reason,'Clase realizada confirmada por Elkin');assert.equal(result.calls[0].slotId,undefined);
 assert.match(result.questions[0],/Pasará de reservada a consumida/);
 assert.match(source,/value="complete" formnovalidate/);
});
test('Completar conserva un motivo propio y cancelar la confirmación no guarda',async()=>{
 assert.equal((await submit('complete',{reason:'Clase de conversación'})).calls[0].reason,'Clase de conversación');
 assert.equal((await submit('complete',{},false)).calls.length,0);
});
test('Un motivo incompleto produce aviso en el formulario y foco en el campo',async()=>{
 const r=await submit('complete',{reason:'x'});assert.equal(r.calls.length,0);assert.equal(r.focused,true);assert.equal(r.messages[0][1],true);assert.ok(r.messages[0][2]);
});
test('Cambios y cancelaciones mantienen sus validaciones',async()=>{
 assert.equal((await submit('reschedule',{reason:'Cambio solicitado'})).calls.length,0);
 assert.equal((await submit('cancel')).calls.length,0);
 assert.equal((await submit('reschedule',{reason:'Cambio solicitado',slotId:'new-slot'})).calls[0].slotId,'new-slot');
});

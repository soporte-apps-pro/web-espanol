const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../google-calendar-availability-sync.gs'),'utf8');
const start=Date.parse('2026-09-23T01:00:00Z');
function fixture(minutes=30,events=[]){
 const queried=[],saved=[];const ctx=vm.createContext({Date,console:{log(){}},CalendarApp:{EventTransparency:{TRANSPARENT:'transparent'}}});vm.runInContext(source,ctx);
 ctx.getBlockingCalendars=()=>[{getEvents:(a,b)=>{queried.push([a.getTime(),b.getTime()]);return events;}}];
 ctx.getAvailabilityDocuments=()=>[{name:'projects/test/databases/(default)/documents/privateAvailability/slot',updateTime:'2026-09-17T00:00:00Z',fields:{status:{stringValue:'available'},startAt:{timestampValue:new Date(start).toISOString()},...(minutes==null?{}:{durationMinutes:{integerValue:String(minutes)}})}}];
 ctx.firestoreRequest=(url,options)=>{saved.push({url,body:JSON.parse(options.payload)});return {};};
 return {ctx,queried,saved};
}
const event=(from,to,transparent=false)=>({getStartTime:()=>new Date(start+from*60000),getEndTime:()=>new Date(start+to*60000),getTransparency:()=>transparent?'transparent':'opaque'});
test('30 minute slots stay free when another event starts at minute 30',()=>{
 const f=fixture(30,[event(30,80)]);f.ctx.syncPrivateAvailability();assert.equal(f.queried[0][1]-f.queried[0][0],30*60000);assert.equal(f.saved[0].body.fields.googleCalendarBlocked.booleanValue,false);assert.equal(f.saved[0].body.fields.googleCalendarCheckedDurationMinutes.integerValue,'30');
});
test('50 minute slots remain blocked by the same event',()=>{
 const f=fixture(50,[event(30,80)]);f.ctx.syncPrivateAvailability();assert.equal(f.saved[0].body.fields.googleCalendarBlocked.booleanValue,true);
});
test('real overlaps block, adjacent endings and transparent events do not',()=>{
 for(const [events,blocked]of [[[event(-30,0)],false],[[event(-30,1)],true],[[event(10,20)],true],[[event(10,20,true)],false]]){const f=fixture(30,events);f.ctx.syncPrivateAvailability();assert.equal(f.saved[0].body.fields.googleCalendarBlocked.booleanValue,blocked);}
});
test('legacy slots use 50 minutes and invalid durations fail without writing',()=>{
 const f=fixture(null);f.ctx.syncPrivateAvailability();assert.equal(f.queried[0][1]-f.queried[0][0],50*60000);const bad=fixture(0);assert.throws(()=>bad.ctx.syncPrivateAvailability(),/Invalid duration/);assert.equal(bad.saved.length,0);
});
test('patches use preconditions and a concurrent booking is left untouched',()=>{
 const f=fixture();f.ctx.syncPrivateAvailability();assert.match(f.saved[0].url,/currentDocument.updateTime=/);
 f.ctx.firestoreRequest=()=>{const e=Error('Changed');e.httpStatus=412;throw e;};assert.doesNotThrow(()=>f.ctx.syncPrivateAvailability());
});
test('availability listing follows pagination',()=>{
 const ctx=vm.createContext({console});vm.runInContext(source,ctx);const urls=[];ctx.firestoreRequest=url=>{urls.push(url);return urls.length===1?{documents:[{name:'first'}],nextPageToken:'next token'}:{documents:[{name:'second'}]};};
 assert.equal(ctx.getAvailabilityDocuments().length,2);assert.match(urls[1],/pageToken=next%20token/);
});

const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs'),{resolve}=require('node:path');
test('existing calendar sync creates 30 minute events from booked slots',()=>{
 const events=[];const context=vm.createContext({Date,console,CONFIG:{classesCalendarId:'test'},CalendarApp:{getCalendarById:()=>({getEvents:()=>[],createEvent:(title,start,end)=>events.push({title,start,end})})}});
 vm.runInContext(readFileSync(resolve(__dirname,'../../google-calendar-write-sync.gs'),'utf8'),context);
 context.indexFirestoreDocuments_=()=>({booking:{fullName:{stringValue:'Test Student'}}});
 context.listFirestoreDocuments_=name=>name==='privateAvailability'?[{name:'slots/test',fields:{status:{stringValue:'confirmed'},startAt:{timestampValue:new Date(Date.now()+86400000).toISOString()},bookingRequestId:{stringValue:'booking'},durationMinutes:{integerValue:'30'}}}]:[];
 context.syncConfirmedClassesToGoogleCalendar();assert.equal(events.length,1);assert.equal(events[0].end-events[0].start,30*60000);
});

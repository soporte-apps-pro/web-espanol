const test=require('node:test'),assert=require('node:assert/strict');
test('publication accepts half-hour starts through 11 pm and only supported durations',async()=>{
 const {validPrivateStart}=await import('../../private-availability.mjs');
 for(const time of ['07:00','18:30','22:30','23:00'])for(const minutes of [30,50])assert.equal(validPrivateStart(time,minutes),true);
 for(const time of ['06:30','23:30','24:00','22:15','bad'])assert.equal(validPrivateStart(time,30),false);
 assert.equal(validPrivateStart('23:00',60),false);
});
test('adjacent short slots fit, overlaps do not, and legacy capacity remains 50 minutes',async()=>{
 const {overlapsPrivateSlot}=await import('../../private-availability.mjs');
 const slot={startAt:{toMillis:()=>0},status:'available',durationMinutes:30,availabilityDurationMinutes:30};
 assert.equal(overlapsPrivateSlot(30*60000,30,slot),false);
 assert.equal(overlapsPrivateSlot(20*60000,30,slot),true);
 assert.equal(overlapsPrivateSlot(-30*60000,30,slot),false);
 delete slot.availabilityDurationMinutes;
 assert.equal(overlapsPrivateSlot(30*60000,30,slot),true);
 slot.status='closed';assert.equal(overlapsPrivateSlot(0,30,slot),false);
});

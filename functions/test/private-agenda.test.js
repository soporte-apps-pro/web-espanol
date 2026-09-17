const test=require('node:test');
const assert=require('node:assert/strict');
const make=(id,start,durationMinutes=50,status='reserved')=>({id,startAt:{toMillis:()=>start},durationMinutes,status});
test('agenda combines students, orders bookings and excludes resolved lessons',async()=>{
 const {groupReservedLessons}=await import('../../private-agenda.mjs');
 const result=groupReservedLessons([make('later',3000),make('cancelled',2000,50,'cancelled'),make('next',1000),make('done',1500,50,'completed')],0);
 assert.deepEqual(result.upcoming.map(l=>l.id),['next','later']);assert.equal(result.pending.length,0);
});
test('agenda keeps ongoing lessons and separates ended 30 and 50 minute lessons',async()=>{
 const {groupReservedLessons}=await import('../../private-agenda.mjs');
 const result=groupReservedLessons([make('short',0,30),make('long',0,50)],30*60000);
 assert.deepEqual(result.upcoming.map(l=>l.id),['long']);assert.deepEqual(result.pending.map(l=>l.id),['short']);
});
test('empty agenda and invalid dates do not count as reservations',async()=>{
 const {groupReservedLessons}=await import('../../private-agenda.mjs');
 assert.deepEqual(groupReservedLessons([{status:'reserved'}],0),{upcoming:[],pending:[]});
});

import { getApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, getDocsFromServer, getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { adminUid } from "./firebase-config.js";

const app = getApp();
const auth = getAuth(app);
const database = getFirestore(app);
const grid = document.querySelector("#calendar-grid");
const monthTitle = document.querySelector("#calendar-month");
const message = document.querySelector("#calendar-message");
let events = [];
let visibleMonth = colombiaToday();

function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function colombiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"America/Bogota", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type,part.value]));
  return new Date(Date.UTC(Number(value.year),Number(value.month)-1,Number(value.day),12));
}
function dateKey(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`; }
function timestampKey(timestamp) { return new Intl.DateTimeFormat("en-CA", { timeZone:"America/Bogota", year:"numeric", month:"2-digit", day:"2-digit" }).format(timestamp.toDate()); }
function colombiaTime(timestamp) { return new Intl.DateTimeFormat("es-CO", { timeZone:"America/Bogota", hour:"numeric", minute:"2-digit", hour12:true }).format(timestamp.toDate()); }
function addDays(date, days) { const result=new Date(date); result.setUTCDate(result.getUTCDate()+days); return result; }

function renderCalendar() {
  const year=visibleMonth.getUTCFullYear(); const month=visibleMonth.getUTCMonth();
  monthTitle.textContent = new Intl.DateTimeFormat("es-CO", { month:"long", year:"numeric", timeZone:"UTC" }).format(new Date(Date.UTC(year,month,1)));
  const first=new Date(Date.UTC(year,month,1,12)); const mondayOffset=(first.getUTCDay()+6)%7; const start=addDays(first,-mondayOffset); const todayKey=dateKey(colombiaToday());
  let visibleCount=0;
  grid.innerHTML=Array.from({length:42},(_,index)=>{
    const day=addDays(start,index); const key=dateKey(day); const dayEvents=events.filter((event)=>event.date===key); visibleCount+=dayEvents.length;
    return `<div class="calendar-day ${day.getUTCMonth()===month?"":"outside"} ${key===todayKey?"today":""}"><span class="calendar-number">${day.getUTCDate()}</span>${dayEvents.map((event)=>`<span class="calendar-event ${event.type}" title="${escapeHtml(event.details)}"><strong>${escapeHtml(event.time)}</strong> · ${escapeHtml(event.title)}<br>${escapeHtml(event.subtitle)}</span>`).join("")}</div>`;
  }).join("");
  document.querySelector("#calendar-tab-count").textContent=visibleCount;
}

async function loadCalendar() {
  message.className="message hidden";
  try {
    const [slotSnapshot,requestSnapshot,groupSnapshot]=await Promise.all([
      getDocsFromServer(collection(database,"privateAvailability")),
      getDocsFromServer(collection(database,"privateBookingRequests")),
      getDocsFromServer(collection(database,"speakingClubGroups")),
    ]);
    const requests=new Map(requestSnapshot.docs.map((item)=>[item.id,item.data()]));
    const privateEvents=slotSnapshot.docs.filter((item)=>item.data().status==="confirmed").map((item)=>{
      const slot=item.data(); const request=requests.get(slot.bookingRequestId)||{};
      return { type:"private", date:timestampKey(slot.startAt), time:colombiaTime(slot.startAt), title:"Clase privada", subtitle:request.fullName||"Estudiante", details:`${request.packageLabel||"Paquete privado"} · ${request.email||""}` };
    });
    const groupEvents=groupSnapshot.docs.filter((item)=>["confirmed","completed"].includes(item.data().status)).flatMap((item)=>{
      const group=item.data(); return (group.sessionDates||[]).map((date,index)=>({ type:"group", date, time:({"monday-1000":"10:00 a. m.","tuesday-1700":"5:00 p. m.","wednesday-0800":"8:00 a. m.","thursday-1400":"2:00 p. m.","friday-1100":"11:00 a. m."})[group.slot]||"", title:group.name, subtitle:`Speaking Club · Sesión ${index+1}`, details:`${group.memberApplicationIds?.length||0} estudiantes` }));
    });
    events=[...privateEvents,...groupEvents]; renderCalendar();
  } catch(error) { console.error(error); message.textContent="No fue posible cargar el calendario."; message.className="message error"; }
}

document.querySelector("#calendar-prev").addEventListener("click",()=>{ visibleMonth=new Date(Date.UTC(visibleMonth.getUTCFullYear(),visibleMonth.getUTCMonth()-1,1,12)); renderCalendar(); });
document.querySelector("#calendar-next").addEventListener("click",()=>{ visibleMonth=new Date(Date.UTC(visibleMonth.getUTCFullYear(),visibleMonth.getUTCMonth()+1,1,12)); renderCalendar(); });
document.querySelector("#calendar-today").addEventListener("click",()=>{ visibleMonth=colombiaToday(); renderCalendar(); });
document.querySelector('[data-admin-tab="calendar"]').addEventListener("click",loadCalendar);
onAuthStateChanged(auth,(user)=>{ if(user?.uid===adminUid) loadCalendar(); });

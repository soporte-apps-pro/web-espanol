export function validPrivateStart(time, minutes) {
 return [30,50].includes(minutes) && /^(0[7-9]|1[0-9]|2[0-2]):(00|30)$|^23:00$/.test(time);
}
export function overlapsPrivateSlot(startMs, minutes, slot) {
 const existing=slot.startAt?.toMillis?.();
 return slot.status!=='closed' && Number.isFinite(existing) && startMs < existing+(slot.availabilityDurationMinutes||50)*60000 && startMs+minutes*60000>existing;
}

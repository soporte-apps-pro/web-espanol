export function groupReservedLessons(lessons, now = Date.now()) {
  const active = lessons.filter(l => l.status === 'reserved' && Number.isFinite(l.startAt?.toMillis())).sort((a,b) => a.startAt.toMillis() - b.startAt.toMillis());
  const upcoming = [], pending = [];
  for (const lesson of active) {
    const end = lesson.startAt.toMillis() + (lesson.durationMinutes || 50) * 60000;
    (end > now ? upcoming : pending).push(lesson);
  }
  return { upcoming, pending };
}

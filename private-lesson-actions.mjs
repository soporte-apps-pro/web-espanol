export function lessonChangeReason(action, value, admin) {
  let reason = String(value || '').trim();
  if (admin && action === 'complete' && !reason) reason = 'Clase realizada confirmada por Elkin';
  if (reason.length > 500 || admin && reason.length < 3) throw new Error('Escribe un motivo de 3 a 500 caracteres para el historial.');
  return reason;
}
export function lessonChangeConfirmation(action, admin) {
  if (action === 'complete') return '¿Marcar esta clase como realizada? Pasará de reservada a consumida y quedará registrada en el historial. No se descontará otra clase disponible.';
  if (action === 'cancel') return admin ? '¿Cancelar esta clase y devolverla al saldo?' : 'Cancel this lesson and return its credit?';
  if (action === 'late_cancel') return '¿Cancelar y consumir esta clase por cancelación tardía?';
  if (action === 'no_show') return '¿Registrar ausencia y consumir esta clase?';
  return admin ? '¿Guardar este cambio?' : 'Save this change?';
}

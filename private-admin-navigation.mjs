export function mountPrivateAdminNavigation(root, canNavigate = () => true) {
  const sections = [
    ['reservations', 'Reservas', 'Ver próximas clases y gestionar cambios.'],
    ['students', 'Estudiantes', 'Consultar saldos, enlaces, tarifas e historial.'],
    ['activate', 'Activar estudiante', 'Habilitar una cuenta y asignar sus condiciones.'],
    ['payments', 'Pagos', 'Revisar pagos reportados y acreditar clases.'],
    ['availability', 'Disponibilidad', 'Consultar el calendario y publicar horarios.']
  ];
  const nav = document.createElement('nav');
  nav.className = 'private-task-nav';
  nav.setAttribute('aria-label', 'Qué quieres hacer en clases privadas');
  const intro = document.createElement('p');
  intro.className = 'lesson-note';
  intro.textContent = '¿Qué quieres hacer? Elige una opción.';
  root.querySelector('h2').after(intro, nav);
  const panes = new Map();
  for (const [id, label, description] of sections) {
    const pane = document.createElement('section');
    pane.id = 'private-task-' + id;
    pane.className = 'private-task-pane';
    pane.hidden = true;
    pane.setAttribute('aria-label', label);
    panes.set(id, pane);
    root.append(pane);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.privateTask = id;
    button.setAttribute('aria-controls', pane.id);
    button.setAttribute('aria-pressed', 'false');
    const title = document.createElement('strong');
    title.textContent = label;
    const subtitle = document.createElement('span');
    subtitle.textContent = description;
    button.append(title, subtitle);
    nav.append(button);
  }
  const move = (id, node) => { if (node) panes.get(id).append(node); };
  move('reservations', root.querySelector('.lesson-agenda'));
  const forms = root.querySelector('.lesson-forms');
  move('activate', root.querySelector('[data-open]'));
  move('students', root.querySelector('[data-student]').parentElement);
  // Pending accounts belong beside the activation form.
  move('activate', root.querySelector('[data-enrollments]').closest('details'));
  forms.remove();
  panes.get('activate').querySelector('details').open = true;
  for (const selector of ['[data-account]', '[data-class-link]', '[data-settings]', '[data-content]']) {
    move('students', root.querySelector(selector));
  }
  move('payments', root.querySelector('[data-topups]'));
  const availability = document.querySelector('#private-availability-tools');
  if (availability) { availability.hidden = false; move('availability', availability); }
  // Keep policies with class management, rather than above every task.
  for (const note of [...root.children].filter(el => el.matches('p.lesson-note') && el !== intro)) {
    move('reservations', note);
  }
  const fold = (form, label) => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = label;
    form.before(details);
    details.append(summary, form);
  };
  for (const [selector, label] of [
    ['[data-meeting]', 'Cambiar enlace de clase'],
    ['[data-duration]', 'Corregir duración'],
    ['[data-configure]', 'Cambiar tarifa y condiciones'],
    ['[data-credit]', 'Añadir clases pagadas o ajustar saldo'],
    ['[data-book]', 'Reservar una clase para este estudiante']
  ]) fold(root.querySelector(selector), label);
  function show(id, focus = false) {
    if (!panes.has(id) || !canNavigate()) return;
    for (const [key, pane] of panes) pane.hidden = key !== id;
    for (const button of nav.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.privateTask === id));
    }
    if (focus) {
      const pane = panes.get(id);
      pane.tabIndex = -1;
      pane.focus({preventScroll: true});
      nav.scrollIntoView({block: 'start', behavior: 'smooth'});
    }
  }
  const click = event => {
    const button = event.target.closest('[data-private-task]');
    if (button) show(button.dataset.privateTask, true);
  };
  nav.addEventListener('click', click);
  show('reservations');
  return {show, cleanup() {
    nav.removeEventListener('click', click);
    if (availability) {
      availability.hidden = true;
      root.after(availability);
    }
  }};
}

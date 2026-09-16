# Clases personales — Firebase Spark

Esta versión utiliza Firestore, Firebase Authentication y la sincronización existente con Google Calendar. No utiliza Cloud Functions ni requiere activar Blaze. `firebase.json` publica únicamente reglas de Firestore. Se aplican las cuotas gratuitas de Spark; no se ha habilitado facturación.

## Uso

1. El estudiante entra en `student-access.html`, elige **Private classes**, crea su cuenta y verifica el correo. Si ya tiene una cuenta con un perfil registrado, puede conservarla.
2. En **Administración → Privadas → Clases personales**, Elkin activa al estudiante por su correo e introduce solo las clases pendientes, con una nota de saldo inicial.
3. El estudiante puede informar un nuevo pago desde su portal. En **Nuevos pagos**, Elkin verifica el ingreso y pulsa **Confirmar pago y añadir clases**. También conserva el registro manual de paquetes y ajustes; no debe usarlo para duplicar una recarga ya confirmada. Los ajustes negativos solo pueden reducir el saldo disponible.
4. El estudiante ve clases acreditadas, consumidas, reservadas y disponibles; puede reservar horarios publicados y verificados por Calendar para los próximos 21 días.
5. Puede cancelar o reprogramar con al menos 24 horas de anticipación. Con menos de 24 horas, solo Elkin puede hacer cambios. Cancelar a tiempo devuelve la clase; reprogramar mantiene la reserva.
6. Elkin marca las clases realizadas o las ausencias después de terminar el horario. Ante una cancelación tardía puede consumir la clase o devolverla como excepción.

Las clases acreditadas incluyen saldo inicial, paquetes y ajustes; no incluyen las clases históricas anteriores a la carga inicial. Las clases consumidas distinguen realizadas, ausencias y cancelaciones tardías en el historial.

Los pagos del flujo público anterior no se acreditan automáticamente en este saldo. Las reservas anteriores tampoco se migran automáticamente. Revisar con cada estudiante sus clases pendientes y no registrar dos veces el mismo pago.

Los nuevos reportes del portal preparan correos para Elkin y el estudiante. El envío requiere activar el disparador de Google una vez siguiendo `private-topup-email-setup.html`. Ver `PRIVATE-TOPUP-EMAILS.md` para la instalación y la protección contra referencias repetidas.

## Seguridad y consistencia

- `private-lessons-store.mjs` realiza transacciones desde la web. Las reglas de Firestore validan los datos, permisos y plazo con `request.time`, independientemente de la hora del dispositivo.
- Cada operación modifica conjuntamente saldo, reserva, disponibilidad e historial inmutable. Un identificador de operación permite reintentar sin duplicar descuentos o créditos.
- Solo Elkin puede abrir saldos, añadir créditos, registrar realización o cobrar ausencias/cancelaciones tardías. Cada estudiante solo puede leer y gestionar sus clases.
- No se permite guardar una reserva sin su descuento, cambiar el saldo sin movimiento, falsificar un horario o devolver dos veces la misma clase.
- Las reservas simultáneas del mismo horario y el gasto simultáneo de la última clase se resuelven por transacciones.
- El administrador publica horarios no superpuestos: la pantalla comprueba intervalos de 50 minutos. Las reglas protegen la exclusividad de cada documento de horario; quien publique disponibilidad fuera de esta pantalla también debe evitar intervalos superpuestos entre documentos distintos.
- Una proyección protegida en `privateBookingRequests`, identificada con `lessonId`, permite que la sincronización de Calendar actual lea nombres y horarios sin actualizar Apps Script. No representa un nuevo pago. Los controles administrativos antiguos no modifican estas reservas con saldo.
- Cancelar o reprogramar invalida la verificación del horario liberado hasta que la sincronización quite el evento anterior y vuelva a comprobar disponibilidad.
- No se generan nuevos correos de reserva ni enlaces Meet. El enlace de clase se coordina con Elkin como antes.

## Pruebas y publicación

La carpeta `functions` contiene únicamente herramientas y pruebas locales; no contiene una función desplegable. Para ejecutar las pruebas con Node y Java 21:

```powershell
npm.cmd --prefix functions ci
npm.cmd run test:lessons
```

Se probaron 16 casos/grupos en el emulador: cuentas, permisos, transacciones concurrentes, reintentos, plazo de 24 horas, reprogramación, consumos, datos falsificados y compatibilidad con reservas públicas. Todos pasaron, sin omisiones. No se han usado cuentas ni saldos reales para las pruebas ni se ha realizado una prueba de navegador con sesiones reales.

Para publicar solo las reglas, sin servicios de pago:

```powershell
node functions/node_modules/firebase-tools/lib/bin/firebase.js deploy --project spanish-with-elkin --only firestore:rules
```

Después se publican los archivos estáticos en el GitHub Pages existente, conservando el dominio autorizado para Firebase Auth/App Check. No se cambia el plan de Firebase.

## Condiciones personales

Antes de activar, elegir tarifas generales (50 minutos) o un paquete personal en USD: cantidad de clases, precio total, duración de 30 o 50 minutos, enlace https opcional e instrucciones. El portal privado muestra únicamente el paquete asignado. Una clase consume un crédito, independientemente de su duración. Las cuentas anteriores conservan las tarifas generales.

El administrador puede editar las condiciones con un motivo. El precio cambia para reportes futuros; los reportes anteriores conservan el importe. Cambiar la duración requiere saldo pendiente y reservas en cero; no se convierten clases pagadas entre duraciones. Un reporte pendiente de otra duración no se acredita hasta resolver las condiciones.

La disponibilidad se sigue publicando en bloques de 50 minutos. Una reserva personal de 30 minutos marca su horario confirmado como 30 para la sincronización existente de Calendar. Al cancelar o reprogramar se restablece la capacidad de 50 minutos del horario liberado y se exige nueva verificación. No se ofrece automáticamente el tramo restante como otra reserva. Al publicar se conservan separaciones de al menos 50 minutos.

Los avisos de paquetes personales esperan con estado terms_pending hasta actualizar privateTopupEmails.gs en Google; el disparador de 15 minutos no cambia.

## Sesión del navegador

El acceso por correo configura persistencia local de Firebase antes de autenticar. La página de acceso reconoce la cuenta guardada y dirige al portal o a administración. Una pestaña de administración rechaza cuentas sin permisos sin cerrar su sesión en otras pestañas. La verificación conserva la sesión y permite continuar con una comprobación, sin otra contraseña. Los cierres normales solo ocurren al pulsar Cerrar sesión. Administración y estudiantes usan instancias de Firebase con nombres distintos (swe-admin y swe-student). Cada acceso conserva su cuenta entre pestañas y cerrar uno no cierra el otro. Tras esta actualización se debe iniciar sesión una vez en cada acceso; no se copian credenciales de la sesión compartida anterior. El navegador puede eliminar su almacenamiento, y las sesiones revocadas siguen requiriendo autenticación. Pruebas de control de sesión con SDK simulado; no se han usado contraseñas reales.

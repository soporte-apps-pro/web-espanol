# Clases personales — Firebase Spark

Esta versión utiliza Firestore, Firebase Authentication y la sincronización existente con Google Calendar. No utiliza Cloud Functions ni requiere activar Blaze. `firebase.json` publica únicamente reglas de Firestore. Se aplican las cuotas gratuitas de Spark; no se ha habilitado facturación.

## Uso

1. El estudiante entra en `student-access.html`, elige **Private classes**, crea su cuenta y verifica el correo. Si ya tiene una cuenta con un perfil registrado, puede conservarla.
2. En **Administración → Privadas → Clases personales**, Elkin activa al estudiante por su correo e introduce solo las clases pendientes, con una nota de saldo inicial.
3. Para añadir un paquete, Elkin verifica el pago y registra la cantidad de clases y su referencia. Los ajustes negativos solo pueden reducir el saldo disponible.
4. El estudiante ve clases acreditadas, consumidas, reservadas y disponibles; puede reservar horarios publicados y verificados por Calendar para los próximos 21 días.
5. Puede cancelar o reprogramar con al menos 24 horas de anticipación. Con menos de 24 horas, solo Elkin puede hacer cambios. Cancelar a tiempo devuelve la clase; reprogramar mantiene la reserva.
6. Elkin marca las clases realizadas o las ausencias después de terminar el horario. Ante una cancelación tardía puede consumir la clase o devolverla como excepción.

Las clases acreditadas incluyen saldo inicial, paquetes y ajustes; no incluyen las clases históricas anteriores a la carga inicial. Las clases consumidas distinguen realizadas, ausencias y cancelaciones tardías en el historial.

Los pagos del flujo público anterior no se acreditan automáticamente en este saldo. Las reservas anteriores tampoco se migran automáticamente. Revisar con cada estudiante sus clases pendientes y no registrar dos veces el mismo pago.

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

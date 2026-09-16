# Nuevos pagos y avisos por correo

## Flujo

- El estudiante con cuenta personal activa informa el paquete, el método, la referencia de la transacción y el pagador. Los paquetes utilizan los precios ya publicados: 1 clase US$25, 4 clases US$84, 8 clases US$152.
- El reporte queda pendiente en Administración → Privadas → Nuevos pagos. No añade clases.
- Se preparan dos correos: aviso en español a `hello@spanishwithelkin.com` y acuse en inglés al estudiante.
- Elkin comprueba el ingreso y confirma: reporte confirmado, recarga, referencia utilizada, historial y correo de confirmación se guardan en una sola transacción.
- Si solicita una revisión, se conserva el reporte y se prepara un correo con su mensaje. No se añade saldo. Para corregir la misma referencia ya revisada, el estudiante debe contactar a Elkin; no se permite reciclarla como un pago nuevo.

## Activación del correo

Abrir `private-topup-email-setup.html` en la web y seguir sus pasos. Añadir `private-topup-emails.gs` al proyecto existente de Apps Script que ya accede a Firestore y envía correos. Ejecutar una vez `sweInstallPrivateTopupEmails` y autorizar los permisos de Google. No sustituir el webhook existente ni sus implementaciones.

El instalador crea un único disparador propio cada quince minutos y escribe el estado en `privateTopupSettings/emailDelivery`. La ejecución registra `lastRunAt`, destinatario administrativo y cuota restante. Las integraciones anteriores permanecen intactas. No requiere Cloud Functions ni Blaze.

No se ha instalado el archivo en la cuenta de Google desde esta sesión: el editor de Apps Script no estaba disponible. El estado administrativo muestra que el correo está pendiente de activar hasta que se complete la instalación; los avisos quedan guardados. No se han enviado correos reales de prueba.

## Seguridad y duplicados

- `privateTopups`: reportes inmutables salvo decisión administrativa. El estudiante solo lee sus propios reportes y no puede falsificar el paquete ni el correo de destino.
- `privateTopupClaims`: reserva administrativa de una referencia confirmada. Dos reportes con el mismo método y referencia no pueden acreditar dos recargas.
- `privateTopupMail`: cola de avisos. El navegador crea solamente los mensajes que corresponden al evento validado por las reglas. Solo el servicio de Google puede actualizar su estado.
- Reintentar el mismo reporte o la misma aprobación no duplica clases ni mensajes. Los movimientos manuales de saldo anteriores siguen disponibles: no deben usarse para volver a acreditar un reporte ya confirmado.
- El correo se construye con los datos almacenados; no acepta un destinatario ni HTML enviado por el navegador. El nombre y los mensajes se escapan para HTML.
- El servicio comprueba la cuota antes de enviar, reclama cada mensaje usando la versión del documento y marca su resultado. Si el transporte o el registro posterior deja un resultado ambiguo, el estado pasa a `uncertain` y requiere revisión; no se promete entrega exactamente una vez ante un fallo entre el envío y su registro.
- El disparador revisa hasta 30 avisos por ejecución. Si se agota la cuota diaria, deja los avisos en `retry`. Los límites gratuitos de Google siguen aplicando.

## Validación

`npm.cmd run test:lessons` ejecuta las pruebas con Firestore local y MailApp simulado. Cubre reportes repetidos, aprobaciones concurrentes, referencia reutilizada, rechazos, permisos, escrituras incompletas, destinatarios, textos de correo, escape HTML, orden de notificaciones, cuotas y envíos inciertos.

La prueba con una cuenta real y la confirmación de recepción deben realizarse después de instalar el disparador en Google. No se requieren pagos ni saldos ficticios en producción para activar el servicio.

Los nuevos registros privados crean un aviso admin_activation en la misma transacci?n. Solo se env?a al administrador una vez; no confirma verificaci?n ni pago. No se notifican registros anteriores. Para activar esta ampliaci?n, reemplazar privateTopupEmails.gs en Google y guardar; el activador existente sirve.

Al activar el saldo se crea student_activated una vez, con instrucciones de reserva o recarga seg?n el saldo disponible. Requiere actualizar el mismo archivo de Apps Script; no se aplica retroactivamente.

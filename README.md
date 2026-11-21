# CashPlay v2 • App de Recompensas con Offerwalls, Referidos y Persistencia

Aplicación Web Móvil PWA completa con backend en Node.js lista para GitHub y Render.

## Novedades incluidas
- **Base de datos persistente (`database.json`)**: Guarda usuarios, monedas, ofertas completadas, referidos y solicitudes de retiro. (Si conectas un Persistent Disk en Render, configura `DATA_DIR=/var/data`).
- **Sistema de Referidos viral**: Cada usuario recibe su propio enlace (`/?ref=CASH-XXXX`), gana +300 monedas por invitación y un **10% de comisión automática** sobre lo que ganen sus invitados en Offerwalls.
- **Postback S2S (`/api/postback`)** y **Endpoint Admin (`/api/admin/overview?secret=TU_CLAVE`)** para revisar usuarios y pagos pendientes.

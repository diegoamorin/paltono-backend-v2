# Monolito modular con PostgreSQL

Se acuerda iniciar el backend NestJS como una aplicación y una base PostgreSQL, con módulos de cuentas/autenticación, identidades del catálogo, música, eventos/tours, contribuciones editoriales, vocabularios administrados e interacciones. Cada módulo posee sus escrituras; contribuciones editoriales coordina las transacciones entre áreas necesarias para publicar propuestas y grupos atómicos.

Se elige esta estructura frente a microservicios iniciales para conservar las garantías transaccionales del modelo editorial. Los límites facilitan una separación futura, pero extraer servicios requerirá revisar las operaciones atómicas entre módulos; no se promete una migración transparente.

La persistencia usará TypeORM con entidades separadas de los DTOs de entrada/salida y migraciones explícitas de PostgreSQL para las restricciones y triggers requeridos. La sincronización automática del esquema estará desactivada en producción. Se mantiene pnpm como gestor de paquetes y Railway como destino previsto de despliegue.

La cobertura de la API se define por casos de uso y relaciones del ER, incluyendo administración y moderación. Una matriz vinculará cada caso con endpoint, permisos, DTOs, pruebas y documentación Swagger; cubrir una tabla no implica exponer un CRUD que evada el flujo editorial. Se acuerdan pruebas primero, integración con PostgreSQL real y pruebas HTTP, incluyendo privacidad, rollback y concurrencia donde corresponda. Los escenarios de aceptación de la especificación editorial son obligatorios.

El contrato HTTP seguirá [JSON:API](0004-json-api-contract.md), conservando los permisos y las transacciones editoriales.

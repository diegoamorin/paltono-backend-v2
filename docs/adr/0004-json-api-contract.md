# Contrato HTTP basado en JSON:API

Se adopta JSON:API para que los clientes web, móviles y externos compartan un contrato estándar de recursos, relaciones y errores. La referencia es la [especificación JSON:API 1.1](https://jsonapi.org/format/1.1/). El formato HTTP no modifica la propiedad editorial, las autorizaciones ni las transacciones del dominio. Swagger se generará con las herramientas documentadas de NestJS y DTOs que representen el contrato real.

La API incluirá búsqueda global de fichas y listados con filtros específicos. La búsqueda contemplará nombres, títulos y alias registrados, incluidos texto coreano y romanizaciones aportadas, sin asumir transliteración automática. Los listados tendrán paginación, límites y orden estable.

Se admiten `include`, `fields[tipo]`, `sort`, filtros documentados por recurso y paginación mediante `page[number]` y `page[size]`. El tamaño por defecto será 20 y el máximo 100; la inclusión de relaciones se limita a dos niveles mediante rutas permitidas. Los filtros podrán combinar criterios y relaciones expresamente soportadas. La definición concreta de campos, operadores y rutas se documentará por endpoint; JSON:API no aporta automáticamente esa semántica. Toda selección de campos, inclusión o filtro conserva las restricciones de privacidad y borradores.

Las obras usan su PK `works.id` BIGINT como identificador de recurso, serializada como cadena. Los demás recursos conservan sus identificadores públicos existentes y las operaciones editoriales utilizan sus UUID editoriales. No se añade una segunda columna de identidad a `works`.

El slug de una obra es único, se genera a partir del título y se conserva cuando cambia ese título. Una colisión genera un sufijo como `butter-2`; la asignación debe respetar la unicidad incluso ante creaciones simultáneas. Los títulos de obras no son únicos. El slug no sustituye al identificador estable del recurso.

La API se expone bajo el prefijo `/v1` y exige el media type `application/vnd.api+json`, respondiendo 415 o 406 según la especificación, también en los endpoints de autenticación. `/health` queda fuera de `/v1`, responde JSON simple mediante `@nestjs/terminus` y sirve al healthcheck de Railway.

La búsqueda global se implementa en PostgreSQL con `pg_trgm` y `unaccent` sobre nombres visibles, alias y títulos, sin motor externo. Los filtros, ordenaciones e `include` permitidos de cada recurso se definen en la matriz de endpoints y se revisan en conjunto.

Swagger UI y el documento OpenAPI están activos en desarrollo; en producción se desactivan por defecto y solo se habilitan mediante variable de entorno, protegidos con autenticación básica. Ocultarlos no sustituye la autorización: la seguridad depende de autenticación, permisos, validación y límites de peticiones. Las pruebas verifican que el documento OpenAPI se genera sin errores. El mismo documento se versiona en `openapi.json` como contrato para las aplicaciones (`pnpm openapi:export`) y una prueba falla si deja de coincidir con la API; publicarlo en el repositorio no expone nada que el código fuente no muestre ya.

La [matriz de endpoints](../api/endpoint-matrix.md) concreta rutas, permisos, filtros, ordenaciones, `include` y pruebas de cada caso de uso. Las cuentas se exponen por `users.uuid`, las filas dependientes por su PK entera, y una ficha retirada responde 200 con su aviso.

# Contrato HTTP basado en JSON:API

Se adopta JSON:API para que los clientes web, móviles y externos compartan un contrato estándar de recursos, relaciones y errores. La referencia es la [especificación JSON:API 1.1](https://jsonapi.org/format/1.1/). El formato HTTP no modifica la propiedad editorial, las autorizaciones ni las transacciones del dominio. Swagger se generará con las herramientas documentadas de NestJS y DTOs que representen el contrato real.

La API incluirá búsqueda global de fichas y listados con filtros específicos. La búsqueda contemplará nombres, títulos y alias registrados, incluidos texto coreano y romanizaciones aportadas, sin asumir transliteración automática. Los listados tendrán paginación, límites y orden estable.

Se admiten `include`, `fields[tipo]`, `sort`, filtros documentados por recurso y paginación mediante `page[number]` y `page[size]`. El tamaño por defecto será 20 y el máximo 100; la inclusión de relaciones se limita a dos niveles mediante rutas permitidas. Los filtros podrán combinar criterios y relaciones expresamente soportadas. La definición concreta de campos, operadores y rutas se documentará por endpoint; JSON:API no aporta automáticamente esa semántica. Toda selección de campos, inclusión o filtro conserva las restricciones de privacidad y borradores.

Las obras usan su PK `works.id` BIGINT como identificador de recurso, serializada como cadena. Los demás recursos conservan sus identificadores públicos existentes y las operaciones editoriales utilizan sus UUID editoriales. No se añade una segunda columna de identidad a `works`.

El slug de una obra es único, se genera a partir del título y se conserva cuando cambia ese título. Una colisión genera un sufijo como `butter-2`; la asignación debe respetar la unicidad incluso ante creaciones simultáneas. Los títulos de obras no son únicos. El slug no sustituye al identificador estable del recurso.

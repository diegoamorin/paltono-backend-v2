# Matriz de endpoints del MVP

Aprobada el 2026-10-17, incluidas las decisiones P1–P7. Deriva de `ERDiagram.mdj`, [la especificación editorial](../editorial-contributions.md) y los ADR [0001](../adr/0001-modular-monolith.md)–[0005](../adr/0005-image-uploads-to-r2.md). Nada de esto está implementado todavía. Las decisiones propias de esta matriz están marcadas **[P#]** y reunidas al final.

## Convenciones comunes

- Prefijo `/v1`; `Content-Type` y `Accept`: `application/vnd.api+json` (415/406 según JSON:API). `/health` queda fuera.
- Identificadores de recurso (`id`, siempre cadena): `public_id` en identidades, artistas, grabaciones, lanzamientos (`release-groups`), ediciones (`releases`), eventos y tours; `works.id`; `users.uuid` para cuentas **[P1]**; UUID en recursos editoriales; PK entera para filas dependientes como pistas y créditos **[P2]**. Cada ficha expone `meta.editorialEntityId` para operar en el flujo editorial.
- Paginación `page[number]`/`page[size]` (20 por defecto, 100 máximo), con `meta.total` y enlaces `first/prev/next/last`. Orden estable: toda ordenación añade el `id` como desempate.
- `include` hasta dos niveles, solo por las rutas listadas. `fields[tipo]` en todos los recursos. Un `include`, `sort` o filtro no listado responde 400.
- Las columnas de orden listan campos: cada uno admite ambas direcciones, y la dirección escrita es la habitual **[P12]**. Un filtro por código o slug de un vocabulario que no existe devuelve una lista vacía, no 400 **[P13]**.
- Errores en formato JSON:API: 400 consulta mal formada, 401 sin autenticación, 403 autenticado sin permiso, 404 inexistente u oculto por privacidad, 409 estado o concurrencia incompatibles, 415/406 media type, 422 validación, 429 límite de peticiones.
- Fichas: solo se sirven raíces `published` o `withdrawn`; una reserva responde 404. Una ficha retirada responde 200 con su identificador, `publicationStatus: withdrawn`, `withdrawnAt` y sin el contenido retirado **[P3]**. Las relaciones hacia una ficha retirada muestran solo ese aviso. Los listados de fichas solo incluyen raíces `published`; una ficha retirada se consulta por su id **[P11]**.
- Imágenes de las fichas (`imgProfile` y `person.imgFullBody` de identidades, `coverArt` de ediciones, `image` de tours y eventos): se leen como `{url, width, height}` o `null`, y `null` también cuando la URL guardada no tiene una subida con su archivo (ADR 0005). Los payloads editoriales, las revisiones y `avatarUrl` siguen siendo solo la URL.
- Fechas parciales: se serializan como `{year, month, day}` con nulos; los filtros de rango comparan solo la precisión conocida y documentan que una fecha parcial que se solapa con el rango se incluye.

### Niveles de acceso

| Código | Quién |
|---|---|
| `Pub` | Cualquiera, sin autenticación |
| `Auth` | Cuenta autenticada en cualquier estado que pueda iniciar sesión, incluida sin verificar |
| `Ver` | Cuenta `active` con correo verificado |
| `Own` | `Ver` y además autora del recurso |
| `Staff` | `Ver` con rol moderador o administrador |
| `Admin` | `Ver` con rol administrador |

Toda comprobación de acceso relee el estado vigente de cuenta y sesión; la expiración del token de acceso no basta.

### Categorías de prueba

Cada endpoint tendrá pruebas HTTP contra PostgreSQL real de las categorías que le correspondan:

| Código | Qué cubre |
|---|---|
| `ok` | Caso válido, forma del documento JSON:API, cabeceras |
| `val` | Validación de cuerpo, parámetros, `include`/`sort`/filtros no permitidos |
| `authn` | Sin token, token caducado, sesión revocada, cuenta suspendida o eliminada |
| `authz` | Rol o propiedad insuficientes; borradores y datos privados ocultos como 404 |
| `state` | Transiciones no permitidas (409) |
| `conc` | Peticiones simultáneas: una sola aplicación efectiva |
| `tx` | Rollback completo ante fallo intermedio |
| `rate` | Límite de peticiones (429) |
| `spec` | Escenario de aceptación de la §6 de la especificación editorial |

### Swagger

Cada controlador usa `@ApiTags` por módulo; cada operación `@ApiOperation`, `@ApiParam`/`@ApiQuery` por filtro, `@ApiBearerAuth` o `@ApiCookieAuth` y respuestas `@ApiOkResponse`/`@ApiCreatedResponse` y de error con DTO. Los documentos JSON:API genéricos (`{data, included, links, meta}`) se describen con `@ApiExtraModels` y `getSchemaPath`, la técnica de respuestas genéricas de la documentación de NestJS. Una prueba genera el documento OpenAPI y falla si hay errores.

## 1. Cuentas y autenticación (módulo `accounts`)

| # | Método y ruta | Caso de uso | Acceso | Cuerpo o resultado | Pruebas |
|---|---|---|---|---|---|
| A1 | `POST /v1/users` | Registro | Pub | `users`: username, email, password, displayName. 201 con cuenta sin verificar; envía correo, con enlace a la aplicación principal, después del commit | ok val rate conc |
| A2 | `POST /v1/email-verifications` | Confirmar correo con token | Pub | `{token}`. Marca verificado y consume el token | ok val state |
| A3 | `POST /v1/email-verification-requests` | Reenviar verificación | Auth | `{}`. 202 aunque el envío falle | ok authn rate state |
| A4 | `POST /v1/sessions` | Login con username o correo | Pub | `{identifier, password, client: web|mobile}`. Devuelve token de acceso; renovación en cookie (web) o en el cuerpo (móvil). Suspendida: error específico solo con contraseña correcta | ok val rate state |
| A5 | `POST /v1/session-refreshes` | Renovar sesión | Cookie o token de renovación | Rota el token; conserva el límite absoluto de 30 días. Reutilizar un token ya rotado falla | ok authn conc |
| A6 | `DELETE /v1/sessions/current` | Logout | Auth | 204; revoca la sesión actual y borra la cookie | ok authn |
| A7 | `GET /v1/me/sessions` | Listar sesiones propias | Auth | user agent, IP, creación, expiración; marca la actual | ok authn |
| A8 | `DELETE /v1/me/sessions/{id}` | Revocar una sesión propia | Auth | 204; sesión ajena responde 404 | ok authn authz |
| A9 | `POST /v1/password-reset-requests` | Pedir recuperación | Pub | `{email}`. 202 idéntico exista o no la cuenta | ok val rate |
| A10 | `POST /v1/password-resets` | Completar recuperación | Pub | `{token, password}`. Verifica el correo y revoca todas las sesiones | ok val state conc |
| A11 | `POST /v1/me/password-changes` | Cambiar contraseña | Auth | `{currentPassword, newPassword}`. Revoca todas las sesiones | ok val authn |
| A12 | `POST /v1/me/email-change-requests` | Pedir cambio de correo | Auth **[P4]** | `{currentPassword, newEmail}`. Envía token al correo nuevo | ok val rate state |
| A13 | `POST /v1/email-changes` | Confirmar cambio de correo | Pub | `{token}`. Revalida unicidad bajo bloqueo; invalida otros tokens de cambio | ok state conc |
| A14 | `GET /v1/me` | Cuenta propia | Auth | Incluye correo, verificación, rol, estado, `usernameChangedAt` y próxima fecha de cambio | ok authn |
| A15 | `PATCH /v1/me` | Editar perfil | Ver | displayName, bio, username (cada 7 días; un no-op no reinicia el plazo). `avatarUrl` solo admite `null`, que quita el avatar y borra su archivo; una URL responde 422 | ok val state conc |
| A20 | `PUT /v1/me/avatar` | Subir el avatar propio | Ver | `multipart/form-data`, campo `file`, con la validación y el procesamiento de E22. Registra una subida `avatar`, la aplica de inmediato como `avatarUrl` (sin flujo editorial, ADR 0005) y borra del almacenamiento el avatar anterior. Devuelve la cuenta propia. Cupo de 1 cada 15 días para todos los roles, aparte del de catálogo: 429 `upload_quota_exceeded` con `meta.availableAt` | ok val authz rate tx |
| A16 | `POST /v1/account-deletions` | Baja voluntaria | Ver | `{password}`. Aplica la limpieza de datos, borra del almacenamiento el archivo del avatar (las subidas de catálogo se conservan) y respeta al último administrador | ok val state tx |
| A17 | `GET /v1/users/{id}` | Perfil público | Pub | username, displayName, avatar, bio, rol, fecha de registro, indicador de suspensión; eliminada solo muestra el username | ok authz |
| A18 | `GET /v1/users?filter[username]=` | Buscar perfil por username | Pub | 0 o 1 resultado; no hay listado público de cuentas | ok val |
| A19 | `GET /v1/users/{id}/proposals` | Envíos públicos de una cuenta | Pub | Proyección pública (ver E-proyección) | ok authz |

Filtros y orden de A19: `filter[status]=open|closed`, `filter[entityType]`; orden `-submittedAt` (defecto), `submittedAt`.

## 2. Administración de cuentas (módulo `accounts`)

| # | Método y ruta | Caso de uso | Acceso | Notas | Pruebas |
|---|---|---|---|---|---|
| U1 | `GET /v1/admin/users` | Listar cuentas | Admin | Incluye correo **[P5]** | ok authz val |
| U2 | `GET /v1/admin/users/{id}` | Detalle administrativo | Admin | | ok authz |
| U3 | `POST /v1/admin/users/{id}/role-changes` | Cambiar rol | Admin | `{newRole, reason}`. Bloquea, compara el rol anterior y protege al último admin | ok val authz state conc tx spec |
| U4 | `GET /v1/admin/users/{id}/role-changes` | Auditoría de roles | Admin | | ok authz |
| U5 | `POST /v1/admin/users/{id}/status-changes` | Suspender, reactivar o dar de baja una suspendida | Admin | `{newStatus, reason}`. La suspensión revoca las sesiones | ok val authz state conc tx |
| U6 | `GET /v1/admin/users/{id}/status-changes` | Auditoría de estados | Admin | | ok authz |

U1: `filter[q]` (username, correo, nombre visible), `filter[role]`, `filter[status]`, `filter[emailVerified]`; orden `-createdAt` (defecto), `username`, `lastLoginAt`.

## 3. Vocabularios administrados (módulo `vocabularies`)

Lectura pública; escritura de administradores fuera del flujo editorial. Borrar una entrada en uso responde 409 sin cascadas.

| # | Recurso | Rutas | Filtros | Orden | Pruebas |
|---|---|---|---|---|---|
| V1 | `countries` | `GET` lista y detalle (Pub); `POST`, `PATCH`, `DELETE` (Admin) | `q`, `code` | `name`, `code` | ok val authz state |
| V2 | `genres` | Igual | `q`, `slug` | `name` | ok val authz state |
| V3 | `platforms` | Igual | `q`, `slug`, `supports=catalog_identity|track|album` | `name` | ok val authz state |
| V4 | `organization-types` | Igual | `q`, `slug` | `name` | ok val authz state |
| V5 | `contribution-roles` | Igual; el atributo `scopes` (work/recording/release/membership) se gestiona como conjunto. Quitar un ámbito en uso responde 409 | `q`, `slug`, `category`, `scope` | `name`, `category` | ok val authz state |

## 4. Catálogo: identidades (módulo `catalog-identities`)

Solo lectura. Toda escritura pasa por el flujo editorial (sección 7).

| # | Método y ruta | Contenido | Pruebas |
|---|---|---|---|
| C1 | `GET /v1/identities` | Personas y organizaciones | ok val |
| C2 | `GET /v1/identities/{id}` | Datos comunes y subtipo (`person` u `organization`) | ok authz |
| C3 | `GET /v1/identities/{id}/memberships` | Membresías como organización o como miembro (`filter[side]=organization|member`) con roles | ok val |
| C4 | `GET /v1/identities/{id}/credits` | Créditos en obras, grabaciones y lanzamientos (`filter[scope]`, `filter[role]`) | ok val |
| C5 | `GET /v1/identities/{id}/organized-events` y `/organized-tours` | Eventos y tours donde figura como organizador | ok |
| C6 | `GET /v1/artists` | Perfiles artísticos | ok val |
| C7 | `GET /v1/artists/{id}` | Perfil y su identidad | ok authz |
| C8 | `GET /v1/artists/{id}/release-groups` | Discografía: lanzamientos con crédito de presentación, uno por lanzamiento aunque tenga varias ediciones (`filter[type]`) | ok val |
| C9 | `GET /v1/artists/{id}/tracks` | Pistas acreditadas (`filter[rank]`) | ok val |
| C10 | `GET /v1/artists/{id}/events` y `/tours` | Anunciado en eventos y tours | ok val |

| Recurso | Filtros | Orden | `include` |
|---|---|---|---|
| `identities` | `q` (nombre visible y alias), `type`, `hasArtistProfile`, `nationality`, `birthCountry`, `originCountry`, `organizationType` | `displayName` (defecto), `-createdAt` | `aliases`, `nationalities`, `birthCountry`, `originCountry`, `organizationTypes`, `platformLinks`, `platformLinks.platform`, `artist` |
| `artists` | `q`, `identityType`, `affiliatedWith` (organización), `affiliationStatus` | `displayName` (defecto), `-createdAt` | `identity`, `identity.aliases`, `affiliations`, `affiliations.organization` |
| `organization-memberships` (C3) | `side=organization|member` (sin él, ambos lados) | `joined` (defecto, fechas desconocidas al final), `-createdAt` | `organization`, `member`, `roles`, `roles.role` |
| `work-contributions`, `recording-contributions`, `release-contributions` (C4, documento heterogéneo) | `scope=work|recording|release`, `role` (slug) | `createdAt` (defecto), `-createdAt` | `work`, `recording`, `release`, `role` |

## 5. Catálogo: música (módulo `music`)

| # | Método y ruta | Contenido | Pruebas |
|---|---|---|---|
| M1 | `GET /v1/works` | Obras; `filter[slug]` resuelve una obra por slug | ok val |
| M2 | `GET /v1/works/{id}` | Obra | ok authz |
| M3 | `GET /v1/works/{id}/recordings` | Grabaciones que la interpretan, interpolan o samplean (`filter[relationType]`) | ok val |
| M4 | `GET /v1/recordings` | Grabaciones | ok val |
| M5 | `GET /v1/recordings/{id}` | Grabación | ok authz |
| M6 | `GET /v1/recordings/{id}/tracks` | Apariciones en ediciones | ok |
| M7 | `GET /v1/releases` | Ediciones | ok val |
| M8 | `GET /v1/releases/{id}` | Edición, con su disponibilidad derivada y su instante de salida | ok authz |
| M9 | `GET /v1/releases/{id}/tracks` | Lista de pistas por disco y número | ok |
| M10 | `GET /v1/tracks/{id}` | Pista | ok authz |
| M11 | `GET /v1/release-groups` | Lanzamientos | ok val |
| M12 | `GET /v1/release-groups/{id}` | Lanzamiento, con fecha, próxima salida y cuenta regresiva derivadas de sus ediciones | ok authz |
| M13 | `GET /v1/release-groups/{id}/releases` | Ediciones del lanzamiento | ok val |
| M14 | `GET /v1/release-groups/{id}/repackages` | Repackages que apuntan a este lanzamiento | ok |

| Recurso | Filtros | Orden | `include` |
|---|---|---|---|
| `works` | `q` (título), `slug`, `iswc`, `contributor` (identidad), `role` | `title` (defecto), `-createdAt` | `contributions`, `contributions.identity`, `contributions.role`, `recordingWorks`, `recordingWorks.recording` |
| `recordings` | `q`, `isrc`, `genre` (slug), `contributor`, `work`, `artist` (crédito de pista), `year`, `isExplicit` | `title` (defecto), `-recordingDate`, `-createdAt` | `contributions`, `contributions.identity`, `contributions.role`, `genres`, `recordingWorks`, `recordingWorks.work`, `tracks`, `tracks.release` |
| `release-groups` | `q`, `type`, `artist`, `upcoming`, `releasedFrom`, `releasedTo` (YYYY, YYYY-MM o YYYY-MM-DD, sobre la fecha derivada) | `-releaseDate` (defecto, nulos al final), `releaseDate` (útil con `upcoming`), `title`, `-createdAt` | `artistCredits`, `artistCredits.artist`, `releases`, `repackageOf` |
| `releases` | `q`, `releaseGroup`, `contributor`, `availability=upcoming|released|cancelled|unknown`, `releasedFrom`, `releasedTo` | `-releaseDate` (defecto, nulos al final), `title`, `-createdAt` | `releaseGroup`, `releaseGroup.artistCredits`, `tracks`, `tracks.recording`, `contributions`, `contributions.identity` |
| `tracks` | (solo anidado) | `discNumber,trackNumber` | `recording`, `artistCredits`, `artistCredits.artist`, `platformLinks`, `platformLinks.platform` |

## 6. Catálogo: eventos y tours (módulo `live-events`)

| # | Método y ruta | Contenido | Pruebas |
|---|---|---|---|
| L1 | `GET /v1/events` | Conciertos | ok val |
| L2 | `GET /v1/events/{id}` | Concierto | ok authz |
| L3 | `GET /v1/tours` | Tours | ok val |
| L4 | `GET /v1/tours/{id}` | Tour; países y fechas derivados de sus eventos publicados | ok authz |
| L5 | `GET /v1/tours/{id}/events` | Eventos del tour | ok val |

| Recurso | Filtros | Orden | `include` |
|---|---|---|---|
| `events` | `q` (título, recinto, ciudad), `status`, `country` (código), `city`, `artist`, `organizer`, `tour`, `dateFrom`, `dateTo` | `startDate` (defecto, nulos al final), `-startDate`, `-createdAt` | `tour`, `artists`, `artists.artist`, `organizers`, `organizers.identity`, `links`, `country` |
| `tours` | `q`, `status`, `artist`, `organizer`, `country` (derivado de sus eventos) | `-startDate` (defecto), `title` | `artists`, `artists.artist`, `organizers`, `organizers.identity`, `links`, `links.country`, `events` |

## 7. Contribuciones editoriales (módulo `editorial`)

Los borradores son visibles solo para su autor, también frente al personal: cualquier otro recibe 404.

### Registro de operaciones y raíces

| # | Método y ruta | Caso de uso | Acceso | Notas | Pruebas |
|---|---|---|---|---|---|
| E1 | `GET /v1/editorial-operations` | Registro de selectores permitidos | Pub | Por tipo de raíz: operaciones, `target_path`, forma de `target_key` y JSON Schema del payload por `payload_schema_version`, con `status` `current` (la más alta del selector) u `obsolete`. Las versiones obsoletas se siguen listando para leer el historial; no se aceptan en microcambios nuevos | ok |
| E2 | `POST /v1/editorial-entities` | Reservar una raíz para un alta | Ver | `{entityType}`; queda `reserved`, versión 0 | ok val authz |
| E3 | `GET /v1/editorial-entities/{id}` | Estado editorial de una raíz | Pub; reserva solo su creador | tipo, estado, versión, fechas | ok authz |
| E4 | `GET /v1/editorial-entities/{id}/proposals` | Historial público de envíos | Pub | Proyección pública. Sirve también el historial de una raíz reservada en cuanto tiene un envío; una reserva sin envíos solo existe para su creador **[P9]** | ok authz spec |
| E5 | `GET /v1/editorial-entities/{id}/revisions` | Revisiones aplicadas | Staff; autor solo las suyas **[P6]** | before/after, versión, fecha | ok authz |

### Propuestas y borradores

| # | Método y ruta | Caso de uso | Acceso | Notas | Pruebas |
|---|---|---|---|---|---|
| E6 | `POST /v1/proposals` | Crear borrador | Ver | `{description, previousProposal?}` | ok val authz |
| E7 | `GET /v1/me/proposals` | Mis propuestas, incluidos borradores | Ver | Con estados de microcambio; en borradores marca los microcambios en una versión del payload obsoleta | ok authz |
| E8 | `GET /v1/proposals/{id}` | Ver propuesta | Pub (proyección); autor y personal con estados; borrador solo autor | Como E7, el autor ve marcados los microcambios obsoletos de su borrador | ok authz spec |
| E9 | `PATCH /v1/proposals/{id}` | Editar borrador | Own | Solo `draft`; enviado responde 409 | ok val authz state |
| E10 | `DELETE /v1/proposals/{id}` | Descartar borrador | Own | Solo `draft`; no es una decisión de moderación | ok authz state |
| E11 | `POST /v1/proposals/{id}/changes` | Añadir microcambio | Own | operación, raíz, selector, payload, grupo atómico, posición; valida contra E1. Sin `payloadSchemaVersion` guarda la vigente; una anterior responde 422 `obsolete_payload_schema_version` | ok val authz state |
| E12 | `PATCH`/`DELETE /v1/proposals/{id}/changes/{changeId}` | Editar o quitar microcambio del borrador | Own | Editar con una versión anterior responde 422 `obsolete_payload_schema_version`; un microcambio obsoleto se quita o se rehace en la vigente | ok val authz state |
| E13 | `GET /v1/proposals/{id}/changes` | Listar microcambios | Como E8 | | ok authz |
| E14 | `POST`/`DELETE /v1/proposal-changes/{id}/relationships/dependencies` | Declarar dependencias | Own | Rechaza ciclos, también al colapsar grupos atómicos | ok val state spec |
| E15 | `POST /v1/proposals/{id}/sources`, `PATCH`/`DELETE …/sources/{sourceId}` | Fuentes generales | Own | URL HTTP(S), cita o ambas | ok val state |
| E16 | `POST`/`DELETE /v1/proposal-changes/{id}/relationships/sources` | Vincular fuentes a un microcambio | Own | Fuente de otra propuesta responde 422 | ok val spec |
| E17 | `POST /v1/proposals/{id}/submission` | Enviar | Own | Exige descripción, un microcambio, una fuente, tipos y dependencias válidos; congela el contenido. Un microcambio en una versión obsoleta responde 422 `obsolete_payload_schema_version` con `meta.changeId` | ok val state conc tx spec |
| E18 | `POST /v1/proposals/{id}/publication` | Publicación directa del personal | Staff, autor del borrador | Envía y aplica en una transacción; retirar una ficha publicada exige Admin | ok authz tx spec |
| E22 | `POST /v1/images` | Subir una imagen de catálogo | Ver | `multipart/form-data`, campo `file`; devuelve `image-uploads` con la URL para el borrador y el ancho y alto de la imagen guardada, ya aplicada su orientación EXIF (ADR 0005). JPEG, PNG o WebP por contenido, 3 MB (413) y 4000 px por lado (422). Cupo de 4 cada 15 días para `user`, sin cupo para el personal: 429 `upload_quota_exceeded` con `meta.availableAt`. Un rechazo no consume cupo | ok val authz rate |

### Moderación y decisiones

| # | Método y ruta | Caso de uso | Acceso | Notas | Pruebas |
|---|---|---|---|---|---|
| E19 | `GET /v1/moderation/changes` | Cola de moderación | Staff | | ok authz val |
| E20 | `POST /v1/proposal-changes/{id}/decisions` | Decidir un microcambio | Staff; el autor solo `withdraw_change` | `{action, reason?, confirmedVersion?}`. Acciones manuales: `apply`, `apply_rebased`, `reject`, `withdraw_change` **[P7]**. Si pertenece a un grupo atómico, la decisión se aplica al grupo y devuelve todas sus decisiones. Sobre un microcambio en una versión del payload obsoleta, cualquier acción registra `mark_obsolete` y bloquea su grupo y sus dependientes; responde 409 `obsolete_payload_schema_version` | ok val authz state conc tx spec |
| E21 | `GET /v1/proposal-changes/{id}/decisions` | Historial de decisiones | Autor y personal | Incluye decisiones automáticas | ok authz |

E19: `filter[status]=pending|conflicted` (defecto ambos), `filter[entityType]`, `filter[operation]`, `filter[author]`, `filter[entity]`; orden `createdAt` (defecto, más antiguo primero), `-createdAt`; `include=proposal,proposal.sources,entity` **[P10]**.

E7/E8 y listados de propuestas: `filter[status]`, `filter[entity]`, `filter[entityType]`; orden `-submittedAt`, `-updatedAt` (borradores).

**E-proyección (pública).** Autor, fechas, descripción, operaciones, valores propuestos y fuentes, rotulados como información propuesta. Excluye estado y fecha de resolución de cada microcambio, decisiones, motivos, resultado global derivado y datos de revisión que revelen el resultado individual. El estado `open/closed` de la propuesta y su `closedAt` son públicos **[P8]**. Se construye en el servidor, no ocultando columnas en el cliente.

## 8. Búsqueda (módulo `discovery`)

| # | Método y ruta | Contenido | Pruebas |
|---|---|---|---|
| S1 | `GET /v1/search` | `filter[q]` obligatorio, `filter[type]=identities,artists,works,recordings,release-groups,events,tours`; sin `filter[type]` se buscan todos salvo `artists`, porque un perfil artístico forma parte de la ficha de su identidad y aparecería dos veces; devuelve lanzamientos, no ediciones, para que un álbum aparezca una sola vez. Documento heterogéneo ordenado por relevancia (`pg_trgm` y `unaccent` sobre nombres, alias y títulos); sin transliteración automática. Excluye reservas y fichas retiradas | ok val |

`discovery` solo lee, a través de los servicios públicos de lectura de cada módulo, para no acoplarse a sus tablas.

## 9. Operación

| # | Ruta o comando | Uso | Pruebas |
|---|---|---|---|
| O1 | `GET /health` | Healthcheck de Railway con `@nestjs/terminus` (base de datos) | ok |
| O2 | `GET /docs`, `GET /docs-json` | Swagger UI y OpenAPI; activos en desarrollo, desactivados en producción salvo variable de entorno y autenticación básica | ok |
| O3 | `pnpm admin:bootstrap -- --username <u> --reason <texto>` | Promoción inicial por consola | ok state conc spec |
| O4 | `pnpm db:seed` | Seed K-pop mediante el flujo editorial; solo desarrollo | ok |
| O5 | `pnpm db:reset` | Vacía todos los registros, conserva tablas; solo desarrollo | ok |
| O6 | `pnpm migration:run`, `migration:revert`, `migration:generate` | Migraciones TypeORM | ok |
| O7 | `pnpm payload-schemas:export` | Añade a `payload-schemas.json` las versiones del payload recién publicadas; falla sin escribir si una ya publicada cambió o desapareció ([ADR 0006](../adr/0006-payload-schema-versions.md)). Una prueba compara el archivo con el registro | ok |

## Fuera del MVP

OAuth (`user_identities`), likes (`recording_likes`), `play_count`, lectura desde las microaplicaciones (CORS), suspensiones con caducidad, colas persistentes de correo y retención antiabuso.

## Decisiones de esta matriz

Aprobadas el 2026-10-17.

| # | Decisión | Motivo |
|---|---|---|
| P1 | Las cuentas se identifican en la API por `users.uuid`; el username se resuelve con `filter[username]` | El username cambia y se reutiliza; los enlaces de autor deben ser estables |
| P2 | Pistas, créditos, alias, enlaces y demás filas dependientes usan su PK entera como `id` | No tienen `public_id`; JSON:API necesita un `id` para `include` y `target_key` las identifica por PK |
| P3 | Una ficha retirada responde 200 con el aviso, no 410 | La especificación exige mostrar el aviso y resolver enlaces hacia él |
| P4 | Una cuenta sin verificar puede pedir cambio de correo | Permite corregir un correo mal escrito, parte de "gestionar ese acceso" |
| P5 | Los administradores ven el correo de las cuentas en U1/U2 | Necesario para soporte y bajas solicitadas fuera de la API; nadie más lo ve |
| P6 | Las revisiones aplicadas solo las ven el personal y, para sus propios microcambios, el autor | La §5 de la especificación excluye del historial público los datos de revisión que revelan el resultado individual; una revisión vinculada a su microcambio lo revela directamente |
| P7 | `mark_conflict`, `mark_satisfied`, `block_dependency` y `mark_obsolete` solo los registra el sistema | La especificación los define como automáticos; el personal resuelve con `apply_rebased`, `reject` o `withdraw_change` |
| P8 | La proyección pública muestra el estado `open/closed` de la propuesta y `closedAt` | Indican si la revisión terminó, no su resultado: el resultado global derivado (total o parcial) y el estado de cada microcambio siguen ocultos. A19 ya filtra públicamente por ese estado |
| P9 | E4 sirve el historial de una raíz reservada que ya tiene un envío, aunque E3 siga respondiendo 404 a esa reserva | El envío ya es público en E8 con el UUID de la raíz, y el historial debe verse antes de la publicación; el estado editorial de la reserva sigue siendo privado |
| P10 | En la cola E19, `include=entity` muestra al personal el estado editorial de la raíz, también de una reserva cuya alta revisa | El personal necesita tipo, estado y versión para decidir un alta; fuera de la cola la reserva sigue siendo privada para su creador (E3) |
| P11 | Los listados de fichas (C1, C6, M1…) omiten las fichas retiradas | Filtrar por `q` u ordenar por nombre operaría sobre el contenido retirado y lo revelaría; el aviso sigue accesible por id y desde las relaciones |
| P12 | Cada campo de orden listado admite ambas direcciones | Todos los listados ya lo hacen con el mismo analizador de consultas; la dirección escrita en la matriz es la de uso habitual, no una restricción |
| P13 | Un filtro con un código o slug de vocabulario desconocido devuelve una lista vacía | Es la respuesta correcta a "identidades de un país sin identidades"; validar contra el vocabulario no protege de nada y añade una consulta |

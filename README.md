# Paltono backend

API JSON:API de Paltono: NestJS 11, Node 24 LTS, pnpm y PostgreSQL con TypeORM. Las decisiones están en [`docs/adr`](docs/adr) y las rutas en la [matriz de endpoints](docs/api/endpoint-matrix.md).

## Puesta en marcha

1. Node 24 y pnpm 10; PostgreSQL local (no hace falta Docker).
2. `pnpm install`
3. Copiar `.env.example` a `.env` y ajustar `DATABASE_URL` y `DATABASE_URL_TEST`. Crear la base de desarrollo; la de pruebas se crea sola en el mismo servidor si no existe, y su nombre debe terminar en `_test` y ser distinto del de desarrollo. En un worktree de git enlazado, las pruebas insertan el nombre del worktree antes de `_test` (`paltono_test` pasa a `paltono_<worktree>_test`), así que cada checkout usa su propia base sin editar el `.env`; el checkout principal usa `DATABASE_URL_TEST` tal cual.
4. `pnpm migration:run` y `pnpm start:dev`.

## Comandos

| Comando | Uso |
|---|---|
| `pnpm start:dev` | API en modo observación |
| `pnpm build` / `pnpm start` | Compila a `dist/` y la ejecuta |
| `pnpm typecheck` | Comprobación de tipos |
| `pnpm test` | Pruebas HTTP y de consola con Jest y Supertest contra la base de pruebas (`DATABASE_URL_TEST`, con el sufijo del worktree en un worktree enlazado), que se crea si falta y se recrea con las migraciones antes de cada ejecución |
| `pnpm migration:run` / `migration:revert` | Aplica o revierte migraciones sobre `DATABASE_URL` |
| `pnpm migration:generate src/database/migrations/<Nombre>` | Genera una migración a partir de las entidades |
| `pnpm db:reset` | Vacía todos los registros conservando las tablas; solo con `NODE_ENV=development` |
| `pnpm db:seed` | Puebla una base vacía (tras `db:reset`) con cuentas de prueba de cada rol y estado y el catálogo K-pop (identidades, obras, grabaciones, lanzamientos con sus ediciones, tours y conciertos), creado mediante propuestas con fuentes reales que revisa o publica `seed_moderadora`, más propuestas en todos los estados de microcambio y una ficha retirada; solo con `NODE_ENV=development`. Todas las cuentas del seed usan la contraseña `paltono-seed-2026` |
| `pnpm admin:bootstrap -- --username <u> --reason <texto>` | Promueve a administrador la primera cuenta activa y verificada mientras no exista ninguno (ADR 0003); queda auditado sin administrador actuante |
| `pnpm openapi:export [ruta]` | Escribe en `openapi.json` (o en la ruta dada) el documento OpenAPI que sirve `/docs-json`, sin levantar el servidor ni conectar a la base |
| `pnpm db:test:prepare` | Crea si falta y recrea la base de pruebas (la misma que usa `pnpm test`); rechaza cualquier base que no termine en `_test` o que coincida con `DATABASE_URL` |

## Endpoints de operación

- `GET /health`: JSON simple con la comprobación de la base de datos, para Railway.
- `GET /docs` y `GET /docs-json`: Swagger UI y OpenAPI. Activos en desarrollo; en producción solo con `SWAGGER_ENABLED=true`, `SWAGGER_USER` y `SWAGGER_PASSWORD` (autenticación básica).
- `openapi.json`: el mismo documento OpenAPI, versionado como contrato para las aplicaciones. Tras cambiar un controlador o un DTO, regenéralo con `pnpm openapi:export` y haz commit; `pnpm test` falla mientras no coincida con la API.

## Infraestructura JSON:API

`src/common/json-api` contiene lo común a todos los recursos bajo `/v1`:

- Exigencia del media type `application/vnd.api+json` (415/406) y documentos de error JSON:API.
- `defineResource` describe cómo un modelo se convierte en recurso; `collectionQuery` y `resourceQuery` declaran el orden, filtros e `include` permitidos (hasta dos niveles) de cada endpoint; `@JsonApiQuery(spec)` valida la consulta y responde 400 ante cualquier parámetro no permitido.
- `collectionDocument` y `resourceDocument` construyen los documentos con `included`, `fields[tipo]`, enlaces de paginación y `meta.total`. La página es de 20 por defecto y 100 como máximo; el orden siempre termina en el `id`.
- `swagger.ts` documenta los documentos genéricos con `@ApiExtraModels` y `getSchemaPath`.

## Cuentas y autenticación

`src/accounts` implementa el registro, la verificación de correo, el login con username o correo, `GET /v1/me`, el logout, la renovación y gestión de sesiones y la recuperación y el cambio de contraseña (ADR 0002):

- El token de acceso es un JWT HS256 de 15 minutos firmado con `ACCESS_TOKEN_SECRET`, enviado en `Authorization: Bearer`. Cada petición relee la sesión y la cuenta: una sesión revocada o una cuenta suspendida deja de autorizar aunque el token no haya caducado.
- `@Authenticated()` protege un endpoint para cualquier cuenta que pueda iniciar sesión, verificada o no; `@Authenticated('verified')` exige el correo verificado, como contribuir.
- Las caducidades se configuran con `ACCESS_TOKEN_TTL_SECONDS` (15 minutos por defecto), `SESSION_TTL_DAYS` (30), `EMAIL_VERIFICATION_TTL_HOURS` (24) y `PASSWORD_RESET_TTL_MINUTES` (30).
- El token de renovación viaja en la cookie `paltono_refresh_token` (web) o en `meta.refreshToken` (móvil). `POST /v1/session-refreshes` lo sustituye con una actualización condicionada al token presentado: un token ya sustituido no vuelve a servir y, de dos renovaciones simultáneas, solo una prospera. La renovación nunca extiende el límite absoluto de la sesión.
- Recuperar o cambiar la contraseña revoca todas las sesiones de la cuenta; recuperarla además marca el correo como verificado.
- Los correos salen por el puerto `Mailer` después del commit; un fallo de envío no deshace la operación. Con `RESEND_API_KEY` se envían por Resend; sin ella, fuera de producción, se escriben en el log. Los enlaces apuntan siempre a la aplicación principal, `MAIN_APP_URL` (`http://localhost:5173` por defecto fuera de producción); el cliente no elige adónde.
- CORS solo admite el origen de `MAIN_APP_URL`, con credenciales para la cookie de renovación; cualquier otro origen no recibe `Access-Control-Allow-Origin` y su navegador bloquea la respuesta.
- Login, registro, reenvío de la verificación y solicitud de recuperación de contraseña admiten `AUTH_RATE_LIMIT` peticiones por minuto y dirección (10 por defecto); responden 429 por encima.

En producción son obligatorias `ACCESS_TOKEN_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `MAIN_APP_URL`, `IMAGE_PUBLIC_BASE_URL` y la configuración de R2 (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`).

En las pruebas, `createTestApp` sustituye el `Mailer` por un doble que captura los correos (`app.mailer`) y `app.reset()` vacía la base antes de cada prueba.

El reloj (`Clock`) es una dependencia inyectable: el código usa `clock.now()` y las pruebas lo sustituyen por un reloj controlado.

## Subidas de imagen

`src/images` es dueño de las subidas de imagen (ADR 0005):

- `POST /v1/images` recibe `multipart/form-data` con la imagen en el campo `file` y devuelve una subida `catalog` con su URL. Las rutas que reciben un archivo se listan en `MULTIPART_PATHS` (`src/common/json-api/media-type.ts`); `@ReceivesImage()` y `@UploadedImage()` leen el archivo en memoria.
- `ImageUploadsService.upload(cuenta, propósito, bytes)` valida, procesa con `sharp`, comprueba el cupo de subidas, guarda el archivo y lo registra en `image_uploads`. Un rechazo no guarda ni registra nada.
- El almacenamiento es el puerto `ImageStorage` (guardar bytes por clave, borrar por clave), y la URL de cada imagen es `IMAGE_PUBLIC_BASE_URL` más su clave. En development y en pruebas es una carpeta local (`IMAGE_STORAGE_DIRECTORY`, por defecto `storage/images`, fuera de git) que el backend sirve en `/images`. En producción es un bucket de Cloudflare R2 (`R2ImageStorage`, sobre el cliente S3) configurado con `R2_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `R2_BUCKET`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`, y servido públicamente en `img.paltono.com`; el arranque falla si falta alguna. El adaptador de R2 no tiene test automático: se verifica a mano contra el bucket real.
- La regla de URLs de imagen vive en `CatalogImageUrls` (`src/images/catalog-image-urls.ts`): un campo de imagen del catálogo es null o una URL bajo `IMAGE_PUBLIC_BASE_URL` registrada como subida `catalog`. Una operación del registro editorial declara sus campos de imagen con `imageUrls(value)` (usando `imageUrlAt` y el esquema `CATALOG_IMAGE_URL`), y la regla se comprueba al escribir el microcambio y al enviarlo, nunca al aplicarlo.
- En las pruebas, `createTestApp` usa una carpeta temporal y la base `http://localhost/images/`; `test/support/images.ts` genera las imágenes y lee las servidas.

## Roles y vocabularios

- `@Authenticated('admin')` exige una cuenta verificada con rol administrador; moderadores y usuarios reciben 403.
- `POST /v1/admin/users/{id}/role-changes` cambia el rol con un motivo obligatorio y `GET` del mismo recurso devuelve la auditoría (`user_role_changes`). El cambio relee el rol bajo bloqueo y no deja degradar al último administrador activo y verificado. Todo camino que pueda retirar o añadir un administrador operativo, también la consola, toma antes `lockAdministration` (`src/accounts/role-changes.ts`), un bloqueo consultivo de transacción que los serializa.
- `src/vocabularies` sirve `countries`, `genres`, `platforms`, `organization-types` y `contribution-roles` en `/v1/{tipo}`: lectura pública con los filtros y el orden de la matriz, escritura solo de administradores. Cada vocabulario declara su tabla, su recurso, sus filtros y sus documentos; `VocabularyStore` y `vocabularyController` hacen el resto. Las FKs hacia los vocabularios restringen el borrado, así que borrar una entrada en uso o quitar un ámbito en uso de un rol musical responde 409 sin cascadas.

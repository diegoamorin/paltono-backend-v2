# Paltono backend

API JSON:API de Paltono: NestJS 11, Node 24 LTS, pnpm y PostgreSQL con TypeORM. Las decisiones están en [`docs/adr`](docs/adr) y las rutas en la [matriz de endpoints](docs/api/endpoint-matrix.md).

## Puesta en marcha

1. Node 24 y pnpm 10; PostgreSQL local (no hace falta Docker).
2. `pnpm install`
3. Copiar `.env.example` a `.env` y ajustar `DATABASE_URL` y `DATABASE_URL_TEST`. Crear ambas bases; la de pruebas debe terminar en `_test` y ser distinta de la de desarrollo.
4. `pnpm migration:run` y `pnpm start:dev`.

## Comandos

| Comando | Uso |
|---|---|
| `pnpm start:dev` | API en modo observación |
| `pnpm build` / `pnpm start` | Compila a `dist/` y la ejecuta |
| `pnpm typecheck` | Comprobación de tipos |
| `pnpm test` | Pruebas HTTP y de consola con Jest y Supertest contra `DATABASE_URL_TEST`, que se recrea con las migraciones antes de cada ejecución |
| `pnpm migration:run` / `migration:revert` | Aplica o revierte migraciones sobre `DATABASE_URL` |
| `pnpm migration:generate src/database/migrations/<Nombre>` | Genera una migración a partir de las entidades |
| `pnpm db:reset` | Vacía todos los registros conservando las tablas; solo con `NODE_ENV=development` |
| `pnpm db:test:prepare` | Recrea la base de pruebas; rechaza cualquier base que no termine en `_test` o que coincida con `DATABASE_URL` |

## Endpoints de operación

- `GET /health`: JSON simple con la comprobación de la base de datos, para Railway.
- `GET /docs` y `GET /docs-json`: Swagger UI y OpenAPI. Activos en desarrollo; en producción solo con `SWAGGER_ENABLED=true`, `SWAGGER_USER` y `SWAGGER_PASSWORD` (autenticación básica).

## Infraestructura JSON:API

`src/common/json-api` contiene lo común a todos los recursos bajo `/v1`:

- Exigencia del media type `application/vnd.api+json` (415/406) y documentos de error JSON:API.
- `defineResource` describe cómo un modelo se convierte en recurso; `collectionQuery` y `resourceQuery` declaran el orden, filtros e `include` permitidos (hasta dos niveles) de cada endpoint; `@JsonApiQuery(spec)` valida la consulta y responde 400 ante cualquier parámetro no permitido.
- `collectionDocument` y `resourceDocument` construyen los documentos con `included`, `fields[tipo]`, enlaces de paginación y `meta.total`. La página es de 20 por defecto y 100 como máximo; el orden siempre termina en el `id`.
- `swagger.ts` documenta los documentos genéricos con `@ApiExtraModels` y `getSchemaPath`.

El reloj (`Clock`) es una dependencia inyectable: el código usa `clock.now()` y las pruebas lo sustituyen por un reloj controlado.

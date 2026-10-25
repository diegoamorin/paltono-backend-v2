# Países: lista ISO 3166-1 completa más Kosovo, en inglés y cargada a mano

Un catálogo musical ubica a sus artistas por identidad cultural, y su público espera ver a un artista puertorriqueño como de Puerto Rico y no de Estados Unidos. Por eso los países del catálogo son todos los códigos de ISO 3166-1 alfa-2, territorios incluidos (PR, HK, MO, EH, también los deshabitados como AQ), más Kosovo con el código provisional `XK`, el mismo criterio de "país o región" que siguen las plataformas de streaming. Las entidades sin código, como Chipre del Norte o Somalilandia, no entran.

Cada país se guarda con el nombre corto común en inglés ("South Korea", "Taiwan", "Palestine"), no con el nombre literal de ISO ("Korea, Republic of", "Taiwan, Province of China"). Toda la API va en inglés: el front traduce por código con `Intl.DisplayNames`, que también conoce `XK`, y busca sobre la lista traducida en el cliente en lugar de usar el filtro `q`.

La lista se carga con `pnpm countries:load`, un comando manual permitido en cualquier entorno, como `admin:bootstrap`. Solo inserta los códigos que faltan: no modifica ni borra filas existentes, así que se puede repetir sin riesgo. Al terminar informa de lo insertado y lo saltado, y avisa sin abortar cuando un país existente tiene el mismo nombre que uno de la lista pero otro código. `db:seed` lo ejecuta por dentro.

## Considered Options

- **Solo Estados soberanos (ONU más observadores y Taiwán)**: descartado, porque registraría a Puerto Rico como Estados Unidos y a Hong Kong como China, en contra de la identidad cultural que el catálogo quiere reflejar.
- **Una migración de datos**: descartado, porque `db:reset` vacía las tablas y conserva el historial de migraciones, así que los países no volverían a cargarse, y porque una migración corre sola con el deploy en vez de cuando se decide.
- **Cargar solo si la tabla está vacía**: descartado, porque unos pocos países creados a mano impedirían cargar el resto. Saltar código por código cubre ese caso.

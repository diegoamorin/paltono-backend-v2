# Modelo del catálogo musical

Especificación de las tablas musicales de `ERDiagram.mdj`. Recoge reglas ya documentadas en el ER, incluidas las aprobadas el 12 y el 13 de octubre de 2026, y las decisiones sobre lanzamientos y ediciones del 17 de octubre de 2026. El flujo de cambios y la propiedad editorial se rigen por [Contribuciones editoriales](editorial-contributions.md); los términos, por el [glosario](../GLOSSARY.md).

## 1. Niveles del catálogo

| Nivel | Tabla | Qué representa | Raíz editorial |
|---|---|---|---|
| Obra | `works` | Música y/o letra abstracta, independiente de sus grabaciones | Sí |
| Grabación | `recordings` | Un audio concreto de una o varias obras | Sí |
| Lanzamiento | `release_groups` | Álbum, EP, single o recopilatorio tal como se anunció | Sí |
| Edición | `releases` | Publicación digital concreta de un lanzamiento | Sí |
| Pista | `tracks` | Posición de una grabación dentro de una edición | No; la posee su edición |

Una grabación puede aparecer en varias ediciones y posiciones. Una obra puede tener varias grabaciones, incluidas versiones cover. No se crean obras, grabaciones ni lanzamientos automáticamente por coincidencia de título.

## 2. Obras y grabaciones

- `works.id` (BIGINT) es el identificador público de la obra; `works.slug` es único, se genera desde el título, se conserva aunque el título cambie y resuelve colisiones con un sufijo (`butter-2`). Los títulos no son únicos. El ISWC es opcional y no acredita derechos.
- `recording_works` vincula grabaciones y obras con `relation_type`: `performance` interpreta la obra, `interpolation` incorpora material recreado y `sample` incorpora material grabado. `position` ordena las obras de un medley. No identifica la grabación de origen de un sample.
- `recordings.is_explicit` marca el contenido explícito de cada grabación. Una versión limpia es otra grabación.
- Las fechas de grabación son parciales y jerárquicas: el mes exige año y el día exige mes; lo desconocido es NULL y nunca se inventa precisión.

## 3. Lanzamientos y ediciones

### Lanzamiento

Un lanzamiento posee su título, su tipo (`album | ep | single | compilation`), una descripción opcional, `repackage_of_id` y los créditos de presentación de sus artistas (`release_artist_credits`), que valen para todas sus ediciones.

- **Tipo.** Es una decisión editorial con fuente sobre cómo lo anunció su artista o agencia; nunca se calcula por número de pistas ni duración. Un single sigue siendo single aunque una edición añada remixes o un instrumental. Las ediciones no tienen tipo propio.
- **Alta mínima.** Basta un título no vacío y un tipo válido; puede publicarse sin ediciones para registrar un anuncio.
- **Repackage.** Un repackage es un lanzamiento propio. `repackage_of_id` apunta al lanzamiento original, que debe estar publicado y ser distinto del propio; se admiten cadenas, no ciclos. Si el original se retira después, el vínculo se conserva y muestra su aviso de retirada.
- **Fecha y estado.** La fecha del lanzamiento y su condición de próximo se derivan de sus ediciones no canceladas; no se almacenan.

### Edición

Hay una edición distinta cuando:

1. cambia el tracklist: se añaden, quitan o reordenan pistas, como en un deluxe;
2. cambia el audio de alguna pista aunque el título sea igual: explícita frente a limpia, sped up, slowed + reverb, remasterizada o instrumental; cada pista apunta a su propia grabación;
3. una edición regional tiene contenido distinto.

No son ediciones distintas en el MVP los formatos físicos ni las variantes de empaque (photobook, versiones A/B/C, vinilo frente a CD). Si en el futuro se cataloga lo físico, se añaden ediciones sin cambiar el modelo.

Reglas de la edición:

- Pertenece exactamente a un lanzamiento (`release_group_id` obligatorio). Moverla a otro lanzamiento es un cambio de campo de la edición; no hay fusión automática de lanzamientos.
- `title` es opcional: NULL muestra el título del lanzamiento sin copiarlo. `edition_name` distingue ediciones ("Deluxe", "Sped Up", "Clean", "Japan Edition"); `UNIQUE NULLS NOT DISTINCT (release_group_id, edition_name)` permite como mucho una edición sin nombre, la estándar, por lanzamiento.
- Alta mínima: solo su lanzamiento. Título, portada, fecha y pistas pueden ser desconocidos o estar vacíos; no se usan portadas de relleno ni pistas inventadas.
- Fecha parcial (año, mes, día) con la misma jerarquía que el resto del catálogo. `release_time` y `timezone` (zona IANA) son opcionales, van juntos y solo con fecha completa; la zona nunca se deduce del país. Juntos definen el instante de salida que usa la cuenta regresiva.
- `is_cancelled` marca una edición cancelada. Un retraso se registra cambiando fecha y hora; las revisiones conservan los valores anteriores.
- El contenido explícito de una edición se deriva de las grabaciones de sus pistas; no se almacena.

Disponibilidad derivada de una edición:

| Estado | Condición |
|---|---|
| Cancelada | `is_cancelled = true` |
| Próxima | No cancelada y el instante o la fecha conocida aún no ha llegado |
| Publicada | No cancelada y el instante o la fecha conocida ya pasó |
| Desconocida | No cancelada y sin fecha |

Un lanzamiento muestra la cuenta regresiva de su primera edición próxima que tenga instante completo. Con fecha parcial ("noviembre de 2026") se muestra la fecha sin cuenta regresiva.

### Pista

`UNIQUE (release_id, disc_number, track_number)`, con disco y número mayores que cero. `tracks.title` es opcional y conserva el título literal de esa edición; NULL muestra el título vigente de la grabación sin copiarlo.

## 4. Créditos

| Tabla | Ámbito | Qué acredita | Propietario editorial |
|---|---|---|---|
| `work_contributions` | `work` | Autoría y aportes a la obra: composición, letra, adaptación, traducción, arreglo de obra | Obra |
| `recording_contributions` | `recording` | Interpretación, producción, arreglo de grabación, grabación y mezcla | Grabación |
| `release_contributions` | `release` | Créditos de una edición: masterización, restauración o producción global documentada | Edición |
| `release_artist_credits` | Presentación | Artistas con que se presenta el lanzamiento, en orden | Lanzamiento |
| `track_artist_credits` | Presentación | Artistas de una pista: `main`, `featured` o `remixer` | Edición de la pista |

- Los créditos de presentación referencian `artists` y no atribuyen autoría, interpretación ni producción. `credited_as` conserva el nombre literal de la fuente; NULL muestra el nombre visible de la identidad.
- Los créditos de participación referencian `catalog_identities` y un rol de `contribution_roles` válido para su ámbito mediante una FK compuesta con `contribution_role_scopes`. Una persona u organización puede recibir créditos sin perfil artístico.
- `position` es un orden editorial, no importancia ni porcentaje. `details` describe instrumentos o funciones adicionales; `source_text`/`source_url` conservan la referencia del crédito.

## 5. Géneros y enlaces

- `recording_genres` asigna géneros a grabaciones, con como mucho un género primario por grabación.
- `track_platform_links` enlaza pistas con plataformas que admitan pistas; `catalog_identity_platform_links` hace lo mismo con identidades. `play_count` queda fuera del MVP.

## 6. Fuera del MVP

Ediciones físicas y variantes de empaque, sellos y números de catálogo, duración, títulos en varios idiomas e idioma de los alias, grabación de origen de los samples y likes.

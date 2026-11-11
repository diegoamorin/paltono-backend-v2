# El lanzamiento se llama release y la edición, edition

Paltono llama **release** al lanzamiento (el álbum, EP, single o recopilatorio tal como lo anunció su artista o agencia) y **edition** a cada publicación digital concreta de ese lanzamiento (la estándar, Deluxe, Clean, Sped Up…). Así se llaman las tablas (`releases`, `editions`, `edition_contributions`), sus columnas (`editions.release_id`, `tracks.edition_id`) y el tipo `release_type`.

El esquema lo leen fans, quien construye el frontend y la IA que responde preguntas sobre el catálogo, y casi nadie de ellos conoce los nombres de MusicBrainz. Para un fan, un *release* es el álbum que salió; "¿cuántos álbumes sacó BTS?" debe contar filas de `releases` y dar el número correcto sin saber nada más. Si `releases` guardara ediciones, ese conteo saldría inflado sin ningún error visible. El nombre obvio tiene que ser el correcto.

Las columnas de fecha de salida de la edición se llaman `release_*` (`release_year`, `release_month`, `release_day`, `release_time`) porque ahí *release* significa la fecha en que la edición sale, como en *release date*, no su lanzamiento.

## Equivalencias

| Paltono | MusicBrainz | DDEX |
|---|---|---|
| Lanzamiento (`releases`) | Release group | Sin equivalente directo |
| Edición (`editions`) | Release | Release (el producto, con su UPC) |

Quien importe o compare datos de MusicBrainz o DDEX traduce en ese borde, no en el esquema.

## Considered Options

- **Los nombres de MusicBrainz** (`release_groups` y `releases`): descartado, porque obligan a advertir en todas partes que *release* no es el álbum, y quien no lo sepa cuenta ediciones creyendo contar álbumes.
- **Los nombres de DDEX**: descartado, porque DDEX no tiene un nivel para el lanzamiento anunciado; solo describe productos.
- **`albums` para el lanzamiento**: descartado, porque álbum es solo uno de sus tipos, junto a EP, single y recopilatorio.

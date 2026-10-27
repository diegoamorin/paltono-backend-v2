# Imágenes subidas a R2 a través del backend

Las imágenes del catálogo (imagen de perfil, foto de cuerpo completo, portada de edición, imagen de concierto y de tour) y el avatar de la cuenta se guardan como URLs, pero solo se aceptan URLs de imágenes subidas a Paltono: deben empezar por la base pública configurada (`img.paltono.com` en producción) y estar registradas como subidas. Se rechaza cualquier URL externa, para que Paltono controle qué se muestra y ningún servidor ajeno vea a quien visita una ficha.

Cada archivo pasa por el backend antes de llegar a Cloudflare R2: el backend comprueba el tipo por su contenido (JPEG, PNG o WebP), el peso (3 MB) y las dimensiones (4000 px por lado), elimina los metadatos EXIF respetando la orientación y recomprime sin pérdida visible conservando el formato. Una subida directa del navegador a R2 con URL firmada impediría limpiar y validar el archivo.

Cada subida se registra con su cuenta y las dimensiones de la imagen guardada, para contar el cupo de subidas en Postgres (sobrevive a reinicios), saber quién subió cada imagen y encontrar más adelante las que ninguna ficha usa. Una subida puede perder su archivo (hoy, el avatar reemplazado, quitado o de una cuenta borrada) y el registro se conserva con el momento en que se borró: sigue contando para el cupo, pero su URL ya no se acepta en una ficha ni se muestra. Las fichas guardan solo la URL, también en sus payloads y revisiones; al leerlas, el backend añade las dimensiones de la subida, o muestra la imagen como ausente si su archivo ya no está. En desarrollo y en pruebas el almacenamiento es una carpeta local servida por el propio backend, para que todo funcione sin red ni credenciales.

## Iconos de plataforma externa

El icono de una plataforma externa también es una subida, de propósito propio, y es el único caso en que se acepta SVG: los logotipos de marca son vectoriales y los diseña o consigue un administrador. Solo los administradores los suben, sin cupo, por `POST /v1/images/platform-icons`; `POST /v1/images` y el avatar siguen aceptando solo JPEG, PNG y WebP. El `iconUrl` de una plataforma externa solo acepta un icono subido con su archivo vigente, y cada icono pertenece a una sola plataforma externa; como el avatar, el archivo del icono reemplazado o de la plataforma externa borrada se elimina.

Un SVG es un documento que puede ejecutar scripts, cargar recursos ajenos o expandir entidades, así que se valida contra una lista blanca de elementos y atributos de dibujo y se **rechaza** lo que no está en ella, nombrando cada elemento o atributo a quitar al administrador. Solo se descartan sin avisar los comentarios, `<metadata>` y la marca de los editores. Se guarda el SVG reconstruido a partir de lo validado, no el archivo original. Como segunda barrera, las imágenes se sirven con `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` y `X-Content-Type-Options: nosniff`: en producción, una Response Header Transform Rule de Cloudflare sobre `img.paltono.com` (R2 no fija una CSP por objeto); en local, el propio backend. Los clientes los muestran solo con `<img src>`, donde el navegador no ejecuta nada del SVG.

## Considered Options

- **Aceptar cualquier URL HTTP(S)** (la decisión del MVP que esta reemplaza): descartada porque permite contenido ajeno, enlaces rotos y rastreo de visitantes.
- **Subida directa a R2 con URL firmada**: descartada porque el backend nunca ve el archivo y no puede quitarle el EXIF ni validar su contenido.
- **Cloudflare Images**: innecesario mientras basten las imágenes originales; las transformaciones de Cloudflare sobre el dominio de R2 cubren miniaturas futuras sin migrar.
- **Iconos de plataforma como URL externa libre** (la excepción que tuvo esta decisión): descartada por las mismas razones que las URLs externas del catálogo.
- **Extraer el favicon de la URL de la plataforma externa**, como hacen las vistas previas de enlaces: un favicon es un raster pequeño que cambia sin aviso, y para un conjunto pequeño y curado de servicios un icono propio por servicio da mejor resultado.
- **Iconos empaquetados en el frontend por `slug`**: evita servir SVG, pero obliga a desplegar cada aplicación para añadir una plataforma externa.
- **Limpiar el SVG en silencio (DOMPurify)**: acepta más archivos, pero lo guardado deja de ser lo diseñado sin que el administrador lo sepa; rechazar nombrando lo que sobra es más claro.

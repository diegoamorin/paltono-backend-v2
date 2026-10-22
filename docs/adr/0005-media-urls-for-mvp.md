# Imágenes subidas a R2 a través del backend

Las imágenes del catálogo (imagen de perfil, foto de cuerpo completo, portada de edición, imagen de concierto y de tour) y el avatar de la cuenta se guardan como URLs, pero solo se aceptan URLs de imágenes subidas a la plataforma: deben empezar por la base pública configurada (`img.paltono.com` en producción) y estar registradas como subidas. Se rechaza cualquier URL externa, para que la plataforma controle qué se muestra y ningún servidor ajeno vea a quien visita una ficha.

Cada archivo pasa por el backend antes de llegar a Cloudflare R2: el backend comprueba el tipo por su contenido (JPEG, PNG o WebP), el peso (3 MB) y las dimensiones (4000 px por lado), elimina los metadatos EXIF respetando la orientación y recomprime sin pérdida visible conservando el formato. Una subida directa del navegador a R2 con URL firmada impediría limpiar y validar el archivo.

Cada subida se registra con su cuenta, para contar el cupo de subidas en Postgres (sobrevive a reinicios), saber quién subió cada imagen y encontrar más adelante las que ninguna ficha usa. En desarrollo y en pruebas el almacenamiento es una carpeta local servida por el propio backend, para que todo funcione sin red ni credenciales.

## Considered Options

- **Aceptar cualquier URL HTTP(S)** (la decisión del MVP que esta reemplaza): descartada porque permite contenido ajeno, enlaces rotos y rastreo de visitantes.
- **Subida directa a R2 con URL firmada**: descartada porque el backend nunca ve el archivo y no puede quitarle el EXIF ni validar su contenido.
- **Cloudflare Images**: innecesario mientras basten las imágenes originales; las transformaciones de Cloudflare sobre el dominio de R2 cubren miniaturas futuras sin migrar.

# Imágenes mediante URLs durante el MVP

El MVP recibirá URLs HTTP(S) para avatares, portadas e imágenes del catálogo y eventos. La primera versión no incluye endpoints para subir archivos, almacenamiento propio ni procesamiento de imágenes; así se mantiene el alcance compatible con los campos URL del ER.

La intención para una segunda versión es utilizar Cloudflare R2. Cloudflare Images se considera una posibilidad al monetizar, no una decisión definitiva. Los contratos de carga y la persistencia de metadatos se diseñarán en esa fase; no se agregan tablas ni dependencias de esos servicios al MVP.

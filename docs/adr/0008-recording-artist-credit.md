# Crédito de artista en la grabación y crédito impreso opcional en la pista

El crédito de artista solo existía en la pista. Una grabación tiene una pista por cada edición en la que sale, así que ninguna vista centrada en la grabación (lista de canciones, créditos de una identidad, buscador) podía mostrar de quién es sin elegir una pista. Decidimos que la grabación tenga su propio crédito de artista y que el de la pista pase a ser un **crédito impreso** opcional, que solo existe cuando una edición acredita la grabación de otra forma ("Becky G" sola en un recopilatorio, "JENNIE (BLACKPINK)" en el álbum del grupo). No es una copia para acelerar lecturas: son dos hechos distintos que casi siempre coinciden. Una pista con crédito impreso lo muestra entero en lugar del de su grabación, sin combinarlos; una pista sin él muestra el de su grabación al leerla, sin copiarlo, y la API resuelve esa regla para que quien la consume no haga el cruce.

La migración da a cada grabación el crédito de su pista en la edición publicada y no cancelada más temprana, y borra los créditos de pista idénticos al de su grabación (mismos artistas, clase, posición y nombre acreditado). Escribe filas de dominio fuera del flujo editorial, así que esas altas y bajas no quedan como revisiones de ninguna ficha; se aceptó porque no había propuestas pendientes ni borradores con créditos de pista. Las grabaciones que solo están en ediciones sin publicar quedan sin crédito y conservan los de sus pistas.

El payload de los créditos de pista no cambia de forma, así que su versión sigue vigente y el código absorbe el nuevo significado (peldaño 1 del ADR 0006); el crédito de la grabación es una operación nueva con su propia v1.

## Considered Options

- **Copiar el crédito a cada pista** (como hasta ahora): descartado, porque corregir el artista de una canción obligaría a tocar todas sus pistas y nada distinguiría un crédito impreso real de una copia.
- **Combinar el crédito impreso con el de la grabación**: descartado, porque no permitiría que una edición omita a un artista.
- **Derivar el artista de la grabación de su primera pista al leer**: descartado, porque haría depender un hecho del catálogo de qué ediciones existen y cómo se ordenan.

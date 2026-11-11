# Enlaces de plataforma en la grabación, uno por plataforma externa

Spotify, Apple Music o YouTube Music organizan los enlaces para escuchar una canción por pista: una URL distinta por cada lanzamiento en que sale la canción. Una grabación es un mismo audio, así que todas sus pistas suenan igual y cualquiera de esas URLs sirve para escucharla; elegir entre ellas solo cambia la portada que muestra la plataforma externa. Decidimos que el enlace de plataforma sea un dato de la grabación, con a lo sumo uno por plataforma externa, y que la pista no tenga enlaces. Así una canción aparece una vez con un enlace por plataforma, sin una regla que elija entre los de sus pistas, y el número de enlaces no crece con las reediciones. Reemplazar un enlace cambia solo su URL; pasar a otra plataforma externa es quitarlo y añadir otro. Los enlaces anteriores quedan en el historial de revisiones.

Una plataforma externa marca si admite grabaciones, no pistas, y no existe ninguna operación de enlaces de pista.

## Considered Options

- **Enlaces en la pista**, como en las plataformas externas: descartado, porque la página de una canción repetiría los mismos enlaces por cada edición y una lista de canciones tendría que elegir uno.
- **Enlaces en la pista y la grabación eligiendo uno al leer**: descartado, porque haría depender un dato de la canción de qué ediciones existen, como ya se descartó para el crédito de artista (ADR 0008).
- **Varios enlaces por plataforma externa en la grabación**: descartado, porque vuelve a admitir un enlace por edición; distinguir un MV de un audio oficial es asunto de un concepto de video propio.

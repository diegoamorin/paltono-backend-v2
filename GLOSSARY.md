# Catálogo musical colaborativo

Base de conocimiento musical que reúne identidades, obras, grabaciones, lanzamientos, eventos y tours. Sus fichas se construyen mediante contribuciones con fuentes y revisión editorial.

## Language

### Catálogo

**Identidad de catálogo (identity)**:
Persona u organización descrita en el catálogo musical. Es distinta de la cuenta de quien participa en la plataforma.
_Avoid_: Usuario para referirse a una persona del catálogo.

**Ficha**:
Unidad de información editorial correspondiente a una identidad, obra, grabación, lanzamiento, evento o tour. Puede reunir datos y relaciones cuya modificación se revisa conjuntamente o por partes.
_Avoid_: Página como sinónimo de la información del catálogo.

**País (country)**:
País o territorio vigente con identidad cultural propia en el que se ubica algo del catálogo, como en los catálogos musicales habituales: incluye Estados soberanos, territorios como Puerto Rico o Hong Kong y entidades de reconocimiento disputado como Taiwán, Palestina o Kosovo. Los estados ya extintos no son países del catálogo: un lugar se registra con el país actual al que pertenece. Las entidades sin reconocimiento internacional estándar, como Chipre del Norte o Somalilandia, tampoco: se registran con el país reconocido que las contiene.
_Avoid_: Estado soberano como sinónimo, región, territorio histórico.

**Nacionalidad (nationality)**:
País con el que una persona se identifica como nacional; es identidad cultural, no ciudadanía legal, por lo que una persona de Puerto Rico puede figurar con Puerto Rico y también con Estados Unidos. Una persona puede tener varias, o ninguna conocida.
_Avoid_: País de nacimiento, origen.

**País de nacimiento (birth country)**:
País donde nació una persona. Es uno solo y no implica una nacionalidad.
_Avoid_: Nacionalidad, origen.

**País de origen (origin country)**:
País donde surgió una organización.
_Avoid_: Nacionalidad, sede.

**Foto de cuerpo completo (full-body image)**:
Imagen de una persona de pie, de la cabeza a los pies, pensada para mostrarla a escala junto a otras. Es distinta de la imagen de perfil.
_Avoid_: Foto de perfil, avatar.

**Subida de imagen (image upload)**:
Imagen que una cuenta entregó a la plataforma para usarla en una ficha o como avatar. Existe desde que se sube, aunque ninguna ficha la use todavía. Puede perder su archivo, como el avatar que se reemplaza, y sigue existiendo como historial de la cuenta: cuenta para el cupo, pero no se puede volver a usar ni se muestra.
_Avoid_: Adjunto, archivo.

**Cupo de subidas (upload quota)**:
Número de subidas de imagen que una cuenta puede hacer en los últimos 15 días. El de catálogo y el de avatar son independientes, y el personal no tiene cupo de catálogo.
_Avoid_: Rate limit, para no confundirlo con los límites por frecuencia de peticiones.

### Música

**Lanzamiento (release group)**:
Álbum, EP, single o recopilatorio tal como lo presentó su artista o agencia, independientemente de cuántas ediciones tenga. Su tipo es una decisión editorial respaldada por fuentes, no un cálculo por número de pistas.
_Avoid_: Release a secas, porque puede referirse al lanzamiento o a una edición.

**Edición (release)**:
Publicación digital concreta de un lanzamiento. Hay una edición distinta cuando cambia el tracklist, el audio de alguna pista o el contenido de una edición regional; las variantes físicas o de empaque no son ediciones.
_Avoid_: Versión, que puede referirse a una edición, a una grabación alternativa o a una variante de photobook.

**Pista (track)**:
Posición de una grabación dentro de una edición.
_Avoid_: Canción, que puede referirse a la obra, a la grabación o a la pista.

**Repackage**:
Lanzamiento propio que relanza el contenido de otro con material nuevo y suele tener otro título. Se vincula con el lanzamiento original.
_Avoid_: Edición para referirse a un repackage.

### Contribuciones editoriales

**Propuesta (change proposal)**:
Conjunto de cambios que una persona presenta sobre una o varias fichas, acompañado de una descripción y fuentes. Puede contener cambios con resultados distintos.
_Avoid_: Edición aprobada como sinónimo de propuesta.

**Borrador (draft)**:
Propuesta todavía no enviada cuyo contenido solo puede consultar y modificar su autor.
_Avoid_: Envío para referirse a un borrador.

**Envío**:
Propuesta presentada a revisión cuyo contenido y fuentes quedan fijados. Corregir ese contenido exige otra propuesta.
_Avoid_: Borrador enviado que todavía se puede editar.

**Microcambio (proposal change)**:
Operación individual de una propuesta sobre una ficha o una de sus relaciones. Su resultado puede resolverse de forma independiente salvo que pertenezca a un grupo atómico.
_Avoid_: Propuesta para referirse a una sola operación dentro de ella.

**Versión del payload (payload schema version)**:
Forma publicada de los datos de un tipo de microcambio. Una vez publicada no cambia nunca; una forma o un significado distintos son una versión nueva.
_Avoid_: Versión a secas, ni versión de la ficha, que cuenta los microcambios aplicados a una ficha.

**Microcambio obsoleto (obsolete change)**:
Microcambio escrito en una versión del payload que ya no puede aplicarse. Se cierra sin aplicarse y sus dependientes y su grupo atómico quedan bloqueados.
_Avoid_: Conflicto, porque lo que cambió es la forma de sus datos y no la información sobre la que se basaba.

**Fuente (source)**:
Referencia que respalda una propuesta, mediante una dirección web, una referencia bibliográfica o ambas. Puede vincularse también a microcambios concretos.
_Avoid_: Evidencia verificada como sinónimo de fuente aportada.

**Grupo atómico (atomic group)**:
Conjunto de microcambios de un mismo envío que deben aplicarse juntos o no aplicarse. Sus decisiones terminales también se resuelven conjuntamente.
_Avoid_: Propuesta indivisible como regla general.

**Decisión (change decision)**:
Registro de una acción de revisión sobre un microcambio y del contexto observado al resolverlo. Una decisión no implica necesariamente que se haya modificado la ficha.
_Avoid_: Aprobación como sinónimo de cualquier decisión.

**Revisión (entity revision)**:
Registro de un microcambio efectivamente incorporado a una ficha, con sus valores anteriores y resultantes.
_Avoid_: Decisión o propuesta como sinónimos de revisión aplicada.

**Conflicto (conflict)**:
Situación en la que cambió la información relevante sobre la que se basaba un microcambio y hace falta una decisión explícita antes de aplicarlo.
_Avoid_: Rechazo automático.

**Retirada de ficha (entity withdrawal)**:
Acción editorial de un administrador que retira el contenido público de una ficha y conserva su aviso, identidad e historial.
_Avoid_: Borrado de ficha.

**Retirada de microcambio (change withdrawal)**:
Cierre de un microcambio todavía no resuelto por su autor o por el personal. No revierte los cambios que ya se aplicaron.
_Avoid_: Reversión de una aplicación.

### Cuentas

**Cuenta (account)**:
Registro de una persona que participa en la plataforma, identificado de forma estable con independencia de su username.
_Avoid_: Identidad de catálogo para referirse a una cuenta.

**Suspensión**:
Estado de una cuenta a la que un administrador impide actuar temporalmente, con un motivo registrado. Se puede revertir mediante reactivación.
_Avoid_: Baja o bloqueo como sinónimos de suspensión.

**Baja (account deletion)**:
Cierre definitivo de una cuenta por decisión de su titular. Libera su correo, conserva su username reservado y mantiene la atribución de sus contribuciones.
_Avoid_: Borrado para referirse a la baja, porque la cuenta y su historial se conservan.

### Aplicaciones

**Aplicación**:
Cliente web de Paltono con su propio dominio sobre el mismo catálogo. Ninguna ficha pertenece a una aplicación.
_Avoid_: Vertical, sitio.

**Aplicación principal**:
La aplicación de `paltono.com`, que muestra el catálogo entero. Es la única donde se usa una cuenta: registro, sesión, contribuciones y gestión de la cuenta.
_Avoid_: Frontend K-pop, frontend general.

**Microaplicación**:
Aplicación con un solo propósito que solo lee datos públicos del catálogo, sin cuentas, como comparar alturas o ver en un calendario cumpleaños, lanzamientos y conciertos.
_Avoid_: Vertical, módulo.

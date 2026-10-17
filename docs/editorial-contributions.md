# Contribuciones editoriales y moderación

Especificación del modelo `Editorial Contributions` de `ERDiagram.mdj`, acordada el 16 de octubre de 2026. Aplica al catálogo musical, eventos y tours. El diagrama describe entidades, columnas, relaciones y restricciones; no es una migración SQL ni implementa permisos o transacciones. Se asume PostgreSQL.

## 1. Roles y propiedad editorial

| Acción | Usuario | Moderador | Administrador |
|---|---|---|---|
| Crear borradores y enviar altas/cambios | Sí | Sí | Sí |
| Publicar o editar directamente, con fuentes e historial | No | Sí | Sí |
| Resolver propuestas | No | Sí | Sí |
| Solicitar retirada de una ficha | Sí | Sí | Sí |
| Aplicar retirada de una ficha publicada | No | No | Sí |
| Asignar o quitar roles | No | No | Sí |

Solo cuentas `active` pueden actuar. El rol `moderator` se añade a `users.role`; `user` es el valor inicial. Cada cambio de rol comprueba el rol anterior bajo bloqueo, exige un administrador activo y escribe `user_role_changes` en la misma transacción que actualiza `users`, salvo el bootstrap inicial descrito a continuación. Una suspensión o revocación debe impedir decisiones posteriores: comprobar y proteger la autorización también en la transacción de aplicación.

El primer administrador se obtiene promoviendo desde consola una cuenta ya registrada, activa y con correo verificado. Esta operación de despliegue solo se permite si no existe ninguna cuenta con rol `admin`; se serializa con todos los caminos de cambio de rol y vuelve a comprobar esa ausencia bajo bloqueo. La promoción y su auditoría se confirman juntas. Exclusivamente en este caso, `user_role_changes.changed_by` es NULL y el motivo de bootstrap es obligatorio: representa una acción del operador de consola sin atribuírsela falsamente al usuario promovido. Los endpoints HTTP nunca admiten esta excepción; los cambios posteriores requieren un administrador activo. No se configura una contraseña inicial de administrador en variables de entorno. Véase [ADR 0003](adr/0003-initial-administrator-bootstrap.md).

No se puede degradar, suspender ni eliminar al último administrador activo con correo verificado. Los cambios de rol, estado y verificación deben comprobar bajo coordinación transaccional que permanezca otro administrador operativo cuando una acción vaya a retirar esa condición al afectado. Esta regla también se aplica a la baja voluntaria y a los comandos de consola.

Se elimina `artist_team_members`. Crear una ficha no confiere propiedad ni permiso de edición directa. Se mantienen `organization_memberships` y `artist_organization_affiliations`, que describen relaciones musicales e informativas. Un moderador puede publicar su propio contenido sin segunda revisión; la operación utiliza el mismo historial que las propuestas de usuarios.

| Raíz editorial | Tabla de dominio | Datos que posee |
|---|---|---|
| `identity` | `catalog_identities` | `people` o `organizations`, perfil `artists`, alias, nacionalidades, categorías y enlaces; membresías y roles pertenecen a la organización; afiliaciones pertenecen a la identidad del artista. |
| `work` | `works` | Créditos `work_contributions`. |
| `recording` | `recordings` | Créditos, géneros y relaciones con obras (`recording_works`). |
| `release` | `releases` | Créditos del release, pistas, créditos de presentación y enlaces de las pistas. |
| `event` | `events` | Participantes, organizadores y enlaces del concierto. |
| `tour` | `tours` | Artistas, organizadores y enlaces del tour. |

Las seis tablas de dominio tienen `editorial_entity_id UUID NOT NULL UNIQUE`, FK a `editorial_entities.id`, sin sustituir sus IDs existentes. `artists` y `tracks` no reciben una segunda raíz editorial. Cada relación tiene un único propietario de escritura; sus vistas inversas son derivadas. Las entidades referenciadas también se comprueban al validar dependencias, publicación y retirada, sin inventar revisiones en ellas cuando no cambian sus datos.

Los vocabularios compartidos (`countries`, `genres`, `platforms`, `organization_types`, `contribution_roles` y ámbitos) tienen lectura pública y escritura exclusiva de administradores, fuera del flujo de propuestas. Solo pueden eliminarse entradas sin referencias; una entrada en uso produce rechazo sin cascadas. Son datos administrados, no nuevas fichas colaborativas. Autenticación y likes quedan fuera de este flujo.

## 2. Tablas y restricciones

| Tabla | Contenido y restricciones principales |
|---|---|
| `editorial_entities` | UUID, tipo inmutable, estado `reserved/published/withdrawn`, creador, versión y referencia a la creación aplicada. |
| `change_proposals` | Autor, descripción, estado `draft/open/closed`, fechas y propuesta anterior opcional. |
| `proposal_changes` | Operación, raíz, selector, base, propuesta, versión del payload, grupo atómico, orden y estado. |
| `change_dependencies` | Grafo de dependencias dentro de una propuesta; PK `(change_id, depends_on_change_id)`. |
| `proposal_sources` | Fuentes generales; URL HTTP(S), referencia bibliográfica o ambas. |
| `change_sources` | Asociación opcional; PK `(change_id, source_id)`. |
| `change_decisions` | Registro inmutable de decisiones y base observada; permite varios intentos de decisión, pero una sola aplicación efectiva. |
| `entity_revisions` | Registro inmutable de operaciones aplicadas, sus valores reales anterior/nuevo y clave de la fila generada. |
| `user_role_changes` | Usuario afectado, administrador (NULL exclusivamente en el bootstrap inicial por consola), roles anterior/nuevo, motivo y fecha. |

Todos los IDs de las tablas nuevas son UUID salvo las referencias a `users.id`, que siguen siendo INTEGER; los pares de las tablas puente son sus PK. Todas las FKs editoriales usan `ON DELETE RESTRICT`. Conservar las cuentas mediante el estado `deleted` permite mantener autoría y revisores; no borrar en cascada su historial.

Restricciones que la implementación SQL debe materializar, además de los indicadores PK/FK/UNIQUE del diagrama:

- `proposal_changes`: UNIQUE `(proposal_id,id)`, `(id,entity_id)` y `(proposal_id,position)`; versiones no negativas y orden no negativo.
- `change_dependencies`: dos FKs compuestas desde `(proposal_id,change_id)` y `(proposal_id,depends_on_change_id)` a `proposal_changes(proposal_id,id)`. Prohibir autorreferencia y ciclos; comprobar también que colapsar los grupos atómicos no produzca ciclos.
- `proposal_sources`: UNIQUE `(proposal_id,id)`; exigir al menos una URL o referencia no vacía por fila. Una URL proporcionada no puede estar vacía ni usar otro protocolo.
- `change_sources`: FKs compuestas `(proposal_id,change_id)` y `(proposal_id,source_id)` a las claves anteriores. Impiden usar una fuente de otra propuesta.
- `change_decisions`: UNIQUE `(id,change_id)`.
- `entity_revisions`: UNIQUE `(entity_id,version)`, `change_id` y `decision_id`; FK directa de `entity_id` a la raíz y FKs compuestas `(change_id,entity_id)` y `(decision_id,change_id)` a `proposal_changes(id,entity_id)` y `change_decisions(id,change_id)`. La decisión debe corresponder a una aplicación efectiva.
- `editorial_entities`: FK compuesta `(creation_change_id,id)` a `proposal_changes(id,entity_id)`; `creation_change_id` único. Debe ser una operación `create_entity` aplicada, cuyo autor coincide con `created_by`.
- `user_role_changes`: `previous_role <> new_role`, ambos dentro de los roles de `users`. `changed_by` admite NULL exclusivamente bajo las condiciones transaccionales del bootstrap inicial; en ese caso `new_role=admin` y el motivo no está vacío. La nulabilidad no autoriza promociones anónimas por HTTP.

Las restricciones entre varias tablas, el grafo, las autorizaciones y las transiciones requieren validación transaccional del servicio y, cuando corresponda, triggers de restricción diferidos. No basta con el dibujo de una FK. Para consultas de trabajo, indexar propuestas por autor/fecha y estado/fecha; microcambios por propuesta/estado y por entidad/selector/estado; dependencias por prerrequisito; decisiones por microcambio/fecha; fuentes por propuesta y auditoría por usuario/fecha. Las claves únicas de revisiones cubren la consulta por entidad/versión.

## 3. Borradores, altas y operaciones

Una propuesta puede contener varias fichas relacionadas. El borrador solo es accesible a su autor; su contenido se almacena en la capa editorial. Enviar exige descripción, al menos un microcambio, una fuente general y validación de tipos y dependencias. Esto incluye las acciones directas del personal, que crean un envío y su aplicación en una transacción.

Al enviar, quedan congelados autor, descripción, operaciones, bases, orden, grupos, dependencias y fuentes. Solo cambia el estado de revisión. Para corregir contenido o añadir evidencia se crea otra propuesta con `previous_proposal_id`, del mismo autor y apuntando a un envío previo, sin ciclos. El enlace no cancela automáticamente el envío anterior. Para reemplazar una propuesta de alta no publicada, reservar otra raíz y retirar los microcambios pendientes del alta original; no reutilizar su UUID. Un moderador que redacte un valor distinto del enviado crea su propia propuesta, conservando la atribución de la original.

El autor congelado es la cuenta referenciada por su ID, no una copia de su username. La atribución mostrada usa el username vigente de esa cuenta, también para contribuciones anteriores a un cambio de nombre. Los enlaces de autor conservan su identidad mediante un identificador estable. Reutilizar un username liberado no transfiere contribuciones. Este comportamiento no reescribe descripciones, fuentes ni valores históricos que contengan nombres como texto.

Al iniciar un alta se reserva un UUID en `editorial_entities`; `current_version=0`, `publication_status=reserved` y no existe fila en el dominio. `creation_change_id`, `published_at` y `withdrawn_at` son NULL. Solo su autor puede proponer operaciones sobre esa reserva, dentro de la misma propuesta de creación. Las propuestas de modificación independientes solo se envían contra raíces publicadas.

Una operación `create_entity` contiene una creación mínima válida: todos los datos obligatorios no generados, sus valores válidos y los subtipos necesarios. Por ejemplo, una identidad debe tener exactamente un subtipo coherente con `person/organization`; un release necesita título no vacío y tipo válido, pero puede carecer de fecha, portada y pistas. No relajar las restricciones existentes de grabaciones, obras, créditos, pistas o eventos. Fechas opcionales permanecen desconocidas, sin inventar precisión.

Al aplicar la creación se inserta la raíz del dominio, se fija `creation_change_id`, se publica y se escribe su primera revisión. Los datos adicionales del envío pueden continuar pendientes. `created_by` sigue siendo el autor; el aprobador se obtiene de la decisión de creación. Una raíz publicada o retirada tiene exactamente una fila del tipo correcto entre las seis tablas; `published_at` y `creation_change_id` son obligatorios. Una reserva abandonada permanece sin fila pública.

Operaciones admitidas:

| Operación | Semántica |
|---|---|
| `create_entity` | Alta mínima de una raíz reservada y de sus componentes obligatorios. |
| `set_fields` | Cambio de un campo o conjunto coherente, como año/mes/día de una fecha. |
| `add_relation` | Insertar un alias, crédito, pista, enlace u otra fila dependiente. |
| `update_relation` | Modificar una fila dependiente existente. |
| `remove_relation` | Quitar una fila dependiente respetando FKs y guardando sus valores anteriores. |
| `withdraw_entity` | Retirada lógica de una raíz publicada; solo un administrador puede aplicarla. |

`target_path` selecciona un campo, grupo o relación de un registro de operaciones permitido; nunca permite SQL o tablas arbitrarias. `target_key` identifica filas por PK simple o compuesta, nunca por posición de un array. No admitir operaciones con escrituras solapadas en un mismo envío: combinar cambios relacionados en una operación coherente.

Los JSONB utilizan una envoltura `{"exists": true, "value": ...}`; `{"exists": false}` indica ausencia. Así se distingue un valor NULL de una fila inexistente. Una alta parte de ausencia; una eliminación propone ausencia. Para retirada, el objetivo es el estado editorial, no borrar la fila. La forma interna de `value` depende de `payload_schema_version` y del selector permitido.

Las referencias propuestas a nuevas raíces usan `{"entity_id":"<UUID editorial>"}`. Para una fila dependiente todavía no creada, la clave puede usar `{"change_id":"<UUID de inserción>"}`. Ambas referencias deben tener una dependencia explícita hacia su creación, verificable al enviar. El servidor las traduce a las PK del dominio al aplicar; `entity_revisions.result_key` conserva el resultado y `after_value` el valor efectivo. No modificar los UUID ni las referencias del envío original. Los payloads no pueden modificar roles, autoría, versiones, decisiones ni metadatos administrativos.

`atomic_group_id` agrupa operaciones del mismo envío. Aplicar un grupo completo en una transacción o no aplicar ninguna. Dentro del grupo se ejecuta en orden de dependencias y se validan las invariantes finales antes del commit. Los grupos también se resuelven juntos al rechazar, retirar o declarar no aplicables sus miembros; una aplicación que contenga operaciones ya satisfechas puede cerrar esas operaciones sin una revisión adicional. Un conflicto que impide el grupo mantiene los demás miembros pendientes.

No es necesario agrupar toda una propuesta: una identidad puede aprobarse antes que su grabación y esta antes que una pista. Para publicar la pista deben estar publicadas tanto la grabación como el release, o publicarse dentro de la misma transacción. Una relación no apunta a una reserva ni a una ficha retirada. Una dependencia aplicada solo desbloquea cuando su postcondición sigue siendo válida; no basta con consultar su estado histórico.

## 4. Decisiones, conflictos y transacciones

| Estado del microcambio | Significado |
|---|---|
| `pending` | Pendiente de decisión; puede estar esperando dependencias. |
| `conflicted` | Cambió su base relevante; requiere decisión explícita. |
| `applied` | Incorporado al dominio; tiene una revisión. |
| `rejected` | Descartado mediante decisión. |
| `satisfied` | Su resultado ya existe; no genera escritura ni revisión. |
| `blocked` | No aplicable por fallo definitivo de una dependencia. |
| `withdrawn` | Retirado de la revisión por el autor o el personal. |

Solo `pending/conflicted` son estados no terminales; `resolved_at` es NULL exactamente en esos estados. Rechazar o retirar una dependencia propaga `blocked` a sus dependientes pendientes, con decisiones registradas; esperar una dependencia conserva `pending`. Una operación `satisfied` sirve como prerrequisito únicamente si puede resolverse su identidad de destino de forma inequívoca. No fusionar altas por coincidencia de título/nombre.

`change_decisions.action` registra `apply`, `apply_rebased`, `reject`, `mark_conflict`, `mark_satisfied`, `block_dependency` o `withdraw_change`, junto al estado anterior/resultante. `apply` exige base compatible y produce `applied`; `apply_rebased` exige confirmación explícita del personal sobre una base distinta y también produce `applied`. Las demás acciones producen su estado homónimo. Todas actúan sobre estados no terminales; no se reabren decisiones terminales ni se revierten aplicaciones editando su historial. Una corrección posterior es una nueva propuesta.

`actor_id` es obligatorio para aplicar, rechazar o retirar. Puede ser NULL para marcar automáticamente conflictos, resultados satisfechos o dependencias fallidas; nunca representa una aprobación automática. El autor solo puede retirar sus microcambios no resueltos. Conflictos, rechazos, aplicación sobre una base nueva y fallos de dependencia requieren motivo. Las decisiones automáticas también conservan el contexto observado.

Solo las propuestas enviadas y abiertas reciben decisiones. Editar o descartar un borrador privado no constituye una decisión de moderación ni permite al personal consultar su contenido.

Secuencia de aplicación para una operación o grupo:

1. Comprobar permiso actual y bloquear de forma consistente las raíces afectadas/referenciadas por UUID, las propuestas y los microcambios pertinentes. Usar el mismo orden en todos los caminos de publicación/retirada y respetar la serialización de cambios de rol. Releer estado y dependencias bajo esos bloqueos.
2. Validar selector, payload, fuente, publicación, FKs, unicidad e invariantes del dominio. Los grupos se validan sobre el estado que dejará su transacción. No saltarse validaciones al resolver conflictos.
3. Si el resultado ya existe y la identidad es inequívoca, registrar `satisfied`. Si la base relevante cambió, registrar `conflicted` y no sobrescribir. En caso de incertidumbre, mantener pendiente/en conflicto para decisión humana.
4. Si es compatible, aplicar; si hay conflicto, exigir `apply_rebased`, que guarda la versión y el valor actuales confirmados. Conservar intactos `base_version/base_value` del autor. Una nueva modificación concurrente obliga a volver a comprobar, no a aceptar una confirmación obsoleta.
5. Escribir la decisión, el cambio del dominio y la revisión, e incrementar `current_version`, todo en la misma transacción. Cada microcambio aplicado consume una versión de su raíz; varias operaciones del mismo grupo pueden generar versiones consecutivas visibles juntas. UNIQUE `change_id` en revisiones y bloqueo de estado impiden la doble aplicación.
6. Recalcular conflictos/dependencias de operaciones pendientes afectadas y el cierre de sus propuestas bajo bloqueo; registrar decisiones automáticas solo cuando haya una transición nueva. Toda aplicación posterior vuelve a comprobar la base, aunque la detección previa hubiera quedado desactualizada.

Un cambio en otra parte de la ficha no provoca conflicto por sí solo. Comparar la base de los datos afectados y sus precondiciones, utilizando también las revisiones posteriores a `base_version` para detectar cambios relevantes que luego volvieron al valor anterior. Los cambios en listas se comparan por claves y restricciones, no reemplazando toda la colección. Añadir dos alias diferentes suele ser compatible; insertar dos pistas en la misma posición no lo es.

Ejemplo: con altura original 170, Ana propone 172 y Luis 175. Aplicar 172 deja el cambio de Luis en conflicto, sin rechazarlo. Si se confirma después 175, su propuesta sigue diciendo que partió de 170, pero la decisión y revisión muestran que reemplazó 172. Si Luis también hubiera propuesto 172, se cierra como satisfecho. Una propuesta paralela de biografía continúa siendo aplicable si su propia base no cambió.

Una propuesta enviada está `open` mientras exista un cambio `pending/conflicted`; queda `closed` cuando todos son terminales. El resultado parcial se deriva, no se almacena en otro enum. Cada propuesta con una altura aún pendiente sigue abierta aunque sus otros cambios estén resueltos. Retirar pendientes no revierte lo aprobado. Los fallos transaccionales no dejan decisiones de aplicación ni revisiones huérfanas; reintentar requiere releer autorización, versiones y estado.

## 5. Fuentes, historial público y retirada

Las fuentes son generales y obligatorias por propuesta; el vínculo por microcambio es opcional. La cadena revisión → microcambio → propuesta → fuentes conserva procedencia. Los campos musicales existentes `source_text/source_url` mantienen su propósito: no copiar automáticamente una fuente general a todos los créditos ni eliminarlos al introducir el historial editorial.

El público ve todos los envíos, incluidos los que tengan cambios rechazados o pendientes, con autor, fecha, descripción, valores propuestos y fuentes. Rotularlos como **información propuesta**, separada de la ficha vigente. Excluir de esa proyección `proposal_changes.status/resolved_at`, decisiones, motivos internos, resultado global derivado y datos de revisión que revelen directamente el resultado individual. Es una proyección permitida en el servidor, no solo columnas ocultas en el frontend. La comparación con la ficha actual puede permitir inferir algún resultado; el requisito es no publicar el detalle de las decisiones.

El autor y el personal pueden consultar los estados y decisiones de los envíos; los visitantes no. Los borradores solo son accesibles a su autor, incluido cuando otra persona tenga rol de moderador. Los datos privados de cuentas y la auditoría de roles tampoco forman parte del historial público.

Retirar una raíz es una operación editorial con fuente, propuesta, decisión de administrador y revisión; cambia `publication_status` a `withdrawn` y fija `withdrawn_at`, conservando `published_at`, IDs y filas. La ficha pública muestra un aviso de retirada. Las fichas que ya la referencian mantienen sus datos y resuelven el enlace hacia ese aviso, sin mostrar el contenido retirado por joins secundarios. No eliminar referencias en cascada ni aceptar nuevas relaciones hacia esa raíz. Las propuestas de edición que estuvieran pendientes quedan en conflicto y no pueden aplicarse mientras la raíz esté retirada; sus dependientes se resuelven según corresponda. Rechazar/retirar esas propuestas sigue permitido. No se introduce restauración automática en esta versión.

## 6. Verificación y escenarios de aceptación

El validador estructural se ejecuta con `python scripts/validate_erd.py`. Para comparar preservación con el estado previo de Git: `python scripts/validate_erd.py --baseline-git <commit-anterior>`. Comprueba IDs, referencias, vistas, cardinalidades, tipos y vínculos editoriales; no ejecuta la política del futuro backend.

| Escenario | Resultado que deberá verificar la implementación |
|---|---|
| Un envío con altura aprobada, alias rechazado y fecha pendiente | Ficha con altura nueva; propuesta abierta; tres resultados internos y fuentes conservadas. |
| Dos alturas distintas desde la misma base | Primera aplicada; segunda en conflicto. Confirmación posterior conserva base original y valor realmente sustituido. |
| Dos propuestas idénticas | Segunda satisfecha, sin escritura ni versión duplicada. |
| Altura y biografía independientes | Ambas pueden aplicarse aunque la versión de la raíz avance. |
| Alta de identidad, grabación, release y pista | Se publican en orden válido o dentro de un grupo atómico; nunca hay referencias públicas a reservas. |
| Rechazo de una creación prerrequisito | Sus dependientes quedan bloqueados; los cambios independientes siguen disponibles. |
| Alta mínima válida con altura opcional pendiente | Se publica la ficha y el envío continúa abierto. |
| Fecha parcial y grupo inseparable | No se publica una fecha inválida ni una fracción de un grupo fallido. |
| Dos moderadores aplican simultáneamente | Una aplicación efectiva; el segundo relee estado y no duplica revisión. |
| Dos nuevas pistas compiten por release/disco/posición | Se respeta la unicidad, incluso si los selectores propuestos son distintos. |
| Dependencia aplicada cuya entidad fue retirada | No se aplica la relación; se comprueba la publicación actual. |
| Intento de publicar, retirar o elevar rol sin permiso | Rechazo sin escritura; moderadores no asignan roles ni retiran fichas publicadas. |
| Bootstrap por consola de una cuenta activa y verificada, sin administradores existentes | Promoción y auditoría atómicas, con `changed_by=NULL` y motivo de bootstrap. |
| Dos bootstrap simultáneos o bootstrap cuando ya existe un administrador | Como máximo una promoción inicial; el intento incompatible no cambia roles ni deja auditoría de éxito. |
| Bootstrap de cuenta no verificada/inactiva o intento de usar la excepción por HTTP | Rechazo sin promoción ni auditoría de éxito. |
| Personal publica directamente | Hay fuente, propuesta enviada, autor, decisión, revisión y versión; puede coincidir autor y aprobador. |
| Retirada con relaciones existentes | Aviso público, IDs/historial conservados, sin cascadas ni nuevas referencias. |
| Fuente de otra propuesta o ciclo de dependencias | Rechazo por FK compuesta o validación del grafo. |
| Visitante consulta historial | Ve todos los envíos y fuentes, sin estados individuales ni motivos; nunca ve borradores. |
| Autor retira pendientes de un envío parcialmente aplicado | Se conservan las revisiones aplicadas; se cierran pendientes/dependientes según su resultado. |
| Autor cambia de username y otra cuenta toma el anterior | Las contribuciones existentes muestran el username vigente del autor original; sus IDs, contenido e historial no cambian ni se transfieren a la otra cuenta. |

No hay backend ni base de datos ejecutable en este repositorio. Estos casos son criterios de aceptación del diseño, no pruebas de integración ya superadas. Si se implementa sobre datos existentes, habrá que crear raíces y revisiones iniciales con procedencia real o migración explícita; no atribuir autores o fuentes inventados.

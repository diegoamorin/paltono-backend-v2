# Baja de cuentas y conservación del correo

Fecha de revisión: 2026-10-17. Estado: investigación de referencia; la decisión de producto posterior para Q29 se recoge en el [ADR 0002](../adr/0002-local-authentication.md). Las observaciones jurídicas no certifican el cumplimiento del servicio.

El responsable operará desde Perú; el proyecto se dirigirá a Latinoamérica y posiblemente España. La finalidad declarada de conservar el correo antiguo es prevenir abusos y evasión de sanciones. Esta nota compara ejemplos relevantes; no certifica cumplimiento ni sustituye la revisión jurídica de los países efectivamente atendidos.

## Observaciones de las fuentes

- **Perú, ley:** finalidad, proporcionalidad y conservación necesaria rigen el tratamiento (arts. 6–8); el consentimiento es la regla salvo habilitación aplicable (arts. 5, 13.5 y 14). El art. 14.5 contempla necesidad contractual y el 14.9 menciona intereses legítimos del titular de los datos: no debe importarse automáticamente la base general de interés legítimo del responsable del RGPD. Los arts. 20 y 28.7 regulan supresión cuando los datos dejan de ser necesarios. Prevenir evasiones exige justificar el tratamiento concreto, no basta incluirlo en términos de uso. [Ley 29733, publicación oficial](https://www3.congreso.gob.pe/Docs/DGP/DIDP/files/ley_29733.pdf).

- **Perú, reglamento vigente:** el DS 016-2024-JUS rige desde el 31-03-2025. [ANPD, vigencia](https://www.gob.pe/9251-modificar-banco-de-datos-en-el-registro-nacional-de-proteccion-de-datos-personales). El art. III.2 define bloqueo que impide tratamiento y visualización, también previo a cancelar por posibles responsabilidades. Los arts. 82–85 regulan supresión, evaluación mediante bloqueo, comunicación, conservación justificada y disociación cuando proceda. El art. 6.1.9 exige informar el plazo de conservación. El límite de dos años del art. 31.2 pertenece al tratamiento por encargo; no fija automáticamente la retención de cuentas de esta aplicación. [DS 016-2024-JUS, publicación oficial](https://www3.congreso.gob.pe/Docs/DGP/DIDP/files/ds_016-2024-jus.pdf).

- **UE/España:** el RGPD puede alcanzar a responsables fuera de la UE que ofrezcan servicios a personas en ella o supervisen allí su comportamiento. Exige finalidad, base jurídica, minimización y conservación limitada; la supresión tiene excepciones, incluidas obligaciones legales y reclamaciones. No basta decidir que una cuenta quede `deleted` para justificar su correo indefinidamente. La seudonimización no equivale necesariamente a anonimización: un username o UUID vinculable a una persona puede seguir siendo dato personal. [RGPD, artículos 3, 4, 5, 6 y 17; considerandos 23 y 26, publicación oficial en BOE](https://www.boe.es/doue/2016/119/L00001-00088.pdf).

- **España:** cuando procede el bloqueo del artículo 32, los datos quedan reservados, impidiendo su tratamiento e incluso visualización, salvo su puesta a disposición de las autoridades indicadas para exigir responsabilidades. El bloqueo dura los plazos de prescripción aplicables; después procede destruir los datos. No equivale a mantener el correo visible en un panel administrativo ordinario. [LOPDGDD, artículo 32](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673#a3-4).

- **Plazos:** dependen de relaciones jurídicas, responsabilidades y normas sectoriales. El informe laboral de la AEPD no fija la retención de esta plataforma musical. [AEPD, informe 2019-0148, páginas 25–26](https://www.aepd.es/documento/2019-0148.pdf).

- **Brasil:** terminar la finalidad o necesidad conduce a terminar el tratamiento, con excepciones específicas de conservación. El uso exclusivo del responsable del art. 16.IV exige anonimización y excluir terceros; no habilita genéricamente retener correos de cuentas dadas de baja. [LGPD, artículos 15, 16 y 18](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).

Estos ejemplos no constituyen una ley única para Latinoamérica. Hay que concretar países y alcance territorial antes de fijar una política definitiva.

## Decisión posterior y alternativas investigadas

El usuario decidió liberar el correo al dar de baja la cuenta: `users.email` pasa a NULL, permitido exclusivamente para cuentas `deleted`. Una cuenta nueva puede verificar y utilizar ese correo sin heredar identidad ni historial. Se mantiene unicidad sobre los valores no nulos; la alternativa de índice parcial por estado y conservación del correo antiguo descrita abajo no fue adoptada. No se ha autorizado un registro adicional de correos, hashes antiabuso ni tablas nuevas. Esta decisión está documentada en el ER y en el ADR 0002.

Separar **baja de acceso**, **conservación justificada** y **supresión de datos**. La baja debe revocar sesiones y evitar autenticación; la conservación posterior requiere identificar finalidad, base aplicable, acceso permitido y plazo. Cifrar o calcular un hash del correo puede reducir exposición, pero no proporciona por sí solo esa justificación ni garantiza anonimato.

Como alternativa no adoptada, permitir otra cuenta con el mismo correo sería compatible técnicamente con conservar temporalmente la anterior mediante unicidad limitada a cuentas cuyo estado fuera distinto de `deleted`, incluidas las suspendidas. Un índice único parcial sobre `lower(email)` permitiría esa reutilización, pero no legitimaría la retención. No implementar esa alternativa como si fuera la decisión aprobada.

Para la finalidad confirmada, distinguir baja voluntaria de sanción: una cuenta suspendida mantiene ocupado su correo, pero conserva sus derechos de supresión. La baja no debe borrar silenciosamente una sanción vigente. Evaluar un registro mínimo de restricción solo si fundamento, necesidad y plazo están justificados; no conservar por defecto todo el perfil. Es una propuesta pendiente, sin tablas nuevas autorizadas. Comparar correos al registrarse constituye uso activo: no llamarlo «bloqueo legal» para evitar justificarlo. Un hash comparable no vuelve anónimo el registro; tampoco impide utilizar otro correo.

La cuenta nueva tendrá otro identificador y deberá verificar el correo de nuevo. Login y recuperación buscarán exclusivamente la cuenta vigente. Tokens, sesiones y confirmaciones se vincularán a `user_id`, finalidad y estado; un token antiguo nunca podrá operar sobre una cuenta nueva que reutilice el correo. El historial editorial no se transferirá automáticamente.

La decisión aceptada de conservar username y atribución histórica permanece vigente como decisión de producto, pero necesita revisión frente a solicitudes de supresión cuando identifique a una persona. Sustituirlo por un identificador interno no garantiza anonimización si sobreviven vínculos identificativos.

## Cuestiones de privacidad aún pendientes

- Mercados concretos iniciales; Perú y finalidad de prevenir abusos/evasión ya confirmados.
- Alcance y duración de las sanciones, revisión y efecto de una baja voluntaria sobre ellas.
- Datos mínimos, fundamento, plazo y reglas de acceso/eliminación para cada finalidad.
- Tratamiento de username, contribuciones con datos personales, logs, copias de seguridad y proveedores.

La investigación no autoriza nuevas tablas ni retenciones adicionales. Los cambios aprobados al ER corresponden exclusivamente a la decisión posterior descrita arriba.

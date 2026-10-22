# Versiones del payload editorial: inmutables y sin migrar el historial

Los microcambios guardan su payload con la forma de su versión del payload, y las tablas del dominio van a cambiar. Decidimos que una versión publicada no cambia nunca, que las revisiones aplicadas son solo historial (nunca se migran ni se vuelven a ejecutar: corregir algo es un microcambio nuevo sobre el estado actual) y que solo lo no aplicado puede necesitar adaptarse. Así las tablas pueden cambiar sin reescribir JSON histórico, a cambio de que el historial muestre cada valor en la forma con que se escribió.

Ante un cambio de tablas se elige, por este orden:

1. **Absorberlo en el código de la operación** (`read`/`apply`), sin versión nueva. Renombrar o dividir columnas no obliga a cambiar el payload, que es un formato propio y no una copia de la tabla. Ningún pendiente se entera.
2. **Versión nueva con traductor** (`upcast` de la versión anterior a la siguiente, encadenable) cuando la forma cambia pero se puede traducir sin inventar datos. Los borradores se reescriben a la versión vigente; los envíos nunca se reescriben y se traducen en memoria al decidir, al detectar conflictos y al comparar competidores.
3. **Versión nueva sin traductor** solo cuando traducir exigiría inventar datos. Lo pendiente queda obsoleto: los borradores no pueden enviarse hasta que el autor quite o rehaga esos microcambios, y un envío se cierra con una decisión automática `mark_obsolete` (sin actor, con motivo, resultado `blocked`) cuando el sistema intenta decidirlo o recalcularlo; sus dependientes y su grupo atómico quedan bloqueados como ante cualquier prerrequisito fallido.

El estado de una versión se deduce y no se escribe a mano: la más alta de un selector es la vigente; una anterior con traductor es traducible y una sin traductor es obsoleta. Una versión obsoleta conserva en el registro su descripción y sus schemas, sin código para aplicarla, y E1 la sigue publicando para que el historial pueda mostrarse.

Hoy solo existe el peldaño 3: el traductor y la traducción en memoria se construyen la primera vez que haga falta el peldaño 2. Una prueba congela los schemas publicados contra `payload-schemas.json` y falla si cambia o desaparece una entrada existente, o si falta una versión nueva; `pnpm payload-schemas:export` añade las nuevas y se niega a reescribir las publicadas. Ese fallo es el aviso de que hay que elegir peldaño. Un barrido que cierre de una vez los envíos obsoletos al desplegar la versión nueva es opcional.

## Considered Options

- **Migrar el JSON guardado al cambiar las tablas**: descartado, porque reescribe envíos congelados y revisiones, y cada migración tendría que entender todas las versiones antiguas.
- **Estados de versión escritos a mano (`current`/`superseded`/`retired`)**: descartado, porque se deducen de la versión más alta y de la existencia de un traductor.

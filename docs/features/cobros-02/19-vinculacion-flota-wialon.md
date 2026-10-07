# 19 · Vinculación de la flota con Wialon

**Estado:** 🔵 Script listo y probado en local · pendiente de correr en dev
**Script:** `apps/crm/apps/server/src/scripts/vincular-flota-wialon.ts`
**Relacionado:** [9 · Integración GPS / Wialon](./09-integracion-gps-wialon.md) (D-10, el vínculo en la Ficha 360)

---

## Qué es

Cada vehículo del CRM tiene que saber **qué unidad de Wialon (GPS de La Legión) es la suya**.
Sin ese vínculo la Ficha 360 no muestra ubicación, el job de eventos GPS no vigila el carro y
el apagado no sabe a qué unidad apuntar.

Hasta ahora el vínculo se hacía **de a uno**: la primera vez que alguien abría el GPS en la
ficha, se deducía por placa y se guardaba (D-10). Un carro cuya ficha nadie abrió seguía sin
vínculo, y los que solo se pueden encontrar por VIN no se encontraban nunca.

Este script hace la vinculación **para toda la flota de una vez**: cruza el catálogo completo
de Wialon contra todos los vehículos del CRM, por placa **y** por VIN, y deja escrito lo que
puede decidir con certeza. Lo que no, lo reporta con su motivo para revisión.

---

## Cómo se cruza

### La evidencia

| Del CRM | Contra Wialon | Ejemplo |
| --- | --- | --- |
| **Placa**: el núcleo de 3 dígitos + 3 letras | El **nombre** de la unidad y su campo `registration_plate` | `P0-123ABC` → `123ABC` coincide con `P-123ABC - CON APAGADO` |
| **VIN** (17 caracteres) | Cualquier VIN de 17 caracteres **dentro del nombre** y el campo `vin` de la unidad | Unidad llamada `1HGBH41JXMN109186 - SIN APAGADO` |

- **Por qué el VIN dentro del nombre:** cerca de 330 unidades se nombran por VIN porque el
  carro aún no tenía placa cuando se instaló el GPS. El campo `registration_plate` casi
  nunca viene lleno, así que el nombre es la fuente principal.
- **Normalización:** la placa ignora prefijo, guiones, espacios y el cero de más
  (`P0-`, `P - `). El VIN se pasa a mayúsculas, sin separadores, y `O→0`, `I→1`, `Q→0`
  (un VIN no usa esas letras: si aparecen es un error de tipeo). Un VIN tiene que traer al
  menos un dígito y una letra: `00000000000000000` o un texto de relleno no cuentan.
- **VIN en el campo de placa:** hay vehículos del CRM con el VIN cargado como placa (carros
  nuevos sin placa todavía). Si la placa tiene forma de VIN, se usa como VIN.

### El criterio: solo con certeza

El mismo criterio conservador de la ficha: **se vincula únicamente cuando la evidencia apunta
a exactamente una unidad y esa unidad no la reclama otro vehículo.** Elegir mal manda al gestor
de campo al carro equivocado, así que ante la duda no se vincula y decide una persona.

| Situación | Resultado |
| --- | --- |
| Placa y VIN apuntan a la **misma** unidad | Se vincula (`placa+vin`) |
| Solo una de las dos encuentra unidad, y es una sola | Se vincula (`placa` o `vin`) |
| Placa y VIN apuntan a unidades **distintas** | `conflicto_placa_vin`: una de las dos está mal escrita |
| Varias unidades coinciden | `ambiguo` |
| La unidad ya está guardada en otro vehículo | `unidad_ya_asignada`: no se toca |
| Ninguna unidad coincide | `sin_coincidencia` |
| El vehículo no tiene placa ni VIN válidos | `sin_placa_ni_vin` |

Las coincidencias **parciales** (VIN que difiere en 1–2 caracteres, placa con una letra o un
dígito distinto) **nunca se vinculan**. Salen como **sugerencia** en el CSV para que alguien
las confirme. Cruzar por "VIN parecido" a ciegas da falsos positivos: carros del mismo lote
tienen VIN casi iguales.

### Vehículos duplicados

Es común que el **mismo carro esté dos veces en el CRM**: una vez migrado de SIFCO y otra
creado de nuevo al refinanciarlo o revenderlo tras recuperarlo. Los dos reclaman la misma
unidad. Para decidir cuál se la queda se consulta el estado del crédito en cartera-back:

1. **Un solo vehículo con crédito vigente** (`ACTIVO`, `MOROSO`, `EN_RECUPERACION`,
   `EN_CONVENIO`, `PENDIENTE_CANCELACION`) → se queda ese.
2. **Varios vigentes con exactamente los mismos créditos vigentes** → el que tenga el
   prefijo de placa que trae la unidad (`C-…` contra `P-…`).
3. **Varios vigentes con créditos distintos** (refinanciamiento sin cerrar el crédito
   anterior) → **el crédito más nuevo**. Cuenta como distinto si uno tiene un crédito
   vigente que el otro no, aunque compartan otro; compartir un crédito viejo ya cancelado
   tampoco los hace el mismo. Un crédito originado en el CRM (`CRM-…`) siempre es
   más nuevo que uno migrado de SIFCO, porque la fecha de los migrados es la de la migración
   y no la del préstamo. Entre dos del mismo origen decide la fecha.
4. **Ninguno vigente** → el único con crédito, o el del crédito más nuevo (misma regla que
   el punto 3). Queda marcado
   **para confirmar** y no se escribe salvo que se pida (`--incluir-confirmar`).
5. Lo que siga empatado → `unidad_disputada`, revisión manual.

Un vehículo sin crédito nunca le gana a uno con crédito. **Si cartera-back no responde, no se
desempata nada**: las disputas quedan para revisión en vez de resolverse a ciegas.

---

## Qué se guarda

El vínculo va en las columnas de `vehicles` de la migración `0057`
(`wialon_unit_id`, `wialon_unit_name`, `wialon_vinculado_at`, `wialon_vinculado_por`).
El marcador de `wialon_vinculado_por` dice cómo se dedujo:

| Marcador | Cuándo | Qué hace la Ficha 360 con él |
| --- | --- | --- |
| `auto:placa` | La placa está en el nombre de la unidad **y** la ficha, al revalidar, elegiría esa misma unidad | Lo revalida en cada consulta contra el nombre actual en Wialon y lo suelta si dejó de valer (placa corregida, unidad renombrada o pasada a otro carro) |
| `auto:vin` | Se encontró por VIN | Lo trata como fijo (igual que uno manual): no lo revalida. Un supervisor lo corrige como cualquier otro |
| `auto:registro` | La placa solo aparece en el campo `registration_plate` | Igual que `auto:vin` |
| email del supervisor | Lo fijó una persona desde la ficha | No se revalida; esa decisión manda |

`auto:placa` solo se usa cuando la ficha llegaría a la misma conclusión: si no, la ficha lo
soltaría en la primera consulta y el trabajo se perdería.

Cada vínculo escrito deja su fila en la bitácora de entidades (`crm_entity_audit`, acción
`wialon_vincular`, origen `system`).

---

## Cómo se corre

Por defecto el script **solo lee**: no escribe nada en la base.

```bash
cd apps/crm/apps/server

# 1) Diagnóstico: resumen en consola + CSV para revisar
bun run src/scripts/vincular-flota-wialon.ts --salida=/tmp/diag-wialon

# 2) Escribir, una vez revisado el plan
bun run src/scripts/vincular-flota-wialon.ts --salida=/tmp/diag-wialon \
  --aplicar --confirmar-bd=<host de DATABASE_URL>
```

| Opción | Qué hace |
| --- | --- |
| `--salida=<carpeta>` | Dónde dejar los CSV (por defecto `diagnostico-wialon-<fecha>`) |
| `--solo-con-credito` | Reporta y escribe solo vehículos con un SIFCO en su oportunidad o contrato. El cruce se hace igual con toda la flota: una unidad guardada en un vehículo sin crédito sigue ocupada, y un duplicado sin crédito sigue contando en la disputa |
| `--aplicar` | Escribe los vínculos del plan |
| `--confirmar-bd=<host>` | Obligatorio con `--aplicar`: hay que teclear a propósito el host de la base a la que apunta `DATABASE_URL`. Evita escribir en la base equivocada por un `.env` olvidado |
| `--incluir-confirmar` | Incluye los desempates de duplicados sin crédito vigente |
| `--max=<n>` | Escribe solo los primeros `n` (tanda de prueba) |

### Antes de correrlo

- **cartera-back levantado y apuntando al schema correcto.** Sin él, las disputas entre
  duplicados no se resuelven. En COBROS-02 cartera-back usa el sandbox `cartera_cobros2`:
  hay que arrancarlo con `CARTERA_SCHEMA=cartera_cobros2` (ver
  [5 · Datos y ambientes](./05-datos-y-ambientes.md)). Si arranca sin la variable, apunta a
  `cartera` y falla buscando columnas que solo existen en el sandbox.
- **La base destino tiene que tener la `0057`.**
- El token de Wialon sale del `.env` del server, como el resto de la integración.

### Lo que deja

| Archivo | Contenido |
| --- | --- |
| `vehiculos.csv` | Un renglón por vehículo: estado, método, unidad, sugerencia, créditos y su estado |
| `unidades.csv` | Un renglón por unidad de Wialon: si quedó vinculada, propuesta, en revisión o sin vehículo |
| `plan.csv` | Lo que se escribiría (o se escribió) y lo excluido, con el motivo |
| `resultado.csv` | Solo con `--aplicar`: qué pasó con cada vínculo. Se agrega un renglón después de cada escritura |
| `reversa.sql` | Solo con `--aplicar`: deshace exactamente lo escrito. Se reescribe completo después de cada vínculo guardado: si el proceso se corta a la mitad, revierte todo lo que alcanzó a confirmarse |

### Garantías al escribir

- **Producción se rechaza siempre**, aunque se confirme el host.
- Cada vínculo va en su propia transacción, con el mismo **lock por unidad** que usa la ficha
  (`pg_advisory_xact_lock`): dos escrituras no pueden darle la misma unidad a dos vehículos.
- **No pisa nada:** si mientras corría alguien vinculó el vehículo, o la unidad ya está en
  otro, o la placa o el VIN cambiaron desde el diagnóstico, ese vínculo se omite y queda
  anotado en `resultado.csv` (`vehiculo_ya_vinculado`, `unidad_ocupada`, `datos_cambiaron`).
- Si se acumulan 5 errores, **se detiene**: si la base está caída no tiene sentido seguir.
- **Es idempotente:** una segunda corrida reconoce lo ya vinculado y no propone nada nuevo.
- **La reversa** solo suelta los vehículos que siguen con la misma unidad y el mismo
  marcador, así no deshace una corrección que un supervisor haya hecho después. Trae el
  conteo esperado: si el `UPDATE` afecta menos filas, alguien cambió esos vínculos.

---

## Resultados (7-oct-2026)

Cifras con el catálogo real de Wialon (1449 unidades visibles para el usuario de
integración). La corrida con escritura fue en una base **local** (copia del sandbox); en dev
aún no se ha corrido.

| | Vehículos |
| --- | --- |
| Ya vinculados desde la ficha antes de correrlo | 51 |
| Vinculados por el script, primera pasada (715 por placa, 221 por VIN) | 936 |
| Vinculados al resolver duplicados por crédito vigente | 13 |
| **Total vinculado en local** | **1000** |

En un cruce de solo lectura con datos más recientes, **1134 de las 1449 unidades** quedan
vinculables de forma automática, y cubren el 63 % de los créditos vigentes.

---

## Por qué no se vincula el resto

| Grupo | Aprox. | Causa | Qué haría falta |
| --- | --- | --- | --- |
| **En el CRM pero no en Wialon** | ~890 vehículos (~440 con crédito vigente) | El vehículo tiene placa o VIN válidos, pero ninguna unidad visible los trae. En la mayoría la placa coincide con la de la póliza de seguro de SIFCO, así que el dato del CRM está bien: la unidad no está en el catálogo (sin GPS de La Legión, o no asignada al usuario de integración) | Revisarlo con La Legión |
| **Vehículos de relleno** | ~325 vehículos (~195 vigentes) | La migración de SIFCO creó el crédito, casi siempre "sobre vehículo", con un vehículo sin placa ni VIN (marca y modelo `N/A`). No hay con qué buscarlo. Unos pocos registros de relleno están compartidos por créditos de clientes distintos | Traer placa y chasis desde SIFCO (garantía del préstamo, `WSCreditos/{id}/Garantias`). El dato no está en ninguna otra tabla del CRM. Los compartidos necesitan un vehículo propio por crédito |
| **En Wialon pero no en el CRM** | ~310 unidades | Unidades cuya placa o VIN no está en ningún vehículo del CRM. Probablemente buena parte son los vehículos de relleno de la fila anterior | Se resuelven solas al llenar la placa de los de relleno |
| Posible error de tipeo | ~9 | Placa o VIN a 1–2 caracteres de una unidad libre | Revisión manual (vienen como sugerencia en el CSV) |
| Duplicados sin crédito | ~10 | La unidad ya la tiene el duplicado vigente | Nada; conviene fusionar o marcar el duplicado |

**Hallazgo aparte (no es de GPS):** ~85 créditos migrados de SIFCO existen en el CRM y en
SIFCO, pero **no están cargados en cartera-back**. No impiden el vínculo (la cartera solo se
usa para desempatar duplicados), pero esos créditos no se están gestionando en cartera.

---

## Pendientes

1. Correr el script en **dev**: primero sin `--aplicar` para revisar el plan, y con el visto
   bueno del equipo, escribir. Guardar `reversa.sql`.
2. Traer placa y chasis de SIFCO para los vehículos de relleno y volver a correr el script.
3. Exigir placa o VIN al crear un vehículo en el CRM, para que no nazcan más vehículos de
   relleno.
4. Correrlo de forma periódica (por ejemplo, cada noche) para que las unidades nuevas de
   Wialon se vinculen solas sin esperar a que alguien abra la ficha.
5. Retirar `vincular-unidades-wialon.ts`, el script anterior que solo cruza por placa.

---

## Archivos

| Archivo | Qué tiene |
| --- | --- |
| `scripts/vincular-flota-wialon.ts` | El script: lee Wialon, el CRM y cartera-back, imprime el resumen, escribe CSV y, con `--aplicar`, los vínculos |
| `scripts/vincular-flota-wialon.logic.ts` | Lógica pura del cruce: evidencia, decisión, desempate de duplicados, sugerencias. Sin base ni red |
| `scripts/vincular-flota-wialon.plan.ts` | Lógica pura de la escritura: plan, marcadores, aplicación, protección de producción, reversa |
| `scripts/vincular-flota-wialon.logic.test.ts` | Tests del cruce y del desempate |
| `scripts/vincular-flota-wialon.plan.test.ts` | Tests del plan, la aplicación, la protección de producción y la reversa |

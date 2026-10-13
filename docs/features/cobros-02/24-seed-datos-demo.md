# 24 · Seed de datos de demo para presentar COBROS-02

**Estado al 2026-10-13:** Fases 1 y 2 hechas. Falta la Fase 3, el seed de gestiones.
**Para qué:** que el sandbox tenga datos creíbles para mostrar el diseño del Figma al PM: la
cartera real de producción, el CRM real y 90 días de gestiones sembradas que tengan sentido.

---

## Decisiones (Daniel, 2026-10-13)

| Tema | Decisión |
| --- | --- |
| Créditos | **Todos** se quedan, en cartera y en el CRM. No se borra ninguno |
| Quién lleva gestiones sembradas | **Solo los créditos cuyo `numero_credito_sifco` empieza con `CRM-`** (~707 vivos). Los viejos, con número de SIFCO, no llevan gestiones |
| `casos_cobros` | **No se usa para elegir.** Tenga o no caso, el crédito `CRM-` lleva gestiones. Si no tiene caso, el seed lo crea solo porque las tablas de gestiones lo exigen (FK `caso_cobro_id NOT NULL`), con la misma regla con la que la app lo crea al abrir la Ficha (`getDetallesCreditoCarteraBack`). Lo temporal era `casos_cobros.responsable_cobros`, que ya se eliminó (0066/0067) |
| CRM de DEV | Se **pisa `public`** con la copia de producción. Esa base solo se usa para pruebas |
| Ventana | **90 días** de historia. Si se complica, 60 |
| Convenios | Se crean por el **endpoint real**, para que existan solicitudes pendientes en la bandeja del supervisor (ver Fase 3) |

El flujo de convenios **ya existe** y no hay que implementarlo:
1. El asesor crea el convenio desde la Ficha o el Workspace con `crearConvenioDesdeFicha`. Solo se permite desde B2.
2. Cartera lo crea con `activo=false`, es decir, pendiente de aprobación.
3. El CRM avisa a los supervisores (`convenio_pendiente_aprobacion`).
4. El supervisor lo ve en `/cobros/solicitudes` y lo aprueba o lo rechaza con `decidirConvenio`.

Los convenios creados desde carteraFront siguen el mismo camino.

---

## Fase 1 · Cartera desde producción (hecha)

Corrida con `alinear_desde_prod.sh` (ver el [runbook](./RUNBOOK-refrescar-sandbox.md)). Se
lanzó con `--sin-swap`, se revisó el resultado y después se hizo el swap a mano (es el mismo
rename del paso 7). Al final se reinició `Cartera-Api-Cobros`.

- 2,036 créditos y 134,341 pagos. La última mora es del 2026-10-13. Entraron 121 créditos nuevos.
- Motor: 12 subidas, **1,062 bajadas** y 1,041 reasignados. El sandbox llevaba un mes sin pagos
  de producción, y el motor diario había subido a B1 créditos que en realidad ya habían pagado.
- Reparto final:

  | Bucket | Asesor(es) | Créditos |
  | --- | --- | --- |
  | B0 | Caren / Wilson | 532 / 532 |
  | B1 | Octavio | 292 |
  | B2 | Jorge / Samuel | 77 / 76 |
  | B3 | Jorge / Samuel | 31 / 30 |
  | B4 | Erik | 26 |
  | B5 | Gerencia | 215 |

  No quedó ningún crédito con un asesor fuera del pool de su bucket.
- Backup del sandbox anterior: `cartera_cobros2_bk_20261013_1512`.

**Correos de asesores.** Samuel Gamboa (id 10 en producción, `yoaner.b@`) y Octavio Rosales
(id 6, `cobros@`) tienen en producción un correo distinto al del pool del sandbox (`samuel.g@` y
`octavio.r@`), y el mapa por correo abortaba. Se agregó `--correcciones`, que toma
`correcciones_asesores.csv` y corrige **solo la copia**, validando id y nombre. En producción el
CRM y cartera usan el mismo correo entre sí. **Antes del pase hay que decidir cuáles son los
correos reales y usar los mismos en el pool, en cartera y en el CRM.**

**Trampa:** el motor no carga desde un worktree con `node_modules` por symlink, porque bun
resuelve desde `~/.bun/install/cache` y falla con `date-fns` y `@smithy`. Hay que correrlo desde
la carpeta principal del repo.

---

## Fase 2 · CRM de producción en `public` de DEV (hecha)

Se hizo a mano. Cuando se repita, conviene scriptearlo.

1. **Respaldo del `public` viejo:** `~/Escritorio/respaldos-dev/crm_dev_public_antes_20261013.dump`.
2. **Detener «CRM API Cobros»** en Coolify (`tgmt4r4n8pjjqpi7rjqf5lfb`).
3. **Dump de producción:** `pg_dump -n public -Fc` del CRM de producción (Neon `ep-winter-butterfly`,
   solo lectura), sin los datos de `session`, `verification`, `otps` y `notifications`.
4. **Borrar los objetos del CRM en `public`** en una transacción: tablas, vistas, secuencias, funciones
   y tipos. **Nunca `DROP SCHEMA public`:** ahí viven `estado_liquidacion`,
   `payment_validation_status` y `tipo_cuenta_enum`, que usan 102 columnas de `cartera*`. Los
   objetos de extensiones (`pgcrypto`) tampoco se tocan.
5. **`pg_restore` por la conexión DIRECTA**, nunca por el pooler. Del TOC se excluyen
   `SCHEMA public`, su comentario y esos 3 enums, porque el dump de producción también los trae.
   La FK `notification_documents → notifications` falla porque no se copiaron las notificaciones:
   se vacía `notification_documents` y se crea la FK.
6. **Las 65 migraciones CRM propias de COBROS-02**, las que no están en `main`, en orden `LC_ALL=C`.
   Cada una va en su propia transacción, salvo `0033b`, que lleva `CONCURRENTLY`. **Pasaron todas
   sobre datos reales: sirve como ensayo del pase.**
7. **Usuarios:**
   - Asesores, supervisores y `daniel.r` entran con la contraseña de DEV `CobrosDev2026!`.
   - En el CRM de DEV, Octavio y Samuel pasaron a `octavio.r@` y `samuel.g@`, para que coincidan con
     el sandbox. Conservan su historial real.
8. **Levantar la API y probarla:** login de Octavio, `getBucketsCatalogo`, `getMiAgendaHoy` y
   `getColaDia`, que devolvió sus 85 créditos.

Resultado: 10,117 leads, 1,633 casos y 23,680 contactos.

### Lo que también vive en `public` de DEV (no volver a perderlo)

| Qué | Dueño | Qué pasó |
| --- | --- | --- |
| `nexa_payment_tokens`, `nexa_payment_transactions`, `nexa_poll_runs`, `nexa_reviews`, `nexa_token_users`, `nexa_token_user_reservations`, `mock_cartera_credits`, más 3 enums y una secuencia `nexa_*` | **Nexa Server Dev** usa esta misma base | Se borraron con el resto, se restauraron del respaldo con datos y se reinició Nexa Server Dev |
| `opportunity_agency_sellers`, `opportunity_close_quotations`, `insurance_invoice_submissions`, `buro_interno_fuentes_cartera`, `vehicle_vendors.company_id`, `partner_members.seller_id`, `buro_interno_personas.origen` | Ramas del tracker y del buró que otros devs prueban en DEV | Se restauró la estructura. Sus filas de prueba se perdieron porque apuntaban a oportunidades que ya no existen |

**La próxima vez:** antes de pisar `public`, comparar la estructura del respaldo contra la nueva
(restaurar el respaldo solo con estructura en una base temporal y comparar
`information_schema.columns` y `pg_enum`). Después volver a poner lo que no es del CRM de
producción.

### Lo que hallamos en los datos

- En el CRM de producción, los ~16,500 contactos de los últimos 90 días son casi todos «WhatsApp ·
  contactado», es decir, envíos. **Llamadas, promesas, visitas y recuperaciones reales casi no hay.**
  Eso es lo que siembra la Fase 3.
- Créditos en el sandbox: 739 `CRM-` (707 vivos) y 1,176 viejos (1,078 vivos). En B4/B5 la mayoría son viejos.

---

## Fase 3 · Seed de gestiones (pendiente)

### Reglas duras

- **Solo DEV:** el script se niega a correr si el host no es `ep-green-tree`, o si es `supabase.com` o `ep-winter-butterfly`.
- **Solo inserta.** Nunca llama a funciones que envíen WhatsApp, SMS o correos. Además, la API del
  sandbox tiene `TEST_MESSAGE=true`.
- **Marcado:** cada fila sembrada queda registrada (tabla `seed_demo_filas(tabla, pk, corrida)` o
  equivalente), y `--limpiar` borra exactamente eso.
- **Reproducible:** RNG con semilla fija.
- **Primero `--dry-run`**, que muestra conteos por tabla.
- **Orden:** después de cada alineación de cartera, porque la alineación no conserva los convenios
  creados en el sandbox.

### Alcance y coherencia

- **Créditos:** `cartera_cobros2.creditos` con `numero_credito_sifco LIKE 'CRM-%'` y estado vivo (no
  `CANCELADO`). El caso del CRM se crea solo si falta (ver Decisiones).
- **Fechas:** últimos 90 días, en horario hábil de Guatemala.
- **Asesor de cada gestión:** el dueño del crédito en esa fecha, según `credito_asesor_historial`. El
  usuario del CRM sale de `asesores.email_cash_in = user.email`.
- **Promesas:** si después de la fecha prometida hubo un pago real en cartera, la promesa queda
  cumplida; si no, incumplida. El estado no se escribe a mano: lo calcula `getEstadoPromesasPago`.
- **Vida del crédito:** reconstruir `buckets_historial` antes del 2026-09-09 a partir de los pagos
  reales (cuándo se atrasó y cuándo se puso al día), marcado como seed.

### Qué se siembra por bucket

| Bucket | Gestiones |
| --- | --- |
| B0 | `recordatorios_premora` y algún WhatsApp en `contactos_cobros` |
| B1 | Llamadas (contesta, no contesta, número equivocado), WhatsApp y promesas (`contactos_cobros` con `estado_contacto='promesa_pago'`, `cuota_inicio`/`cuota_fin`, `monto_comprometido`, `fecha_proximo_contacto`) |
| B2–B3 | Lo de B1, más: `visitas_cobros` de residencia y trabajo (programadas y realizadas, con resultado), `contactos_referencias_cobros`, `investigaciones_redes_cobros`, llamada del supervisor en B3, `recuperaciones_vehiculo` con `estado_solicitud` pendiente o aprobada y su `checklist`, e `inmovilizaciones_unidad` |
| B4 | Recuperación con el checklist completo; GPS (`vehicles.wialon_*`, `gps_ubicaciones_clave`, `gps_eventos`, `gps_estancias`); apagado y reactivación |
| B5 | Historia completa y `solicitudes_juridico_cobros` |

**Supervisión:**
- `cierre_diario_credito_cobros` y `agenda_cobros_snapshots` de los últimos 30 días. Se pueden
  sembrar o generar con `generarCierreDiario()`.
- `metas_asesor_cobros` del mes, con el `asesor_id` de cartera.
- Una cobertura por vacaciones en `coberturas_agenda_cobros`.
- `notifications` con `cobros_tipo`: promesa incumplida, sin contacto 3 días, etc.

**Convenios por el endpoint real:**
- Unos 8–10 créditos `CRM-` de B2/B3 con convenio **pendiente**, para que la bandeja tenga solicitudes.
- Algunos **aprobados** y algunos **rechazados** con `decidirConvenio`, para el historial de decisiones.

**Créditos "estrella":** 6, uno por bucket, con la historia más completa y un guion corto para la
presentación.

### Límites conocidos

- La **ubicación en vivo** del GPS llama a Wialon de verdad (`WIALON_TOKEN`) y no tiene modo de
  prueba. Se ven las ubicaciones y los eventos sembrados; la tarjeta en vivo solo funciona con
  unidades reales vinculadas.
- **Rebaja de mora, jurídico y contrapropuesta** tienen backend, pero la web todavía no los muestra
  (solo cuentan en los KPIs del supervisor). Sembrar poco de eso.
- Las fotos de visitas y de redes (`r2_key`) necesitan archivos en R2. Usar unas pocas imágenes de
  ejemplo subidas una sola vez, o no poner evidencias.

### Implementación sugerida

Script TypeScript en `apps/crm/apps/server/src/scripts/seed-demo-cobros02.ts`, con una sola conexión
directa, porque `public` y `cartera_cobros2` están en la misma base de DEV.

Pasos: `--dry-run` → casos que falten → vida del crédito → gestiones por bucket → supervisión →
convenios por la API → verificación pantalla por pantalla (dashboard del asesor y del supervisor,
Cartera general, Ficha 360, Workspace, Mi equipo y Solicitudes).

El inventario completo de tablas, columnas obligatorias, enums y FKs está en el reporte del 2026-10-13.
Las fuentes son `src/db/schema/cobros.ts`, las migraciones 0025–0082 y `drizzle/cobros-02/`.

---

## Pendientes y avisos

- **Correos de Octavio y Samuel** para el pase (ver Fase 1).
- El `.env` local de cartera-back de Daniel tiene `SUPABASE_DB_URL` apuntando a Neon DEV (schema
  `cartera`). La de producción está comentada en la línea 33.
- `Cartera-Api-Cobros` avisa `CRM_SERVICE_USER_ID no configurado`, así que en el sandbox las rebajas
  de mora aprobadas desde el CRM devuelven 403.
- `RECIBO_PAGO_WHATSAPP_ENABLED=true` en `Cartera-Api-Cobros`, para que el sandbox siga mandando
  recibos a los teléfonos de prueba.

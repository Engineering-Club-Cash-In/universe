# 13 · Dashboard del asesor y Mi Cartera: lo que falta de backend

> **Para:** José (backend).
>
> **Contexto:** el front del rediseño (Figma «CRM Ventas» › Asesor Junior / Senior) ya está hecho y conectado. Lo que todavía no tiene dato llega como `null` y la pantalla muestra "—" o "pronto". **No hay que tocar el front:** en cada tarea se dice qué procedimiento llenar y con qué forma. En cuanto devuelva datos, la card se pinta sola.
>
> **PR:** #1861 (mergeado en `COBROS-02` el 2026-10-06).
>
> **Seguimiento:** issue #1862, asignado a José. Lo que se hizo en el front está en [14-rediseno-dashboard-asesor.md](./14-rediseno-dashboard-asesor.md).

## Las pantallas

| Pantalla | Ruta | Para quién |
| --- | --- | --- |
| **Dashboard del asesor** | `/cobros` | Rol `cobros`. Supervisor y admin siguen viendo el dashboard anterior hasta que se haga su rediseño. Reemplaza a `/cobros/mi-dia`, que ahora redirige. |
| **Mi Cartera** | `/cobros/cartera` | Asesor (su cartera) y supervisor/admin (toda la cartera). Es la tabla completa con todos los filtros que antes estaban en el dashboard. |

**Junior y senior** usan la misma pantalla. Se distinguen por los buckets de su pool en cartera, no por el rol: junior = B0–B1, senior = B2–B4. Ver `getMiPerfilCobros`.

## Cómo está conectado

```
cartera-back  ──(endpoint nuevo, tarea Bn)──▶  server CRM: procedimiento ORPC (stub con TODO(José))  ──▶  front: card/columna
```

Cada stub está marcado en el código con `// TODO(José) · tarea Bn`:

```bash
git grep -n "TODO(José)" -- apps/crm
```

## Lo que YA se hizo en el server del CRM (no hace falta repetirlo)

- **Cartera forzada por sesión.** `getTodosLosCreditos` y `getCobrosDashboardStats` ignoran el `emailCobrador` que manda el front cuando el usuario es asesor. Antes un asesor que lo omitía veía toda la cartera. `getResumenPromesas` y el contador "Contactos hoy" ahora cuentan solo lo del asesor.
- **`getTodosLosCreditos` trae campos nuevos:**
  - `bucketNumero/Prefijo/Nombre` (bucket del motor)
  - `deudaVencida` (aproximada, ver B4)
  - `seguimiento` (intentos sin contacto, último intento, contactado/intentado hoy, próxima llamada)
  - `estadoGestion` y `accionPendiente`
- **`getTodosLosCreditos` acepta filtros nuevos:** `numerosSifco[]`, `filtroGestion` (sin gestión +48h, sin contactar hoy, promesas por vencer, convenios pendientes) y búsqueda por **DPI** (13 dígitos).
- **`getColaDia`:** devuelve lo mismo por ítem, más `conteosExtra` (`llamada_hoy`, `sin_intento_hoy`) y `filtroExtra`. **No cambia** qué entra a la cola ni su orden.
- **Procedimientos nuevos** (`apps/crm/apps/server/src/routers/cobros-asesor.ts`):
  - `getMiPerfilCobros`
  - `getMiDesempeno` (contactabilidad, promesas cumplidas, movimiento)
  - `getMiAgendaContadoresPendientes` (stubs)
- **Lógica pura con pruebas:** `lib/seguimiento-cobros.ts` (+ `.test.ts`) y `lib/desempeno-asesor.ts` (+ `.test.ts`).

---

## Tareas

### B2 · Recuperación del asesor por período

- **Para qué:** el KPI **"Recuperación del día / semana / mes"** de *Mi desempeño*, el primero de la fila en Figma: `Q18.5K / Q20K`, barra, "92% de la meta diaria" y ▲ +4.2%. Es el objetivo central del rol.
- **Dónde llenarlo:** `getMiDesempeno` en `apps/crm/apps/server/src/routers/cobros-asesor.ts`, variable `recuperacion`.
- **Contrato** (`RecuperacionAsesor`, mismo archivo):
  ```ts
  { monto: number;              // Q recuperados en el período actual
    montoAnterior: number|null; // Q del mismo tramo del período anterior (tendencia)
    meta: number|null }         // meta del período en Q (tarea B3); null si no hay
  ```
  Si no hay datos, se devuelve `null` y el front muestra "—".
- **Rangos:** ya calculados en `lib/desempeno-asesor.ts` (`rangosDesempeno`): día = hoy contra ayer, semana = lunes a hoy contra el mismo tramo de la semana anterior, mes = día 1 a hoy contra el mismo tramo del mes anterior, todo en hora GT. `getMiDesempeno` ya los tiene en `actual` y `anterior`.
- **Qué hay hoy en cartera-back:** `/reportes/mora-recuperacion-por-asesor` y `/reportes/mora-cobrada-por-asesor`. Son solo mensuales (período del 6 al 6) y en el CRM solo para supervisor (`getMoraRecuperacionPorAsesor`, `getMoraCobradaPorAsesor`).
- **Qué hace falta:**
  1. Definir con negocio qué es "recuperación": ¿mora cobrada?, ¿cuotas vencidas cobradas?, ¿todo lo pagado de créditos en mora?
  2. Un endpoint en cartera-back que acepte `asesor_id` + `fecha_desde`/`fecha_hasta`.
  3. Llamarlo dos veces (actual y anterior) desde `getMiDesempeno`. El asesor se resuelve como en `getMiPerfilCobros` (`email_cash_in` del pool == correo de la sesión).

### B3 · Metas por asesor (en quetzales)

- **Para qué:** la meta del KPI de recuperación (`/ Q20K`, % de la meta).
- **Qué hay hoy:** `metas_mora_cobros`, que son porcentajes globales por mes. No hay metas por asesor.
- **Qué hace falta:**
  - Una tabla `metas_asesor_cobros` (asesor, año, mes, monto en Q; opcional: meta de promesas y de contactabilidad).
  - Un upsert para supervisor; puede ir en la pantalla "Metas de Mora" que ya existe.
  - Devolver `meta` en `recuperacion`. Para día y semana, la meta mensual prorrateada por días hábiles; definir con negocio.

### B4 · Deuda vencida real por crédito

- **Para qué:** la columna **"Deuda vencida"** de las dos tablas.
- **Hoy:** el server del CRM la aproxima como `cuotasVencidas × cuota + mora` y manda `deudaVencidaAproximada: true`. No descuenta abonos parciales.
- **Dónde:** `getTodosLosCreditos` en `apps/crm/apps/server/src/routers/cobros.ts`, buscar `TODO(José): reemplazar por \`monto_vencido\``.
- **Qué hace falta:** que `/getAllCredits` de cartera-back devuelva `monto_vencido` (saldo real de las cuotas atrasadas más la mora) y mapearlo ahí. Después, borrar `deudaVencidaAproximada`.

### B5 · Orden y filtro por bucket del motor en `/getAllCredits`

- **Para qué:** el orden de **Mi Cartera** que pide Figma (bucket → prioridad de la acción → días de mora → saldo) y que los chips de bucket cuadren con la tabla.
- **Hoy:**
  - `/getAllCredits` ordena por `fecha_creacion DESC` y pagina en el server, así que el front solo puede ordenar la página actual. Lo dice en la interfaz.
  - El filtro `estadoMora` y los conteos de `/stats` agrupan por **cuotas atrasadas**, no por el bucket del motor. Un crédito en recuperación o en convenio puede caer en otro chip.
- **✅ Filtro por bucket del motor: hecho el 2026-10-07** (directo en COBROS-02, a pedido del usuario):
  - `/getAllCredits` (GET y POST) acepta `buckets` (bucket del motor, 0–5), el mismo filtro de `/buckets/creditos`. Con él, cartera-back ignora `estado` y usa todo el funnel.
  - `getTodosLosCreditos` y `enviarWhatsappMasivoCobros` aceptan `buckets`. El chip y la etapa de bucket de la cartera mandan `buckets` en lugar de `estadoMora`.
  - Los conteos de los chips salen de `getTodosLosCreditos({buckets:[n], limit:1})`, con el mismo criterio que el filtro.
- **Qué falta:**
  - En `/getAllCredits`, un parámetro `orden`: bucket del motor desc, después `diasAtrasoMoraMaximo` desc, después saldo.
  - Opcional: que `/stats` agrupe por bucket del motor. Así los chips se contarían en una sola llamada y no en seis.

### B6 · "Pagos por confirmar"

- **Para qué:** el contador **"Pagos por confirmar"** de la *Agenda de hoy* y la acción pendiente **"Confirmar pago · recibido hoy"** de la tabla.
- **Dónde:**
  - Contador: `getMiAgendaContadoresPendientes` en `cobros-asesor.ts`, variable `pagosPorConfirmar` (`number | null`).
  - Acción por crédito: `accionPendienteDe` en `apps/crm/apps/server/src/lib/seguimiento-cobros.ts`. El tipo `confirmar_pago` ya existe y el front ya lo dibuja; falta un flag por crédito que lo dispare.
- **Qué hace falta:**
  1. **Definir con negocio** qué es un pago por confirmar. Candidatos: `cartera.pagos_credito.validation_status = 'pending'`, boletas del bot en `revision_manual` o `confirmada_a_verificar`, o promesa que vence hoy con pago reportado.
  2. Un conteo por asesor.
  3. Un flag `pagoPorConfirmar` por crédito, pasado a `accionPendienteDe` (agregarlo a `extras`).

### B7 · "Referencias por contactar"

- **Para qué:** el contador **"Referencias por contactar"** de la *Agenda de hoy*.
- **Dónde:** `getMiAgendaContadoresPendientes`, variable `referenciasPorContactar`.
- **Qué hace falta:** definir la regla (por ejemplo: N intentos fallidos al titular y referencias sin gestión en X días) y contarlo por asesor sobre las tablas de `referencias-cobros` más `contactos_cobros`.

### B8 · Hora del próximo contacto

- **Para qué:** "Llamar · **hoy 3:00 PM**" en la columna *Acción pendiente*.
- **Hoy:** `contactos_cobros.fecha_proximo_contacto` se guarda como día (medianoche GT, ver `components/contacto-modal.tsx`). El front muestra "Llamar · hoy" sin hora.
- **Qué hace falta:**
  - Guardar la hora: una columna `hora_proximo_contacto` o un timestamp real para los contactos que no son promesa. Las promesas siguen por día.
  - Agregar el selector de hora en el modal de contacto.
  - En `resumirSeguimiento` (`lib/seguimiento-cobros.ts`), devolver la fecha con hora en `proximaLlamadaEn`. El front formatea la hora si viene distinta de medianoche.

### B9 · Movimiento de buckets del día en vivo

- **Para qué:** el KPI **"Movimiento"** (↓ bajaron / ↑ subieron) con el período "Día".
- **Hoy:** sale de `cierre_diario_credito_cobros`, que llena el job de las 22:00, así que el día en curso aparece en 0 hasta la noche. `getMiDesempeno` devuelve `movimiento.incluyeHoy: false` y el front lo aclara con un tooltip.
- **Qué hace falta:** para el día actual, leer de `buckets_historial` en cartera-back los movimientos de hoy de los créditos del asesor, sumarlos al cierre y poner `incluyeHoy: true`.

### B10 · ¿B0 entra a "Casos que requieren atención hoy"?

- **Decisión de negocio, no de código.** La cola (`getColaDia`) usa el universo SLA de cartera-back, que **excluye B0** porque no tiene SLA. Un asesor junior (B0–B1) no ve en "atención hoy" un B0 con cuota que vence hoy o con promesa hoy. En **Mi Cartera** sí aparecen.
- **Si negocio quiere B0 ahí:** agregar a `getColaDia` los créditos B0 con `venceHoy` o promesa de hoy (sin SLA). Cuidado: la misma cola la usa el supervisor en `/cobros/cola`.

---

## Archivos clave

| Qué | Dónde |
| --- | --- |
| Procedimientos del asesor (stubs B2, B3, B6, B7) | `apps/crm/apps/server/src/routers/cobros-asesor.ts` |
| Cartera con seguimiento, filtros y deuda vencida (B4, B5) | `getTodosLosCreditos` en `apps/crm/apps/server/src/routers/cobros.ts` |
| Cola del día con seguimiento | `getColaDia` en el mismo archivo |
| Seguimiento, estado de gestión y acción pendiente (B6, B8) | `apps/crm/apps/server/src/lib/seguimiento-cobros.ts` |
| Rangos Día/Semana/Mes | `apps/crm/apps/server/src/lib/desempeno-asesor.ts` |
| Front del Dashboard | `apps/crm/apps/web/src/components/cobros/asesor/` (`dashboard-asesor*.tsx`) |
| Front de Mi Cartera | `apps/crm/apps/web/src/components/cobros/asesor/` (`mi-cartera*.tsx`) y `routes/cobros/cartera.tsx` |
| Fila compartida (columnas de Figma) | `apps/crm/apps/web/src/components/cobros/asesor/fila-cartera.tsx` |

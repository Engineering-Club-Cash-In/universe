# Plazo del inversionista (EN STANDBY)

> **Estado: pausado por decisión de negocio (2026-07-14).** Este doc es el handoff
> completo para retomarlo. Todo lo descrito está commiteado en la rama
> `INV-PLAZOS-OPCIONES` y probado end-to-end contra una copia de prod en local.
> **Ninguna migración está aplicada en dev ni en prod.**

## Qué es

Los inversionistas pueden definir **en cuántos meses sacan su inversión**
(`plazo_inversionista`, entero en meses), independiente del plazo de los
créditos donde está metido su capital. Hoy el abono a capital que recibe en
cada liquidación sale del ritmo del crédito (cuota del crédito − interés −
IVA − cargos), que suele ser mucho menor a lo que su plazo requiere.

Hay **dos variantes**, seleccionables por compra con el flag
`usar_plazo_en_candidatos`:

| | Variante 1 | Variante 2 |
|---|---|---|
| Flag | `true` / ausente | `false` |
| Compra | El plazo **filtra los créditos candidatos** (escalada por rondas de cuotas pendientes) | Flujo normal por score ("no importa el crédito") |
| Liquidación | Normal | El capital amortiza como **cuota nivelada francesa** sobre SU monto y SU plazo; la parte que el crédito no cubre la comprará CUBE |
| Guardado del plazo | Siempre (espejo + compras) | Siempre (espejo + compras) |

## Lo que YA está hecho

### Migraciones (en `drizzle/`, se aplican A MANO, pendientes en dev/prod)

1. **`0019_add_plazo_inversionista.sql`** — `plazo_inversionista integer` (nullable)
   en `cartera.creditos_inversionistas_espejo` y
   `cartera.compras_credito_inversionista`. NULL = usa el plazo del crédito.
2. **`0020_add_diferencia_amortizacion_plazo.sql`** —
   `diferencia_amortizacion_plazo numeric(18,2)` en
   `cartera.pagos_credito_inversionistas_espejo`.
3. **`0021_add_plazo_inversionista_restante.sql`** —
   `plazo_inversionista_restante integer` en el espejo (+ backfill
   `= plazo_inversionista`). Es el contador de meses que FALTAN.

### Front (`carteraFront` → modal Compra de Cartera en `tableInvestors.tsx`)

- Campo opcional **"Plazo del inversionista (meses)"** (modo normal y manual).
- Switch **"Usar plazo para elegir créditos"** (visible solo con plazo, default
  encendido = variante 1). Payload: `plazo_inversionista` +
  `usar_plazo_en_candidatos` en `agregarInversionistaCreditoService`.

### Backend — compra (`controllers/addInvestorToCredit.ts`)

- `plazo_inversionista` y `usar_plazo_en_candidatos` entran por zod + Elysia.
- El plazo **siempre se persiste** en espejo y compras. En el nuke & rebuild
  del espejo se preserva el plazo (y el restante) de los DEMÁS inversionistas
  vía mapas `plazoActualPorInv` / `plazoRestanteActualPorInv` (mismo patrón que
  `tipo_reinversion`).
- `plazo_inversionista_restante` arranca = plazo al comprar; si el target ya
  tenía plazo corriendo y la compra trae plazo nuevo, el contador se REINICIA;
  sin plazo en el request, preserva lo que llevaba.
- **Escalada por rondas** (variante 1, solo modo automático): llena primero
  créditos con cuotas pendientes == plazo; si el CUBE disponible (monto de CUBE
  en el padre) no cubre el monto, escala a plazo+1, +2… hasta cubrirlo o agotar
  la cartera elegible; si no alcanza → compra PARCIAL como siempre. Un crédito
  que cumple el plazo SIEMPRE se llena antes que uno de plazo mayor. La
  respuesta incluye `escalada_plazo` (rondas, capacidad CUBE acumulada).
- ⚠️ **SIMULACIÓN**: el filtro por plazo del GET de candidatos se simula EN
  MEMORIA con `total_cuotas - cuotas_pagadas` (bloque marcado en el código).
  El filtro real ya existe en `assign-capital` (PR #1092, mergeado en esta
  rama): al retomar, reemplazar `rondaPorPlazo` por la llamada real por ronda
  (ojo: el GET es caro, ~10 queries por llamada; evaluar si conviene seguir
  filtrando en memoria).

### Backend — liquidación (`controllers/payments.ts`, variante 2 paso 1)

En `insertPagosCreditoInversionistas` (lo llama `calcularYRegistrarPagosEspejo`
/ `POST /calcularPagosEspejo`), después del `abono_capital` final: si el espejo
tiene plazo, se calcula y guarda en el pago espejo:

```
r     = porcentaje_interes × 1.12 / 100        (tasa del deudor con IVA)
n     = plazo_inversionista_restante           (fallback: plazo_inversionista)
cuota = monto × r × (1+r)^n / ((1+r)^n − 1)    (cuota nivelada francesa)
amortizacion_real = cuota − monto × r          (cuota − interés+IVA del mes)

diferencia_amortizacion_plazo = amortizacion_real − abono_capital   (clamp a 0)
```

- `monto` = `montoBaseCalculo` (monto del espejo neto de compras pendientes).
- Misma matemática que la calculadora de inversión (`apps/investment-calculator`,
  modelo Tradicional). El % de participación NO entra: reparte interés, no capital.
- NULL cuando no hay plazo, es CUBE, monto 0 o restante < 1. Tasa 0 → lineal
  (`monto / n`).
- **Solo se registra**: no toca `monto_aportado` ni ejecuta compra alguna.

### Números de verificación (copia de prod en local)

- Compra Q150k plazo 6 (variante 1): escaló rondas 18→27→28→32, paró al cubrir
  el monto, llenó en orden de rondas y el último crédito tomó solo el remanente.
- Liquidación (monto 37,976.54, tasa 1.5%, plazo 12, restante 12):
  amort. real 2,882.84 − abono 425.31 = **2,457.53** ✓
- Mismo caso con restante 5: amort. real 7,344.36 − 425.31 = **6,919.05** ✓
- Créditos sin plazo → NULL; compra nueva con plazo 18 → espejo 18/18;
  compra sin plazo NO borra plazos ajenos (rebuild preserva).

## Lo que FALTA (al retomar)

1. **La resta en cada liquidación** (variante 2, paso 2 — todo junto):
   a. restar `diferencia_amortizacion_plazo` del `monto_aportado` del espejo,
   b. decrementar `plazo_inversionista_restante` en 1,
   c. **compra de CUBE** de esa porción (CUBE absorbe el capital que el crédito
      no amortizó — definir el mecanismo: ¿compra_cartera interna? ¿ajuste
      directo padre/espejo?).
   Con (saldo nuevo, restante nuevo), la cuota nivelada recalculada sigue la
   curva francesa exacta y cierra en 0 justo al mes n — la fórmula ya lo
   garantiza, por eso el cálculo usa el restante desde ya.
2. **Integrar el GET real** de candidatos con plazo (quitar el bloque
   ⚠️ SIMULACIÓN de `addInvestorToCredit.ts`).
3. **Aplicar migraciones 0019–0021** en dev y prod (a mano, como siempre).
4. Decidir si `insertPagosCreditoInversionistasV2` (flujo alterno de pagos
   espejo) también necesita el cálculo — hoy solo está en V1.
5. UI/reportes que consuman `diferencia_amortizacion_plazo` (visibilidad para
   operaciones antes de activar la resta).

## Decisiones de negocio ya tomadas

- Escalada **por rondas** (no re-rank global por score).
- Escalar **hasta agotar candidatos** (sin tope fijo).
- Si no se llena el monto → **compra parcial** (comportamiento actual).
- El GET de candidatos filtra cuotas pendientes **== plazo exacto** (por eso
  las rondas acumulan de plazo en plazo).
- Créditos con MENOS cuotas pendientes que el plazo quedan **excluidos** de la
  variante 1 (se arranca en el plazo exacto y se escala solo hacia arriba).
- Plazo nuevo en una compra **reinicia** el contador restante del inversionista
  en ese crédito.

## Cómo probar (entorno local)

Copia de prod en local (prod NUNCA se toca, solo `pg_dump` de lectura):

```bash
# 1. Dump de prod (Supabase, cadena comentada en apps/cartera-back/.env)
pg_dump "$SUPABASE_PROD_URL" -Fc --no-owner --no-privileges \
  --schema=cartera --schema=public --schema=drizzle \
  --schema='"auth-google"' --schema=docuseal -f ~/dumps/cartera-prod.dump

# 2. Restore local (contenedor cartera-postgres, puerto 5433, postgres/local)
docker start cartera-postgres
psql -h localhost -p 5433 -U postgres -d postgres \
  -c 'DROP DATABASE IF EXISTS cartera WITH (FORCE);' -c 'CREATE DATABASE cartera;'
pg_restore -h localhost -p 5433 -U postgres -d cartera \
  --no-owner --no-privileges -j 4 ~/dumps/cartera-prod.dump

# 3. Migraciones locales
psql ... -f drizzle/0019_add_plazo_inversionista.sql
psql ... -f drizzle/0020_add_diferencia_amortizacion_plazo.sql
psql ... -f drizzle/0021_add_plazo_inversionista_restante.sql

# 4. Backend contra local SIN mandar correos reales
RESEND_API_KEY=key_invalida bun run src/index.ts
```

El `.env` de cartera-back ya apunta a `localhost:5433/cartera`. Endpoints de
prueba: `POST /agregar-inversionista-credito` (compra, con
`plazo_inversionista` / `usar_plazo_en_candidatos`) y
`POST /calcularPagosEspejo` (genera pagos espejo; requiere JWT del `.env`).

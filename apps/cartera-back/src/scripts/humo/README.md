# Humo de rubros contra una copia de producción

Estos scripts corren los flujos **reales** del motor de pagos contra una copia
local del dump de producción, y leen la base después de cada paso. Existen porque
el resto de la suite no los cubre: no hay arnés e2e para `insertarPago`, así que
todos los tests de esos caminos son mocks o funciones puras. Un mock que devuelve
lo que se le pidió prueba que el código llama en el orden correcto — no que el
SQL esté bien, que las FKs aguanten, ni que la plata caiga donde debe.

Viven en esta capa del stack y no en la primera por un motivo simple: **antes de
acá el código que prueban no existe**. `crearRubro` aparece en la capa del
backend de rubros y el cobro dentro de los pagos es de esta misma capa, así que
más abajo ni siquiera importarían.

## 🔒 El candado va primero

`00-guard.ts` **aborta si la base no se llama `smoke_rubros`**, y no hereda la URL
del `.env`: la construye a mano. El motivo no es paranoia — el `SUPABASE_DB_URL`
de este repo ha apuntado a PRODUCCIÓN dentro de una misma sesión de trabajo.
Producción no puede llamarse `smoke_rubros`, así que el nombre es la garantía.

**Nunca correr esto con el `.env` del repo.** La URL va explícita en la línea de
comandos, como en los ejemplos de abajo.

## Preparar la copia

```bash
docker start cartera-local
docker exec cartera-local psql -U postgres -c "DROP DATABASE IF EXISTS smoke_rubros;"
docker exec cartera-local psql -U postgres -c "CREATE DATABASE smoke_rubros TEMPLATE dump20260910;"
```

`dump20260910` es la foto de prod del 10-sep: ~1,920 créditos y ~125,000 pagos, ya
con las migraciones `0036`/`0037` y **sin** el índice único que borra la `0038` —
o sea el estado en que queda producción después del pase completo.

**Resetear la copia entre corridas.** Los scripts escriben de verdad, y el guard
de boletas duplicadas rechaza un `numeroAutorizacion` repetido.

## Correrlos

Desde `apps/cartera-back`, en este orden:

```bash
U="postgresql://postgres:localdev123@localhost:5433/smoke_rubros"
SUPABASE_DB_URL="$U" bun run src/scripts/humo/02-cobro.ts             # crear el rubro
SUPABASE_DB_URL="$U" bun run src/scripts/humo/03-boleta.ts            # una boleta lo cobra
SUPABASE_DB_URL="$U" bun run src/scripts/humo/05-revertir.ts          # aplicar y revertir
SUPABASE_DB_URL="$U" bun run src/scripts/humo/06-capital-con-otros.ts # abono a capital con otros
SUPABASE_DB_URL="$U" bun run src/scripts/humo/07-doble-clic.ts        # dos clics en "declarar falsa"
SUPABASE_DB_URL="$U" bun run src/scripts/humo/08-saldo-reversa.ts     # qué le quita la reversa al saldo
SUPABASE_DB_URL="$U" bun run src/scripts/humo/09-doble-reversa.ts     # revertir DOS veces la misma fila
```

Los dos últimos necesitan además la migración `0039`:

```bash
docker exec -i cartera-local psql -U postgres -d smoke_rubros \
  < drizzle/0039_saldo_a_favor_acreditado.sql
```

## Qué prueba cada uno

| Script | Qué verifica leyendo la base |
|---|---|
| `02-cobro` | el rubro nace con su saldo y su evento `creacion` en el historial |
| `03-boleta` | la boleta crea el reclamo en `rubros_pagos`, suma el cargo a `pagos_credito.otros`, y **el saldo NO baja todavía** |
| `05-revertir` | al aplicar, el saldo baja a 0 y el reclamo queda sellado; al revertir, **el saldo vuelve** y el historial queda `creacion→abono→reversa` |
| `06-capital-con-otros` | con `otros` encima, el total asignado **no supera la boleta** |
| `07-doble-clic` | dos `falsePayment` simultáneos no duplican el espejo de inversionistas |
| `08-saldo-reversa` | la reversa devuelve **lo que el pago acreditó**, no la boleta entera |
| `09-doble-reversa` | revertir dos veces la misma fila no le resta dos veces al cliente |

## Lo que NO cubren

* **El reintento tras una falla transitoria.** Haría falta inyectar un error a
  mitad de la transacción; el doble clic no es lo mismo.
* **Las rutas de Excel y migración** (`processFromExcelFull`, `migration.ts`), que
  borran pagos sin devolver el saldo del rubro. Están documentadas como agujeros
  conocidos en el mapa de superficies (descripción del PR #1600).
* **El front.** Acá sólo corre el backend.

## Si uno falla

El script imprime `esperado` vs `obtenido` por cada comprobación, así que el
renglón en rojo dice qué columna quedó mal. La copia queda viva para inspeccionarla
con `psql`; el dump de referencia nunca se toca.

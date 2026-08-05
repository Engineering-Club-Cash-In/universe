# Cuadre de la cartera de Autocash contra el Excel

Herramientas para comparar los créditos de **Autocash S.A.** entre la base de cartera y el
Excel *Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx*, y para ajustar la base a lo que dice el
Excel.

> **Nada de esto se corre solo.** El generador de plan es de solo lectura; el aplicador arranca
> en modo seco y necesita `--apply` explícito. Contra producción además exige `--permitir-prod`.

---

## Cómo lee el Excel

Cada hoja del libro es un mes. Un crédito puede ocupar **varias filas**, una por inversionista:

- Lo normal es el sufijo `_2`, `_3` sobre el mismo SIFCO (`01010214117220`, `01010214117220_2`).
- A veces el Excel usa **SIFCO correlativos distintos** para el mismo crédito
  (`01010214105290` + `01010214105300` + `01010214105310`). Se detectan agrupando por
  *(cliente, # de cuota)* dentro de la hoja: si en el grupo hay **exactamente un** SIFCO que
  existe en la base, los demás son rebanadas suyas. Si hay dos o más en la base son créditos
  distintos del mismo cliente y no se juntan.

La foto de un crédito se toma de la **última hoja mensual donde aparece con `Pagado` en
{`Si`, `Atrasado`}**, sumando todas sus filas. Columnas que se usan: `Capital restante` y `Cuota`.

Dos límites del libro, ya contemplados:

| Columna  | Existe desde |
|----------|--------------|
| `Pagado` | Agosto 2023  |
| `Cuota`  | Julio 2024   |

Cuando el Excel **liquida** un crédito pone `Capital restante = 0` y mete el **finiquito** en la
columna `Cuota`. Por eso esos créditos se excluyen del ajuste automático.

---

## Fase 1 — ajustar los créditos que ya tienen Autocash

### Reglas

1. Solo se ajustan créditos en **ACTIVO**, **MOROSO** o **EN_CONVENIO**.
2. `creditos.capital` y `creditos.cuota` se alinean al Excel.
3. Del reparto por inversionista **solo se mueve la fila de Autocash**
   (`monto_aportado` y `cuota_inversionista`): absorbe la diferencia para que la suma cuadre
   con el crédito. Ningún otro inversionista se toca.
   La fila **espejo** de Autocash se empareja con los mismos valores que el padre, en la misma
   transacción. Si no existe fila espejo **no se crea**: se reporta para revisarla a mano.
4. Si otro inversionista está fuera de cuadre contra el Excel, va al log `revisar_manual`
   para ajustarlo a mano.
5. Se excluyen los créditos que el Excel da por liquidados (`Capital restante = 0`).
6. Después del ajuste se llama a `recalcularPagosCredito({ numero_credito_sifco })`
   ([`updateCredit.ts`](../../controllers/updateCredit.ts)). Sin `numero_cuota` recalcula
   **solo las cuotas no pagadas** y los pagos registrados pendientes de validar; las cuotas ya
   pagadas y los abonos a capital no se tocan.

### Paso 1 — generar el plan (solo lectura)

```bash
cd apps/cartera-back
export SUPABASE_DB_URL='postgresql://...'          # ambiente de PRUEBA
python3 src/scripts/autocash/generar_plan_ajuste_autocash.py \
  --excel "$HOME/Descargas/Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx" \
  --salida plan_ajuste_autocash.json
```

Produce `plan_ajuste_autocash.json` con:

| Sección | Qué trae |
|---|---|
| `aplicar` | Créditos a ajustar, con valores actuales, objetivo y delta de cada campo |
| `excluidos` | Los que quedan fuera y **por qué** (liquidados, status, sin foto, etc.) |
| `revisar_manual` | Inversionistas distintos de Autocash fuera de cuadre — para ajustar a mano |
| `fase2_candidatos` | Relevamiento de la Fase 2 (ver abajo) |

Y un `plan_ajuste_autocash_revisar_manual.csv` con la misma lista en formato de hoja.

**Revisá el plan antes de seguir.** Es el punto de control.

### Paso 2 — aplicar

```bash
# Modo seco: imprime todo y escribe el reporte, sin tocar la base
bun run src/scripts/autocash/aplicarPlanAjusteAutocash.ts --plan=plan_ajuste_autocash.json

# Un solo crédito, para la primera prueba
bun run src/scripts/autocash/aplicarPlanAjusteAutocash.ts --plan=... --solo=01010214117220 --apply

# Los primeros 5
bun run src/scripts/autocash/aplicarPlanAjusteAutocash.ts --plan=... --limite=5 --apply

# Todo
bun run src/scripts/autocash/aplicarPlanAjusteAutocash.ts --plan=... --apply
```

| Flag | Efecto |
|---|---|
| *(ninguno)* | Modo seco. Nada se escribe. |
| `--apply` | Escribe de verdad. |
| `--solo=A,B` | Solo esos SIFCO. |
| `--limite=N` | Solo los primeros N del plan. |
| `--sin-recalculo` | Ajusta pero no llama a `recalcularPagosCredito`. |
| `--sin-espejo` | Ajusta el padre pero deja el espejo como está (solo para pruebas). |
| `--permitir-prod` | Necesario para escribir si la conexión apunta a `supabase.com`. |
| `--reporte=ruta` | Dónde dejar el reporte (default `reporte_ajuste_autocash.json`). |

### Qué hace por crédito

1. Relee el estado vivo y verifica que **siga coincidiendo con el plan**. Si alguien movió el
   crédito entre medio, lo salta y lo reporta: hay que regenerar el plan.
2. En **una transacción**: `UPDATE creditos` (capital + cuota), `UPDATE creditos_inversionistas`
   y `UPDATE creditos_inversionistas_espejo`, las dos últimas solo de la fila de Autocash y con
   los mismos valores, para que padre y espejo queden iguales. El update del crédito va dentro
   de `withCapitalContext`, así el trigger `trg_historial_capital_credito` deja el rastro con
   fuente `AJUSTE_EXCEL_AUTOCASH` y el motivo (hoja del Excel y filas usadas).
3. Recalcula los pagos no pagados del crédito.
4. Al final **verifica** que cada espejo haya quedado igual al padre. Lo que salga en
   `espejos_desalineados` es un problema a revisar, no un resultado esperado.

### Lo que el script NO hace a propósito

- **No crea filas espejo** que no existan: eso implicaría inventar porcentajes y modalidad de
  facturación. Se reportan en `creditos_sin_fila_espejo` para verlas a mano.
- No toca ningún inversionista que no sea Autocash, ni en el padre ni en el espejo.
- No toca `cuota_interes`, `porcentaje_participacion_inversionista` ni
  `porcentaje_cash_in`. (Ojo: `porcentaje_participacion_inversionista` no es el % de capital,
  es el reparto del interés con Cash-In; por eso no se recalcula al mover `monto_aportado`.)
- No toca créditos CANCELADO, INCOBRABLE, PENDIENTE_CANCELACION ni CAIDO.

---

## Fase 2 — créditos que el Excel tiene con Autocash y la base no

**Todavía no implementada**, a propósito. El generador ya los deja relevados en
`fase2_candidatos` (mismos estados ajustables) con: qué inversionistas tiene cada uno en la
base, cuáles en el Excel, y cuánto capital y cuota le corresponden a Autocash según el Excel.

En la corrida contra producción del 5-ago-2026 eran **10 créditos**, y en casi todos la base
tiene `Cube Investments S.A.` donde el Excel dice `Autocash S.A.` — o sea el traslado se hizo
en el sistema y el Excel no se actualizó, o al revés.

Esto **no es un ajuste de montos**: es dar de alta o reemplazar una participación. Los
controllers que ya existen para eso son
[`addInvestorToCredit.ts`](../../controllers/addInvestorToCredit.ts) y
[`replaceInvestorCredit.ts`](../../controllers/replaceInvestorCredit.ts). Antes de automatizar
nada hay que definir con negocio si manda el Excel o manda el sistema.

---

## Herramientas del comparativo (las que originaron esto)

| Script | Qué hace |
|---|---|
| `comparativo_autocash.py` | Genera el Excel comparativo de 2 hojas (créditos comparativos / los que ya no están en el sistema) |
| `corregir_companions.py` | Aplica la corrección de SIFCO correlativos sobre un comparativo ya generado |
| `agregar_resumen.py` | Agrega la hoja *Resumen* al inicio del comparativo |

Los tres esperan un `db_creditos.csv` al lado. Se regenera así (solo lectura):

```bash
psql "$SUPABASE_DB_URL" -c "COPY (
SELECT c.credito_id, c.numero_credito_sifco, u.nombre AS cliente, c.\"statusCredit\" AS status,
       c.capital, c.cuota, c.plazo, agg.n_inv, agg.suma_aportado, agg.suma_cuota_inv, agg.inversionistas,
       CASE WHEN EXISTS (SELECT 1 FROM cartera.creditos_inversionistas ci2
                         WHERE ci2.credito_id=c.credito_id AND ci2.inversionista_id=89)
            THEN 1 ELSE 0 END AS es_autocash
FROM cartera.creditos c
JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
LEFT JOIN LATERAL (
  SELECT count(*) AS n_inv, sum(ci.monto_aportado) AS suma_aportado,
         sum(ci.cuota_inversionista) AS suma_cuota_inv,
         string_agg(i.nombre, ' | ' ORDER BY i.nombre) AS inversionistas
  FROM cartera.creditos_inversionistas ci
  JOIN cartera.inversionistas i USING(inversionista_id)
  WHERE ci.credito_id = c.credito_id
) agg ON true
ORDER BY c.numero_credito_sifco
) TO STDOUT WITH CSV HEADER" > db_creditos.csv
```

> El `89` es el `inversionista_id` de Autocash **en producción**. En otro ambiente hay que
> resolverlo por nombre. El generador de plan y el aplicador ya lo hacen solos.

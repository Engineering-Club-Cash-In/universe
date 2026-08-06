# Cuadre de la cartera de Autocash

Herramientas para comparar los créditos de **Autocash S.A.** entre la base de cartera y el
Excel *Cartera Préstamos (Cash-In) NUEVA 3.0.xlsx*, y para aplicar los ajustes que
contabilidad autorizó.

> Nada corre solo. El generador de plan es de solo lectura y el aplicador arranca en modo
> seco: necesita `--apply` explícito, y contra producción además `--permitir-prod`.

---

## Flujo vivo

```
1) comparativo_autocash.py        →  Excel comparativo (DB vs Excel de cartera)
2) corregir_companions.py         →  arregla los créditos partidos en SIFCO correlativos
3) agregar_resumen.py             →  hoja de resumen al inicio
        ↓  contabilidad revisa y marca el archivo
4) preview_ajuste_conta.py        →  Excel para gerencia + plan_ajuste_conta.json
5) aplicarAjusteConta.ts          →  aplica el plan y recalcula pagos
```

### Scripts supersedidos (no usar)

`generar_plan_ajuste_autocash.py` y `aplicarPlanAjusteAutocash.ts` implementan la propuesta
**original**: alinear capital *y cuota* al Excel en los 72 créditos vivos, igualando siempre
el espejo al padre. Contabilidad no autorizó eso. Se conservan por el contexto y porque la
lógica de lectura del Excel sirve de referencia, pero **correrlos aplicaría cambios que nadie
autorizó**.

---

## Cómo se lee el Excel de cartera

Cada hoja es un mes. Un crédito ocupa **varias filas**, una por inversionista:

- Lo normal es el sufijo `_2`, `_3` sobre el mismo SIFCO (`01010214117220`, `01010214117220_2`).
- A veces el Excel usa **SIFCO correlativos distintos** para el mismo crédito
  (`01010214105290` + `01010214105300` + `01010214105310`). Se detectan agrupando por
  *(cliente, # de cuota)*: si en el grupo hay **exactamente un** SIFCO que existe en la base,
  los demás son rebanadas suyas. Con dos o más en la base son créditos distintos del mismo
  cliente y no se juntan.

La foto se toma de la **última hoja mensual donde el crédito aparece con `Pagado` en
{`Si`, `Atrasado`}**, sumando todas sus filas. Columnas: `Capital restante` y `Cuota`.

| Columna  | Existe desde |
|----------|--------------|
| `Pagado` | Agosto 2023  |
| `Cuota`  | Julio 2024   |

Cuando el Excel **liquida** un crédito pone `Capital restante = 0` y mete el **finiquito** en
la columna `Cuota`. Por eso esos créditos no se ajustan automáticamente.

---

## Las reglas que autorizó contabilidad

Conta marcó el comparativo con una columna `capital correcto` y un código de color que dice
**a qué registro** se le pone ese valor:

| Color | Acción |
|---|---|
| 🟨 Amarillo | solo el **espejo** |
| 🟩 Verde | solo el **padre** |
| 🟦 Celeste | **padre y espejo** |
| 🟧 Naranja | **padre y espejo** (no estaba en la leyenda; confirmado aparte) |
| 🟥 Rojo `CANCELADO` | **espejo a 0**, el padre no se toca |

Más:

- Si la fila trae un **segundo monto**, ese manda sobre `capital correcto`.
- Solo se mueve el `monto_aportado` de **Autocash**, que absorbe la diferencia para que
  `SUM(padre) == creditos.capital`. Excepción autorizada: Crhistian Herrera, donde conta dio
  los montos de Autocash y de Cube por separado y se aplican los dos.
- **La cuota no se toca**: conta solo autorizó capital.

### Los dos invariantes

1. `SUM(creditos_inversionistas.monto_aportado) == creditos.capital` — **siempre debe cumplirse**.
2. El espejo **no** tiene por qué igualar al capital: es un libro aparte (capital real del
   inversionista para liquidación, movido por compras de cartera y actualizaciones manuales).

Para **Autocash** sí se alinea el espejo al padre, porque este inversionista **nunca ha sido
liquidado** (0 filas en `cartera.liquidaciones`), así que no pisa ningún pago histórico. Esa
premisa hay que **re-verificarla** antes de correr esto de nuevo.

---

## Uso

### Paso 1 — plan y preview (solo lectura)

```bash
cd apps/cartera-back
export SUPABASE_DB_URL='postgresql://...'
python3 src/scripts/autocash/preview_ajuste_conta.py --plan plan_ajuste_conta.json
```

Genera:

| Archivo | Para qué |
|---|---|
| `Resumen_Ajuste_Autocash_gerencia.xlsx` | El que va al correo de autorización |
| `Preview_Ajuste_Autocash_conta.xlsx` | Desglose fila por fila |
| `plan_ajuste_conta.json` | Lo que consume el aplicador |

El plan trae dos lotes:

- **`conta`** — lo autorizado por contabilidad.
- **`saneamiento`** — créditos que conta no revisó y que están internamente incoherentes.
  Acá **no se cambia el capital del crédito**: se mueve a Autocash para que la suma cuadre y
  se alinea su espejo. No necesita autorización porque no cambia ningún capital.

### Paso 2 — aplicar

```bash
# Seco (default)
bun run src/scripts/autocash/aplicarAjusteConta.ts --plan=plan_ajuste_conta.json

# De verdad
bun run src/scripts/autocash/aplicarAjusteConta.ts --plan=... --apply --incluir-opcionales
```

| Flag | Efecto |
|---|---|
| *(ninguno)* | Modo seco. |
| `--apply` | Escribe. |
| `--incluir-opcionales` | Mete los items marcados `opcional` en el plan. |
| `--lote=conta` / `--lote=saneamiento` | Solo ese lote. |
| `--solo=A,B` | Solo esos SIFCO. |
| `--sin-recalculo` | No llama a `recalcularPagosCredito`. |
| `--permitir-prod` | Necesario para escribir contra `supabase.com`. |

### Qué hace por crédito

1. Relee el estado vivo y verifica que **siga coincidiendo con el plan**. Si algo cambió, lo
   salta y avisa: hay que regenerar el plan.
2. En **una transacción**: `creditos.capital` (si cambia), `creditos_inversionistas` y
   `creditos_inversionistas_espejo` de Autocash, más los `otros_movidos` que el plan traiga
   explícitos. El update del crédito va dentro de `withCapitalContext`, así el trigger
   `trg_historial_capital_credito` deja el rastro con fuente `AJUSTE_EXCEL_AUTOCASH`.
3. **Solo si cambió `creditos.capital`**, llama a `recalcularPagosCredito({ numero_credito_sifco })`
   ([updateCredit.ts](../../controllers/updateCredit.ts)). Sin `numero_cuota` toca únicamente
   las cuotas no pagadas y los pagos pendientes de validar. Si solo se movió el espejo, no hay
   nada que recalcular.

---

## Verificación de la prueba en local (2026-08-06)

Copia fresca de prod, 19 créditos (14 del lote de conta + 5 de saneamiento):

- 19 aplicados, 0 omitidos, 0 errores.
- De los 72 créditos vivos: **71 con padre cuadrado**, 67 con espejo alineado. Los 6 restantes
  son por diseño (2 cancelados con espejo en 0, 2 que conta marcó solo-espejo, 1 fuera del
  lote, y 1 donde Autocash absorbe el desfase del espejo de otro inversionista).
- Recálculo de pagos en los 10 que cambiaron capital: **259 filas pagadas, 0 modificadas**;
  417 filas no pagadas reproyectadas; **0 cambios de estado pagado↔no pagado**.
- 0 filas de pago con montos negativos.

### Cómo comparar antes/después de los pagos

`pagos_credito` no tiene auditoría. Para un antes/después real, cargar la tabla desde el dump:

```bash
pg_restore --data-only -t pagos_credito cartera_prod.dump -f - \
  | sed 's/cartera\.pagos_credito/cartera.pagos_credito_antes/g' > pagos_antes.sql
psql "$URL" -c "CREATE TABLE cartera.pagos_credito_antes (LIKE cartera.pagos_credito);"
psql "$URL" < pagos_antes.sql
```

---

## Pendientes conocidos

- **Brenda Aguilar** (`01010202115520`): con 3% mensual y Q644.74 de cargos fijos, al subirle
  el capital pasa a amortizar Q40.30/mes. Ya no amortizaba antes del ajuste, pero ahora es
  peor: con la cuota actual no termina de pagarse. Necesita recálculo de cuota o de plazo.
- **Espejo de terceros descuadrado** en Edmon Robinson, Peralta Soma y Francisco Luna. No es
  de Autocash, hay que resolverlo con esos inversionistas.
- **`replaceInvestorCredit` deja padre ≠ espejo**: de 331 filas de espejo creadas por la API,
  144 tienen el padre distinto. Caso confirmado: Francisco Luna, donde el reemplazo de Central
  de Carga por Richard Kachler dejó al padre con el monto viejo.
- **Cuota vs Excel** en Anabella Figueroa (+Q21.87) y José Carlos Motta (−Q3,816.28).
  Internamente cuadran (crédito == suma de inversionistas, en padre y espejo); solo difieren
  contra el Excel. Sin autorizar.
- **Rocael Batres** y **Pedro Bersai**: conta no los marcó. Rocael quedó como `opcional`.
- **Fase 2**: créditos que el Excel tiene con Autocash y el sistema no (~10, casi todos hoy
  con Cube Investments). No es ajuste de montos sino alta o reemplazo de participación; ver
  [addInvestorToCredit.ts](../../controllers/addInvestorToCredit.ts) y
  [replaceInvestorCredit.ts](../../controllers/replaceInvestorCredit.ts).

---

## Regenerar `db_creditos.csv`

Los scripts del comparativo (pasos 1-3) esperan ese CSV al lado:

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

> El `89` es el `inversionista_id` de Autocash **en producción**. `preview_ajuste_conta.py` y
> `aplicarAjusteConta.ts` lo resuelven por nombre, así que funcionan en cualquier ambiente.

# Simulación de Inversionistas — Documentación del Endpoint

## Endpoint

```
GET /inversionistas/:id/simulacion?mes=N&anio=N
```

Proyecta todas las cuotas pendientes de un inversionista y, si tiene reinversión activa, calcula un **crédito ficticio** que modela lo que generaría el capital reinvertido.

---

## Parámetros

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | number | ID del inversionista |
| `mes` | number (opcional) | Mes de liquidación — filtra la respuesta `creditos[]` a solo la cuota de ese mes |
| `anio` | number (opcional) | Año de liquidación — requerido si se pasa `mes` |

> **Importante:** el filtro `mes/anio` solo afecta el array `creditos[]` y sus `totales`. El `desglose_acumulado` y `reinversion_proyectada` **siempre** devuelven la proyección completa. El frontend aplica el filtro visual por su cuenta.

---

## Respuesta

```typescript
{
  inversionista_id: number;
  nombre: string;
  tipo_reinversion: string | null;
  moneda: string | null;
  emite_factura: boolean;
  mes_liquidacion: { mes: number; anio: number } | null;

  creditos: CreditoSimulado[];       // cuotas proyectadas de créditos reales
  totales: { ... };                   // sumas de creditos[]

  reinversion_proyectada: ReinversionProyectada[];  // uno por tipo de reinversión
  desglose_acumulado: {
    total_creditos: number;
    total_reinversion: number;        // suma de depósitos reales por mes
    total_acumulado: number;
    meses: DesgloseMes[];
  };
}
```

---

## Lógica paso a paso

### Paso 1 — Proyectar cuotas de créditos reales

Para cada crédito espejo del inversionista se calcula la tabla de amortización francesa completa desde la cuota pendiente más antigua hasta la última. Cada cuota tiene:

- `abono_capital` — capital que se amortiza
- `abono_interes` — interés bruto
- `abono_iva` — IVA 12% (si emite factura)
- `abono_isr` — ISR 7% (si NO emite factura)
- `monto_neto` — lo que realmente recibe el inversionista

---

### Paso 2 — Calcular depósitos de reinversión por mes

Para cada cuota proyectada de cada crédito real, se calcula **cuánto va a reinversión** según el tipo configurado en ese crédito:

| Tipo | Qué se reinvierte |
|------|-------------------|
| `reinversion_capital` | Solo `abono_capital` |
| `reinversion_interes` | Solo interés neto (`interes - ISR` o `interes + IVA`) |
| `reinversion_total` | `abono_capital + interés neto` (todo) |
| `reinversion_variable` | Hasta un monto fijo mensual configurado |
| `reinversion_excedente` | Lo que sobra después del monto fijo |

**Para `reinversion_combinada`:** cada crédito espejo tiene su propio `tipo_reinversion`, entonces se agrupan los depósitos por tipo:

```
depositosPorTipo = Map<tipo, Map<"YYYY-MM", monto>>
```

Ejemplo Selvyn (reinversion_combinada):
- Crédito 8675 → `reinversion_total` → capital + interés neto va al ficticio tipo "total"
- Crédito 8700 → `reinversion_capital` → solo capital va al ficticio tipo "capital"

También se mantiene `depositosGlobalesPorMes` (suma de todos los tipos) para el desglose visual.

---

### Paso 3 — Tasa promedio ponderada del ficticio

```
tasa = Σ(monto_aportado × porcentaje_interes) / Σ(monto_aportado)
```

Se usa la misma tasa para todos los ficticios (mismo pool de créditos).

---

### Paso 4 — Algoritmo de saldo creciente (uno por tipo)

Para cada tipo de reinversión se corre un crédito ficticio independiente con **saldo que crece cada mes** conforme llegan nuevos depósitos.

#### Horizonte

El ficticio termina en el **mismo mes que el último crédito real** — no se extiende más allá. Si el último crédito real vence en 2033-02, el ficticio también termina en 2033-02.

#### Inicio

El ficticio **no genera cuota en el primer mes de depósito** — ese mes el capital apenas llega. Las cuotas empiezan el mes siguiente.

```
Primer mes (ej. Mayo):
  saldoFicticio = depósito de Mayo
  → sin cuota (el dinero acaba de entrar)

Segundo mes en adelante (ej. Junio):
  saldoFicticio += depósito de este mes (si hay)
  interés = saldoFicticio × tasa_mensual
  cuota = amortización francesa sobre saldoFicticio a n meses restantes
  capital = cuota - interés
  saldoFicticio -= capital
```

#### Fórmula de cuota francesa (recalculada cada mes)

```
cuota = saldo × r / (1 - (1 + r)^-n)
```

Donde:
- `r` = tasa mensual (ej. 1.5% → 0.015)
- `n` = meses restantes hasta el fin del horizonte

La cuota se **recalcula cada mes** porque el saldo crece con nuevos depósitos. Esto hace que la cuota aumente gradualmente mes a mes.

#### Por qué la cuota crece

```
Mayo:   saldo = Q 2,360  (primer depósito, sin cuota)
Junio:  saldo = Q 2,360 + depósito Junio → cuota pequeña (muchos meses por delante)
Julio:  saldo += depósito Julio → cuota un poco mayor
...
```

---

### Paso 5 — IVA e ISR sobre interés del ficticio

Igual que en créditos reales:
- Si emite factura: `IVA = interés × 12%`, ISR = 0
- Si NO emite factura: ISR = `interés × 7%`, IVA = 0
- `monto_neto = capital + (interés ± IVA/ISR)`

---

### Paso 6 — Desglose acumulado por mes

Combina créditos reales + reinversión en una vista por mes:

```
DesgloseMes {
  mes: "YYYY-MM"
  total_creditos:   lo que recibe de créditos reales
  total_reinversion: cuánto SE DESTINA a reinversión de los créditos reales (depósito)
  total_mes:        total_creditos + total_reinversion
  creditos: [lista de créditos reales con su monto_neto]
}
```

**Las cuotas del ficticio NO se suman aquí** — son solo informativas en el frontend (filas FICTICIO). Representan lo que generará el ficticio, pero no es dinero que el inversionista "recibe" o "reinvierte" en ese mes — es el retorno proyectado del capital ya reinvertido.

#### Qué significa cada columna en el frontend

| Columna | Significa |
|---------|-----------|
| RECIBE | `total_creditos` — pago neto de créditos reales |
| REINVIERTE | `total_reinversion` — cuánto de ese pago va al ficticio |
| TOTAL MES | `total_mes` = RECIBE + REINVIERTE |
| Fila FICTICIO | Cuota que genera el ficticio ese mes (solo informativo) |

---

## Ejemplo numérico — Selvyn (reinversion_combinada)

Selvyn tiene 5 créditos, todos al 1.5% mensual:

| Crédito | Capital | Tipo reinversión | Plazo |
|---------|---------|-----------------|-------|
| 8675 | Q 140,585 | reinversion_total | 60m |
| 8700 | Q 121,880 | reinversion_capital | 84m |
| 8707 | Q 131,501 | reinversion_capital | 84m |
| 8991 | Q 45,051 | reinversion_total | 60m |
| 9023 | Q 42,468 | reinversion_total | 60m |

**Mayo 2026 (primer mes):**
- Créditos reales pagan → Selvyn recibe Q 480 (solo el crédito con cuota pendiente ese mes)
- De esas cuotas, Q 2,360 va a reinversión (capital + interés neto de créditos `reinversion_total`, más capital de `reinversion_capital`)
- El ficticio recibe Q 2,360 como capital inicial → **no genera cuota en Mayo**

**Junio 2026:**
- Créditos reales pagan → Selvyn recibe Q 485
- Más depósito de Junio → saldo ficticio crece
- Ficticio genera primera cuota: Reinv. Capital ~Q 13 + Reinv. Total ~Q 83 = ~Q 96

La cuota del ficticio es pequeña comparada con el depósito porque el capital se amortiza a lo largo de ~84 meses restantes.

---

## Campos de `reinversion_proyectada[]`

```typescript
{
  tipo: "reinversion_capital" | "reinversion_total" | ...
  tasa_promedio: number        // tasa anual promedio ponderada
  plazo: number                // meses de cuotas generadas
  total_reinvertido: number    // suma de todos los depósitos reales
  total_interes_generado: number
  total_a_recibir: number      // suma de monto_neto de todas las cuotas
  cuotas_por_mes: [{
    fecha_vencimiento: string
    abono_capital: number
    abono_interes: number
    abono_iva: number
    abono_isr: number
    monto_neto: number
  }]
}
```

Para `reinversion_combinada` el array tiene **una entrada por tipo** (ej. una para `reinversion_capital` y otra para `reinversion_total`). Para los demás tipos el array tiene una sola entrada.

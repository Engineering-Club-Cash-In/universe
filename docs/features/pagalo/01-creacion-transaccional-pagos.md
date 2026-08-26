# CB-028 · Creación transaccional de pagos Págalo

> **Estado histórico.** Documento conserva diseño inicial de presupuestos
> separados y pago validado. Decisiones vigentes en `DECISIONES.md` y D-48,
> D-50, D-52 compartidas lo reemplazan: importador registra un pago combinado
> pendiente y boletas; motor normal de Cartera valida/aplica después. Snapshot
> audita, no limita cascadeo ni saldo a favor.

**Estado:** diseño original superado; conservar solo como trazabilidad.
**Alcance:** primer slice, solo DEV/sandbox.

## 1. Resultado observable

Dado un grupo CRM con todas sus transacciones Págalo requeridas en `ACCEPT`,
montos correctos y vouchers propios, una llamada idempotente a Cartera crea:

- una fila `pagalo_payment_imports`;
- una o varias filas `pagos_credito`, según distribución normal del motor;
- `pagalo_import_id` en todas las filas creadas o reutilizadas por operación;
- `origen_pago='pagalo'`, banco temporal sandbox y estado `pending`;
- filas `boletas` con uno o dos vouchers requeridos;
- estado final `APPLIED` en importación.

`ACCEPT` y voucher autorizan registro idempotente, no validación final. Pago
sigue validación normal de Cartera después del commit atómico de importación.

## 2. Regla de reutilización

Lógica financiera actual no se copia. Se separan transporte HTTP y negocio:

```ts
export async function procesarRegistroPago(
  input: RegistroPagoInput,
  transaction?: CarteraTransaction,
): Promise<RegistroPagoResult> {
  if (transaction) {
    return ejecutarRegistroPago(input, transaction);
  }

  return db.transaction((tx) => ejecutarRegistroPago(input, tx));
}
```

`ejecutarRegistroPago` contiene lógica existente de `insertPayment`, cambiando
acceso global `db` por executor recibido. No altera orden, fórmulas ni reglas.
Para Págalo recibe además presupuestos inmutables por lado; no puede tratar dos
transacciones como una bolsa única de dinero.

`insertPayment` queda como adaptador Elysia:

```ts
export async function insertPayment({ body, set }: HttpContext) {
  const parsed = pagoSchema.safeParse(body);
  if (!parsed.success) return responderValidacion(parsed.error, set);

  try {
    return await withPaymentLock(parsed.data.credito_id, () =>
      procesarRegistroPago(parsed.data),
    );
  } catch (error) {
    return mapearErrorRegistroPago(error, set);
  }
}
```

Importación Págalo adquiere mismo lock antes de abrir transacción, evitando que
waiters ocupen pool transaccional mientras esperan:

```ts
return withPaymentLock(command.creditoId, () =>
  db.transaction(async (tx) => {
    const imported = await crearImportacionPagalo(command, tx);
    const result = await procesarRegistroPago(
      mapearPagaloARegistro(command, imported.id),
      tx,
    );
    await marcarPagosCreados(imported.id, tx);
    for (const paymentId of result.payment_ids) {
      await validarPagoRegistrado(paymentId, tx);
    }
    await marcarImportacionApplied(imported.id, tx);
    return result;
  }),
);
```

## 3. Helpers transaccionales

Helpers que leen o escriben estado participante reciben executor explícito:

```ts
type PaymentExecutor = typeof db | CarteraTransaction;

obtenerInfoCompletaCredito(input, executor);
procesarPagoMora(input, executor);
updateMora(input, executor);
processConvenioPayment(input, executor);
insertarPago(input, executor);
insertarBoletas(input, executor);
getPagosDelMesActual(creditoId, executor);
validarPagoRegistrado(pagoId, executor);
```

Si helper ya abre transacción, adopta mismo patrón: usa transacción recibida o
abre una solo cuando se invoca de forma independiente. Historial de mora debe
escribirse con mismo executor, no después de commit separado.

Retornos HTTP dejan de vivir dentro del motor. Errores de dominio tipados
provocan rollback y adaptador conserva códigos/mensajes actuales de `/newPayment`.

`validarPagoRegistrado` se extrae del cuerpo interno de `revalidatePayment`:
actualiza capital/restantes, marca cuota cuando corresponde y distribuye
inversionistas. Págalo primero registra filas como `pending` dentro de la
transacción privada y después invoca este helper para cada fila, antes de
commit. Así ninguna fila Págalo pending queda visible y al commit todas salen
`validated`, sin saltar efectos existentes de revalidación.

`marcarImportacionApplied` corre después de validar todas las filas y, en el
mismo `tx`, escribe `status='APPLIED'`, `payments_created_at` si falta y
`applied_at`. `PAYMENTS_CREATED` puede existir solo como estado transitorio no
observable fuera de esa transacción; nunca es respuesta final de importación.

## 4. Contrato CRM → Cartera

Ruta interna, protegida por autenticación servidor-a-servidor existente:

```http
POST /pagalo/payment-imports
Authorization: Bearer <token de cartera>
Content-Type: application/json
```

Request normalizado:

```json
{
  "crm_group_id": "d3100ac5-9e91-4f74-b513-9a8f394df37a",
  "credito_id": 1234,
  "numero_credito_sifco": "01010214108330",
  "currency": "GTQ",
  "capital_total": "5000.00",
  "facturable_total": "850.00",
  "total_amount": "5850.00",
  "cuota_inicial": 3,
  "allocations": [
    {
      "link_type": "CAPITAL",
      "cartera_cuota_id": 301,
      "numero_cuota": 3,
      "rubro": "CAPITAL",
      "amount": "5000.00",
      "facturable": false
    },
    {
      "link_type": "MORA_INTERES",
      "cartera_cuota_id": 301,
      "numero_cuota": 3,
      "rubro": "INTERES",
      "amount": "850.00",
      "facturable": true
    }
  ],
  "capital": {
    "transaction_uuid": "7c9e8dc3-e8dc-4a90-8afb-0f74f7419712",
    "external_identifier": "CB028-...-CAPITAL",
    "request_id": "148600",
    "request_auth": "977076",
    "paid_at": "2026-08-24T18:00:00.000Z",
    "voucher_storage_key": "pagalo/d3100ac5/capital.pdf"
  },
  "facturable": {
    "transaction_uuid": "96ea928a-93e5-44d5-b9b3-c88fa1e57e82",
    "external_identifier": "CB028-...-MORA-INTERES",
    "request_id": "148601",
    "request_auth": "977077",
    "paid_at": "2026-08-24T18:02:00.000Z",
    "voucher_storage_key": "pagalo/d3100ac5/mora-interes.pdf"
  },
  "payload_hash": "6ac6f0c345dd30cfbac3f8df6159ebfaf74922f93bd42ab3f994222a9640c027"
}
```

Para grupo de un link, lado Q0.00 no tiene allocation, fuente ni voucher. Puede
ser mora-only (`capital_total="0.00"`, `capital=null`) o solo-capital
(`facturable_total="0.00"`, `facturable=null`). Nunca se fabrica evidencia Q0.

`payload_hash` se calcula en CRM sobre JSON canónico con orden fijo de campos y
allocations. Cartera reconstruye hash antes de aceptar. Headers, tokens y datos
de tarjeta nunca forman parte del comando.

Respuesta nueva:

```json
{
  "success": true,
  "status": "APPLIED",
  "import_id": 42,
  "payment_ids": [1001, 1002],
  "idempotent_replay": false
}
```

Retry exacto responde `200` con mismos ids e `idempotent_replay=true`.

## 5. Mapeo al motor existente

```ts
const registro: RegistroPagoInput = {
  credito_id: command.credito_id,
  usuario_id: credito.usuario_id, // siempre resuelto en Cartera
  // Total solo para auditoría/cabecera; no autoriza mezclar presupuestos.
  monto_boleta: numberExacto(command.total_amount),
  fecha_pago: fechaGuatemalaDelInstanteMayor(
    command.capital?.paid_at,
    command.facturable?.paid_at,
  ),
  fecha_boleta: fechaGuatemalaDelInstanteMayor(
    command.capital?.paid_at,
    command.facturable?.paid_at,
  ),
  cuotaApagar: command.cuota_inicial,
  url_boletas: compactar([
    command.capital?.voucher_storage_key,
    command.facturable?.voucher_storage_key,
  ]),
  banco_id: undefined,
  numeroAutorizacion: undefined,
  origen_pago: "pagalo",
  observaciones: `Pago Págalo · grupo ${command.crm_group_id}`,
  otros: 0,
  abono_directo_capital: 0,
  registerBy: "pagalo@clubcashin.com",
  pagalo_import_id: imported.id,
  pagalo_componentes: {
    capital: command.capital
      ? {
          disponible: decimal(command.capital_total),
          allocations: allocationsDe(command, "CAPITAL"),
          voucher_storage_key: command.capital.voucher_storage_key,
        }
      : undefined,
    facturable: command.facturable
      ? {
          disponible: decimal(command.facturable_total),
          allocations: allocationsDe(command, "MORA_INTERES"),
          voucher_storage_key: command.facturable.voucher_storage_key,
        }
      : undefined,
  },
};
```

`usuario_id` del request no se confía ni se necesita; Cartera lo deriva desde
crédito. URLs externas tampoco se aceptan: solo keys esperadas de almacenamiento
propio. `pagalo_componentes` es contrato interno; no se agrega al schema público
de `/newPayment`.

Diseño de presupuestos de este apartado fue reemplazado. Motor recibe total
combinado, aplica reglas normales de boleta manual y puede cascader/saldo a
favor. Snapshot y componentes quedan como evidencia, no como límite financiero.

## 6. Invariantes dentro del lock

Antes de primera escritura financiera:

1. Crédito existe y `(credito_id, numero_credito_sifco)` coincide.
2. Moneda es `GTQ`.
3. Capital y facturable son no negativos, total es positivo y
   `capital + facturable = total` en centavos.
4. Allocations y fuente existen si y solo si su lado es mayor que cero.
5. CAPITAL solo contiene rubros no facturables; MORA_INTERES, facturables.
6. CRM conserva unicidad global de UUID e identificadores Págalo. Cartera aún
   no revalida reutilización cruzada de roles entre grupos: defensa adicional
   P2 documentada en D-13, no bloqueante para dispatcher CRM actual.
7. `payload_hash` coincide con comando canónico.
8. Cuota inicial y snapshot conservan trazabilidad; aplicación posterior usa
   estado vivo del motor normal, sin revisión por sobrante del snapshot.
9. Voucher keys requeridas son no vacías y distintas cuando hay dos; se obtienen
   mediante `/upload` de Cartera.
10. Diseño histórico: suma consumida por lado nunca excede presupuesto Págalo; mora usa solo
    presupuesto `MORA_INTERES`.

Fallo de 1–10 crea o actualiza importación como `REVIEW_REQUIRED` sin pagos. No
se llama motor con datos ambiguos.

## 7. Idempotencia y fallos

| Situación | Resultado |
| --- | --- |
| Grupo nuevo válido | Crea importación, pagos y validación; `APPLIED`. |
| Retry mismo grupo/hash | Devuelve importación `APPLIED` y pagos existentes. |
| Mismo grupo, hash diferente | `409 PAYLOAD_MISMATCH`; `REVIEW_REQUIRED`. |
| UUID/identificador reutilizado | `409 TRANSACTION_ALREADY_IMPORTED`. |
| Regla financiera rechaza antes de escribir | Rollback completo; importación queda para revisión. |
| Excepción después de cualquier escritura | Rollback de importación, mora, convenios, pagos, boletas y saldos. |
| CRM pierde respuesta después de commit | Retry devuelve mismos ids por `crm_group_id`. |

`payment_ids` sale directamente del resultado interno del motor. No se infiere
por “último id”, tiempo, monto o autor; esos fallbacks existentes no son una
llave idempotente suficiente para Págalo.

Cuando validación determinística falla, Cartera guarda `REVIEW_REQUIRED` en una
transacción corta que no llama motor. Cuando excepción ocurre dentro de
transacción financiera, primero revierte todo y después intenta registrar
`REVIEW_REQUIRED` en una transacción nueva. Si base no permite ese segundo
registro, CRM conserva grupo como `APPLICATION_FAILED` y reintento idempotente
puede reconstruir situación; nunca se repite motor sin consultar importación y
pagos existentes.

## 8. Seguridad

- Endpoint permanece detrás de autenticación Cartera usada por CRM server.
- Navegador nunca llama endpoint Págalo de Cartera.
- `pagalo_import_id` no se agrega al schema público de `/newPayment`.
- Cartera nunca recibe credencial Págalo.
- Payloads y logs excluyen authorization, PAN, CVV y expiración de tarjeta.
- Voucher key se valida como key propia; no se descarga URL arbitraria desde
  Cartera.
- Errores externos se sanitizan antes de persistir `last_error_message`.

## 9. Pruebas de aceptación

### Caracterización antes del refactor

- Pago normal completo produce mismo desglose y respuesta.
- Pago parcial conserva restantes.
- Pago con mora conserva orden actual.
- Pago con convenio conserva actualización actual.
- Pago que cubre varias cuotas crea mismo número de pagos.
- Abono a capital, solo otros, saldo a favor e INCOBRABLE conservan conducta.
- Contratos HTTP de `/newPayment`, Ficha 360 y bot no cambian.

### Atomicidad

Inyectar error después de cada familia de escritura y comprobar cero cambios:

- después de modificar mora;
- después de modificar convenio;
- después de primer `pagos_credito` en operación multicuota;
- después de insertar boletas;
- antes de actualizar saldo a favor;
- antes de marcar importación `APPLIED`.

### Págalo

- ACCEPT requeridos crean importación `APPLIED` y N pagos `validated`; helper
  extraído de revalidación corre dentro de misma transacción antes de commit.
- Todos pagos tienen mismo `pagalo_import_id`, origen `pagalo` y banco nulo.
- Cada pago expone uno o dos vouchers requeridos mediante `boletas`.
- Retry exacto no crea filas adicionales.
- Hash distinto y transacción reutilizada no crean pagos.
- Mora-only o solo-capital con un ACCEPT crea flujo de un link.
- Operación de dos lados no puede importarse con una sola transacción ACCEPT.
- Link sobrado por deuda achicada termina `REVIEW_REQUIRED`; mora crecida se
  consume primero desde MORA_INTERES e informa faltante.
- Presupuesto CAPITAL nunca cubre mora aunque componente facturable se agote.

## 10. Criterio de cierre

Slice termina cuando:

1. suite de caracterización prueba preservación de `/newPayment`;
2. pruebas de rollback cubren familias de efectos;
3. endpoint Págalo crea pagos multicuota e idempotentes en sandbox;
4. Ficha 360 y bot siguen registrando pagos mediante mismo endpoint;
5. validación y distribución existentes se ejecutan por helpers extraídos dentro
   de transacción; ningún código de creación de links, polling, WhatsApp ni
   facturación nueva se incluye en este slice.

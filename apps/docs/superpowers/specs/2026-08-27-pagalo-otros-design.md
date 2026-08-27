# Págalo: concepto manual Otros

## Objetivo

Permitir que asesor agregue monto manual positivo `Otros` al generar links
Págalo. Monto viaja dentro de link `MORA_INTERES`, queda auditable en CRM y se
aplica en cartera-back como componente financiero `otros` cuando grupo completo
queda pagado.

## Límites

- Solo origen `ASESOR` (modal CRM). Flujo bot no cambia.
- Moneda única GTQ.
- `Otros` no altera capital ni selección/consecutividad de cuotas.
- No se crea link de Q0.00. Grupo solo-Otros crea solo `MORA_INTERES`.

## Datos y reglas

CRM añade `otros_total NUMERIC(18,2) NOT NULL DEFAULT 0` a
`pagalo_payment_groups`.

`allocations_snapshot` admite rubro `OTROS`, facturable, sin cuota
(`cartera_cuota_id` y `numero_cuota` nulos). Su monto coincide exactamente con
`otros_total` cuando este es positivo; no existe allocation OTROS cuando es
cero.

Los totales quedan:

```text
facturable_total = cuotas.interés + IVA + mora + otros_total
total_amount     = capital_total + facturable_total
link MORA_INTERES = facturable_total
```

Toda suma y validación usa centavos exactos. Entrada acepta hasta dos decimales
y requiere valor estrictamente mayor que cero si `Otros` está habilitado.

## CRM

`PagaloLinkDialog` agrega checkbox `Otros` e input monetario condicionado.
Desactivar limpia valor. Antes de mutación muestra error local para monto vacío,
no numérico, negativo, cero o con más de dos decimales. Backend repite
validación: cliente no controla monto.

`crearLinksPagalo` acepta `otros` opcional. Servicio orquestador construye
allocation OTROS y actualiza `facturableTotal`/`totalAmount` antes de crear
grupo, links y solicitud Págalo. Ruta historial expone `otrosTotal`; UI añade
columna `Otros` en historial/listado.

## Despacho a cartera-back

Cuando todos links requeridos tienen evidencia ACCEPT, dispatcher arma comando
con `otros_total` y allocation `OTROS`. JSON canónico/hash incluye campo,
evitando replay con monto cambiado.

cartera-back amplía esquema/payload de `POST /pagalo/payment-imports` con
`otros_total`. Valida:

- entero de centavos no negativo;
- total de allocation OTROS coincide con `otros_total`;
- OTROS existe solo en lado MORA_INTERES/facturable;
- suma de componentes coincide con link y total.

Import persiste `otros_total`, conserva idempotencia y mapea valor al componente
`otros` consumido por `registerPayment`. Motor normal registra aplicación sin
tratarlo como capital, mora o saldo no clasificado.

## Errores

Entrada inválida falla antes de emitir links. Inconsistencia de snapshot,
payload o evidencia sigue ruta actual `REVIEW_REQUIRED`; no crea pago parcial.
Links existentes quedan compatibles: `otros_total = 0`, sin allocation OTROS.

## Pruebas

1. UI: activar/desactivar, formato y validaciones de Otros.
2. API CRM: rechaza cero, negativo, tres decimales; acepta `12.34`.
3. Orquestador: Mora/Interés suma Otros; Capital no cambia; solo-Otros emite un
   link MORA_INTERES.
4. Persistencia/historial: grupo, snapshot, endpoint y columna muestran monto.
5. Dispatcher/hash: payload incluye `otros_total` y allocation OTROS.
6. cartera-back: valida contrato, persiste, reintento idempotente, mapea
   `otros` a pago normal.
7. E2E sandbox: cuota+mora+Otros, ambos ACCEPT, grupo COMPLETED y pago de
   cartera con Otros correcto.

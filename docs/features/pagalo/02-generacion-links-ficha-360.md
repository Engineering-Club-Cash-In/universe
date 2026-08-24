# CB-028 · Generación de links desde Ficha 360

**Estado:** diseño conversacional aprobado; revisión escrita pendiente.
**Ambiente:** desarrollo/sandbox. Producción fuera de alcance.

## 1. Resultado visible

Ficha 360 muestra botón `Generar links de pago` inmediatamente después de
`Registrar Contacto` y antes de `Promesa de Pago`. Botón abre modal propio; no
reutiliza formulario de contacto porque genera intención financiera, links y
auditoría distintas.

Primera versión permite:

- elegir cuotas atrasadas completas;
- cobrar mora completa junto con cuotas;
- cobrar únicamente mora;
- ver desglose exacto antes de generar;
- generar uno o dos links según componentes con monto positivo.

Cuotas futuras quedan documentadas como fase posterior y no se implementan.

## 2. Selector

Modal sigue patrón visual de `ContactoModal` en variante Promesa de Pago:
lista compacta, checkboxes, vencimiento, monto alineado y total vivo.

Al abrir:

1. cuotas atrasadas aparecen ordenadas de más antigua a más reciente;
2. todas empiezan seleccionadas;
3. cada fila representa cuota completa y no expone campo de monto editable;
4. selección siempre forma prefijo consecutivo desde cuota más antigua;
5. seleccionar cuota posterior selecciona anteriores;
6. desmarcar cuota elimina esa cuota y posteriores;
7. si existe mora mayor que Q0.00, fila Mora inicia marcada y no permite monto
   parcial;
8. asesor puede quitar todas las cuotas y conservar solo Mora;
9. si no existe mora, debe quedar al menos una cuota seleccionada.

Ejemplo con cuotas 11, 12 y 13 vencidas:

```text
Válido:   11
Válido:   11 + 12
Válido:   11 + 12 + 13
Válido:   solo mora
Inválido: 12 sin 11
Inválido: media cuota 11
Inválido: parte de mora
```

## 3. Desglose previo

Debajo del selector se muestran dos bloques derivados del snapshot de Cartera:

```text
Link CAPITAL · No facturable
  Capital cuota #11                     Q1,800.00
  Capital cuota #12                     Q1,750.00
  Subtotal CAPITAL                      Q3,550.00

Link MORA E INTERÉS · Facturable
  Interés cuota #11                       Q350.00
  IVA/rubros facturables cuota #11         Q42.00
  Interés cuota #12                       Q340.00
  IVA/rubros facturables cuota #12         Q40.80
  Mora vigente                            Q150.00
  Subtotal MORA_INTERES                    Q922.80

Total a pagar                            Q4,472.80
```

Para mora sola:

```text
Link MORA E INTERÉS · Facturable          Q150.00
Total a pagar                             Q150.00
Se generará 1 link de pago
```

Bloque CAPITAL no se muestra cuando subtotal es cero. Botón final cambia texto:

- `Generar 1 link de pago` para mora sola;
- `Generar 2 links de pago` cuando existen ambos componentes.

## 4. Cálculo y fuente de verdad

Frontend no calcula composición financiera usando aproximaciones. Solicita a
Cartera snapshot por cuota con rubros explícitos y usa valores retornados para
mostrar selección. CRM server vuelve a validar selección y sumas antes de crear
grupo. Se opera en centavos/decimal exacto, nunca `number` flotante para hashes
o persistencia.

```text
capital_total    = suma de rubros CAPITAL seleccionados
facturable_total = interés + IVA/rubros facturables + mora completa
total_amount     = capital_total + facturable_total
```

Tipos requeridos se derivan de montos, sin columna duplicada:

```text
capital_total = 0  → MORA_INTERES
capital_total > 0  → CAPITAL + MORA_INTERES
```

## 5. Creación y envío

Al confirmar:

1. CRM vuelve a obtener deuda viva y rechaza selección obsoleta;
2. crea `pagalo_payment_groups` con snapshot inmutable;
3. crea solo links cuyo subtotal sea mayor que cero;
4. si falla cualquier link requerido, no envía mensaje;
5. cuando todos existen, envía un solo mensaje con uno o dos links etiquetados;
6. registra eventos de creador, parámetros, generación y envío.

Modal bloquea doble submit. Reintento usa idempotencia del grupo; nunca crea
segundo grupo por timeout ambiguo sin consultar primero operación previa.

## 6. Mora cambiante

Link usa monto fijo. Worker consulta primero estado Págalo y después compara
mora viva con snapshot mientras link siga pendiente.

Págalo documenta consulta y estados de link, pero no documenta endpoint para
cancelar request pendiente. Hasta obtener contrato oficial:

- CRM no marca `CANCELLED` alegando cancelación solo local;
- no genera reemplazo que deje URL vieja todavía cobrable;
- si cliente paga monto desactualizado, grupo pasa `REVIEW_REQUIRED`;
- no se aplica como mora parcial ni se manda sobrante a cuota/saldo.

Si proveedor confirma cancelación:

1. worker solicita cancelación remota;
2. consulta estado final para resolver carrera pago/cancelación;
3. solo estado remoto cancelado permite marcar `CANCELLED`;
4. crea generación siguiente y relaciona `supersedes_link_id`;
5. envía reemplazo al cliente.

## 7. Cambios DB correctivos requeridos

Las migraciones correctivas fueron creadas localmente y están pendientes de
ejecución manual en DEV; este documento no afirma que se hayan aplicado.
Las migraciones originales no se reescriben: CRM `0039` y Cartera `0008`.

- CRM: nueva `0045_cb028_pagalo_optional_capital.sql`;
- Cartera: nueva `drizzle/cobros-02/0009_pagalo_optional_capital.sql`,
  transaccional y segura de re-ejecutar.

CRM permite `capital_total = 0`, conserva `facturable_total > 0` y no requiere
fila CAPITAL inexistente. Cartera vuelve nullable evidencia CAPITAL y agrega
constraint de forma:

```text
capital_total = 0
  → campos capital_* NULL

capital_total > 0
  → transaction_uuid, external_identifier y paid_at CAPITAL obligatorios
```

Índices UNIQUE de campos CAPITAL permanecen: PostgreSQL admite múltiples NULL.
No se crean tablas, links ficticios, `required_link_count` ni `payment_mode`.

## 8. Pago solo mora en Cartera

Motor existente ya representa pago solo mora mediante fila especial:

- `mora` contiene monto completo;
- `monto_aplicado` y rubros de cuota quedan en cero;
- cuota asociada no se marca pagada;
- voucher queda en `boletas`;
- fila queda `validation_status='pending'` y `origen_pago='pagalo'`;
- `pagalo_import_id` enlaza importación idempotente.

Antes de invocarlo para Págalo, Cartera exige bajo lock que mora viva coincida
exactamente con snapshot pagado. Motor Págalo no usa rama parcial existente.

Prueba de caracterización vigente:

```text
bun test src/controllers/registerPayment.test.ts
54 pass
0 fail
```

Esto prueba semántica interna existente; todavía faltan integración HTTP,
transacción total, origen `pagalo`, importación y rollback antes de declarar
flujo Págalo listo end-to-end.

## 9. Casos de aceptación

1. Tres cuotas vencidas permiten solo prefijos consecutivos y montos completos.
2. Mora mayor que cero siempre forma parte de selección con cuotas.
3. Todas las cuotas pueden quitarse y mora sola sigue siendo válida.
4. Mora sola crea un grupo, un link, un voucher y una fuente ACCEPT.
5. Cuotas crean un grupo y dos links; un ACCEPT deja grupo parcial.
6. Desglose mostrado coincide en centavos con payload y snapshot guardados.
7. Fallo creando segundo link no envía primero al cliente.
8. Diferencia de mora antes de generar bloquea operación y refresca modal.
9. Diferencia tras pago deja `REVIEW_REQUIRED`, sin pago automático.
10. Doble submit/retry no crea grupos o links duplicados.

## 10. Fuera de alcance

- cuotas futuras;
- pagos parciales;
- edición manual de montos;
- expiración automática;
- cancelación remota hasta contrato oficial;
- producción;
- validación contable, facturación y aplicación a inversionistas.

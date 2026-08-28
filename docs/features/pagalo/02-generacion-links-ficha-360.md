# CB-028 · Generación de links desde Ficha 360

> **Estado histórico parcial.** Selector, snapshot y separación de links siguen
> vigentes. Reglas de aplicación posterior fueron reemplazadas por
> `DECISIONES.md` D-14/D-17 y D-52 compartida: importación suma links y usa
> motor normal de boleta manual; snapshot no genera `REVIEW_REQUIRED` por
> deuda reducida.

**Estado:** reglas de UI vigentes; reglas de aplicación posterior superadas.
**Ambiente:** desarrollo/sandbox. Producción fuera de alcance.

## 1. Resultado visible

Ficha 360 ofrece `Generar links de pago` como una de las dos opciones del botón
primario `Registrar Pago` (la otra es `Subir boleta`); ver
[D-19](DECISIONES.md#d-19--generar-links-es-una-forma-de-registrar-un-pago-no-otra-gestión).
Abre modal propio; no reutiliza formulario de contacto porque genera intención
financiera, links y auditoría distintas.

> Ubicación anterior (botón suelto junto a `Registrar Contacto`): superada por
> D-19.

El modal tiene dos estados y se distinguen desde el encabezado:

- **Sin grupo vivo** → selector de cuotas. La jerarquía es: qué se va a cobrar
  (mora + cuotas, con el saldo real de cada una a la derecha), después el cargo
  manual `Otros`, y al final el resumen con el total de los links a crear.
- **Con grupo vivo** → lista de los links existentes, encabezada por el total
  del grupo y el avance de cobro (`N de M links pagados`). El texto del modal
  dice explícitamente que el crédito **ya tiene links generados** y que no se
  pueden crear nuevos hasta que se paguen o se cancelen: sin eso, abrir el
  modal y no encontrar el selector se lee como un error.

Primera versión permite:

- elegir cuotas atrasadas completas;
- cobrar mora completa junto con cuotas;
- cobrar únicamente mora;
- ver desglose exacto antes de generar;
- generar uno o dos links según componentes con monto positivo.

También puede incluir próxima cuota por vencer; cuotas futuras arbitrarias no se
implementan.

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
7. si existe mora mayor que Q0.00, fila Mora inicia marcada, queda bloqueada y
   no permite monto parcial;
8. asesor puede quitar todas las cuotas y conservar solo Mora;
9. si no existe mora, debe quedar al menos una cuota seleccionada.
10. próxima cuota por vencer puede agregarse al final del rango consecutivo.

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

Link 2 · Facturable
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
Link de pago                               Q150.00
Total a pagar                             Q150.00
Se generará 1 link de pago
```

Para solo-capital, por ejemplo cuota parcialmente cubierta cuyos rubros
facturables ya llegaron a cero:

```text
Link de pago                             Q1,800.00
Total a pagar                            Q1,800.00
Se generará 1 link de pago
```

Solo se muestran bloques con subtotal positivo. Botón final cambia texto:

- `Generar 1 link de pago` para mora sola o solo-capital;
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
capital_total = 0, facturable_total > 0  → MORA_INTERES
capital_total > 0, facturable_total = 0  → CAPITAL
capital_total > 0, facturable_total > 0  → CAPITAL + MORA_INTERES
```

## 5. Creación y envío

Al confirmar:

1. CRM vuelve a obtener deuda viva y rechaza selección obsoleta;
2. crea `pagalo_payment_groups` con snapshot inmutable;
3. crea solo links cuyo subtotal sea mayor que cero;
4. si falla cualquier link requerido, no envía mensaje;
5. cuando todos existen, envía un solo mensaje con uno o dos links etiquetados;
6. registra eventos de creador, parámetros, generación y envío.

Modal bloquea doble submit. Índice único evita dos grupos activos para mismo
crédito. Recuperación visible de timeout ambiguo sigue pendiente: asesor debe
consultar grupo existente antes de reintentar.

## 6. Mora cambiante

Link usa monto fijo. Worker confirma estado remoto, monto y moneda antes de
guardar voucher. Snapshot queda como auditoría; Cartera aplica estado vivo con
motor de boleta manual. CRM no aplica dinero ni recalcula saldo financiero.

Págalo documenta consulta y estados de link, pero no documenta endpoint para
cancelar request pendiente. Hasta obtener contrato oficial:

- CRM no marca `CANCELLED` alegando cancelación solo local;
- no genera reemplazo que deje URL vieja todavía cobrable;
- mora que creció se consume primero mediante pago combinado del motor normal;
- deuda achicada puede dejar cascadeo a cuotas posteriores o saldo a favor;
  no crea `REVIEW_REQUIRED` solo por link sobrado.

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

- CRM: `0048_pagalo_lado_facturable_opcional.sql` re-afirma ambos lados Q0;
- Cartera: `0010_pagalo_solo_capital.sql` re-afirma nulabilidad/evidencia de
  ambos lados. Reemplazan alcance de correctivos locales `0045/0009`.

CRM y Cartera permiten cualquiera de los lados en Q0 y requieren evidencia solo
del lado con monto positivo:

```text
lado = 0
  → campos de evidencia del lado NULL

lado > 0
  → transaction_uuid, external_identifier y paid_at del lado obligatorios
```

Índices UNIQUE de campos CAPITAL permanecen: PostgreSQL admite múltiples NULL.
No se crean tablas, links ficticios, `required_link_count` ni `payment_mode`.

## 8. Pago solo mora en Cartera

Motor existente ya representa pago solo mora mediante fila especial:

- `mora` contiene monto completo;
- `monto_aplicado` y rubros de cuota quedan en cero;
- cuota asociada no se marca pagada;
- voucher queda en `boletas`;
- fila queda `validation_status='validated'` y `origen_pago='pagalo'`;
- `pagalo_import_id` enlaza importación idempotente.

Antes de invocarlo, Cartera revalida saldo vivo. Si mora creció, dinero del
link MORA_INTERES la consume primero y recibo informa faltante; si link queda
sobrado por deuda achicada, grupo pasa `REVIEW_REQUIRED`.

Prueba de caracterización vigente:

```text
bun test src/controllers/registerPayment.test.ts
57 pass
0 fail
```

Esto prueba semántica interna y metadatos Págalo. Hay pruebas unitarias de
mapping/idempotencia, pero todavía faltan integración HTTP, rollback total y
validación de snapshot/rubros vivos antes de declarar flujo Págalo listo
end-to-end.

## 9. Casos de aceptación

1. Tres cuotas vencidas permiten solo prefijos consecutivos y montos completos.
2. Mora mayor que cero siempre forma parte de selección con cuotas.
3. Todas las cuotas pueden quitarse y mora sola sigue siendo válida.
4. Mora sola crea un grupo, un link, un voucher y una fuente ACCEPT.
5. Cuotas crean uno o dos links según subtotales positivos; dos links requieren
   dos ACCEPT y un solo link queda listo con su único ACCEPT.
6. Cuota parcialmente pagada con saldo solo CAPITAL crea un link CAPITAL, un
   voucher y una fuente ACCEPT; no muestra bloque facturable.
7. Desglose mostrado coincide en centavos con payload y snapshot guardados.
8. Fallo creando segundo link no envía primero al cliente.
9. Diferencia de mora antes de generar bloquea operación y refresca modal.
10. Mora crecida usa jerarquía normal del pago combinado; deuda achicada puede
    cascader o dejar saldo a favor sin `REVIEW_REQUIRED` por sobrante.
11. Doble submit/retry no crea grupos o links duplicados.
12. Mora aparece como fila propia, queda marcada y no puede desmarcarse cuando
    tiene saldo positivo.

## 10. Fuera de alcance

- cuotas futuras arbitrarias;
- pagos parciales;
- edición manual de montos;
- expiración automática;
- cancelación remota hasta contrato oficial;
- producción;
- validación manual, facturación nueva o aplicación a inversionistas alternativa.

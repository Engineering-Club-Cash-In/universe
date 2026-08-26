# Historial Links de Pagos — Diseño

## Objetivo

Rediseñar sección CRM Págalo para que cada link de pago comunique su estado
individual. Un grupo puede contener links con estados distintos; estado global
no debe ocultar ese detalle.

## Alcance

- Renombrar sección a **Historial Links de Pagos**.
- Reemplazar icono/enlace externo por acción **Copiar link de pago**.
- Copiar `paymentUrl` al portapapeles sin navegar ni abrir pestaña.
- Mostrar confirmación temporal mediante toast: **Link copiado**.
- Presentar cada link como tarjeta/filas independientes, usando estilos y
  componentes ya existentes CRM.
- Mantener grupos en orden actual, más reciente primero.
- Ocultar timeline técnico de eventos de vista principal.

No incluye cambios a creación, consulta/polling, cobro ni esquema Págalo.

## Experiencia

Cada grupo muestra encabezado compacto: fecha creación, monto total y resumen
como `1 de 2 pagados`. Debajo, cada link contiene:

| Dato | Regla |
| --- | --- |
| Concepto | `Capital` o `Mora e intereses`. |
| Monto | Capital usa `capitalTotal`; mora e intereses usa `facturableTotal`. |
| Estado | Se deriva solo de `link.status`, nunca de `grupo.status`. |
| Fecha pago | Solo `paidAt` cuando estado es `PAID`. |
| Copia | Botón visible solo con `paymentUrl`; copia URL, no navega. |

Datos grupo (`origen`, `creadoPor`, importación o error) continúan disponibles
como información secundaria sin competir con links.

## Estados individuales

| Estado API | Etiqueta CRM | Tratamiento |
| --- | --- | --- |
| `CREATING` | Creando link | Neutro/proceso; sin acción de copia. |
| `ACTIVE` | Pendiente de pago | Ámbar; permite copiar. |
| `PAID` | Pagado | Verde; muestra `paidAt`; no muestra copia. |
| `REPLACED` | Reemplazado | Gris; no permite copiar. |
| Cualquier otro | Valor recibido | Neutro; no permite copiar salvo que tenga URL y sea estado activo futuro definido. |

Estados de grupo permanecen como contexto de procesamiento, no sustituyen
estado link. Ejemplo: grupo `PARTIALLY_PAID`, Capital `PAID`, Mora `ACTIVE`.

## Componentes y flujo

`PagaloHistorial` conserva consulta y colapsable. `GrupoPagalo` calcula
resumen de links y presenta `LinkPagalo`. `LinkPagalo` recibe un único link,
monto y concepto; contiene badge, metadatos y acción copy.

Al presionar copiar:

1. Llamar `navigator.clipboard.writeText(paymentUrl)`.
2. Al resolver, mostrar toast éxito `Link copiado`.
3. Si falla permiso/API, mostrar toast error y conservar página sin navegación.

No se renderiza `<a target="_blank">`; URL nunca dispara navegación.

## Errores y estados vacíos

- Sin grupos: mantener comportamiento actual, no renderizar sección.
- Grupo sin links: mostrar datos grupo, sin resumen `x de y` inválido.
- Link sin `paymentUrl`: no renderizar acción copia.
- Clipboard no disponible/falla: toast de error; usuario puede reintentar.
- Datos fecha nulos: mostrar `—` solo donde corresponde, nunca afirmar pago.

## Pruebas

- Renderizar grupo con Capital `PAID` y Mora `ACTIVE`; ambos badges deben ser
  distintos, resumen debe mostrar `1 de 2 pagados`.
- Botón `ACTIVE` copia URL exacta y llama toast éxito.
- Acción no crea anchor, no modifica URL ni abre pestaña.
- `PAID`, `CREATING`, `REPLACED` y link sin URL no ofrecen copia cuando regla
  lo prohíbe.
- Falla de clipboard presenta toast error.
- Ejecutar typecheck y build de `apps/web`.

## Criterios de aceptación

1. Encabezado dice **Historial Links de Pagos**.
2. Dos links de mismo grupo pueden verse simultáneamente uno pagado y otro
   pendiente, con colores/textos correctos.
3. Copiar link no abre pestaña ni navega; deja confirmación visible.
4. Diseño reutiliza primitivas, espaciado y paleta actuales CRM.
5. Timeline técnico no aparece por defecto.

# Págalo: crédito-cliente y filtro por asesor de pool

## Objetivo

En `/cobros/pagalo`, compactar SIFCO y cliente en una sola columna y permitir
que admin/supervisor filtre grupos por asesor, usando relación asesor-pool de
buckets; no propiedad directa del crédito.

## Alcance visual

- Reemplazar columnas `Crédito` y `Cliente` por `Crédito / Cliente`.
  - SIFCO mantiene enlace para supervisor cuando existe caso de cobros.
  - Nombre normalizado del cliente queda debajo del SIFCO.
- Agregar columna `Asesor`.
  - Con filtro seleccionado, muestra asesor cuyo pool se está consultando.
  - Sin filtro, muestra `—`: un crédito de bucket puede estar en pool de más
    de un asesor, por lo que no existe único asesor atribuible.
- Para admin/supervisor, agregar selector `Todos los asesores` y asesores
  activos de pool.
- Rol cobros no ve selector y conserva alcance de sus propios buckets.

## Fuente y seguridad

1. `getPoolPorAsesor()` obtiene catálogo de asesores con buckets activos.
2. Para `asesorId` seleccionado, servidor llama
   `getSifcosPoolAutoritativos({ asesorId })`.
3. Esa lista se deriva del bucket actual de cada crédito y se intersecta con
   grupos Págalo en SQL mediante `ANY($1::text[])`.
4. Solamente admin/supervisor puede enviar `asesorId`; otros roles mantienen
   scope resuelto desde correo contra `email_cash_in`.

No se usa `creditos.asesor_id`: representa dueño comercial/operativo, no
pertenencia de crédito al bucket que puede atender asesor.

## Flujo

1. Página carga catálogo de asesores solo para supervisor/admin.
2. Al cambiar selector, reinicia página a 1 y consulta Págalo con `asesorId`.
3. Router valida autorización, resuelve SIFCOs del pool y aplica filtro a
   resultados, total y conteos por estado.
4. Tabla recibe nombre de asesor seleccionado para columna nueva.

## Errores y bordes

- Pool vacío: resultado vacío, total cero, sin ampliar acceso.
- Error cargando catálogo: selector comunica error; consulta actual permanece.
- Ningún asesor seleccionado: se muestran todos los grupos para
  admin/supervisor; columna Asesor muestra `—`.
- Paginación nunca mezcla resultados de filtros distintos: cambiar asesor
  siempre vuelve a primera página.

## Pruebas

- Tests puros para resolver alcance solicitado y validar que rol no supervisor
  no puede filtrar otro pool.
- Test router/estructura para asegurar `asesorId` impacta predicado de grupos
  y conteos.
- Check de tipos y build web tras editar interfaz.

## Fuera de alcance

- Reasignar créditos o modificar pools.
- Cambiar permiso de acciones Págalo.
- Elegir un propietario único cuando pools se superponen.

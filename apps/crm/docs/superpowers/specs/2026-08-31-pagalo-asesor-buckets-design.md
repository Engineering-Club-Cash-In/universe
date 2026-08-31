# Págalo: acceso de asesor por buckets

## Objetivo

Permitir que usuarios con rol `cobros` abran `/cobros/pagalo` en modo lectura y vean únicamente grupos Págalo de créditos cuyo bucket actual pertenece a su pool asignado.

## Decisiones

- `admin` y `cobros_supervisor` conservan universo completo y acciones de supervisor.
- `cobros` recibe universo restringido, sin acciones y sin enlace al caso de cobro. El detalle actual usa una autorización distinta (`responsableCobros`) y no debe convertirse en vía para abrir casos ajenos al asesor.
- Vínculo de identidad: `context.session.user.email` normalizado contra `email_cash_in` de Cartera Back.
- Fuente de autorización: pool activo de `/buckets/pool-por-asesor` y bucket motor actual de `/getAllCredits`; no se persiste bucket en Págalo.
- Asesor sin vínculo o sin buckets recibe respuesta vacía. Si Cartera Back falla al validar scope, endpoint falla sin devolver grupos.

## Flujo

1. API Págalo permite `cobrosProcedure`.
2. Si rol puede asignar Cobros, omite scope.
3. Si rol `cobros`, obtiene pool del asesor por correo.
4. Lee SIFCOs distintos de grupos Págalo y los consulta contra Cartera Back en lotes GET de 50, sin caché.
5. Conserva SIFCOs cuyo `bucket.numero` está dentro de buckets del asesor.
6. Usa conjunto permitido en listado, búsqueda, conteo por estado y total antes de paginar.
7. UI permite consulta para `canAccessCobros`; conserva `esSupervisor` solo para acciones y enlaces.

## Reuso y límites

- Reusa `getPoolPorAsesor()` y `getAllCreditos()` existentes.
- Lotes de 50 evitan POST bulk actual, que exige `estado` y no sirve para grupos de varios estados.
- No se agrega endpoint ni migración en Cartera Back.
- No se cambia autorización de Ficha 360 ni de acciones Págalo.

## Pruebas

- Resolver asesor por `email_cash_in`, ignorando mayúsculas y espacios.
- Partir SIFCOs en lotes de 50.
- Retener solo créditos en buckets permitidos, incluyendo B0.
- Asesor sin pool o sin crédito con bucket permitido queda sin resultados.
- Regresión de UI: rol `cobros` consulta; solo supervisor recibe acciones/enlace.

# 11 · Investigación en redes sociales (CB-039)

**Estado:** ✅ Implementado en código · migración CRM `0073` pendiente de correr (la corre quien administra la DB)
**Jira:** CC2-75 (CB-039) · Épica B3 · Rescate avanzado

---

## Qué es

Mientras el Asesor Sr busca al cliente (B2/B3), registra cada consulta que hace en redes
sociales: **qué fuente miró, qué encontró, cuándo, quién y las capturas** que lo
respaldan. Es una **bitácora**: lo guardado no se edita ni se borra; si algo estaba mal,
se registra otra entrada.

No es una gestión con el cliente (no se le contactó), así que **no** escribe en
`contactos_cobros` ni agrega un canal al historial de contactos. Vive en su propia tarjeta.

> "Asesor Sr" no es un rol del sistema: es quien tiene los buckets 2 y 3 en el pool de
> cartera. El acceso lo decide lo mismo que toda la ficha (`assertAccesoCasoCobro`: el
> dueño del crédito en cartera, su cobertura, supervisor o admin) y el **bucket**.

## Dónde está en la Ficha 360

Pestaña **Referencias**, debajo de las referencias y hallazgos de localización (CB-036):
tarjeta **Investigación en redes sociales**.

- **Registrar investigación**: formulario con fuente (Facebook, Instagram, TikTok,
  LinkedIn, X, Threads, Google u otra), enlace del perfil (opcional), si se encontró algo,
  hallazgos, fecha y hasta 10 archivos (JPG, PNG, WebP o PDF).
- **Historial**: fuente, resultado, quién, cuándo, hallazgos y capturas. Se ve en
  **cualquier bucket**, aunque el crédito ya haya pasado a B4.

## Buckets: un solo lugar

`BUCKETS_INVESTIGACION` en `apps/crm/apps/server/src/lib/investigaciones-redes-cobros.ts`
(hoy `[2, 3]`). El servidor, el botón de la ficha y el mensaje de bloqueo salen de ahí.
**Para abrirlo a B4 basta sumar `4` al arreglo.** El bucket se lee de cartera sin cache y
falla cerrado: sin bucket confirmado no se registra.

## Datos

Migración `0073_cb039_investigacion_redes_sociales.sql` (idempotente):

- `investigaciones_redes_cobros`: `caso_cobro_id`, `fuente`, `fuente_otra`,
  `enlace_perfil`, `resultado` (`con_hallazgos` | `sin_hallazgos`, CHECK), `hallazgos`,
  `fecha_investigacion`, `bucket_snapshot`, `registrada_por`, `created_at`.
- `investigaciones_redes_cobros_evidencias`: `investigacion_id`, `r2_key` (UNIQUE),
  `nombre_archivo`, `mime_type`, `tamano_bytes`, `subido_por`, `created_at`.

Las capturas van a R2 (privado, URL firmada) bajo `cobros/investigaciones/<caso>/`, con el
mismo flujo de dos pasos que las visitas: el navegador sube con URL prefirmada
(`cobros_investigacion_evidencia`) y el servidor verifica en R2 que cada archivo exista,
sea de ese caso y de un tipo permitido antes de guardarlo.

## Código

| Qué | Dónde (`apps/crm/apps`) |
| --- | --- |
| Reglas puras (buckets, catálogos, formulario) + tests | `server/src/lib/investigaciones-redes-cobros.ts` (`.test.ts`) |
| Tablas | `server/src/db/schema/investigaciones-redes-cobros.ts` |
| API | `server/src/routers/investigaciones-redes-cobros.ts`: `getInvestigacionesRedesCaso`, `registrarInvestigacionRedes` |
| Subida | `server/src/lib/storage.ts`, `server/src/routers/upload.ts`, `web/src/lib/upload-to-r2.ts` |
| UI | `web/src/components/cobros/investigacion-redes-card.tsx` y `investigacion-redes-dialog.tsx` |

## Privacidad y uso aceptable (definición de listo, pendiente de Legal)

El ticket pide validar políticas de privacidad, legal y uso aceptable **antes de
producción**. Pendiente con Legal: qué fuentes e información se pueden consultar y
guardar, y si hay plazo de retención de las capturas (si lo hay, aplicar el patrón de
`services/wialon/purgar-snapshots-ubicaciones.ts`: borrar los archivos y conservar la
fila de auditoría).

Ya cubierto en el diseño: bucket R2 privado con URL firmada, acceso solo a quien trabaja el
caso, bitácora sin edición, usuario y fecha siempre registrados, y un aviso en el
formulario (solo información pública, sin cuentas falsas, sin pedir contraseñas, sin
contactar al cliente por esta vía).

## Pendiente

- **Checklist de recuperación B4 (CB-043):** el paso "Búsqueda en redes sociales" se
  recortó el 2026-09-30 porque no había dónde registrarla. Ahora sí; falta decidir si
  vuelve como paso auto-detectado (`redes_sociales`) en `PASOS_CHECKLIST_RECUPERACION`.
  Como solo se registra en B2/B3, las investigaciones se hacen antes de B4 y contarían igual.

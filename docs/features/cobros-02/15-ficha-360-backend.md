# 15 · Ficha 360 rediseñada: backend pendiente

La Ficha 360 (`/cobros/$id`) se rediseñó con el Figma «CRM Ventas» › 🟣 01 · Asesor Junior › **04 · Consulta · Ficha 360 · Ubicaciones** (`1887:4118`). Es la misma ficha para todos los créditos y todos los roles de cobros.

El front ya está **conectado**. Lo que todavía no tiene fuente sale de un solo procedimiento, `getFichaComplementos`, en `apps/crm/apps/server/src/routers/ficha-cobros.ts`. Hoy cada bloque devuelve `null` y la ficha lo muestra como pendiente («—», «Pronto» o un aviso punteado).

**Para cerrar una tarea:**
1. Llenar el cuerpo marcado con `TODO(José) · tarea Fn`, respetando el tipo que ya está exportado en ese mismo archivo.
2. Correr `bunx tsc -b` en el server.

El front no se toca: al recibir datos, los pinta solo.

## Lo que ya está hecho (real)

| Qué | Dónde |
| --- | --- |
| Franja del Resumen: contactabilidad, días sin gestión, intentos sin contacto y próximo contacto | `getSeguimientoFicha` (`routers/ficha-cobros.ts`) |
| Chip de estado de gestión del encabezado (Sin acuerdo / Promesa vigente / Promesa incumplida / Convenio vigente) | Ídem, con `estadoGestionDe` de `lib/seguimiento-cobros.ts` |
| Reglas puras (umbrales de contactabilidad y días en hora de Guatemala) | `lib/ficha-cobros.ts` y sus pruebas |
| Ubicaciones verificadas | Última visita **realizada** de cada tipo (residencia o trabajo) de `getVisitasCaso` (CB-037/038), con su mapa, fotos, comentarios, responsable y resultado |

**Contactabilidad del caso:** cuenta las gestiones manuales de los últimos 60 días y divide las que tuvieron respuesta entre los intentos.
- **Alta:** 50 % o más.
- **Media:** 20 % o más.
- **Baja:** menos de 20 %.
- **Sin intentos:** «—».

Son umbrales propuestos: si negocio define otros, se cambian en `lib/ficha-cobros.ts` y en sus pruebas.

## Tareas

| Tarea | Campo de `getFichaComplementos` | Qué hace falta | Dónde se ve |
| --- | --- | --- | --- |
| **F1** | `datosPersonales: DatosPersonalesFicha` | Datos del titular sincronizados de RENAP: nombre completo, DPI, fecha de nacimiento, sexo y estado civil. Solo lectura. | Contacto › Editar › «Datos personales». Hoy muestra el nombre del caso y el DPI del lead; lo demás aparece como «—». |
| **F2** | `codeudores: CodeudorFicha[]` | Codeudores del crédito, sacados de la oportunidad o del contrato, con correo, teléfonos y direcciones. `[]` si no tiene. | Contacto: una tarjeta por codeudor, debajo del titular. |
| **F3** | `historialCambios: CambioFicha[]` | Bitácora de cambios de los datos del cliente: campo, valor antes y después, autor y origen (Ficha 360, Workspace o carga masiva). Ver el rediseño de la bitácora `crm_entity_audit`. | Contacto › Editar › «Historial de cambios». |
| **F4** | `historico: HitoCredito[]` | La vida del crédito: entradas y salidas de bucket (`cartera.buckets_historial`), reestructuras, convenios y promesas cumplidas. Lo más reciente primero. | Historial › «Histórico». |
| **F5** | `seguro: SeguroComplemento` | Tipo de seguro y coberturas de la póliza. La aseguradora, la cabina, la póliza, el monto y el vencimiento ya salen de la ficha. | Resumen › tarjeta «Seguro». |
| **F6** | `documentos: DocumentoFicha[]` y sus envíos | Enviar al cliente la tarjeta de circulación y la información del seguro. Solicitar al supervisor el contrato, la carta poder, el cambio de placas y el expertaje. Hace falta el catálogo y las mutaciones de envío y de solicitud. | Pestaña Documentos: hoy esas filas dicen «Pronto». |
| **F7** | `resumenIA: ResumenIA` | Resumen del caso generado por IA (texto, etiquetas y fecha de generación) y las preguntas al asistente. **Requiere aprobar el costo de la API antes de activarlo.** | Pestaña Asistente IA. |
| **F8** | — (mutación nueva) | Editar la dirección de residencia y la de trabajo desde la ficha. Hoy solo se editan los teléfonos y el correo, con `guardarTelefonosCaso` y `updateContactInfoCobros`. | Contacto › Editar › «Dirección de residencia» y «Dirección de trabajo», que hoy están en solo lectura. |

## Referencias

- Front y decisiones: [14-rediseno-dashboard-asesor.md](./14-rediseno-dashboard-asesor.md#etapa-2--ficha-360).
- Piezas de la ficha: `apps/crm/apps/web/src/components/cobros/ficha/`. Se ven con datos de ejemplo en `/design-system?only=cobros-ficha-360`.

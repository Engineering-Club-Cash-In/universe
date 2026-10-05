# 🏗 B3 · Modelo de estados (esqueleto)  (`2226:12`)

> Generado por `scripts/extract.py` desde la REST API de Figma. No editar a mano.

_Esta página no tiene componentes maestros; ver notas por sección._

## B3 · Modelo de estados — esqueleto funcional › Frame

<details><summary>Textos de documentación de la sección</summary>

- B3 · Modelo de estados — esqueleto funcional
- Orden H · pasos 1–2. Seis dimensiones ORTOGONALES. Regla dura: ninguna acción de usuario escribe el bucket.

</details>


## B3 · Modelo de estados — esqueleto funcional › Leyenda

<details><summary>Textos de documentación de la sección</summary>

- Leyenda
- Tipos de transición y estatus de definición
- ▸ automático (sistema/días)
- ● acción de usuario
- ⟳ resultado de gestión
- ⇒ efecto disparado por Solicitud
- 🟢 regla cerrada
- 🟡 pendiente de negocio · stub
- 🔵 dato ilustrativo

</details>


## B3 · Modelo de estados — esqueleto funcional › Dim 1 · Bucket (temporal — 100% automático)

<details><summary>Textos de documentación de la sección</summary>

- Dim 1 · Bucket (temporal — 100% automático)
- 🟢 Lo determina el atraso en días. NINGÚN usuario lo escribe. Preparado para recálculo automático futuro (p. ej. ruptura de arreglo).
- B0
- ·
- B1
- B2
- B3
- ▸
- día 91
- B4
- 120d
- B5
- pago cura
- B2 / B1 / B0
- Único acoplamiento de salida: un cambio de bucket puede CERRAR el Plan de Rescate (Dim 2). El bucket nunca es escrito por Dim 2–6.

</details>


## B3 · Modelo de estados — esqueleto funcional › Dim 2 · Plan de Rescate (estado de gestión, dentro de B3)

<details><summary>Textos de documentación de la sección</summary>

- Dim 2 · Plan de Rescate (estado de gestión, dentro de B3)
- 🟢 Sub-estado operativo. NO cambia el bucket. Sus terminales los dispara Dim 1.
- Iniciado
- ⟳
- result. llamada inicial
- En gestión
- compromiso
- Con compromiso
- ⟳ / ●
- incumplido → back
- ⇒
- entrega aprobada
- En verificación de recuperación
- entrega efectiva
- Entrega efectiva
- →
- [HOLD · pendiente de negocio]
- ●
- Supervisor
- Derivación anticipada (sigue B3)
- ▸
- día 91
- Derivado a B4
- Terminales (disparados por Dim 1):
- Resuelto ▸ pago cura
- Derivado a B4 ▸ día 91

</details>


## B3 · Modelo de estados — esqueleto funcional › Dim 3 · Etapa operativa (DERIVADA — no es estado duro)

<details><summary>Textos de documentación de la sección</summary>

- Dim 3 · Etapa operativa (DERIVADA — no es estado duro)
- 🟢 Se calcula de los resultados; alimenta la 'siguiente acción sugerida'. Puede cambiar sin cambiar el estado del Plan (Dim 2).
- Contacto inicial
- Localización
- Negociación / cierre
- Presión / campo
- Tratamiento anticipado

</details>


## B3 · Modelo de estados — esqueleto funcional › Dim 4 · Responsable (owner)

<details><summary>Textos de documentación de la sección</summary>

- Dim 4 · Responsable (owner)
- 🟢 Cambia por reasignación (● Supervisor) o por naturaleza de la acción (llamada inicial + críticas = Supervisor).
- Asesor (dueño del bucket)
- ⇄
- reasignación ●
- Supervisor

</details>


## B3 · Modelo de estados — esqueleto funcional › Dim 5 · SolicitudAccion (objeto independiente · N por crédito)

<details><summary>Textos de documentación de la sección</summary>

- Dim 5 · SolicitudAccion (objeto independiente · N por crédito)
- 🟢 Sobre de decisión GENÉRICO y agnóstico de B3. No congela el caso. Sin campo 'resultado de negocio'.
- Requiere Supervisor (gating)
- ●
- Asesor solicita
- Pendiente
- Supervisor decide
- Aprobada
- Rechazada
- Cancelada
- ⇒
- efecto aplicado/registrado
- Cerrada
- Campos:
- tipo
- origen
- crédito
- objetoAfectado
- payload
- nivelAprobación = { Supervisor | Gerencia }
- resolución { aprobadorId, motivo }
- timestamps

</details>


## B3 · Modelo de estados — esqueleto funcional › Dim 6 · Efecto de negocio (en el objeto destino — disparado por Solicitud aprobada)

<details><summary>Textos de documentación de la sección</summary>

- Dim 6 · Efecto de negocio (en el objeto destino — disparado por Solicitud aprobada)
- 🟢 Máquinas propias por objeto. El efecto vive aquí, NO en la Solicitud.
- Vehículo:
- Normal
- →
- Monitoreo activo
- Apagado
- Oferta / Convenio:
- Propuesta
- Activa / Rechazada
- Cumplida / Incumplida / Cancelada
- Entrega:
- Coordinando
- Efectiva
- [stub · pendiente de negocio]
- Promesa:
- Vigente
- Cumplida / Incumplida

</details>


## B3 · Modelo de estados — esqueleto funcional › Reglas de acoplamiento (lo único permitido entre dimensiones)

<details><summary>Textos de documentación de la sección</summary>

- Reglas de acoplamiento (lo único permitido entre dimensiones)
- Dim 1 → Dim 2  (bucket cierra el Plan)
- Dim 5 → Dim 6  (Solicitud aprobada dispara efecto)
- Dim 6 → Dim 2  (compromiso / incumplimiento mueven el Plan)
- PROHIBIDO: que cualquier acción de usuario o Dim 2–6 escriba Dim 1. El bucket es siempre consecuencia automática del sistema.

</details>


## B3 · Modelo de estados — esqueleto funcional › Stubs / pendientes de negocio — representar lugar, NO fijar regla

<details><summary>Textos de documentación de la sección</summary>

- Stubs / pendientes de negocio — representar lugar, NO fijar regla
- 🟡 La UI muestra el punto; el hook queda abierto para poblarse después sin rediseñar.
- 🟡  post-Entrega efectiva (saldo / liquidación / garantía / cierre / derivación)
- 🟡  efecto contable o de bucket de la entrega y del tratamiento anticipado
- 🟡  recálculo automático de bucket por ruptura de arreglo (arquitectura lo permite; regla no se diseña)
- 🟡  valor/parámetro del umbral de aprobación
- 🟡  catálogo de Promesa / Convenio / Reestructura
- 🟡  disparador y consecuencia de incumplimiento
- 🟡  reglas de desempate de prioridad (presentación, no estados)

</details>


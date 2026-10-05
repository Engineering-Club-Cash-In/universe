# 🏛 05 · Product Architecture  (`199:877`)

> Generado por `scripts/extract.py` desde la REST API de Figma. No editar a mano.

_Esta página no tiene componentes maestros; ver notas por sección._

## Product Architecture Handbook — CCI CRM › 00 · Portada

<details><summary>Textos de documentación de la sección</summary>

- DOCUMENTACIÓN OFICIAL DE PRODUCTO
- Product Architecture Handbook
- Cómo está organizado el CRM de Cobros antes de comenzar a diseñar las pantallas. Documento oficial de referencia para Diseño, Desarrollo, Producto y Negocio.
- VERSIÓN
- v1.0
- ESTADO
- Completo
- ACTUALIZADO
- 13 jul 2026
- BASE
- Design System v1.0
- OWNER
- Equipo de Producto
- 8
- Secciones del handbook
- 5
- Roles del sistema
- 6
- Principios de producto
- 13
- Módulos de la Ficha 360

</details>


## Product Architecture Handbook — CCI CRM › Índice

<details><summary>Textos de documentación de la sección</summary>

- Contenido
- Recorrido del documento. Cada sección representa un nivel distinto de abstracción del producto.
- 00
- Introducción
- Propósito del handbook y cómo utilizarlo en el día a día.
- Disponible
- 01
- Product Vision & Principles
- Qué es el CRM, su objetivo y los principios que gobiernan el diseño.
- 02
- Product Map
- Arquitectura visual del producto: módulos, núcleo Ficha 360 y sus relaciones.
- 03
- Roles del Sistema
- Quiénes participan en el CRM: objetivo, responsabilidad y alcance de cada rol.
- 04
- Matriz de Permisos
- Qué acción puede realizar cada rol dentro de cada módulo del sistema.
- 05
- Product Evolution
- Hoja de ruta del producto: Operación → Automatización → Predicción → Optimización.
- 06
- Dashboard del Asesor
- Definición funcional: objetivo, KPIs, permisos y navegación de la pantalla.
- 07
- Mi Cartera
- Cola de trabajo priorizada: filtra, prioriza y lanza la gestión hacia la Ficha 360.

</details>


## Product Architecture Handbook — CCI CRM › Sección 00: Introducción

<details><summary>Textos de documentación de la sección</summary>

- 00
- Introducción
- Qué es este handbook y cómo utilizarlo.
- Este handbook describe cómo está organizado el CRM de Cobros a nivel de producto —su visión, sus principios, sus roles, su mapa de módulos y su evolución— antes de entrar al diseño de las pantallas. Es la fuente oficial de referencia para alinear a Diseño, Desarrollo, Producto y Negocio sobre qué es
- Cómo usar este documento
- Diseño
- Entiende la estructura antes de diseñar. Cada pantalla debe reflejar los principios y el mapa de producto.
- Desarrollo
- Comprende las entidades, roles y permisos que el sistema debe soportar de base.
- Producto
- Alinea alcance y prioridades con la evolución MVP → Automatización → IA.
- Negocio
- Conecta el CRM con el objetivo real: recuperación de cartera y salud financiera.
- ◆
- REGLA DE GOBERNANZA
- El Design System es la única fuente de verdad visual
- Ninguna pantalla del CRM puede introducir componentes, patrones, estilos o tokens fuera del Design System. Todo se construye ensamblando la librería existente; si algo falta, se extiende el componente fuente y se registra en el changelog —nunca se crea una solución aislada dentro de una pantalla.

</details>


## Product Architecture Handbook — CCI CRM › Sección 01: Product Vision & Principles

<details><summary>Textos de documentación de la sección</summary>

- 01
- Product Vision & Principles
- Qué es el CRM, su objetivo y los principios que gobiernan el diseño del producto.
- Product Vision
- Recuperar más cartera, más rápido y a menor costo. El CRM de Cobros traduce la estrategia de riesgo en ejecución diaria para proteger el flujo de caja y sostener la capacidad del negocio de seguir colocando crédito.
- Menos mora, menos incobrables y decisiones de cobranza más rentables en cada punto del proceso.
- ¿Qué es?
- Plataforma de gestión de cobranza que reúne cartera, cliente e historial de gestiones en una sola fuente de verdad, reemplazando hojas de cálculo y sistemas dispersos.
- Objetivo
- Maximizar la recuperación reduciendo la mora, ordenando la operación por prioridad y asegurando que ningún crédito quede sin gestión.
- Propósito en el negocio
- Proteger la salud financiera: mejor flujo de caja, menos incobrables y capacidad sostenida de seguir colocando crédito. Traduce la estrategia de riesgo en ejecución diaria.
- Product Principles
- Seis principios gobiernan el diseño del producto. Toda pantalla y componente debe respetarlos.
- Una entidad central da contexto a todo.
- Un producto es más claro cuando todo se ancla a una unidad principal. En el CRM esa unidad es el crédito: cada cliente, gestión, promesa y alerta existe siempre en relación a él.
- 02
- El trabajo se ordena por prioridad, no por llegada.
- El sistema decide qué atender primero en lugar de dejarlo al azar. En el CRM, los Buckets agrupan la cartera por mora y riesgo, y definen prioridad, estrategia y responsable.
- 03
- Todo lo que ocurre queda registrado.
- La confianza y la mejora continua nacen de la trazabilidad. Cada acción se guarda con autor, fecha y resultado, habilitando auditoría, supervisión e inteligencia futura.
- 04
- Un solo lugar para entender y actuar.
- El usuario no debería saltar entre pantallas para decidir. Toda la información converge en una vista central —la Ficha 360— desde donde se consulta y se ejecuta sin perder contexto.
- 05
- El producto guía la siguiente acción.
- Un buen sistema no espera: propone. Sugiere qué hacer a continuación —a quién contactar, cuándo y con qué estrategia— para que la persona ejecute en vez de decidir desde cero.
- 06
- Automatizar lo repetitivo, liberar lo humano.
- La tecnología absorbe el trabajo mecánico para que las personas se concentren en lo que aporta valor. Recordatorios, escalamientos y reglas se automatizan; la negociación queda para el equipo.

</details>


## Product Architecture Handbook — CCI CRM › Sección 02: Product Map

<details><summary>Textos de documentación de la sección</summary>

- 02
- Product Map
- Arquitectura del CRM: qué módulos existen, cómo se relacionan y por qué la Ficha 360 es el núcleo donde converge la operación.
- El CRM se organiza alrededor de un núcleo —la Ficha 360— hacia el que converge prácticamente toda la operación. Los módulos principales alimentan, consultan o gobiernan ese núcleo. Este mapa responde qué existe y cómo se relaciona, antes de definir quién usa cada parte (Roles) y qué puede hacer (Mat
- Arquitectura del producto
- CENTRO OPERATIVO DEL CRM
- Ficha 360
- Donde convergen la información, las decisiones y las acciones sobre cada crédito · 13 módulos
- Dashboard
- Entrada · visibilidad
- Mi Cartera
- Operación · priorización
- Reportes
- Análisis · resultados
- Configuración
- Reglas del negocio
- Administración
- Gestión del sistema
- El recorrido principal entra por el Dashboard, prioriza en Mi Cartera y opera sobre la Ficha 360 —el centro operativo del CRM—. Reportes la consulta; Configuración y Administración la gobiernan de forma transversal. La línea resaltada marca la navegación principal.
- Recorrido de navegación
- Cómo se usa realmente el producto: el flujo principal de un asesor durante la gestión diaria.
- 1
- Ve prioridades del día
- →
- 2
- Prioriza y elige crédito
- 3
- Analiza el caso 360°
- 4
- Gestiona
- Promesa, convenio o contacto
- ↩
- Siguiente crédito
- Ficha 360 · 13 módulos internos
- CONTEXTO
- Resumen
- Cliente
- Vehículo
- FINANCIERO
- Estado de cuenta
- Promesas
- Convenios
- ACTIVIDAD
- Timeline
- Historial
- Notas
- GESTIÓN
- Alertas
- Referencias
- Documentos
- Acciones rápidas
- Ficha por módulo
- Detalle de cada módulo: para qué existe, quién lo usa, qué contiene y qué componentes del Design System reutiliza.
- OBJETIVO
- Dar visibilidad del estado de la cartera y del desempeño, con la vista adaptada a cada rol.
- RESPONSABILIDAD
- Es la puerta de entrada: orienta hacia dónde actuar, sin gestionar créditos directamente.
- ROL PRINCIPAL
- Todos (vista por rol) · Supervisor y Gerencia
- SUBMÓDULOS
- Dashboard por rol · KPIs · Alertas del día · Accesos rápidos
- COMPONENTES
- KPI cards · gráficos · badges de Bucket · listas de tareas
- Organizar y priorizar los créditos asignados para decidir a quién gestionar primero.
- Traduce la estrategia en una cola de trabajo priorizada y lleva al usuario a la Ficha 360.
- Asesor
- Lista/tabla de cartera · Filtros por Bucket · Cola de gestión
- Tabla · filtros · badges de Bucket · chips de estado · paginación
- Centro operativo
- Concentrar toda la información del crédito y del cliente para consultar, decidir y actuar sin cambiar de pantalla.
- Es el centro operativo: donde convergen la información, las decisiones y las acciones sobre cada crédito.
- Asesor (consulta transversal)
- 13 módulos: Resumen, Cliente, Vehículo, Estado de cuenta, Timeline, Promesas, Convenios, Referencias, Documentos, Historial, Alertas, Notas, Acciones rápidas
- Tabs · timeline · cards de cliente · tabla de estado de cuenta · paneles · badges
- Analizar resultados de recuperación, productividad y comportamiento de la cartera.
- Cierra el ciclo: mide lo que ocurre en la operación y realimenta la estrategia.
- Gerencia · Supervisor
- Reportes básicos · Exportables · Filtros por periodo y rol
- Gráficos · tablas · filtros · KPI cards
- Definir las reglas del negocio que gobiernan cómo se comporta la operación.
- Establece el marco de negocio: cómo se agrupa, prioriza y automatiza la cartera.
- Administrador
- Buckets · Automatizaciones · Plantillas · Configuración del CRM
- Formularios · inputs · toggles · tablas de reglas
- Gestionar el sistema y su gobernanza: usuarios, accesos y trazabilidad.
- Garantiza la gobernanza del sistema: quién accede, con qué permisos y con qué auditoría.
- Usuarios · Roles · Permisos · Auditoría · Integraciones
- Tablas · formularios · badges de rol · controles de permiso

</details>


## Product Architecture Handbook — CCI CRM › Sección 03: Roles del Sistema

<details><summary>Textos de documentación de la sección</summary>

- 03
- Roles del Sistema
- La arquitectura funcional del CRM vista desde cada tipo de usuario.
- Esta sección documenta quién usa el CRM, para qué, cómo lo usa durante su trabajo diario y hasta dónde llega su responsabilidad. No es una descripción de cargos: es la base para la Matriz de Permisos, la navegación y el diseño de pantallas. Cada rol se relaciona con los módulos definidos en el Produ
- Asesor
- Nivel · Operativo
- Supervisor
- Nivel · Táctico
- Gerencia
- Nivel · Estratégico
- Jurídico
- Nivel · Especializado
- Administrador
- Nivel · Sistema
- Estructura organizacional
- La línea de recuperación es jerárquica (Gerencia → Supervisor → Asesor). Jurídico y Administración son funciones transversales que apoyan todo el proceso.
- LÍNEA DE RECUPERACIÓN
- Estratégico
- Táctico
- Operativo
- FUNCIONES TRANSVERSALES
- Apoyan a todos los niveles del proceso, sin pertenecer a la línea jerárquica de recuperación.
- Especializado
- Administración
- Sistema
- A
- Gestionar y recuperar los créditos asignados de su cartera mediante contacto directo con el cliente.
- PROPÓSITO DE NEGOCIO
- Es la fuerza que convierte la estrategia de cobranza en recuperación real, cliente por cliente.
- NIVEL DE ACCESO
- RESPONSABILIDADES PRINCIPALES
- •  Gestionar diariamente los créditos de su cartera asignada. ⏎ •  Contactar clientes y negociar pagos, promesas y convenios. ⏎ •  Registrar cada gestión y su resultado en la Ficha 360. ⏎ •  Dar seguimiento a promesas y convenios pactados.
- DECISIONES QUE PUEDE TOMAR
- •  A quién contactar primero según la prioridad del Bucket. ⏎ •  Ofrecer y registrar promesas dentro de los parámetros permitidos. ⏎ •  Proponer convenios (sujetos a aprobación del Supervisor). ⏎ •  Marcar resultados y estados de gestión.
- INFORMACIÓN QUE VISUALIZA
- •  Su cartera asignada y la priorización por Bucket. ⏎ •  La Ficha 360 completa de cada crédito. ⏎ •  Promesas y convenios vigentes y su cumplimiento. ⏎ •  Alertas y tareas del día.
- MÓDULOS QUE UTILIZA
- Dashboard
- Mi Cartera
- Ficha 360
- Timeline
- Promesas
- Convenios
- RELACIÓN CON OTROS ROLES
- Reporta al Supervisor, que aprueba sus convenios y reasigna cartera. Escala a Jurídico los casos que pasan a instancia legal.
- ¿CÓMO SE MIDE EL ÉXITO?
- % de recuperación de su cartera · promesas cumplidas sobre pactadas · contactabilidad · nº de gestiones efectivas · reducción de la mora asignada.
- ✓
- PUEDE EJECUTAR
- •  Registrar gestiones y resultados. ⏎ •  Crear promesas de pago. ⏎ •  Proponer convenios. ⏎ •  Agregar notas y adjuntar documentos.
- ✕
- NO PUEDE EJECUTAR
- •  Aprobar convenios o quitas. ⏎ •  Reasignar créditos a otros asesores. ⏎ •  Configurar Buckets, reglas o automatizaciones. ⏎ •  Gestionar usuarios o permisos.
- USER JOURNEY
- · Recorrido diario en el sistema
- →
- Registrar gestión
- Crear promesa
- Siguiente crédito
- S
- Asegurar el desempeño del equipo de asesores y la salud de la cartera bajo su responsabilidad.
- Multiplica el impacto de la estrategia asegurando que cada equipo ejecute con foco y calidad.
- •  Supervisar la gestión diaria de su equipo de asesores. ⏎ •  Aprobar convenios, quitas y excepciones dentro de su alcance. ⏎ •  Reasignar y balancear la cartera entre asesores. ⏎ •  Monitorear alertas y casos críticos.
- •  Aprobar o rechazar convenios y quitas propuestos. ⏎ •  Reasignar créditos entre asesores. ⏎ •  Definir focos de gestión y prioridades del equipo. ⏎ •  Escalar casos a Gerencia o Jurídico.
- •  Dashboard de equipo y desempeño por asesor. ⏎ •  Alertas y casos críticos de la cartera. ⏎ •  Ficha 360 de cualquier crédito de su equipo. ⏎ •  Reportes operativos del equipo.
- Alertas
- Equipo
- Reportes
- Coordina a los Asesores y aprueba sus convenios; reporta a Gerencia y escala a Jurídico los casos legales.
- Recuperación del equipo vs. meta · cumplimiento de promesas del equipo · productividad por asesor · evolución de la mora del portafolio.
- •  Aprobar convenios y quitas dentro de su alcance. ⏎ •  Reasignar cartera entre asesores. ⏎ •  Registrar y editar gestiones del equipo. ⏎ •  Generar reportes operativos.
- •  Configurar Buckets, reglas o automatizaciones. ⏎ •  Gestionar usuarios, roles o permisos. ⏎ •  Aprobar excepciones fuera de su nivel (van a Gerencia).
- Aprobar convenio
- Reasignar
- G
- Dirigir la estrategia de cobranza y garantizar la salud financiera global de la cartera.
- Protege la salud financiera del negocio orientando toda la operación de cobranza hacia las metas.
- •  Definir metas de recuperación y estrategia por segmento y Bucket. ⏎ •  Monitorear la salud global de la cartera y sus tendencias. ⏎ •  Decidir políticas de convenios, quitas y excepciones de alto nivel. ⏎ •  Evaluar el desempeño de supervisores y equipos.
- •  Aprobar políticas y excepciones de alto nivel. ⏎ •  Definir metas y asignación de recursos. ⏎ •  Ajustar la estrategia según tendencias y KPIs. ⏎ •  Priorizar segmentos de la cartera.
- •  Dashboard ejecutivo y KPIs globales. ⏎ •  Reportes de recuperación, productividad y tendencias. ⏎ •  Salud de cartera por Bucket y segmento. ⏎ •  Comparativos entre equipos.
- Dashboard Ejecutivo
- Ficha 360 (consulta)
- Recibe reportes de los Supervisores, define la estrategia que ejecutan los equipos y coordina políticas con Jurídico y Administración.
- Recuperación global vs. meta · evolución de la mora y roll rates · costo de cobranza · % de cartera saludable · cumplimiento de metas por segmento.
- •  Aprobar políticas y excepciones de alto nivel. ⏎ •  Definir metas y estrategia de cobranza. ⏎ •  Consultar cualquier crédito y reporte.
- •  Gestión operativa diaria de créditos (no registra gestiones). ⏎ •  Configuración técnica del sistema (usuarios, permisos).
- KPIs
- Tendencias
- Salud de cartera
- Decisiones
- J
- Gestionar los créditos que escalaron a instancia legal y su recuperación por vía judicial o extrajudicial.
- Recupera el valor que la vía comercial ya no puede, protegiendo al negocio de la pérdida definitiva.
- ◆
- Transversal · Especializado
- •  Gestionar los casos legales asignados y sus expedientes. ⏎ •  Dar seguimiento a procesos judiciales y extrajudiciales. ⏎ •  Administrar los documentos legales del crédito. ⏎ •  Coordinar las acciones legales con el resto de la operación.
- •  Definir la estrategia legal de cada caso. ⏎ •  Registrar avances y estados del proceso legal. ⏎ •  Solicitar documentación y garantías.
- •  Casos legales y sus expedientes. ⏎ •  Ficha 360 del crédito (con foco legal). ⏎ •  Documentos, garantías y referencias. ⏎ •  Historial y timeline del caso.
- Casos legales
- Expedientes
- Documentos
- Recibe casos escalados por Asesores y Supervisores; informa a Gerencia el estado de los procesos legales.
- Recuperación por vía legal · avance y cierre de expedientes · tiempos de proceso · % de casos resueltos favorablemente.
- •  Gestionar expedientes y procesos legales. ⏎ •  Registrar avances legales y cargar documentos. ⏎ •  Actualizar el estado legal del crédito.
- •  Gestión de cobranza operativa (promesas y convenios comerciales). ⏎ •  Reasignar cartera operativa o configurar el sistema. ⏎ •  Aprobar convenios comerciales.
- Registrar avance legal
- Gestión legal
- Ad
- Configurar y gobernar el CRM: reglas de negocio, usuarios, permisos y trazabilidad del sistema.
- Hace que el CRM sea confiable y gobernable: la base sobre la que todos los demás roles operan.
- Transversal · Sistema
- •  Gestionar usuarios, roles y permisos. ⏎ •  Configurar Buckets, reglas y automatizaciones. ⏎ •  Administrar plantillas e integraciones. ⏎ •  Garantizar la auditoría y trazabilidad del sistema.
- •  Definir la estructura de Buckets y las reglas de negocio. ⏎ •  Otorgar y revocar accesos y permisos. ⏎ •  Configurar automatizaciones y plantillas.
- •  Usuarios, roles y permisos. ⏎ •  Configuración de Buckets, reglas y automatizaciones. ⏎ •  Registros de auditoría e integraciones. ⏎ •  Estado y parámetros del sistema.
- Configuración
- Usuarios
- Roles y Permisos
- Auditoría
- Da soporte transversal a todos los roles configurando el sistema; no participa en la cobranza ni en la estrategia comercial.
- Disponibilidad del sistema · integridad de accesos y permisos · cobertura de auditoría · % de automatizaciones activas y correctas.

</details>


## Product Architecture Handbook — CCI CRM › Sección 04: Matriz de Permisos

<details><summary>Textos de documentación de la sección</summary>

- 04
- Matriz de Permisos
- La arquitectura completa de permisos del CRM: quién puede hacer qué, en qué módulo y bajo qué condiciones.
- La Matriz de Permisos traduce los Roles del Sistema y el Product Map en reglas de autorización concretas. Documenta, de forma exhaustiva, qué acciones puede ejecutar cada rol en cada módulo, para que Diseño, Desarrollo y QA puedan implementar y verificar el control de acceso leyendo únicamente esta 
- ◆
- REGLA DE AUTORIZACIÓN
- La UI refleja los permisos pero nunca los sustituye: todo permiso debe validarse en el servidor. Todo lo que no está explícitamente permitido, está denegado por defecto.
- Principios de autorización
- Seis principios rigen cómo se otorgan y validan los permisos en el CRM.
- 01
- Mínimo privilegio
- Cada rol recibe únicamente los permisos que necesita para su función. Ante la duda, se niega el acceso.
- 02
- Denegación por defecto
- Todo lo que no está explícitamente permitido está prohibido. Los permisos se otorgan, nunca se asumen.
- 03
- Separación de responsabilidades
- Quien ejecuta una acción no es quien la aprueba: el Asesor propone convenios; el Supervisor los aprueba.
- Alcance por pertenencia
- Cada rol solo actúa sobre los datos dentro de su alcance: su cartera, su equipo o sus casos.
- 05
- Trazabilidad total
- Toda acción sensible se registra con autor, rol, fecha y resultado, habilitando auditoría y reversión.
- 06
- Validación en el servidor
- La autorización se resuelve en el backend. La UI oculta o deshabilita, pero el permiso real se verifica en cada endpoint.
- Niveles de permiso
- Cada celda de la matriz usa estas abreviaturas. Los permisos elevados (Aprobar) y críticos (Configurar, Eliminar) exigen mayor control y quedan siempre auditados.
- V
- Ver
- Consultar información sin modificarla.
- C
- Crear
- Generar nuevos registros: gestión, promesa, nota, caso.
- E
- Editar
- Modificar registros existentes dentro de su alcance.
- R
- Reasignar
- Transferir la propiedad de un crédito o caso a otro usuario.
- Es
- Escalar
- Derivar un caso a otro nivel o función (Jurídico, Gerencia).
- X
- Exportar
- Descargar datos o reportes fuera del sistema.
- A
- Aprobar
- Autorizar acciones propuestas por otro rol: convenios, quitas, excepciones.
- Cf
- Configurar
- Modificar reglas, Buckets, plantillas o parámetros del sistema.
- D
- Eliminar
- Dar de baja registros. Restringido y siempre auditado.
- Matriz principal · Roles × Módulos × Permisos
- V Ver · C Crear · E Editar · A Aprobar · R Reasignar · Es Escalar · X Exportar · Cf Configurar · D Eliminar · —  Sin acceso
- MÓDULO
- Asesor
- Supervisor
- Gerencia
- Jurídico
- Administrador
- Dashboard
- V · X
- Mi Cartera
- V · E
- V · E · R
- —
- Ficha 360
- Gestiones
- V · C · E
- Promesas
- Convenios / Quitas
- V · C
- V · A
- Casos legales
- V · Es
- Reportes
- Configuración
- V · C · E · Cf
- Administración
- V · C · E · Cf · D
- Reglas especiales y excepciones
- Permisos condicionados y acciones que requieren validaciones adicionales más allá de la matriz base.
- Separación de deberes
- Aprobación de convenios
- El Asesor propone convenios; requieren aprobación del Supervisor. Por encima del umbral de monto o descuento definido, escalan a Gerencia.
- Aprobación de Gerencia
- Quitas y castigos
- Cualquier quita o castigo de capital requiere aprobación de Gerencia y queda registrado en auditoría.
- Restricción de rol
- Reasignación de cartera
- Solo el Supervisor (dentro de su equipo) o el Administrador pueden reasignar créditos. Se notifica a los asesores origen y destino.
- Bloqueo por estado
- Crédito en instancia legal
- Cuando un crédito escala a Jurídico, la gestión comercial (promesas y convenios) se bloquea para Asesor y Supervisor: solo lectura.
- Restricción
- Edición fuera de alcance
- Ningún rol puede editar datos fuera de su alcance (cartera, equipo o casos). Los intentos se rechazan y se registran.
- Auditoría
- Exportación de datos
- Exportar se limita a Supervisor, Gerencia, Jurídico y Administrador. Toda exportación queda auditada: quién, qué y cuándo.
- Doble confirmación
- Configuración crítica
- Cambios en Buckets, reglas o automatizaciones requieren rol Administrador, pueden exigir doble confirmación y se versionan en el changelog.
- Exclusivo Administrador
- Eliminación de registros
- Eliminar es exclusivo de Administrador, se restringe a registros no financieros y es reversible vía auditoría (borrado lógico).
- Modelo de herencia de permisos
- La herencia es parcial y direccional: la visibilidad se amplía hacia arriba en la línea de recuperación, pero la ejecución no se hereda —cada rol conserva sus acciones propias— y las funciones transversales quedan fuera del modelo jerárquico.
- Su cartera
- ⊂
- Su equipo
- Toda la cartera
- La visibilidad (Ver) se hereda hacia arriba en la línea de recuperación. Jurídico y Administrador son transversales: no heredan ni ceden permisos a esta cadena.
- ↑
- SE HEREDA (hacia arriba)
- •  Visibilidad de la cartera del nivel inferior (Supervisor ve la de sus Asesores; Gerencia, la de todos). ⏎ •  Consulta (Ver) y reportes agregados. ⏎ •  Supervisión y aprobación de las acciones propuestas por el nivel inferior.
- ✕

</details>


## Product Architecture Handbook — CCI CRM › Sección 05: Product Evolution

<details><summary>Textos de documentación de la sección</summary>

- 05
- Product Evolution
- La dirección estratégica del CRM en cuatro etapas de madurez. El producto se construye de forma incremental.
- Hoy estamos en la Etapa 1. Las siguientes etapas marcan la evolución planificada del producto —la dirección, no un compromiso detallado de funcionalidades— y se desarrollarán conforme madure la plataforma.
- 01
- Etapa actual
- Operación
- CRM operativo para la gestión diaria.
- Buckets · Gestión · Promesas · Convenios · Reportes básicos · Dashboards operativos
- 02
- Planificado
- Automatización
- El sistema ejecuta tareas y comunicación por sí mismo.
- Reglas automáticas · Automatización de tareas · WhatsApp · Email · SMS · Escalamientos · Recordatorios
- 03
- Predicción
- El CRM anticipa el comportamiento de la cartera.
- Score de cobranza · Priorización inteligente · Predicción de incumplimiento · Siguiente mejor acción · Alertas inteligentes
- 04
- Optimización
- IA que mejora la estrategia de forma continua.
- Inteligencia Artificial · Automatización adaptativa · Optimización continua · Recomendaciones avanzadas · Copiloto para asesores · Simulaciones
- CIERRE DEL HANDBOOK
- Estás leyendo la Etapa 1 · Operación
- La documentación de este handbook corresponde a la Etapa 1 (Operación), que define la primera versión funcional del CRM. Las siguientes etapas representan la evolución planificada del producto y se desarrollarán conforme madure la plataforma.
- Product Architecture Handbook · v1.0
- Documento completo · Fuente oficial de referencia para el diseño de las pantallas del CRM

</details>


## Product Architecture Handbook — CCI CRM › Sección 06: Dashboard del Asesor

<details><summary>Textos de documentación de la sección</summary>

- 06
- Dashboard del Asesor
- Definición funcional de la primera pantalla del Sprint 1. Especifica qué muestra, qué permite hacer y cómo se integra — no la interfaz.
- OBJETIVO
- Dar al asesor una vista de inicio de jornada que le permita ver el estado de su cartera y su desempeño, e identificar rápidamente hacia dónde actuar hoy. Es la puerta de entrada del módulo: orienta y prioriza, no gestiona créditos directamente.
- INFORMACIÓN QUE MUESTRA
- •  Estado de la cartera asignada y su distribución por Bucket (B0–B5).
- •  Desempeño personal los KPIs del rol del período.
- •  Atención de hoy casos prioritarios, promesas por vencer y créditos críticos.
- •  Alcance solo la cartera propia del asesor (por pertenencia).
- ACCIONES PRINCIPALES
- •  Registrar gestión acceso rápido que abre el registro de gestión del crédito.
- •  Crear promesa de pago acceso rápido al alta de promesa.
- •  Ir a Mi Cartera con el filtro del insight seleccionado.
- •  Abrir Ficha 360 desde cualquier caso o alerta.
- KPIS (Y POR QUÉ)
- •  Recuperación de cartera — mide el objetivo central del rol.
- •  Promesas cumplidas / pactadas — calidad y compromiso real de la gestión.
- •  Contactabilidad — eficacia para alcanzar al cliente (1.er contacto ≤48h).
- •  Gestiones efectivas — productividad diaria con resultado.
- •  Reducción de mora asignada — impacto en la salud de su cartera.
- WIDGETS / BLOQUES
- •  Header de página (saludo/rol + acciones globales).
- •  Fila de KPIs (los 5 indicadores del rol).
- •  Distribución por Bucket (widget de reparto de la cartera).
- •  Atención de hoy (lista de casos y acciones prioritarias).
- •  Panel lateral promesas por vencer y créditos críticos (Alertas).
- ESTADOS VACÍOS
- •  Sin cartera asignada: Empty State con mensaje y CTA a contactar supervisor.
- •  Sin acciones ni promesas hoy: estado vacío positivo ("Todo al día").
- •  KPI sin datos suficientes: placeholder neutro con guion (—).
- ESTADOS DE CARGA
- •  Skeleton en KPI cards, listas y panel mientras cargan los datos.
- •  Header inmediato el encabezado de la vista se muestra sin esperar datos.
- •  Progresivo cada bloque resuelve su carga de forma independiente.
- PERMISOS (MATRIZ)
- •  Dashboard = Ver el asesor consulta; no gestiona desde aquí.
- •  Acciones deep-link abren módulos con permiso: Mi Cartera (V·E), Gestiones y Promesas (V·C·E), Convenios (V·C, propone).
- •  Alcance por pertenencia solo su cartera; casos legales solo Ver/Escalar.
- NAVEGACIÓN
- •  KPI / insight → Mi Cartera filtrada por ese criterio.
- •  Caso o fila → Ficha 360 del crédito.
- •  Bucket (Distribución) → Mi Cartera filtrada por Bucket.
- •  Alerta / promesa por vencer → Ficha 360 del crédito.
- •  Acción rápida → registro de gestión o alta de promesa del módulo.
- Reglas del patrón Dashboard Layout (aplican a todas las pantallas del CRM)
- REGLA · HEADER DE PÁGINA
- •  Nombre de la vista siempre presente.
- •  Descripción breve orientada al objetivo del rol que usa la pantalla.
- •  Acciones globales de la vista cuando existan.
- •  Consistencia misma estructura en todas las pantallas del CRM.
- REGLA · ZONA DE KPIS
- •  Flexible: 2 a 6 KPI Cards según las necesidades de cada pantalla.
- •  Auto Layout + wrap automático el área se adapta al contenido.
- •  Respeta Grid y Design System tokens de espaciado, tipografía y color.
- •  KPIs por rol se eligen según los objetivos del rol.

</details>


## Product Architecture Handbook — CCI CRM › Sección 07: Mi Cartera

<details><summary>Textos de documentación de la sección</summary>

- 07
- Mi Cartera
- La cola de trabajo priorizada del asesor: dónde acota, prioriza y lanza la gestión, y salta a la Ficha 360. Definición funcional — no la interfaz.
- OBJETIVO
- Organizar y priorizar los créditos asignados para decidir a quién gestionar primero y llevar al asesor a la Ficha 360. Traduce la estrategia en una cola de trabajo priorizada; el Dashboard orienta, Mi Cartera opera la lista completa.
- ROL EN EL FLUJO
- •  Entra paso 2: Dashboard → Mi Cartera → Ficha 360 → gestiona → vuelve.
- •  Llega desde CTA del Dashboard o clic en KPI/Bucket (entra con filtro aplicado).
- •  Espera su cartera completa priorizada, con filtros/búsqueda y próxima acción por caso.
- •  Sale a Ficha 360 cuando elige un caso que requiere contexto o decisión.
- INFORMACIÓN
- •  Permanente Crédito/Cliente, Bucket, Mora, Saldo, Próxima Acción, Acciones + total, filtros y paginación.
- •  Diferida a Ficha 360 timeline, historial, cliente/vehículo/referencias, estado de cuenta, documentos.
- •  No repetir del Dashboard KPIs de desempeño, agenda y alertas del día.
- ACCIONES
- •  Por fila (default) solo Abrir Ficha 360 y Llamar; el resto en el menú ⋯.
- •  En el menú ⋯ Registrar gestión, Crear promesa, proponer convenio, escalar a jurídico.
- •  Masivas Registrar gestión y Crear promesa; sin Reasignar/Escalar (permiso de Supervisor).
- •  Envían a otra pantalla Ficha 360 y los flujos de gestión/promesa.
- PRIORIZACIÓN
- •  Orden inicial 1) Bucket · 2) prioridad de Próxima Acción · 3) días de mora · 4) saldo.
- •  Filtros protagonistas Bucket (primario), estado de mora, promesa/convenio, sin gestión >48h.
- •  Búsqueda cliente, nº de crédito, placa/vehículo, DPI.
- •  Columnas indispensables: Crédito/Cliente, Bucket, Mora, Saldo, Próxima Acción, Acciones; secundarias: última gestión, promesa vigente, teléfono.
- ENCABEZADO OPERATIVO
- Contexto ligero de la lista (no KPIs, no compite con el Dashboard): créditos asignados (total), casos que requieren atención hoy y filtros activos. Solo enmarca lo que el asesor está viendo.
- ESTADOS DE LA TABLA
- •  Loading Skeleton mientras cargan filas.
- •  Empty sin cartera asignada (mensaje + contactar supervisor).
- •  Sin resultados los filtros no arrojan casos (limpiar filtros).
- •  Error de carga fallo de datos con reintento.
- •  Sin permisos el rol no puede ver esta cartera.
- •  Cartera sana todo al día, sin mora que gestionar (estado positivo).
- PERMISOS (MATRIZ)
- •  Mi Cartera = Ver + Editar (V·E) sobre la cartera propia.
- •  Gestiones y Promesas V·C·E; Convenios V·C (propone, no aprueba).
- •  Reasignar / Escalar Bucket solo Supervisor → ocultos por rol en la barra masiva.
- •  Alcance por pertenencia el asesor ve solo su cartera; casos legales Ver/Escalar.
- NAVEGACIÓN
- •  Fila → Ficha 360 del crédito.
- •  Próxima Acción → atajo a la gestión sugerida.
- •  Bucket / filtro → acota la lista in-situ.
- •  Volver de Ficha 360 conserva filtros y orden previos.
- COMPONENTES
- •  Table/Cartera con toolbar, Bottom Action Bar (acciones por rol vía booleanos) y Pagination.
- •  Badges y celdas Bucket, Mora, Cell/PróximaAcción, Dinero/Fecha/Estado/Avatar.
- •  Filtro y búsqueda Search Bar, Filter Bar, Chip, Dropdown.
- •  Estados Skeleton y Empty State. Shell: Dashboard Layout. Sin componentes nuevos.
- Reglas de producto (aplican a todas las tablas del sistema)
- REGLA · ACCIONES RÁPIDAS POR FILA
- •  Default = 2 acciones solo Abrir Ficha 360 y Llamar visibles en la fila.
- •  El resto en ⋯ Registrar gestión, Crear promesa, convenio, escalar, etc. van al menú.
- •  Consistencia toda tabla del sistema mantiene el mismo patrón limpio.
- REGLA · BARRA DE ACCIONES MASIVAS POR ROL
- •  Un solo componente la Bottom Action Bar se adapta por rol vía propiedades booleanas.
- •  Acciones toggleables Reasignar, Escalar Bucket, Registrar gestión, Crear promesa.
- •  Sin duplicar no se crean composiciones distintas por rol (Asesor/Supervisor/Gerencia).

</details>


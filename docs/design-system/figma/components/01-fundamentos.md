# 🎨 01 · Fundamentos  (`57:877`)

> Generado por `scripts/extract.py` desde la REST API de Figma. No editar a mano.

_Esta página no tiene componentes maestros; ver notas por sección._

## Fundamentos — CCI CRM › Sección: Título

<details><summary>Textos de documentación de la sección</summary>

- Sistema de Diseño — CCI CRM
- Fundamentos: color, tipografía, espaciado y estilo Clay UI (light / dark)

</details>


## Fundamentos — CCI CRM › Sección: Versión

<details><summary>Textos de documentación de la sección</summary>

- v1.0
- 13 de julio, 2026
- CERRADA
- Alcance de esta versión
- ·
- Fundamentos completos: color (Light/Dark), tipografía, espaciado, radios, sombras, grid, elevación, bordes, motion y opacidad.
- 66 componentes: base (botones, inputs, navegación, feedback, carga) y específicos del CRM de Cobros (badges, cards, timeline, tabla, KPIs, paneles).
- Iconografía integrada con Lucide (53 iconos) mediante componente Icon con instance swap.
- Guía de Motion: filosofía, tokens, comportamiento por componente y uso de loaders.
- Primer patrón de producto: Ficha 360 del Cliente, ensamblada 100% con componentes de la librería.
- Estado
- 66
- Componentes
- 53
- Iconos
- 2
- Modos (Light/Dark)
- 1
- Patrón de producto
- Changelog
- VERSIÓN
- FECHA
- CAMBIOS
- 13 jul 2026
- Versión inicial cerrada. Fundamentos completos (color Light/Dark, tipografía, espaciado, radios, sombras, grid, elevación, motion, opacidad), 64 componentes, 53 iconos Lucide, guía de Motion, Governance y patrón Ficha 360.
- —
- Auditoría de calidad: 453 colores reenlazados a variables (corrige el modo Dark), 635 espaciados y 133 radios a tokens, 52 sombras liberadas, Button consolidado (3 duplicados → 1), 13 Component Properties unificadas al español.
- Toda modificación futura al sistema debe registrarse aquí con su versión, fecha y descripción del cambio.
- Convención de nomenclatura
- Primitivas con nombre plano. Familias del CRM agrupadas con namespace Familia/Componente.
- Button
- Modal
- Badge/Bucket
- Card/Cliente
- KPI/Simple
- Component Properties
- Español, con acentos, PascalCase. Sin guiones bajos. Booleanos con prefijo Mostrar.
- Tipo
- Tamaño
- Etiqueta
- MostrarIcono
- ValorTendencia
- Variables
- Namespace por categoría, minúsculas, separadas por barra. Semánticas antes que primitivas.
- text/primary
- brand/primary
- space/16
- bucket/b2/bg
- duration/fast

</details>


## Fundamentos — CCI CRM › Sección: Governance

<details><summary>Textos de documentación de la sección</summary>

- Governance
- El Design System es la única fuente de verdad del producto.
- No se crean componentes nuevos para resolver el caso puntual de una pantalla. Todo elemento reutilizable vive en la librería, y las pantallas se construyen ensamblando instancias.
- Antes de crear un componente nuevo
- 01
- ¿Existe ya el componente?
- Busca en la librería. Muchos casos ya están resueltos con un componente que no conocías.
- 02
- ¿Se resuelve con una variante?
- Revisa si el componente tiene una variante que cubra tu caso (estado, tamaño, tipo).
- 03
- ¿Se resuelve con una propiedad?
- Component Properties: texto editable, mostrar/ocultar elementos, instance swap de iconos.
- 04
- ¿Se resuelve añadiendo una variante?
- Si el caso es legítimo y recurrente, extiende el componente existente en vez de crear uno nuevo.
- 05
- Solo entonces: crear componente
- Documéntalo, dale nomenclatura consistente, enlázalo a variables y regístralo en el changelog.
- Criterios para que un componente entre al sistema
- ✓
- Reutilizable
- Se usará en más de una pantalla o contexto. Si solo sirve para una vista, no pertenece al sistema.
- Enlazado a variables
- Colores, espaciados, radios y tipografía deben venir de tokens. Cero valores manuales.
- Auto Layout
- Debe adaptarse a su contenedor. Nada de tamaños fijos donde deba haber Hug o Fill.
- Con propiedades
- Texto editable, elementos opcionales y variantes que cubran los casos reales de uso.
- Documentado
- Nombre consistente, ubicado en su sección, con descripción de cuándo usarlo.
- Registrado
- Añadido al changelog con su versión y justificación.
- ✕
- ANTI-PATRONES — no hacer
- ·
- Detach de una instancia para "arreglarla rápido" en una pantalla. Si el componente no sirve, se mejora el componente.
- Copiar y pegar un componente para modificarlo. Eso crea duplicados que divergen con el tiempo.
- Usar colores, espaciados o radios manuales "solo esta vez". Rompe el modo oscuro y la consistencia.
- Crear un componente "temporal" con la intención de limpiarlo después. Nunca se limpia.

</details>


## Fundamentos — CCI CRM › Sección: Color · Primitivos

<details><summary>Textos de documentación de la sección</summary>

- Color · Primitivos
- neutral
- 0
- 50
- 100
- 200
- 300
- 400
- 500
- 600
- 700
- 800
- 900
- 950
- primary
- accent
- success
- warning
- danger
- info

</details>


## Fundamentos — CCI CRM › Sección: Color · Semántico (Light/Dark)

<details><summary>Textos de documentación de la sección</summary>

- Color · Semántico (Light / Dark)
- Light
- Fondos
- canvas
- surface
- surface-raised
- overlay
- Texto
- primary
- secondary
- tertiary
- inverse
- Bordes y Marca
- subtle
- default
- primary-hover
- primary-subtle
- Estados
- success/solid
- warning/solid
- danger/solid
- info/solid
- Dark

</details>


## Fundamentos — CCI CRM › Sección: Tipografía

<details><summary>Textos de documentación de la sección</summary>

- Tipografía — Plus Jakarta Sans
- display/lg
- Ejemplo de título grande 40/48
- display/md
- Ejemplo de título mediano 32/40
- heading/lg
- Título de sección 24/32
- heading/md
- Subtítulo 20/28
- heading/sm
- Encabezado de card 16/24
- body/lg
- Texto de cuerpo grande 16/24
- body/base
- Texto de cuerpo base 14/20
- body/sm
- Texto de cuerpo pequeño 13/18
- label/base
- Etiqueta 14/20 Medium
- label/sm
- Etiqueta pequeña 12/16 Medium
- number/lg
- Q165,578,589.46
- number/md
- 1,538
- caption
- Texto auxiliar / caption 12/16

</details>


## Fundamentos — CCI CRM › Sección: Espaciado

<details><summary>Textos de documentación de la sección</summary>

- Espaciado — escala base 4px
- 2px
- 4px
- 8px
- 12px
- 16px
- 20px
- 24px
- 32px
- 40px
- 48px
- 64px
- 80px

</details>


## Fundamentos — CCI CRM › Sección: Radios y Sombras Clay

<details><summary>Textos de documentación de la sección</summary>

- Radios y Sombras Clay
- Light — Raised
- radius/lg · clay-raised
- Light — Subtle
- Dark — Raised
- Dark — Subtle

</details>


## Fundamentos — CCI CRM › Sección: Grid

<details><summary>Textos de documentación de la sección</summary>

- Grid
- Desktop — 12 columnas · margen 80px · gutter 24px
- Tablet — 8 columnas · margen 40px · gutter 20px
- Mobile — 4 columnas · margen 20px · gutter 16px
- Variables: grid/columns · grid/margin · grid/gutter · grid/min-width — 3 modos (Desktop/Tablet/Mobile) en la colección "Grid"

</details>


## Fundamentos — CCI CRM › Sección: Elevación

<details><summary>Textos de documentación de la sección</summary>

- Elevación
- Card (Clay-Raised)
- Dropdown
- Tooltip
- Side Panel
- Modal
- Cards usan sombra Clay (dual). Overlays flotantes (dropdown, tooltip, panel, modal) usan una sombra neutra simple para mayor claridad sobre el contenido.

</details>


## Fundamentos — CCI CRM › Sección: Bordes y Divisores

<details><summary>Textos de documentación de la sección</summary>

- Bordes y Divisores
- border-width/hairline (1px)
- border-width/default (1px)
- border-width/thick (2px)
- Elemento superior
- Elemento inferior (separado por Divider)

</details>


## Fundamentos — CCI CRM › Sección: Iconografía

<details><summary>Textos de documentación de la sección</summary>

- Iconografía
- Especificación: grid 24×24px (contenedores 16/20/24) · trazo 1.75px con puntas y uniones redondeadas (round cap/join) · sin relleno, solo stroke, para mantener coherencia con el trazo suave del Clay UI · color por defecto: text/secondary; estado activo: brand/primary.
- Nota: esto define la estructura (contenedor, grid, grosor de trazo, tamaños y color) del sistema de iconos. Los pictogramas finales (Cobros, Cliente, Vehículo, Documento, WhatsApp, SMS, Correo, Llamada, Convenio, Promesa, Jurídico, Supervisor, Dashboard, Reportes, Configuración) se deben importar de

</details>


## Fundamentos — CCI CRM › Sección: Motion Philosophy

<details><summary>Textos de documentación de la sección</summary>

- Motion Philosophy
- El movimiento debe apoyar la comprensión de la interfaz, nunca distraer al usuario.
- Las animaciones nunca deben utilizarse únicamente como decoración; siempre deben tener una intención funcional y aportar claridad a la experiencia.
- Las animaciones tienen cuatro objetivos principales
- 01
- Comunicar cambios de estado
- El usuario entiende que algo cambió: un botón se presionó, un registro se guardó, un crédito cambió de Bucket. Sin movimiento, los cambios pasan desapercibidos.
- 02
- Guiar la atención
- El movimiento dirige la mirada hacia donde importa: un toast que entra, una alerta crítica que aparece, el foco que se desplaza en un formulario.
- 03
- Reforzar la jerarquía visual
- La duración y el tipo de movimiento comunican importancia. Un modal entra con más peso que un tooltip. Un side panel se desliza; un dropdown solo aparece.
- 04
- Retroalimentación inmediata
- El sistema responde al instante. Un hover, un click, un campo enfocado: el usuario debe percibir que la interfaz está viva y reaccionando a sus acciones.
- Regla de decisión
- ✓
- Sí — el movimiento tiene intención
- ·
- Un toast entra deslizándose para avisar que la gestión se guardó.
- El botón cambia de color al hover para indicar que es clickeable.
- El skeleton mantiene el layout mientras carga la tabla de cartera.
- La alerta crítica aparece con más peso visual que una informativa.
- ✕
- No — el movimiento distrae
- Animar elementos al hacer scroll solo porque "se ve bien".
- Rebotes, giros o efectos elásticos sin propósito funcional.
- Animaciones largas que retrasan al asesor en su trabajo diario.
- Movimiento en datos que el usuario está leyendo (tablas, cifras).

</details>


## Fundamentos — CCI CRM › Sección: Motion

<details><summary>Textos de documentación de la sección</summary>

- Motion
- Duraciones y curvas de animación. Tokens en la colección "Motion".
- Fast — 150ms
- hover, toggles, tooltips
- Normal — 250ms
- modales, dropdowns, toasts
- Slow — 400ms
- side panels, transiciones de página
- Ease In
- cubic-bezier(0.4, 0, 1, 1)
- elementos que salen
- Ease Out
- cubic-bezier(0, 0, 0.2, 1)
- elementos que entran
- Ease In-Out
- cubic-bezier(0.4, 0, 0.2, 1)
- movimiento y morphing
- Tokens de Spinner
- duration/spinner
- 800ms
- duración de un giro completo
- easing/spinner
- linear
- velocidad constante, sin aceleración
- iteration/infinite
- infinite
- se repite indefinidamente
- Implementación de referencia
- @keyframes spin { to { transform: rotate(360deg); } }
- .spinner { animation: spin var(--duration-spinner) var(--easing-spinner) infinite; }
- Guía de Comportamiento por Componente
- Comportamiento esperado de cada componente. Referencia única para desarrollo — no tomar decisiones fuera de esta tabla.
- COMPONENTE
- COMPORTAMIENTO
- DURACIÓN
- CURVA
- NOTAS
- Button · Hover
- Fade (cambio de color de fondo)
- 150ms
- ease-out
- Transición de background-color y box-shadow.
- Button · Pressed
- Scale down (0.98) + inner shadow
- 100ms
- Feedback táctil inmediato. Usa duration/instant.
- Modal
- Fade + Scale (0.95 → 1)
- 250ms
- El scrim hace fade por separado. Al cerrar: ease-in.
- Side Panel / Drawer
- Slide (desde la derecha)
- 300ms
- ease-in-out
- Entre duration/normal y slow. El scrim hace fade a la par.
- Toast
- Slide (desde arriba) + Fade
- Auto-dismiss a los 5s. Al salir: fade + slide inverso.
- Dropdown
- Fade + Scale (0.96 → 1)
- 200ms
- Origen de la transformación: borde superior del trigger.
- Tooltip
- Fade
- Delay de 400ms antes de aparecer. Sin delay al ocultar.
- Spinner
- Rotación continua (360°)
- iteration: infinite. Nunca usar easing con curva.
- Skeleton
- Shimmer (gradiente de izq. a der.)
- 1500ms
- iteration: infinite. Gradiente de 3 paradas.
- Tabs
- Slide del subrayado activo
- El indicador se desplaza; el texto hace fade de color.
- Accordion / Expand
- Height auto + Fade del contenido
- Animar max-height, no height, para evitar reflow.
- Toggle / Checkbox
- Slide del knob + Fade del fill
- El check aparece con un ligero scale.
- Tabla · Row hover
- Fade del background
- Debe sentirse instantáneo, es de alta frecuencia.
- Página / Ruta
- Fade del contenido
- No animar la navegación lateral, solo el área de contenido.
- Principios de Movimiento
- Entrar rápido, salir más rápido
- Los elementos aparecen con ease-out (desaceleran al llegar) y desaparecen con ease-in. Salir siempre es ~30% más rápido que entrar.
- El movimiento comunica jerarquía
- Un modal (250ms) se siente más importante que un tooltip (150ms). La duración refuerza el peso del elemento.
- Nada dura más de 400ms
- Por encima de eso el usuario percibe lentitud. Las únicas excepciones son las animaciones infinitas (spinner, skeleton).
- Linear solo para bucles
- Las curvas ease dan naturalidad a las transiciones, pero un spinner con easing se ve entrecortado. Bucles = linear, siempre.
- Respeta prefers-reduced-motion
- Si el usuario lo activa, reducir las animaciones a fade simple o eliminarlas. Los spinners pueden sustituirse por un indicador estático.

</details>


## Fundamentos — CCI CRM › Sección: Guía de Loaders

<details><summary>Textos de documentación de la sección</summary>

- Guía de Loaders — cuándo usar cada uno
- Regla única para todo el CRM. Evita que cada diseñador o desarrollador decida por su cuenta qué indicador de carga usar.
- Spinner
- CUÁNDO USARLO
- Procesos cortos (menos de 2–3 segundos) donde no existe contenido previo que representar.
- EJEMPLOS EN EL CRM
- Enviar un formulario corto
- Confirmar una acción en un modal
- Validar un campo
- ✕
- No usar para cargar tablas o dashboards — ahí va Skeleton.
- Skeleton
- Cargando contenido estructurado: tablas, tarjetas, listas o dashboards. Evita saltos visuales.
- Tabla de Cartera
- KPIs del dashboard
- Ficha 360 al abrir
- Timeline de gestiones
- No usar si no se conoce la estructura del contenido que llegará.
- Inline Loader
- Acciones puntuales dentro de un componente, sin bloquear el resto de la pantalla.
- Guardar una gestión
- Actualizar un registro
- Reasignar un crédito
- Botón en estado Loading
- No usar para cargas que afectan toda la vista.
- Full Page Loader
- Cargas iniciales del sistema o cambios completos de vista donde aún no existe contenido que mostrar.
- Login / arranque del CRM
- Cambio de módulo (Cobros → Jurídico)
- Recarga completa de sesión
- Usar con moderación: bloquea al usuario. Si hay estructura conocida, prefiere Skeleton.
- REGLA DE DECISIÓN RÁPIDA
- ¿Sé qué estructura va a tener el contenido? → Skeleton.  ¿Es una acción dentro de un componente? → Inline.  ¿Es el arranque del sistema? → Full Page.  ¿Ninguna de las anteriores y dura poco? → Spinner.

</details>


## Fundamentos — CCI CRM › Sección: Opacity

<details><summary>Textos de documentación de la sección</summary>

- Opacity
- Tokens de opacidad para overlays, estados disabled, loading y fondos.
- disabled
- 0.4
- loading
- 0.6
- overlay
- 0.5
- scrim
- 0.7
- hover
- 0.08
- subtle
- 0.12

</details>


## Fundamentos — CCI CRM › Sección: Mapa de Iconos · Lucide

<details><summary>Textos de documentación de la sección</summary>

- Mapa de Iconos · Lucide
- Correspondencia entre cada concepto del CRM y el nombre exacto del icono en Lucide. Busca estos nombres en el plugin de Lucide para insertarlos.
- →
- CÓMO INTEGRAR LOS ICONOS
- 1. Instala el plugin "Lucide" en Figma (Recursos → Plugins → buscar "Lucide").
- 2. Abre el plugin, busca el icono por su nombre (columna derecha de esta tabla) e insértalo.
- 3. Copia el vector y pégalo dentro del nodo "vector" del componente Icon, reemplazando el placeholder.
- 4. Ajusta el color del vector para que use la variable correspondiente (no color fijo).
- 5. Todos los componentes que usen instancias de Icon heredarán el cambio automáticamente.
- Navegación
- Dashboard
- layout-dashboard
- Cobros
- hand-coins
- Cartera
- wallet
- Clientes
- users
- Vehículos
- car
- Análisis
- chart-column
- Jurídico
- gavel
- Inversiones
- trending-up
- Contabilidad
- calculator
- Reportes
- file-text
- Configuración
- settings
- Admin
- shield
- Canales de contacto
- Llamada
- phone
- WhatsApp
- message-circle
- SMS
- message-square
- Correo
- mail
- Visita
- map-pin
- Notificación
- bell
- Gestión de cobranza
- Promesa
- handshake
- Convenio
- file-signature
- Reestructura
- refresh-cw
- Recuperación
- circle-check-big
- Apagado
- power-off
- Escalar Bucket
- Registrar gestión
- clipboard-check
- Reasignar
- user-round-cog
- Entidades
- Cliente
- user-round
- Asesor
- user-round-check
- Supervisor
- Vehículo
- Documento
- file
- Referencia
- users-round
- GPS
- satellite-dish
- Seguro
- shield-check
- Estados y alertas
- Crítica
- circle-alert
- Alerta
- triangle-alert
- Información
- info
- Éxito
- circle-check
- Error
- circle-x
- Pendiente
- clock
- Vencido
- calendar-x
- Pago recibido
- banknote
- Acciones de interfaz
- Buscar
- search
- Filtros
- list-filter
- Ordenar
- arrow-up-down
- Columnas
- columns-3
- Más opciones
- ellipsis-vertical
- Ver
- eye
- Editar
- pencil
- Eliminar
- trash-2
- Descargar
- download
- Cerrar
- x
- Expandir
- chevron-down
- Siguiente
- chevron-right

</details>


# 🧭 04 · Patrones de Producto  (`139:2020`)

> Generado por `scripts/extract.py` desde la REST API de Figma. No editar a mano.

_Esta página no tiene componentes maestros; ver notas por sección._

## Patrones de Producto — CCI CRM › Sección: Título

<details><summary>Textos de documentación de la sección</summary>

- Patrones de Producto
- Bloques funcionales ensamblados con componentes de la librería. Fase actual: Ficha 360.

</details>


## Patrones de Producto — CCI CRM › Sección: Ficha 360

<details><summary>Textos de documentación de la sección</summary>

- Patrón · Ficha 360 del Cliente
- ✓
- PRIMER PATRÓN OFICIAL DEL SISTEMA
- La Ficha 360 está ensamblada exclusivamente utilizando componentes reutilizables del Design System. No contiene componentes creados específicamente para esta pantalla.

</details>


## Patrones de Producto — CCI CRM › Sección: Dashboard Layout

<details><summary>Textos de documentación de la sección</summary>

- Patrón · Dashboard Layout
- Define únicamente el área de trabajo interna del módulo de Cobros. La navegación global (header, branding, notificaciones, perfil, selector de módulos) la aporta el CRM anfitrión.
- ✓  SEGUNDO PATRÓN OFICIAL DEL SISTEMA  ·  🔒 CONGELADO (SPRINT 1)
- El patrón define la estructura interna del módulo de Cobros: header de página, KPIs, área de widgets/listas/tablas y panel lateral opcional. La navegación global del CRM queda fuera de alcance. Todas las pantallas del Sprint 1 se construyen sobre este layout.
- Navegación global fuera de alcance. El header principal, branding, notificaciones, perfil y selector de módulos pertenecen al CRM anfitrión. Este patrón cubre solo el área de trabajo del módulo de Cobros.
- HEADER DE PÁGINA
- Título de la pantalla
- Contexto o descripción breve de la vista, adaptada a cada rol del módulo de Cobros.
- SISTEMA DE TARJETAS / KPIs
- ÁREA DE WIDGETS / LISTAS / TABLAS
- PANEL LATERAL (OPCIONAL)
- Slot flexible: aloja el componente Side Panel para ver detalle o ejecutar acciones sin salir de la pantalla.
- Comportamiento responsive y reglas de composición
- RESPONSIVE (COLECCIÓN GRID)
- •  Desktop ≥1440: grid 12 col · margen 80 · gutter 24 · KPIs en fila · panel lateral en columna (~380).
- •  Tablet 768–1439: grid 8 col · margen 40 · gutter 20 · KPIs 2×2 · panel lateral como overlay.
- •  Mobile <768: grid 4 col · margen 20 · gutter 16 · KPIs apilados · tabla con scroll horizontal · panel a pantalla completa.
- REGLAS DE COMPOSICIÓN
- •  Alcance de módulo: cubre solo el área de trabajo de Cobros; la navegación global la aporta el CRM anfitrión.
- •  Orden vertical fijo: Header de página → Sistema de KPIs → Área de widgets/listas/tablas.
- •  Solo tokens: color, tipografía, espaciado, radios y grid exclusivamente por variables de Fundamentos.
- •  Panel lateral opcional: columna ~380 u overlay Side Panel; no altera el ancho del contenido principal.
- •  Estados y permisos: carga con Skeleton, vacíos con Empty State y visibilidad según Matriz de Permisos.

</details>


## Patrones de Producto — CCI CRM › Sección: Patrones Pendientes

<details><summary>Textos de documentación de la sección</summary>

- Patrones Pendientes (siguiente fase)
- Side Panel
- Abrir información o ejecutar acciones sin abandonar la pantalla: registrar gestión, crear promesa, crear convenio, ver detalle, editar información.
- Dashboard Layout
- ✓ Implementado — ver patrón arriba
- Maestro–Detalle
- Lista + panel de detalle
- Wizard
- Flujos multi-paso (convenio, reestructura)
- Bulk Actions
- Acciones masivas sobre selección
- Búsquedas Avanzadas
- Filtros combinados y vistas guardadas
- Confirmaciones
- Patrones de confirmación destructiva
- Estados de Carga
- Skeletons y loaders en contexto
- Estados Vacíos
- Empty states por vista
- Gestión de Permisos
- Vistas según rol y Bucket

</details>


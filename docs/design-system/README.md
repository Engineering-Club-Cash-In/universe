# Design System — CCI CRM

El diseño oficial del CRM vive en Figma, en el archivo **CRM Ventas** (`ZFxSlzxMdQzVjZgdac7tnL`, equipo de Juan Daniel Cruz, carpeta CCI). Esta carpeta guarda una copia del archivo y explica cómo se traduce a código.

> **Color de marca:** el código usa el **violeta del logo CCI (#5260ff)**, no el teal (#1fa79b) de Figma. Lo eligió producto el 2026-10-05; los detalles están en [Decisiones](#decisiones). Todo lo demás (tipografía, radios, sombras, estados, buckets, modo oscuro) sale de Figma tal cual.

| Qué | Dónde |
| --- | --- |
| Tokens (colores claro/oscuro, espaciado, radios, sombras, tipografía, motion) | [`figma/tokens.json`](./figma/tokens.json) |
| Ficha de cada componente: props, variantes, medidas y tokens | [`figma/components/*.md`](./figma/components/) |
| Catálogo: componente → página, sección, id de Figma | [`figma/index.json`](./figma/index.json) |
| Tokens en CSS (lo que usa la app) | `apps/crm/apps/web/src/index.css` |
| Catálogo vivo (todos los componentes, claro/oscuro) | ruta **`/design-system`** del CRM (menú **Admin › Design System**). Parámetros: `?theme=light\|dark`, `?only=<id>` y `?brand=teal` |

## Actualizar la copia de Figma

Hace falta un token personal de Figma de **solo lectura** en `~/.config/figma/token`.

```bash
docs/design-system/figma/scripts/fetch.sh      # baja las páginas a figma/raw/ (ignorado por git, ~140 MB)
python3 docs/design-system/figma/scripts/extract.py   # regenera components/*.md e index.json
```

`tokens.json` sale de las variables de Figma. La API REST no las expone en el plan Pro, así que se sacan con el conector de Figma (`use_figma`). Si el diseñador cambia algún token, hay que volver a sacarlo así.

Las capturas de cada sección quedan en `figma/screenshots/` (también ignorado por git) y se regeneran con la API de imágenes.

## Cómo leer una ficha

Cada variante de un componente es un árbol, con un nodo por línea:

```
COMPONENT "Tipo=Primary, Tamaño=Medium, Estado=Default"  90x42  row  w:hug h:hug  p:12[space/12],24[space/24]
          gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light
  TEXT "Botón"  text:"Botón" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```

- `row`/`col` es auto-layout horizontal o vertical. `p:` es el padding (arriba,derecha,abajo,izquierda), `gap:` el espacio entre hijos y `w:/h:` el tamaño (fill, hug o fixed).
- `r:` es el radio, `bg:` el relleno, `bd:` el borde (grosor y si va dentro o fuera), `fx:` la sombra y `c:` el color del texto.
- Cuando el valor viene de una variable de Figma se ve el token y entre paréntesis el valor: `brand/primary(#1fa79b)`. **En código siempre se usa el token, nunca el hex.**
- `→ "Icon / Tamaño=S, Color=Inverso"` es una instancia de otro componente, y `props{…}` son los valores de sus propiedades.

## Tokens → clases de Tailwind

### Color semántico (cambia solo entre claro y oscuro)

| Figma | Clase | Notas |
| --- | --- | --- |
| `bg/canvas` | `bg-canvas` | fondo de página (también `bg-background`) |
| `bg/surface` | `bg-surface` | cards (también `bg-card`) |
| `bg/surface-raised` | `bg-surface-raised` | popovers y menús (también `bg-popover`) |
| `bg/overlay` | `bg-overlay` | scrim de modales, con opacidad (`bg-overlay/50`) |
| `text/primary` | `text-fg` | también `text-foreground` |
| `text/secondary` | `text-fg-secondary` | también `text-muted-foreground` |
| `text/tertiary` | `text-fg-tertiary` | |
| `text/inverse` | `text-fg-inverse` | |
| `text/on-solid` | `text-on-solid` | texto sobre rellenos sólidos de estado, bucket o marca |
| `border/default` | `border-line` | inputs y botón Ghost (también `border-input`) |
| `border/subtle` | `border-line-subtle` | cards; es el borde por defecto (`border`) |
| `border/divider` | `border-divider` | separadores |
| `brand/primary` · `-hover` · `-subtle` · `on-primary` | `bg-brand` · `bg-brand-hover` · `bg-brand-subtle` · `text-on-brand` | también `bg-primary`, `text-primary-foreground`. **Violeta, no teal** ([Decisiones](#decisiones)) |
| `accent/default` · `subtle` · `alt-bg` | `bg-accent-default` · `bg-accent-subtle` · `bg-accent-alt` | naranja. **No es** el `accent` de shadcn, que es el gris de hover |
| `status/{success,warning,danger,info}/solid` | `bg-success-solid`, `bg-danger-solid`, … | |
| `status/…/subtle` | `bg-success-subtle`, … | fondo suave |
| `status/…/text` | `text-success-text`, … | texto sobre el fondo suave |
| `status/success/alt-bg` · `alt-fg` | `bg-success-alt-bg` · `text-success-alt-fg` | |
| `status/violet/bg` · `fg` | `bg-violet-bg` · `text-violet-fg` | |
| `bucket/bN/solid` · `bg` · `fg` (N = 0…5) | `bg-bucket-bN` · `bg-bucket-bN-bg` · `text-bucket-bN-fg` | |

### Primitivos (el mismo valor en claro y oscuro)

`bg-cci-primary-600`, `text-cci-neutral-500`, `bg-cci-carbon-800`, etc. Hay una clase por cada `Color/Primitives` de Figma, con el `/` cambiado por `-`. Úsenlos **solo** cuando Figma liga el primitivo directamente, como el hover del botón Primary (`primary/600`). En ese caso agreguen la variante `dark:` que corresponda, porque el primitivo no cambia con el modo.

### Radios

| Figma | `radius/xs` 6 | `sm` 8 | `sm-plus` 10 | `md` 14 | `lg` 20 | `xl` 28 | `full` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Clase | `rounded-sm` | `rounded-md` | `rounded-lg` | `rounded-xl` | `rounded-2xl` | `rounded-3xl` | `rounded-full` |

### Sombras

| Figma | Clase |
| --- | --- |
| `Shadow/Clay-Subtle` (Light/Dark) | `shadow-clay-subtle` |
| `Shadow/Clay-Raised` (Light/Dark) | `shadow-clay-raised` |
| `Elevation/Dropdown` · `Tooltip` · `SidePanel` · `Modal` | `shadow-dropdown` · `shadow-tooltip` · `shadow-sidepanel` · `shadow-modal` |
| Estado *Pressed*: `inset 0 2 4 #0000002e` | `shadow-pressed` |

### Tipografía: Plus Jakarta Sans

| Figma | Clase | Tamaño, interlineado y peso |
| --- | --- | --- |
| `display/lg` · `display/md` | `type-display-lg` · `type-display-md` | 40/48 700 · 32/40 700 |
| `heading/lg` · `md` · `sm` | `type-heading-lg` · `-md` · `-sm` | 24/32 700 · 20/28 600 · 16/24 600 |
| `body/lg` · `base` · `sm` | `type-body-lg` · `-base` · `-sm` | 16/24 · 14/20 · 13/18 (400) |
| `label/base` · `sm` | `type-label-base` · `-sm` | 14/20 500 · 12/16 500 |
| `number/lg` · `md` | `type-number-lg` · `-md` | 28/34 700 · 20/26 600 |
| `caption` | `type-caption` | 12/16 400 |

Si en Figma el texto no usa un estilo, la ficha muestra tamaño, peso e interlineado sueltos: usen `text-[13px] font-semibold leading-none` o la clase más cercana. "Interlineado auto" en Plus Jakarta equivale a 126%.

### Scrollbar

Es global, en `index.css`, y sale del nodo "scrollbar" de los paneles del Workspace en Figma: carril de 5px en `border/subtle`, thumb `neutral/500` con radio 3. No hace falta clase: lo toma cualquier contenedor con scroll. Firefox no deja fijar el ancho exacto, así que ahí se usa `scrollbar-width: thin` con los mismos colores.

### Espaciado, opacidad y motion

- `space/N` px equivale a la escala de Tailwind (`N/4`): `space/12` → `p-3`, `space/6` → `gap-1.5`, `space/14` → `p-3.5`, `space/3` → `gap-0.75`.
- `opacity/disabled` (0.4) → `opacity-40`, `hover` 0.08, `subtle` 0.12, `overlay` 0.5, `scrim` 0.7. ⚠️ En Figma las variables de opacidad quedaron como porcentaje: la ficha muestra `opacity:0.004[opacity/disabled]`, pero lo que se quiso es 40%.
- `duration/fast` 150 → `duration-150`, `normal` 250, `slow` 400. Las curvas `easing/*` de Figma son las mismas de Tailwind (`ease-in`, `ease-out`, `ease-in-out`).

## Reglas para implementar componentes

1. **No romper las pantallas.** Los componentes de `components/ui/` se usan en todo el CRM, así que se mantienen sus exports, props y nombres de `variant`/`size`. Lo que cambia es el aspecto. Cuando Figma tiene variantes que no existen, se agregan como valores nuevos. El mapeo Figma → prop se documenta en un comentario al inicio del archivo (ver `button.tsx`).
2. **Solo tokens.** Nada de hex, de `bg-gray-*` ni de colores de Tailwind sueltos. Primero el semántico; el primitivo `cci-*` solo si Figma lo usa, con su `dark:`.
3. **Modo oscuro obligatorio.** El CRM arranca en oscuro por defecto. Cada componente se revisa en los dos modos en `/design-system`.
4. **Dónde va cada cosa:**
   - Componentes base (página 02 · Componentes): `apps/crm/apps/web/src/components/ui/<nombre>.tsx`. Los interactivos usan Radix (paquete `radix-ui`).
   - Componentes del CRM (página 03 · Componentes CRM): `apps/crm/apps/web/src/components/ds/<nombre>.tsx`. Son de presentación: reciben datos por props y no consultan el servidor.
   - Catálogo: un `components/design-system/showcase/<grupo>.showcase.tsx` por grupo, con `export const meta` y `export default`. Se registra solo.
5. **Textos en español.** En cobros se trata de usted (ver la [guía de redacción](../features/cobros-02/12-guia-de-redaccion.md)).
6. **Íconos:** `lucide-react`, que es la misma librería de la sección "Iconos Lucide" de Figma (`lucide/circle-check` → `CircleCheck`).

## Mapeo de variantes de Figma

### Button
| Figma | `variant` |
| --- | --- |
| Primary | `default` (alias `primary`) |
| Secondary | `secondary` |
| Ghost (borde) | `outline` |
| Text | `link` (alias `text`) |
| Danger | `destructive` (alias `danger`) |
| (sin borde, para íconos) | `ghost` |

Tamaños: Medium → `default` (42px), Small → `sm` (32px). Estado Loading → prop `loading`.

## Inventario

El mapeo detallado de Figma a props está en el comentario al inicio de cada archivo. Todo se ve en `/design-system`.

**Base (`components/ui/`)**

| Componente | Archivos |
| --- | --- |
| Botones | `button`, `toolbar-button` (Button/Toolbar y QuickAction) |
| Formularios | `input` (+ `InputGroup`), `textarea`, `label`, `form`, `field-message`, `search-input`, `password-input`, `date-input`, `currency-input` |
| Selección | `checkbox`, `radio-group`, `switch` (Toggle), `select` (Dropdown), `combobox`, `dropdown-menu` (Context Menu), `popover`, `command` |
| Navegación | `tabs`, `breadcrumb`, `pagination`, `section-header`, `agenda`, `period-selector`, `filter-bar`, `search-bar` |
| Overlays | `dialog` (Modal), `alert-dialog`, `sheet` (Side Panel), `sonner` (Toast), `tooltip`, `info-tooltip` |
| Feedback | `alert` (Callout), `checklist`, `empty-state`, `spinner` (Loader), `skeleton`, `progress` |
| Datos | `avatar`, `chip`, `badge`, `card`, `separator` (Divider), `data-field`, `icon`, `operational-summary`, `table`, `calendar`, `date-picker`, `react-datepicker` |

**CRM (`components/ds/`), página 03**

| Grupo | Archivos |
| --- | --- |
| Badges e indicadores | `badges` (Bucket, Mora, Promesa, Convenio, Acción, Gestión), `indicadores`, `cartera-chips`, `proxima-accion-cell` |
| Timeline | `timeline`, `historial-promesa` |
| Cards y paneles | `cards-credito`, `cards-cobranza`, `card-asesor`, `card-aprobacion`, `panel-resumen-credito`, `header-credito`, `ficha-edicion` |
| Dashboards | `kpi`, `dashboard-role-header`, `distribucion-bucket`, `alertas` |
| Acciones y cartera | `action-crm`, `action-bars`, `table-cells`, `tabla-cartera`, `ubicaciones` |

**Pendiente (fase 2):**
- Migrar las pantallas a los componentes nuevos y quitar los colores puestos a mano.
- Construir los componentes del Workspace y del Supervisor (página 02), junto con el rediseño de cobros.

## Decisiones

### Color de marca: violeta del logo (2026-10-05)

El diseñador eligió un teal (`primary/500` = #1fa79b) y producto lo cambió por el violeta del logo CCI, que representa mejor a la empresa. Las opciones que se compararon en el CRM fueron el teal de Figma, el lavanda exacto del logo (#969fff) y una versión más saturada del mismo tono. Quedó esta última.

Solo cambia la escala `Color/Primitives › primary/*`, siempre con el mismo tono del logo (235°). Los tokens semánticos (`brand/*`) siguen apuntando a la escala como en Figma, así que **no hubo que tocar ningún componente**.

| primary | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Código (violeta) | #eef0ff | #dfe2ff | #c2c7ff | #a1a9ff | #7d88ff | **#5260ff** | #3f4ce6 | #333dbf | #2a3299 | #212773 |
| Figma (teal) | #edfbfa | #d3f5f1 | #a8ece3 | #74ddd1 | #3ec5b7 | #1fa79b | #158b82 | #106f68 | #0d5852 | #0a423e |

- **Legibilidad:** el texto blanco sobre `primary/500` tiene contraste 4.69, que pasa AA para texto grande y casi para normal. El teal daba 2.97.
- **En oscuro:** la marca es `primary/400` (#7d88ff) con texto `neutral/950`, igual que la regla de Figma.
- **Pendiente con el diseñador:** que actualice la escala en Figma para que diseño y código no se separen. Además, `status/violet/*` (`info/bg` #ede8ff, `info/fg` #4832b8) ahora se parece a la marca; conviene que lo mueva a otro tono.
- En `/design-system` hay un interruptor **Violeta (oficial) / Verde (Figma)** para presentaciones. Pone `data-brand="teal"` en `<html>` solo mientras se está en esa página, no se guarda, y al salir el CRM vuelve al violeta. El override está en `index.css` (`:root[data-brand="teal"]`).
- `figma/tokens.json` sigue siendo la copia fiel de Figma, con el teal. La fuente de verdad del código es `index.css`.

### Cómo se mapeó Figma a la API existente

Los componentes de `ui/` conservan sus props, así que ninguna pantalla se rompe. Los nombres de Figma se agregaron como valores nuevos. Los mapeos principales:

| Figma | Código |
| --- | --- |
| Button Primary / Secondary / Ghost / Text / Danger | `variant` `default` / `secondary` / `outline` / `link` / `destructive` (alias `primary`, `text`, `danger`) |
| Button Medium / Small · Loading | `size` `default` (42px) / `sm` (32px) · prop `loading` |
| Input Success / Error | `status="success" \| "error"` o `aria-invalid`; `InputGroup` para los íconos dentro del campo |
| Toggle | `Switch` (nuevo) |
| Dropdown Single / Searchable / Multi | `Select` / `Combobox` / Popover + Command + `Checkbox size="sm"` |
| Context Menu (Tono=Peligro) | `DropdownMenuItem variant="destructive"` |
| Modal (Tipo) | `Dialog`/`AlertDialog` + `DialogIcon`/`AlertDialogIcon variant` |
| Side Panel | `Sheet` con `size="sm\|md\|lg"`, `SheetBody`, `SheetFooter` |
| Callout (Tono) | `Alert variant` (`brand`, `success`, `warning`, `destructive`, `info`) o `Callout` |
| Loader | `Spinner`, `LoaderInline`, `LoaderPage` |
| Chip / Badge | `Chip tone` · `Badge variant` (`success`, `warning`, `danger`, `info`, `brand`, `neutral`) |
| Card (cards de 03 / Workspace) | `Card variant="default" \| "raised" \| "flat"` |

### Desvíos intencionales respecto a Figma

- **Opacidad de deshabilitado:** 40%. En Figma quedó en 0.4% porque las variables de opacidad se guardaron como porcentaje.
- **Tamaños rotos:** algunos nodos de Figma quedaron con alto "hug" mal calculado (avatares, círculos de íconos) y en el archivo se ven como píldoras. En código son círculos.
- **Rellenos blancos:** se quitaron los fondos blancos de frames internos, que en modo oscuro dejarían parches.
- **Textos:** se pasaron a usted, según la guía de cobros. Por ejemplo, "Pendiente de su aprobación" y "Seleccione el día y la hora".
- **Colores sueltos:** las secciones con hex sueltos (Ubicaciones, Card/Cobro, Card/ModuleEntry, Info/*) se pasaron al token más cercano. El detalle está en el comentario de cada archivo.
- **Primitivos sin modo oscuro:** cuando Figma liga un primitivo sin valor oscuro (hover `neutral/50`, track del toggle `neutral/300`, tooltip `neutral/900`), se eligió un `carbon-*` equivalente con `dark:`.
- **Radios y tamaños de texto sin token** (16, 12, 4; textos de 9 a 18px): van con clases sueltas (`rounded-[16px]`, `text-[13px] leading-[1.26]`).
- **Scrollbar:** el nodo del Workspace se aplicó globalmente (ver [Scrollbar](#scrollbar)).
- **Toasts:** se ven como en Figma, pero Error y Warning **siguen cerrándose solos**. Figma pide que no, y cambiar eso afecta unas 400 llamadas; queda por decidir.

### Cambios visibles en pantallas existentes

Las pantallas no se tocaron, pero toman el aspecto nuevo porque usan los componentes base:

- **Paleta:** violeta de marca, grises cálidos, Plus Jakarta Sans y sombras Clay.
- **Controles:**
  - Inputs, selects y botones pasan a 42px y radio 14.
  - Checkbox y radio pasan a 20px.
  - El combobox ahora se ve como un select.
- **Etiquetas de campos:** 13px en gris secundario.
- **Tabs:** pasan de pastilla segmentada a subrayado a todo el ancho. Donde la pantalla le pone `p-1` a la lista (oportunidades), la barra activa queda 4px arriba de la línea.
- **Tablas:**
  - El encabezado va en 10px mayúsculas sobre `bg-canvas`.
  - Las filas pasan a 56px (`density="compact"` las deja en 40px).
  - El calendario aparece en español y la semana empieza el lunes.
- **Overlays:**
  - Los modales tienen radio 28.
  - El `AlertDialog` pasa a 420px con botones de 32px.
  - Los toasts son blancos, con borde, barra y pastilla de color.
  - En oscuro, los tooltips son oscuros.
- **Feedback:**
  - Los badges son píldoras; `destructive` pasa a rojo suave y `secondary` a gris.
  - El `Alert destructive` tiene fondo rojo suave.
  - El loader de página es un spinner de 40px.
  - El skeleton tiene shimmer.

### Pendientes para el diseñador

1. Actualizar `primary/*` al violeta y mover `status/violet` a otro tono.
2. Corregir las variables de opacidad, que están en porcentaje.
3. Badge/Bucket "Completa" B2 y B4: el texto usa `status/*/text` y no `bucket/bN/fg`.
4. Empty State: el círculo del ícono (`bg/surface-raised`) no se distingue sobre cards blancas en modo claro.
5. Ubicaciones, Card/Cobro, Card/ModuleEntry e Info/*: tienen hex sueltos y les faltan tokens.
6. Agregar estilos de texto y radios para los valores que hoy van sueltos.
7. Definir si los toasts de Error y Warning deben quedarse fijos.

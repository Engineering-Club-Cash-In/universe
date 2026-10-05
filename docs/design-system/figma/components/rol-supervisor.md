# 🟠 03 · Supervisor  (`1954:12`)

> Generado por `scripts/extract.py` desde la REST API de Figma. No editar a mano.

## 🟠 08 · Workspace v3 · Aprobación › Workspace/AprobacionPanel · Supervisor

### Workspace/AprobacionPanel · Supervisor  `3345:4274` — component_set, 10 variante(s)

- **Estado** (variante): Revisión · Aprobada — default `Revisión`
- **Tipo** (variante): Rebaja de mora · Documentos · Convenio · Entrega voluntaria · Acción crítica — default `Rebaja de mora`

#### Estado=Revisión, Tipo=Rebaja de mora
```
COMPONENT  "Estado=Revisión, Tipo=Rebaja de mora"  531x643  col  w:fixed h:fixed  p:20,24  gap:14  bg:#ffffff
  FRAME  "tipo"  103x21  row  w:hug h:hug  p:4,10  r:999  bg:status/warning/subtle(#fcefc7)  clip
    TEXT  "Rebaja de mora"  83x13  w:hug h:hug  text:"Rebaja de mora" Inter 600 11/13.31 c:status/warning/text(#b37d0f)
  TEXT  "Solicitud de aprobación"  483x21  w:fill h:hug  text:"Solicitud de aprobación" Inter 600 17/20.57 c:#24211f
  TEXT  "Solicitada por L. Morales · hace 5 h · Crédito #48972"  483x15  w:fill h:hug  text:"Solicitada por L. Morales · hace 5 h · Crédito #48972" Inter 400 12/14.52 c:#6b6661
  FRAME  "detalle"  483x261  col  w:fill h:hug  p:14,16  gap:10  r:12  bg:bg/surface-raised(#ffffff)  clip
    TEXT  "Rebaja de mora — define el porcentaje"  223x15  w:hug h:hug  text:"Rebaja de mora — define el porcentaje" Inter 600 12/14.52 c:#24211f
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  clip
      TEXT  "Deuda total a pagar"  377x15  w:fill h:hug  text:"Deuda total a pagar" Inter 400 12/14.52 c:#6b6661
      TEXT  "Q 4,840.00"  66x15  w:hug h:hug  text:"Q 4,840.00" Inter 600 12/14.52 c:#24211f
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  clip
      TEXT  "Mora acumulada"  379x15  w:fill h:hug  text:"Mora acumulada" Inter 400 12/14.52 c:#6b6661
      TEXT  "Q 1,240.00"  64x15  w:hug h:hug  text:"Q 1,240.00" Inter 600 12/14.52 c:#24211f
    TEXT  "% de rebaja sobre la mora"  136x13  w:hug h:hug  text:"% de rebaja sobre la mora" Inter 500 11/13.31 c:#6b6661
    FRAME  "selector"  451x48  row  w:fill h:hug  clip
      FRAME  "pct-input"  451x48  row  w:fill h:hug  p:12,14  justify:space_between  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:brand/primary(#1fa79b) 1.5in  clip
        FRAME  "val"  42x21  row  w:hug h:hug  gap:1  items:center  clip
          TEXT  "50"  23x21  w:hug h:hug  text:"50" Inter 600 17/20.57 c:brand/primary(#1fa79b)
          TEXT  "%"  15x21  w:hug h:hug  text:"%" Inter 600 17/20.57 c:brand/primary(#1fa79b)
          RECTANGLE  "Rectangle"  2x19  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)
        TEXT  "sobre la mora"  78x15  w:hug h:hug  text:"sobre la mora" Inter 400 12/14.52 c:text/secondary(#6b6459)
    TEXT  "Escribe el porcentaje; el sistema recalcula la rebaja y el total automáticamente."  451x13  w:fill h:hug  text:"Escribe el porcentaje; el sistema recalcula la rebaja y el total automáticame…" Inter 400 11/13.31 c:text/secondary(#6b6459)
    FRAME  "dv"  451x1  w:fill h:fixed  bg:border/divider(#ebe9e6)  clip
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  clip
      TEXT  "Rebaja aplicada (50%)"  377x15  w:fill h:hug  text:"Rebaja aplicada (50%)" Inter 400 12/14.52 c:#6b6661
      TEXT  "− Q 620.00"  66x15  w:hug h:hug  text:"− Q 620.00" Inter 600 12/14.52 c:status/warning/text(#b37d0f)
    FRAME  "Frame"  451x18  row  w:fill h:hug  gap:8  items:center  clip
      TEXT  "Total a pagar"  361x16  w:fill h:hug  text:"Total a pagar" Inter 400 13/15.73 c:#6b6661
      TEXT  "Q 4,220.00"  82x18  w:hug h:hug  text:"Q 4,220.00" Inter 600 15/18.15 c:brand/primary(#1fa79b)
  TEXT  "Nota del asesor"  91x15  w:hug h:hug  text:"Nota del asesor" Inter 600 12/14.52 c:#24211f
  TEXT  "El cliente puede pagar la cuota completa hoy si se le condona la mora acumulada. Ha mostrado disposición y es su primer atraso en el bucket."  483x30  w:fill h:hug  text:"El cliente puede pagar la cuota completa hoy si se le condona la mora acumula…" Inter 400 12/14.52 c:#4d4a47
  FRAME  "notas"  483x87  col  w:fill h:hug  gap:8  bg:#ffffff  clip
    TEXT  "Notas del supervisor"  121x15  w:hug h:hug  text:"Notas del supervisor" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "input"  483x64  col  w:fill h:fixed  p:12  r:10  bg:bg/surface-raised(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
      TEXT  "Agrega una nota (opcional)…"  164x15  w:hug h:hug  text:"Agrega una nota (opcional)…" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "sp"  483x1  w:fill h:fill  clip
  FRAME  "acciones"  483x42  row  w:fill h:hug  gap:12  bg:#ffffff  clip
    INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Rechazar}
      · textos: "Rechazar"
    INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Aprobar}
      · textos: "Aprobar"
```
#### Estado=Aprobada, Tipo=Rebaja de mora
```
COMPONENT  "Estado=Aprobada, Tipo=Rebaja de mora"  531x643  col  w:fixed h:fixed  p:32,24,24,24  gap:16  justify:space_between  items:center  bg:#ffffff
  FRAME  "content"  483x225  col  w:fill h:hug  p:24,0,0,0  gap:14  items:center  clip
    FRAME  "halo"  84x84  row  w:fixed h:fixed  justify:center  items:center  r:42  bg:status/success/subtle(#d9f5e3)  clip
      FRAME  "circ"  56x56  row  w:fixed h:fixed  justify:center  items:center  r:28  bg:status/success/solid(#22b267)  clip
        TEXT  "✓"  22x33  w:hug h:hug  text:"✓" Plus Jakarta Sans 700 26/32.76 c:bg/surface(#ffffff)
    TEXT  "Rebaja de mora aprobada"  275x28  w:hug h:hug  text:"Rebaja de mora aprobada" Plus Jakarta Sans 700 22/27.72 align-center c:text/primary(#24211d)
    TEXT  "La rebaja quedó aplicada al crédito."  483x18  w:fill h:hug  text:"La rebaja quedó aplicada al crédito." Plus Jakarta Sans 400 14/17.64 align-center c:text/secondary(#6b6459)
    FRAME  "pill"  208x29  row  w:hug h:hug  p:7,14  gap:7  items:center  r:16  bg:status/success/subtle(#d9f5e3)  clip
      ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/success/solid(#22b267)
      TEXT  "Guardado en el historial · hoy"  166x15  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 12/15.12 c:status/success/text(#157a45)
  FRAME  "acciones"  483x98  col  w:fill h:hug  gap:10  clip
    FRAME  "cerrar-btn"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary-subtle(#edfbfa)  clip
      TEXT  "Volver a la bandeja"  125x18  w:hug h:hug  text:"Volver a la bandeja" Plus Jakarta Sans 600 14/17.64 c:brand/primary(#1fa79b)
    FRAME  "siguiente"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary(#1fa79b)  clip
      TEXT  "Siguiente caso"  100x18  w:hug h:hug  text:"Siguiente caso" Plus Jakarta Sans 600 14/17.64 c:bg/surface(#ffffff)
```
#### Estado=Revisión, Tipo=Documentos
```
COMPONENT  "Estado=Revisión, Tipo=Documentos"  531x643  col  w:fixed h:fixed  p:20,24  gap:14  bg:#ffffff
  FRAME  "tipo"  88x21  row  w:hug h:hug  p:4,10  r:999  bg:border/subtle(#ebe9e6)  clip
    TEXT  "Documentos"  68x13  w:hug h:hug  text:"Documentos" Inter 600 11/13.31 c:text/secondary(#6b6459)
  TEXT  "Solicitud de documento"  483x21  w:fill h:hug  text:"Solicitud de documento" Inter 600 17/20.57 c:text/primary(#24211d)
  TEXT  "Solicitada por A. Díaz · hace 2 días · Crédito #48972"  483x15  w:fill h:hug  text:"Solicitada por A. Díaz · hace 2 días · Crédito #48972" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "Frame"  483x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
    TEXT  "Documento solicitado"  405x15  w:fill h:hug  text:"Documento solicitado" Inter 400 12/14.52 c:text/secondary(#6b6459)
    TEXT  "Carta poder"  70x15  w:hug h:hug  text:"Carta poder" Inter 600 12/14.52 c:text/primary(#24211d)
  FRAME  "dropzone"  483x92  col  w:fill h:hug  p:28,0  gap:4  justify:center  items:center  r:12  bg:bg/surface-raised(#ffffff)  bd:border/default(#d9d6d1) 1.5in dashed  clip
    TEXT  "Cargar documento"  118x16  w:hug h:hug  text:"Cargar documento" Inter 600 13/15.73 c:text/primary(#24211d)
    TEXT  "Arrastra o sube el archivo · PDF, JPG o PNG"  227x13  w:hug h:hug  text:"Arrastra o sube el archivo · PDF, JPG o PNG" Inter 400 11/13.31 c:text/tertiary(#8f887f)
  TEXT  "Sube el documento solicitado; al enviarlo, se comparte con el cliente."  483x15  w:fill h:hug  text:"Sube el documento solicitado; al enviarlo, se comparte con el cliente." Inter 400 12/14.52 c:text/secondary(#6b6459)
  FRAME  "Frame"  483x284  w:fill h:fill  clip
  FRAME  "acciones"  483x42  row  w:fill h:hug  gap:12  bg:#ffffff  clip
    INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Rechazar}
      · textos: "Rechazar"
    INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar documento}
      · textos: "Enviar documento"
```
#### Estado=Aprobada, Tipo=Documentos
```
COMPONENT  "Estado=Aprobada, Tipo=Documentos"  531x643  col  w:fixed h:fixed  p:32,24,24,24  gap:16  justify:space_between  items:center  bg:#ffffff
  FRAME  "content"  483x225  col  w:fill h:hug  p:24,0,0,0  gap:14  items:center  clip
    FRAME  "halo"  84x84  row  w:fixed h:fixed  justify:center  items:center  r:42  bg:status/success/subtle(#d9f5e3)  clip
      FRAME  "circ"  56x56  row  w:fixed h:fixed  justify:center  items:center  r:28  bg:status/success/solid(#22b267)  clip
        TEXT  "✓"  22x33  w:hug h:hug  text:"✓" Plus Jakarta Sans 700 26/32.76 c:bg/surface(#ffffff)
    TEXT  "Documento enviado"  218x28  w:hug h:hug  text:"Documento enviado" Plus Jakarta Sans 700 22/27.72 align-center c:text/primary(#24211d)
    TEXT  "El documento se generó y se envió al cliente."  483x18  w:fill h:hug  text:"El documento se generó y se envió al cliente." Plus Jakarta Sans 400 14/17.64 align-center c:text/secondary(#6b6459)
    FRAME  "pill"  208x29  row  w:hug h:hug  p:7,14  gap:7  items:center  r:16  bg:status/success/subtle(#d9f5e3)  clip
      ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/success/solid(#22b267)
      TEXT  "Guardado en el historial · hoy"  166x15  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 12/15.12 c:status/success/text(#157a45)
  FRAME  "acciones"  483x98  col  w:fill h:hug  gap:10  clip
    FRAME  "cerrar-btn"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary-subtle(#edfbfa)  clip
      TEXT  "Volver a la bandeja"  125x18  w:hug h:hug  text:"Volver a la bandeja" Plus Jakarta Sans 600 14/17.64 c:brand/primary(#1fa79b)
    FRAME  "siguiente"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary(#1fa79b)  clip
      TEXT  "Siguiente caso"  100x18  w:hug h:hug  text:"Siguiente caso" Plus Jakarta Sans 600 14/17.64 c:bg/surface(#ffffff)
```
#### Estado=Revisión, Tipo=Convenio
```
COMPONENT  "Estado=Revisión, Tipo=Convenio"  531x643  col  w:fixed h:fixed  p:20,24  gap:14  bg:#ffffff
  FRAME  "tipo"  71x21  row  w:hug h:hug  p:4,10  r:999  bg:status/success/subtle(#d9f5e3)  clip
    TEXT  "Convenio"  51x13  w:hug h:hug  text:"Convenio" Inter 600 11/13.31 c:status/success/text(#157a45)
  TEXT  "Solicitud de convenio"  483x21  w:fill h:hug  text:"Solicitud de convenio" Inter 600 17/20.57 c:text/primary(#24211d)
  TEXT  "Solicitada por J. Pérez · hace 2 h · Crédito #48972"  483x15  w:fill h:hug  text:"Solicitada por J. Pérez · hace 2 h · Crédito #48972" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "detalle"  483x143  col  w:fill h:hug  p:14,16  gap:10  r:12  bg:bg/surface-raised(#ffffff)  clip
    TEXT  "Plan propuesto por el asesor"  166x15  w:hug h:hug  text:"Plan propuesto por el asesor" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Deuda vencida"  371x15  w:fill h:hug  text:"Deuda vencida" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "Q 12,900.00"  72x15  w:hug h:hug  text:"Q 12,900.00" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Nº de cuotas"  435x15  w:fill h:hug  text:"Nº de cuotas" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "6"  8x15  w:hug h:hug  text:"6" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Cuota mensual"  380x15  w:fill h:hug  text:"Cuota mensual" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "Q 2,150.00"  63x15  w:hug h:hug  text:"Q 2,150.00" Inter 600 12/14.52 c:brand/primary(#1fa79b)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Primer pago"  371x15  w:fill h:hug  text:"Primer pago" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "15 sep 2026"  72x15  w:hug h:hug  text:"15 sep 2026" Inter 600 12/14.52 c:text/primary(#24211d)
  TEXT  "Nota del asesor"  91x15  w:hug h:hug  text:"Nota del asesor" Inter 600 12/14.52 c:text/primary(#24211d)
  TEXT  "El cliente puede retomar pagos con una cuota más baja tras recuperar ingresos."  483x15  w:fill h:hug  text:"El cliente puede retomar pagos con una cuota más baja tras recuperar ingresos." Inter 400 12/14.52 c:text/secondary(#6b6459)
  FRAME  "notas"  483x87  col  w:fill h:hug  gap:8  bg:#ffffff  clip
    TEXT  "Notas del supervisor"  121x15  w:hug h:hug  text:"Notas del supervisor" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "input"  483x64  col  w:fill h:fixed  p:12  r:10  bg:bg/surface-raised(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
      TEXT  "Agrega una nota (opcional)…"  164x15  w:hug h:hug  text:"Agrega una nota (opcional)…" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "Frame"  483x80  w:fill h:fill  clip
  FRAME  "acciones"  483x94  col  w:fill h:hug  gap:10  bg:#ffffff  clip
    INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  483x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Editar y contraproponer}
      · textos: "Editar y contraproponer"
    FRAME  "decision"  483x42  row  w:fill h:hug  gap:12  clip
      INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Rechazar}
        · textos: "Rechazar"
      INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Aprobar}
        · textos: "Aprobar"
```
#### Estado=Aprobada, Tipo=Convenio
```
COMPONENT  "Estado=Aprobada, Tipo=Convenio"  531x643  col  w:fixed h:fixed  p:32,24,24,24  gap:16  justify:space_between  items:center  bg:#ffffff
  FRAME  "content"  483x225  col  w:fill h:hug  p:24,0,0,0  gap:14  items:center  clip
    FRAME  "halo"  84x84  row  w:fixed h:fixed  justify:center  items:center  r:42  bg:status/success/subtle(#d9f5e3)  clip
      FRAME  "circ"  56x56  row  w:fixed h:fixed  justify:center  items:center  r:28  bg:status/success/solid(#22b267)  clip
        TEXT  "✓"  22x33  w:hug h:hug  text:"✓" Plus Jakarta Sans 700 26/32.76 c:bg/surface(#ffffff)
    TEXT  "Convenio aprobado"  214x28  w:hug h:hug  text:"Convenio aprobado" Plus Jakarta Sans 700 22/27.72 align-center c:text/primary(#24211d)
    TEXT  "El nuevo plan de pagos quedó activo y el asesor fue notificado."  483x18  w:fill h:hug  text:"El nuevo plan de pagos quedó activo y el asesor fue notificado." Plus Jakarta Sans 400 14/17.64 align-center c:text/secondary(#6b6459)
    FRAME  "pill"  208x29  row  w:hug h:hug  p:7,14  gap:7  items:center  r:16  bg:status/success/subtle(#d9f5e3)  clip
      ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/success/solid(#22b267)
      TEXT  "Guardado en el historial · hoy"  166x15  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 12/15.12 c:status/success/text(#157a45)
  FRAME  "acciones"  483x98  col  w:fill h:hug  gap:10  clip
    FRAME  "cerrar-btn"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary-subtle(#edfbfa)  clip
      TEXT  "Volver a la bandeja"  125x18  w:hug h:hug  text:"Volver a la bandeja" Plus Jakarta Sans 600 14/17.64 c:brand/primary(#1fa79b)
    FRAME  "siguiente"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary(#1fa79b)  clip
      TEXT  "Siguiente caso"  100x18  w:hug h:hug  text:"Siguiente caso" Plus Jakarta Sans 600 14/17.64 c:bg/surface(#ffffff)
```
#### Estado=Revisión, Tipo=Entrega voluntaria
```
COMPONENT  "Estado=Revisión, Tipo=Entrega voluntaria"  531x643  col  w:fixed h:fixed  p:20,24  gap:14  bg:#ffffff
  FRAME  "tipo"  62x21  row  w:hug h:hug  p:4,10  r:999  bg:status/info/subtle(#dce9ff)  clip
    TEXT  "Entrega"  42x13  w:hug h:hug  text:"Entrega" Inter 600 11/13.31 c:status/info/text(#2857a8)
  TEXT  "Autorizar entrega voluntaria"  483x21  w:fill h:hug  text:"Autorizar entrega voluntaria" Inter 600 17/20.57 c:text/primary(#24211d)
  TEXT  "Solicitada por A. Díaz · hace 1 día · Crédito #48972"  483x15  w:fill h:hug  text:"Solicitada por A. Díaz · hace 1 día · Crédito #48972" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "detalle"  483x93  col  w:fill h:hug  p:14,16  gap:10  r:12  bg:bg/surface-raised(#ffffff)  clip
    TEXT  "El cliente acepta entregar la unidad."  208x15  w:hug h:hug  text:"El cliente acepta entregar la unidad." Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Vehículo"  285x15  w:fill h:hug  text:"Vehículo" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "Nissan Frontier · P-201KLM"  158x15  w:hug h:hug  text:"Nissan Frontier · P-201KLM" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Saldo del crédito"  372x15  w:fill h:hug  text:"Saldo del crédito" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "Q 32,164.00"  71x15  w:hug h:hug  text:"Q 32,164.00" Inter 600 12/14.52 c:text/primary(#24211d)
  TEXT  "Al autorizar, se coordina la recepción de la unidad y se cierra el crédito por recuperación."  483x30  w:fill h:hug  text:"Al autorizar, se coordina la recepción de la unidad y se cierra el crédito po…" Inter 400 12/14.52 c:text/secondary(#6b6459)
  FRAME  "notas"  483x148  col  w:fill h:hug  gap:8  bg:#ffffff  clip
    TEXT  "Nota del asesor"  91x15  w:hug h:hug  text:"Nota del asesor" Inter 600 12/14.52 c:text/primary(#24211d)
    TEXT  "El cliente ya no puede sostener los pagos y prefiere entregar la unidad para cerrar el crédito."  483x30  w:fill h:hug  text:"El cliente ya no puede sostener los pagos y prefiere entregar la unidad para …" Inter 400 12/14.52 c:text/secondary(#6b6459)
    TEXT  "Notas del supervisor"  121x15  w:hug h:hug  text:"Notas del supervisor" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "input"  483x64  col  w:fill h:fixed  p:12  r:10  bg:bg/surface-raised(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
      TEXT  "Agrega una nota (opcional)…"  164x15  w:hug h:hug  text:"Agrega una nota (opcional)…" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "Frame"  483x135  w:fill h:fill  clip
  FRAME  "acciones"  483x42  row  w:fill h:hug  gap:12  bg:#ffffff  clip
    INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Rechazar}
      · textos: "Rechazar"
    INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Autorizar entrega}
      · textos: "Autorizar entrega"
```
#### Estado=Aprobada, Tipo=Entrega voluntaria
```
COMPONENT  "Estado=Aprobada, Tipo=Entrega voluntaria"  531x643  col  w:fixed h:fixed  p:32,24,24,24  gap:16  justify:space_between  items:center  bg:#ffffff
  FRAME  "content"  483x225  col  w:fill h:hug  p:24,0,0,0  gap:14  items:center  clip
    FRAME  "halo"  84x84  row  w:fixed h:fixed  justify:center  items:center  r:42  bg:status/success/subtle(#d9f5e3)  clip
      FRAME  "circ"  56x56  row  w:fixed h:fixed  justify:center  items:center  r:28  bg:status/success/solid(#22b267)  clip
        TEXT  "✓"  22x33  w:hug h:hug  text:"✓" Plus Jakarta Sans 700 26/32.76 c:bg/surface(#ffffff)
    TEXT  "Entrega autorizada"  202x28  w:hug h:hug  text:"Entrega autorizada" Plus Jakarta Sans 700 22/27.72 align-center c:text/primary(#24211d)
    TEXT  "Se autorizó la entrega voluntaria del vehículo."  483x18  w:fill h:hug  text:"Se autorizó la entrega voluntaria del vehículo." Plus Jakarta Sans 400 14/17.64 align-center c:text/secondary(#6b6459)
    FRAME  "pill"  208x29  row  w:hug h:hug  p:7,14  gap:7  items:center  r:16  bg:status/success/subtle(#d9f5e3)  clip
      ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/success/solid(#22b267)
      TEXT  "Guardado en el historial · hoy"  166x15  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 12/15.12 c:status/success/text(#157a45)
  FRAME  "acciones"  483x98  col  w:fill h:hug  gap:10  clip
    FRAME  "cerrar-btn"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary-subtle(#edfbfa)  clip
      TEXT  "Volver a la bandeja"  125x18  w:hug h:hug  text:"Volver a la bandeja" Plus Jakarta Sans 600 14/17.64 c:brand/primary(#1fa79b)
    FRAME  "siguiente"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary(#1fa79b)  clip
      TEXT  "Siguiente caso"  100x18  w:hug h:hug  text:"Siguiente caso" Plus Jakarta Sans 600 14/17.64 c:bg/surface(#ffffff)
```
#### Estado=Revisión, Tipo=Acción crítica
```
COMPONENT  "Estado=Revisión, Tipo=Acción crítica"  531x643  col  w:fixed h:fixed  p:20,24  gap:14  bg:#ffffff
  FRAME  "tipo"  56x21  row  w:hug h:hug  p:4,10  r:999  bg:status/danger/subtle(#fbdfdb)  clip
    TEXT  "Crítica"  36x13  w:hug h:hug  text:"Crítica" Inter 600 11/13.31 c:status/danger/text(#b32e22)
  TEXT  "Autorizar apagado del vehículo"  483x21  w:fill h:hug  text:"Autorizar apagado del vehículo" Inter 600 17/20.57 c:text/primary(#24211d)
  TEXT  "Solicitada por L. Morales · hace 5 h · Crédito #48972"  483x15  w:fill h:hug  text:"Solicitada por L. Morales · hace 5 h · Crédito #48972" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "warning"  483x39  row  w:fill h:hug  p:12,14  r:12  bg:status/danger/subtle(#fbdfdb)  clip
    TEXT  "Acción crítica e irreversible. Verifica que el vehículo esté detenido."  455x15  w:fill h:hug  text:"Acción crítica e irreversible. Verifica que el vehículo esté detenido." Inter 500 12/14.52 c:status/danger/text(#b32e22)
  FRAME  "detalle"  483x118  col  w:fill h:hug  p:14,16  gap:10  r:12  bg:bg/surface-raised(#ffffff)  clip
    TEXT  "Estado del vehículo (monitoreo)"  185x15  w:hug h:hug  text:"Estado del vehículo (monitoreo)" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Estado"  381x15  w:fill h:hug  text:"Estado" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "DETENIDO"  62x15  w:hug h:hug  text:"DETENIDO" Inter 600 12/14.52 c:status/success/text(#157a45)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Ubicación"  322x15  w:fill h:hug  text:"Ubicación" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "4a calle 5-23, zona 7"  121x15  w:hug h:hug  text:"4a calle 5-23, zona 7" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "Frame"  451x15  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
      TEXT  "Última señal"  313x15  w:fill h:hug  text:"Última señal" Inter 400 12/14.52 c:text/secondary(#6b6459)
      TEXT  "hoy 14:32 · hace 3 min"  130x15  w:hug h:hug  text:"hoy 14:32 · hace 3 min" Inter 600 12/14.52 c:text/primary(#24211d)
  FRAME  "notas"  483x133  col  w:fill h:hug  gap:8  bg:#ffffff  clip
    TEXT  "Nota del asesor"  91x15  w:hug h:hug  text:"Nota del asesor" Inter 600 12/14.52 c:text/primary(#24211d)
    TEXT  "Sin contacto por 5 días ni acuerdo; se solicita el apagado para presionar el pago."  483x15  w:fill h:hug  text:"Sin contacto por 5 días ni acuerdo; se solicita el apagado para presionar el …" Inter 400 12/14.52 c:text/secondary(#6b6459)
    TEXT  "Notas del supervisor"  121x15  w:hug h:hug  text:"Notas del supervisor" Inter 600 12/14.52 c:text/primary(#24211d)
    FRAME  "input"  483x64  col  w:fill h:fixed  p:12  r:10  bg:bg/surface-raised(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
      TEXT  "Agrega una nota (opcional)…"  164x15  w:hug h:hug  text:"Agrega una nota (opcional)…" Inter 400 12/14.52 c:text/tertiary(#8f887f)
  FRAME  "Frame"  483x116  w:fill h:fill  clip
  FRAME  "acciones"  483x42  row  w:fill h:hug  gap:12  bg:#ffffff  clip
    INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Rechazar}
      · textos: "Rechazar"
    INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  235.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Autorizar apagado}
      · textos: "Autorizar apagado"
```
#### Estado=Aprobada, Tipo=Acción crítica
```
COMPONENT  "Estado=Aprobada, Tipo=Acción crítica"  531x643  col  w:fixed h:fixed  p:32,24,24,24  gap:16  justify:space_between  items:center  bg:#ffffff
  FRAME  "content"  483x225  col  w:fill h:hug  p:24,0,0,0  gap:14  items:center  clip
    FRAME  "halo"  84x84  row  w:fixed h:fixed  justify:center  items:center  r:42  bg:status/success/subtle(#d9f5e3)  clip
      FRAME  "circ"  56x56  row  w:fixed h:fixed  justify:center  items:center  r:28  bg:status/success/solid(#22b267)  clip
        TEXT  "✓"  22x33  w:hug h:hug  text:"✓" Plus Jakarta Sans 700 26/32.76 c:bg/surface(#ffffff)
    TEXT  "Acción crítica autorizada"  264x28  w:hug h:hug  text:"Acción crítica autorizada" Plus Jakarta Sans 700 22/27.72 align-center c:text/primary(#24211d)
    TEXT  "El escalamiento a pre-jurídico fue autorizado."  483x18  w:fill h:hug  text:"El escalamiento a pre-jurídico fue autorizado." Plus Jakarta Sans 400 14/17.64 align-center c:text/secondary(#6b6459)
    FRAME  "pill"  208x29  row  w:hug h:hug  p:7,14  gap:7  items:center  r:16  bg:status/success/subtle(#d9f5e3)  clip
      ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/success/solid(#22b267)
      TEXT  "Guardado en el historial · hoy"  166x15  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 12/15.12 c:status/success/text(#157a45)
  FRAME  "acciones"  483x98  col  w:fill h:hug  gap:10  clip
    FRAME  "cerrar-btn"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary-subtle(#edfbfa)  clip
      TEXT  "Volver a la bandeja"  125x18  w:hug h:hug  text:"Volver a la bandeja" Plus Jakarta Sans 600 14/17.64 c:brand/primary(#1fa79b)
    FRAME  "siguiente"  483x44  row  w:fill h:hug  p:13,0  justify:center  items:center  r:10  bg:brand/primary(#1fa79b)  clip
      TEXT  "Siguiente caso"  100x18  w:hug h:hug  text:"Siguiente caso" Plus Jakarta Sans 600 14/17.64 c:bg/surface(#ffffff)
```

## 🟠 01 · Dashboard Supervisor › Dashboard · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- DASHBOARD · SUPERVISOR
- Buen día, Andrea
- Estos son tus pendientes y el estado de tu equipo hoy.
- Reportería ↗
- Desempeño del equipo
- Resumen de KPIs de tus carteras y de tu equipo.
- Aprobaciones pendientes
- Ver todas →
- 8 pendientes · las más antiguas primero
- Roberto Cárcamo
- Crédito #47120 · A. Díaz
- Documentos
- hace 2 días
- Ana Lucía Morales
- Crédito #47730 · C. Ramírez
- Rebaja
- ayer
- María José Contreras
- Crédito #48972 · L. Morales
- Crítica
- hace 5 h
- Luis Fernando Aguilar
- Crédito #48215 · J. Pérez
- Convenio
- hace 3 h
- Marvin Castillo
- Crédito #46980 · M. Gómez
- hace 40 min
- Cartera del equipo por bucket
- Distribución del equipo · B0 a B4
- Ver cartera completa →
- B0 · Sana · 41%
- B1 · Alerta · 27%
- B2 · Gestión · 16%
- B3 · Rescate · 11%
- B4 · Pre-Jur. · 5%
- Equipo
- 4 asesores
- Ver equipo completo →
- ASESOR
- CASOS
- CONTACTOS HOY
- META
- RESCATE
- L. Morales
- 92
- 24
- 88%
- 74%
- J. Pérez
- 78
- 15
- 71%
- 66%
- C. Ramírez
- 84
- 9
- 54%
- 51%
- A. Díaz
- 58
- 19
- 81%
- 70%

</details>


## 🟠 02 · Cartera del equipo › Estado vacío (demo · Sin contacto)

<details><summary>Textos de documentación de la sección</summary>

- Estado vacío — segmento «Sin contacto» sin casos
- ✓
- Sin casos sin contacto
- Todo el equipo tiene contacto reciente en Rescate. Nada requiere tu atención en este segmento.

</details>


## 🟠 02 · Cartera del equipo › Cartera del equipo · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Cartera general
- 312 créditos · cartera general · B0–B4
- ⇄
- Reasignar en bloque
- CRÉDITO / CLIENTE
- ASESOR
- BUCKET
- MORA
- DEUDA VENCIDA
- CUOTA NORMAL
- FECHA DE PAGO
- SEGUIMIENTO
- ESTADO DE GESTIÓN
- ACCIÓN PENDIENTE

</details>


## 🟠 03 · Equipo › Equipo B3 · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Mi equipo
- 10 asesores · 6 Junior · 4 Senior

</details>


## 🟠 03 · Equipo › Estado vacío (demo · Necesitan atención)

<details><summary>Textos de documentación de la sección</summary>

- Estado vacío — segmento «Necesitan atención» sin asesores
- ✓
- Ningún asesor necesita atención
- Todo el equipo está al día en gestiones, contacto y recuperación. Nada requiere tu intervención ahora.

</details>


## 🟠 04 · Detalle de Asesor › Detalle de Asesor · Marta Gómez

<details><summary>Textos de documentación de la sección</summary>

- ← Volver a Equipo
- MG
- Marta Gómez
- Asesor Senior
- Diagnóstico
- Distribución de su cartera
- 34 créditos · Asesor Senior (B2 y B3)
- B2 · 24 créditos
- B3 · 10 créditos
- Casos críticos
- 17
- 2
- convenios pendientes de aprobación
- 3
- promesas incumplidas
- 8
- sin gestión > 48h
- 4
- próximos a subir de bucket
- Ver casos →
- Cartera de Marta Gómez · vista rápida
- Ver cartera completa →
- Cartera de Marta Gómez
- 34 créditos · B2 y B3
- CRÉDITO / CLIENTE
- BUCKET
- MORA
- DEUDA VENCIDA
- CUOTA NORMAL
- FECHA DE PAGO
- SEGUIMIENTO
- ESTADO DE GESTIÓN
- ACCIÓN PENDIENTE
- 1
- María José Contreras
- Toyota Hilux · P-482GHT
- Q6,800
- Q3,200
- 15 ago
- Sin acuerdo
- Luis Fernando Aguilar
- Nissan Frontier · P-201KLM
- Q5,100
- Q2,900
- 5 ago
- Convenio vigente
- Ana Lucía Morales
- Kia Sportage · P-773XYZ
- Q9,400
- Q3,600
- 28 jul
- Promesa incumplida
- Roberto Cárcamo
- Mazda BT-50 · P-559ABC
- Q7,250
- 20 ago
- Convenio en riesgo

</details>


## 🟠 04 · Detalle de Asesor › Reasignar · Asignar a

<details><summary>Textos de documentación de la sección</summary>

- Reasignar créditos
- ✕
- 3 créditos · de Marta Gómez
- Composición · B3: 2  ·  B4: 1
- Asignar a
- L. Morales
- 58 créditos · capacidad para +20
- A. Díaz
- 62 créditos · capacidad para +14
- C. Ramírez
- 84 créditos · sin capacidad disponible
- Motivo
- Rebalanceo de carga
- Sobrecarga
- Vacaciones / baja
- Otro
- Cancelar
- Confirmar reasignación (3)

</details>


## 🟠 04 · Detalle de Asesor › Reasignar · Seleccionar créditos

<details><summary>Textos de documentación de la sección</summary>

- Reasignar créditos
- ✕
- De: Marta Gómez · 84 créditos
- Selecciona los créditos a reasignar
- ✓
- Crédito #47120
- B3
- Ana Lucía Morales · Mora 92
- Toyota Hilux · P-330KLM
- Crédito #47008
- Roberto Cárcamo · Mora 78
- Mazda BT-50 · P-559ABC
- Crédito #46890
- B4
- Sergio Díaz · Mora 110
- Nissan Frontier · P-742XZT
- Crédito #46770
- B2
- Lucía Ramos · Mora 55
- Kia Sportage · P-118QRB
- Crédito #46650
- Marco Polanco · Mora 84
- Toyota Corolla · P-905MND
- Crédito #46540
- B1
- Elena Ruiz · Mora 40
- Hyundai Tucson · P-467LKP
- 3 seleccionados
- Composición · B3: 2 · B4: 1
- Cancelar
- Continuar (3)

</details>


## 🟠 04 · Detalle de Asesor › Reasignar · Registrada

<details><summary>Textos de documentación de la sección</summary>

- ✓
- Reasignación registrada
- 3 créditos reasignados de Marta Gómez a L. Morales.
- Queda registrada en la bitácora de decisiones.
- Listo

</details>


## 🟠 04 · Detalle de Asesor › Reasignar · Asignar a (1 crédito)

<details><summary>Textos de documentación de la sección</summary>

- Reasignar créditos
- ✕
- 1 crédito · Crédito #47120
- Ana Lucía Morales · B3 · Mora 92
- Toyota Hilux · P-330KLM
- Asignar a
- L. Morales
- 58 créditos · capacidad para +20
- A. Díaz
- 62 créditos · capacidad para +14
- C. Ramírez
- 84 créditos · sin capacidad disponible
- Motivo
- Rebalanceo de carga
- Sobrecarga
- Vacaciones / baja
- Otro
- Cancelar
- Confirmar reasignación (1)

</details>


## 🟠 04 · Detalle de Asesor › Reasignar · Registrada (1 crédito)

<details><summary>Textos de documentación de la sección</summary>

- ✓
- Reasignación registrada
- 1 crédito reasignado de Marta Gómez a L. Morales.
- Queda registrada en la bitácora de decisiones.
- Listo

</details>


## 🟠 04 · Detalle de Asesor › Cartera de Marta Gómez · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Dashboard
- /
- Equipo
- Marta Gómez
- Cartera
- ← Volver al detalle del asesor
- Cartera de Marta Gómez
- 34 créditos asignados · buckets B2–B3 · asesor senior · vista de supervisor
- 34 créditos · B2–B3
- CRÉDITO / CLIENTE
- BUCKET
- MORA
- DEUDA VENCIDA
- CUOTA NORMAL
- FECHA DE PAGO
- SEGUIMIENTO
- ESTADO DE GESTIÓN
- ACCIÓN PENDIENTE
- 1
- María José Contreras
- Toyota Hilux · P-482GHT
- Q6,800
- Q3,200
- 15 ago
- Sin acuerdo
- 2
- Luis Fernando Aguilar
- Nissan Frontier · P-201KLM
- Q5,100
- Q2,900
- 5 ago
- Convenio vigente
- 3
- Ana Lucía Morales
- Kia Sportage · P-773XYZ
- Q9,400
- Q3,600
- 28 jul
- Promesa incumplida
- 4
- Roberto Cárcamo
- Mazda BT-50 · P-559ABC
- Q7,250
- 20 ago
- Convenio en riesgo
- Sergio Ramírez
- Diana Herrera
- Carlos Mendoza
- Patricia López

</details>


## 🟠 04 · Detalle de Asesor › Solicitudes de Marta Gómez · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Dashboard
- /
- Equipo
- Marta Gómez
- Solicitudes
- ← Volver al detalle del asesor
- Solicitudes de Marta Gómez
- Todo lo que envió a aprobación del supervisor · con su resultado
- FECHA
- TIPO
- CRÉDITO
- CLIENTE
- ESTADO
- RESULTADO

</details>


## 🟠 04 · Detalle de Asesor › Casos críticos de Marta Gómez · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Dashboard
- /
- Equipo
- Marta Gómez
- Casos críticos
- ← Volver al detalle del asesor
- Casos críticos de Marta Gómez
- 17 casos que requieren atención · para seguimiento con el asesor
- Requieren aprobación
- 2
- Crédito #47120
- María José Contreras
- B2
- Entrega voluntaria · pendiente
- ›
- Crédito #44870
- Roberto Cárcamo
- B3
- Convenio · pendiente
- Sin gestión +48h
- 8
- Crédito #42750
- Patricia López
- Sin contacto hace 3 días
- Crédito #41200
- Andrés Castillo
- Sin contacto hace 4 días
- Crédito #40870
- Sergio Ramírez
- Sin contacto hace 2 días
- Crédito #40120
- Elena Ruiz
- Sin contacto hace 5 días
- Crédito #39980
- Rosa Méndez
- Crédito #39100
- Kevin Ortiz
- Crédito #38650
- Sandra Pérez
- Crédito #38200
- Miguel Ruano
- Sin contacto hace 6 días
- Promesas incumplidas
- 3
- Crédito #46980
- Luis Fernando Aguilar
- Venció hace 2 días · Q3,200
- Crédito #45210
- Ana Lucía Morales
- Venció ayer · Q2,900
- Crédito #43110
- Carlos Mendoza
- Venció hace 3 días · Q2,600
- Próximos a subir de bucket
- 4
- Crédito #43990
- Marco Polanco
- Mora 58 · a 2 días de B4
- Crédito #42200
- Lucía Ramos
- Mora 44 · a 3 días de B3
- Crédito #41500
- José Castañeda
- Mora 57 · a 3 días de B4
- Crédito #40500
- Diana Herrera
- Mora 45 · a 2 días de B3

</details>


## 🟦 05 · Ficha 360 · Supervisor › Ficha 360 · Supervisor · Crédito #47120

<details><summary>Textos de documentación de la sección</summary>

- Responsable actual
- Marta Gómez · Asesor Senior
- Días en mora
- 90
- Contactabilidad
- Media
- Días sin gestión
- 3
- GESTIÓN
- Próxima acción
- Llamar — dar seguimiento · hoy 10:00

</details>


## 🟦 05 · Ficha 360 · Supervisor › Modal · Confirmar aprobación

<details><summary>Textos de documentación de la sección</summary>

- Confirmar aprobación
- Vas a aprobar la solicitud enviada por Marta Gómez. La acción quedará registrada a tu nombre y el asesor será notificado.

</details>


## 🟦 05 · Ficha 360 · Supervisor › Modal · Rechazar solicitud

<details><summary>Textos de documentación de la sección</summary>

- Rechazar solicitud
- Indica el motivo del rechazo. Se enviará al asesor responsable.
- Escribe el motivo del rechazo…

</details>


## 🟦 05 · Ficha 360 · Supervisor › Modal · Aprobación registrada

<details><summary>Textos de documentación de la sección</summary>

- Aprobado
- Aprobación registrada
- El convenio fue aprobado y el asesor será notificado.

</details>


## 🟦 05 · Ficha 360 · Supervisor › Modal · Rechazo registrado

<details><summary>Textos de documentación de la sección</summary>

- Rechazado
- Rechazo registrado
- La solicitud fue rechazada y devuelta al asesor con tu motivo.

</details>


## 🟦 05 · Ficha 360 · Supervisor › Patrón de aprobación · variantes por tipo

<details><summary>Textos de documentación de la sección</summary>

- Mismo patrón · el bloque de contexto cambia según el tipo de solicitud

</details>


## 🟦 05 · Ficha 360 · Supervisor › F2 · Decisión del Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Decisión del Supervisor · solicitud de acción crítica

</details>


## 🟦 05 · Ficha 360 · Supervisor › F3a · Aprobada + efecto

<details><summary>Textos de documentación de la sección</summary>

- Resultado de la solicitud
- EFECTO DE NEGOCIO (objeto destino · Dim 6)
- Vehículo → Unidad apagada
- Solicitud cerrada · habilita la siguiente acción: llamada post-apagado

</details>


## 🟦 05 · Ficha 360 · Supervisor › F3b · Rechazada

<details><summary>Textos de documentación de la sección</summary>

- Resultado de la solicitud
- EFECTO DE NEGOCIO (Dim 6)
- Sin cambios · la unidad NO se apagó
- Devuelto al asesor con motivo. La acción crítica no se ejecutó.

</details>


## 🟦 05 · Ficha 360 · Supervisor › Ficha 360 · Supervisor · Solo lectura (workspace)

<details><summary>Textos de documentación de la sección</summary>

- Responsable actual
- Marta Gómez · Asesor Senior
- Solo lectura · consulta
- Días en mora
- 90
- Contactabilidad
- Media
- Días sin gestión
- 3
- GESTIÓN
- Próxima acción
- Llamar — dar seguimiento · hoy 10:00

</details>


## 🟩 06 · Workspace B3 · Supervisor › SUPERVISOR

<details><summary>Textos de documentación de la sección</summary>

- SUPERVISOR

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 1 · Reposo (contacto inicial)

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Gestión
- Rescate · última oportunidad de arreglo antes de B4
- Inicia el contacto para presentar la última propuesta estructurada de pago.
- Última gestión
- Sin contacto · último intento 11 ago 2026 · 2 intentos

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 2 · Resultado de la gestión

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Resultado de la gestión
- Registra el resultado del contacto:
- Con acuerdo se registra la promesa/convenio (patrón existente). Sin acuerdo o sin contacto continúa la gestión de rescate.

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 3 · Sin acuerdo → Paleta de rescate

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Gestión registrada · Sin acuerdo de pago
- El contacto inicial terminó sin recuperación. Elige la siguiente acción de rescate.
- ACCIONES DE RESCATE · ELIGE SEGÚN EL CASO

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4a · Contactar referencias

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Contactar referencias
- María Elena Morales · Madre
- 5541-2233 · Sin intento
- Jorge Ríos · Ref. laboral
- 4478-9910 · No contestó 10 ago
- Ana Sofía Pérez · Vecina
- 3020-1188 · Sin intento

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4b · Programar visita

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Programar visita
- Una visita programada genera una tarea futura para el responsable.
- Tipo
- Fecha
- — seleccionar
- Ubicación
- Casa 12, Res. Las Flores, zona 7 (domicilio del titular)
- Responsable
- Supervisor · Andrea López

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4c · Investigación en redes

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Investigación en redes
- Registra los hallazgos. Quedan en el historial del caso.
- Red / fuente
- Facebook · Instagram · LinkedIn
- Hallazgos (nuevo teléfono, dirección, empleo…)

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4d · Apagado — contexto y monitoreo

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Apagado del vehículo
- ⚠ No apagar mientras el vehículo esté en movimiento. Verifica que esté detenido.
- Estado del vehículo (monitoreo)
- ● DETENIDO
- Ubicación
- 4a calle 5-23, zona 7
- Velocidad
- 0 km/h (detenido)
- Última señal
- hoy 14:32 · hace 3 min

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4d.1 · Confirmar apagado

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Confirmar apagado
- Vehículo DETENIDO · zona 7. Vas a ejecutar el apagado. Esta acción crítica queda registrada a tu nombre y notifica al cliente.
- Confirmación crítica: el apagado es irreversible desde esta interfaz.

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4d.2 · Apagado ejecutado

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Apagado ejecutado
- Gestión registrada · Apagado ejecutado
- El apagado quedó registrado a tu nombre.
- EFECTO DE NEGOCIO
- Vehículo → Unidad apagada
- Siguiente gestión disponible: contactar al cliente.

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4d.3 · Llamada posterior al apagado

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Llamada posterior al apagado
- Informa por qué se apagó, qué debe hacer y las alternativas. Registra el resultado:
- Alternativas: regularizar pago · entrega voluntaria del vehículo.

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 5a · Entrega voluntaria

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Programar entrega voluntaria
- El cliente entrega el vehículo. Programa los datos de la entrega.
- Modalidad
- Lugar
- Agencia CashIn zona 9 · Ciudad de Guatemala
- Fecha
- — seleccionar
- Responsable
- Supervisor · Andrea López
- [PENDIENTE de negocio] tratamiento posterior a la entrega efectiva.

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 5b · Derivado al tratamiento B4 (sistémico)

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- Derivado al tratamiento B4
- Caso derivado a Pre-Jurídico (B4)
- El rescate se agotó sin resolución. El caso continúa en tratamiento pre-jurídico.
- El cambio de bucket a B4 lo determina el sistema según los días de atraso (automático al día 91). Esta derivación inicia el tratamiento pre-jurídico; no reescribe el bucket manualmente.

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 1b · ¿A quién contactar?

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito
- ¿Con quién estás hablando?
- Selecciona el participante con quien vas a registrar esta gestión. Podrás cambiarlo durante la llamada.

</details>


## 🟩 06 · Workspace B3 · Supervisor › WS Sup · 4z · Gestión registrada (rescate)

<details><summary>Textos de documentación de la sección</summary>

- Rescate · Gestión del crédito

</details>


## 🟠 07 · Aprobaciones (Bandeja + Bitácora) › Bandeja de aprobaciones · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Aprobaciones pendientes
- 14 solicitudes · de tus asesores · ordenadas por antigüedad
- Pendientes
- Historial
- Solicitudes
- 14 pendientes
- SOLICITUD / CRÉDITO
- ASESOR
- TIPO
- PRIORIDAD
- MONTO
- DETALLE
- ANTIGÜEDAD
- MOTIVO
- ESTADO
- BUCKET

</details>


## 🟠 07 · Aprobaciones (Bandeja + Bitácora) › Historial de aprobaciones · Supervisor

<details><summary>Textos de documentación de la sección</summary>

- Historial de decisiones
- Aprobaciones y acciones del supervisor · últimos 30 días
- Pendientes
- Historial
- Registros
- 128 este mes
- FECHA
- TIPO
- SOLICITUD / OBJETO
- ASESOR
- DECISIÓN
- MOTIVO

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Acción crítica

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Acción crítica

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Convenio

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Convenio

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Documentos

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Documentos

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Entrega

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Entrega

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Rebaja

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Rebaja

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Convenio · Contrapropuesta

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Convenio
- Editar convenio · contrapropuesta
- Crédito #47330 · Carlos Mendoza · B3
- Propuesta del asesor
- 6 cuotas · Q2,300/mes
- Tu contrapropuesta
- Total del convenio
- Q13,800
- Nº de cuotas
- 8
- ▾
- Cuota mensual
- Q1,725 / mes
- Se recalcula automáticamente según el número de cuotas.
- Nota para el cliente (requerida)
- Ampliamos a 8 cuotas para que la cuota mensual baje a Q1,725 y sea más accesible.
- Se enviará al cliente. Si la acepta, se aplica automáticamente; si no, podrá contactar a su asesor.
- Cancelar
- Enviar contrapropuesta

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Convenio · Contrapropuesta enviada

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Convenio
- Volver a la bandeja
- Siguiente caso

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Convenio · Resuelto

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Convenio
- Volver a la bandeja
- Siguiente caso

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Documentos · Resuelto

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Documentos
- Volver a la bandeja
- Siguiente caso

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Entrega · Resuelto

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Entrega
- Volver a la bandeja
- Siguiente caso

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Rebaja · Resuelto

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Rebaja
- Volver a la bandeja
- Siguiente caso

</details>


## 🟠 08 · Workspace v3 · Aprobación › WS Aprob · Critica · Resuelto

<details><summary>Textos de documentación de la sección</summary>

- Espacio de aprobación · Acción crítica
- Volver a la bandeja
- Siguiente caso

</details>


## 🟠 09 · Disponibilidad y redistribución › Modal · Marcar ausente · Vacaciones

<details><summary>Textos de documentación de la sección</summary>

- Marcar ausente
- ✕
- MG
- Marta Gómez
- Asesor Senior · 34 créditos asignados
- Motivo
- Vacaciones
- Permiso / Incidente
- Desde
- 18 sep 2026
- 📅
- Hasta
- 30 sep 2026
- Su cartera de 34 créditos se redistribuirá automáticamente entre los otros 9 asesores del equipo.

</details>


## 🟠 09 · Disponibilidad y redistribución › Modal · Redistribución

<details><summary>Textos de documentación de la sección</summary>

- Redistribución de cartera
- ✕
- Cartera de Marta Gómez · 34 créditos → 9 asesores
- Se reparte según la capacidad de cada asesor. Puedes ajustar manualmente después.
- CR
- Carlos Ramírez
- 28 → 32
- +4
- AS
- Andrea Solís
- 30 → 34
- LF
- Luis Fernández
- 27 → 31
- ML
- María López
- 32 → 36
- JP
- José Pérez
- 30 → 33
- +3
- AD
- Ana Díaz
- 28 → 31
- y 3 asesores más…

</details>


## 🟠 09 · Disponibilidad y redistribución › Modal · Cartera redistribuida

<details><summary>Textos de documentación de la sección</summary>

- ✓
- Cartera redistribuida
- Marta Gómez quedó marcada como ausente del 18 al 30 sep. Sus 34 créditos se repartieron entre 9 asesores.
- Se notificó al equipo por el sistema

</details>


## 🟠 09 · Disponibilidad y redistribución › Modal · Asesor reactivado

<details><summary>Textos de documentación de la sección</summary>

- ✓
- Asesor reactivado
- Diego Morales volvió a estar activo. Su cartera se le devolvió y se canceló la redistribución pendiente.
- Se notificó al equipo por el sistema

</details>


## 🟠 09 · Disponibilidad y redistribución › Modal · Marcar ausente · Incidente / Permiso

<details><summary>Textos de documentación de la sección</summary>

- Marcar ausente
- ✕
- MG
- Marta Gómez
- Asesor Senior · 34 créditos asignados
- Motivo
- Vacaciones
- Permiso / Incidente
- Fecha
- 18 sep 2026
- 📅
- Hora de inicio
- 11:00 am
- 🕐
- Fin: indefinido
- Se reactiva cuando el asesor regrese; su cartera vuelve a él automáticamente.
- Su cartera se reasigna al equipo hasta que lo reactives cuando regrese.

</details>


## 🟠 10 · Reportería › Rep · Bucket detalle · B3

<details><summary>Textos de documentación de la sección</summary>

- REPORTERÍA · MIGRACIÓN
- B3 · Rescate
- Qué está pasando dentro del bucket B3 durante el periodo
- ← Volver
- Población y movimiento del bucket
- Entradas, salidas, gestión y riesgo del bucket
- 📅  1–22 sep 2026
- Exportar ↗
- Entradas y salidas
- Movimiento del bucket B3 en el periodo
- 7
- entraron
- 4 desde B2 (deterioro) · 3 desde B4 (recuperación)
- 27
- permanecen
- siguen en B3 al cierre del periodo
- salieron
- 5 a B2 (rescate) · 2 a B4 (pre-jurídico)
- Resultado del periodo
- De los 34 créditos que iniciaron en B3
- 5
- mejoraron ↓
- pasaron a B2 · Rescate
- permanecieron
- sin cambio de bucket
- 2
- empeoraron ↑
- pasaron a B4 · Pre-jurídico
- Estado de gestión
- Situación de los 34 créditos del bucket
- Con promesa vigente
- 9
- En seguimiento
- 8
- Sin contacto
- Promesa incumplida
- 6
- Sin gestión
- 4
- Antigüedad y riesgo
- Distribución de días dentro del bucket
- 0–15 días
- 16–30 días
- 10
- 31–45 días · próx. a escalar
- +45 días · zona crítica
- 18 de 34 (53%) llevan +30 días en B3: 10 próximos a escalar y 8 en zona crítica (+45 días).

</details>


## 🟠 10 · Reportería › Resumen · Cuentas curadas

<details><summary>Textos de documentación de la sección</summary>

- ← DASHBOARD · SUPERVISOR
- Reportería
- Cuentas curadas
- Distribución por bucket · toca para ver a los asesores
- 📅  1–22 sep 2026
- Exportar ↗
- Meta mes
- 70
- ·
- Logrado
- 48 (69%)
- vs periodo
- ▲ +8
- Tiempo para curar
- < 7 días
- 58%
- 7–15 días
- 29%
- > 15 días
- 13%
- Canal de gestión
- Llamada
- 61%
- WhatsApp
- 27%
- Visita
- 12%
- Distribución por bucket · ordenado por foco
- Toca un bucket para ver a los asesores  →

</details>


## 🟠 10 · Reportería › Resumen · Contactabilidad

<details><summary>Textos de documentación de la sección</summary>

- ← DASHBOARD · SUPERVISOR
- Reportería
- Contactabilidad del equipo
- Distribución por bucket y asesor · toca para ver a los asesores
- 📅  1–22 sep 2026
- Exportar ↗
- Meta
- 80%
- ·
- Equipo
- 84%
- vs periodo
- ▲ +6%
- Canal de contacto
- Llamada
- 58%
- WhatsApp
- 33%
- SMS
- 9%
- Intentos hasta contacto
- 1 intento
- 46%
- 2 intentos
- 34%
- 3+ intentos
- 20%
- Embudo del equipo · dónde se cae la gestión
- La mayor caída es de Contacto → Promesa (−23 pts): foco en técnica de negociación.
- Contactados
- →
- 61%
- Con promesa
- 76%
- Cumplidas
- 79% meta
- Recuperado
- Distribución por bucket · ordenado por foco
- Toca un bucket para ver a los asesores  →

</details>


## 🟠 10 · Reportería › Resumen · Migración de bucket

<details><summary>Textos de documentación de la sección</summary>

- ← DASHBOARD · SUPERVISOR
- Reportería
- Migración de bucket
- Movimientos por bucket · toca para ver a los asesores
- 📅  1–22 sep 2026
- Exportar ↗
- Neto del periodo
- +6 a favor (bajan)
- ·
- En riesgo de subir
- 24 créditos
- vs periodo
- ▲ mejora
- Motivo de mejora (bajan de bucket)
- Convenio activo
- 54%
- Pago total
- 31%
- Comprobante
- 15%
- Motivo de deterioro (suben de bucket)
- Nuevo atraso
- 62%
- Promesa rota
- 38%
- Distribución por bucket · ordenado por foco
- Toca un bucket para ver a los asesores  →

</details>


## 🟠 10 · Reportería › Resumen · Promesas cumplidas

<details><summary>Textos de documentación de la sección</summary>

- ← DASHBOARD · SUPERVISOR
- Reportería
- Promesas cumplidas
- Distribución por bucket y asesor · toca para ver a los asesores
- 📅  1–22 sep 2026
- Exportar ↗
- Meta
- 75%
- ·
- Equipo
- 76%
- vs periodo
- ▲ +3%
- Canal de la promesa
- Llamada
- 64%
- WhatsApp
- 29%
- Visita
- 7%
- Cumplimiento
- Cumplidas
- En riesgo
- 14%
- Rotas
- 10%
- Distribución por bucket · ordenado por foco
- Toca un bucket para ver a los asesores  →

</details>


## 🟠 10 · Reportería › Resumen · Recuperación del equipo

<details><summary>Textos de documentación de la sección</summary>

- ← DASHBOARD · SUPERVISOR
- Reportería
- Recuperación del equipo
- Distribución por bucket · toca para ver a los asesores
- 📅  1–22 sep 2026
- Exportar ↗
- Meta mes
- Q180K
- ·
- Equipo
- 79% de meta
- vs periodo
- ▲ +4.2%
- ¿De dónde se recupera?
- Composición de los Q142K · aporta más B1, rezagado B4
- B1 · Alerta
- Q 45,200 · 32%
- B2 · Gestión
- Q 38,600 · 27%
- B3 · Rescate
- Q 32,100 · 23%
- B4 · Pre-jur.
- Q 26,400 · 18%
- Canal de recuperación
- Llamada
- Q74K · 52%
- WhatsApp
- Q47K · 33%
- Visita
- Q21K · 15%
- Composición del pago
- Total Q97K (68%)
- Parcial Q45K (32%)
- 💡 El 59% de lo recuperado viene de mora temprana (B1–B2). Ticket promedio Q3,180.
- Distribución por bucket · ordenado por foco
- Toca un bucket para ver a los asesores  →

</details>


# 🟢 02 · Asesor Senior  (`1644:79`)

> Generado por `scripts/extract.py` desde la REST API de Figma. No editar a mano.

## 🟢 03 · Workspace v3 · Asesor Senior › Workspace/GestionPanel · Senior

### Workspace/GestionPanel · Senior  `3126:13` — component_set, 53 variante(s)

- **State** (variante): HubReposo · CallAcuerdo · CallCompCargado · CallCompNoLegible · CallCompVacio · CallNoAcuerdo · CallNoContacto · CallPago · CallPromesa · CallReagenda · EntLlamAcuerdo · EntLlamCompCargado · EntLlamCompNoLegible · EntLlamCompVacio · EntLlamNoAcuerdo · EntLlamPago · EntLlamPromesa · EntLlamReagenda · EntWAAcuerdo · EntWACompCargado · EntWACompNoLegible · EntWACompVacio · EntWANoAcuerdo · EntWAPago · EntWAPromesa · EntWAReagenda · HubPending · MsgConQuien · MsgCorreoCompose · MsgCorreoEnviado · MsgSMScompose · MsgSMSenviado · MsgWAcompose · MsgWAenviado · GuardandoNA · GuardandoNC · GuardandoPromesa · RegistradaNA · RegistradaNC · RegistradaPromesa · CallConQuien · RegistradaPagoWA · RegistradaComprobante · RebajaMora · RegistradaRebaja · CallRescate · RescateReferencias · RescateVisita · RescateRedes · RescateApagado · RescateApagadoConfirmar · RescateApagadoEjecutado · RegistradaRescate — default `HubReposo`

#### State=HubReposo
```
COMPONENT  "State=HubReposo"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill
    FRAME  "workArea"  531x526  col  w:fill h:fill  p:16  gap:14  clip
      INSTANCE  "colHeaderGestion"  → "Workspace/SectionLabel / Estilo=Columna"  499x14  row  w:fill h:hug  props{Texto=Gestión}
        · textos: "Gestión"
      INSTANCE  "Workspace/StartPrompt"  → "Workspace/StartPrompt"  499x173  col  w:fill h:hug  p:28,24  gap:10  justify:center  items:center  r:12  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in dashed  props{Subtítulo=Aquí se ejecuta y registra el flujo de la llamada. Inicia para identificar al participante y capturar el resultado.; Título=Espacio de gestión}
        · textos: "Espacio de gestión" | "Aquí se ejecuta y registra el flujo de la llamada."
      FRAME  "spacer"  499x279  w:fill h:fill  clip
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "Workspace/ActionBar"  531x116  col  w:fill h:hug  p:12,20  gap:8
      FRAME  "actions-row"  491x42  row  w:fill h:hug  gap:8  clip
        INSTANCE  "secundario"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Mensaje}
          · textos: "Mensaje"
        INSTANCE  "primario"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Llamada}
          · textos: "Llamada"
      FRAME  "entrante-row"  491x42  row  w:fill h:hug  gap:8  clip
        INSTANCE  "btnSec"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:fill  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  props{MostrarIcono=False; Etiqueta=WhatsApp entrante}
          · textos: "WhatsApp entrante"
        INSTANCE  "btnSec"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:fill  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  props{MostrarIcono=False; Etiqueta=Llamada entrante}
          · textos: "Llamada entrante"
```
#### State=HubPending
```
COMPONENT  "State=HubPending"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill
    FRAME  "workArea"  531x526  col  w:fill h:fill  p:16  gap:14  clip
      FRAME  "bannerPendiente"  499x48  row  w:fill h:hug  p:9,10,9,14  gap:10  justify:space_between  items:center  r:10  bg:brand/primary-subtle(#e5f7f5)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "estado"  215x16  row  w:hug h:hug  gap:8  items:center  clip
          ELLIPSE  "Ellipse"  9x9  w:fixed h:fixed  bg:#24d466
          TEXT  "WhatsApp enviado · hace 12 min"  198x16  w:hug h:hug  text:"WhatsApp enviado · hace 12 min" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
        FRAME  "btnContinuar"  136x30  row  w:hug h:hug  p:7,12  gap:6  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Continuar gestión"  112x16  w:hug h:hug  text:"Continuar gestión" Plus Jakarta Sans 600 13/16.38 c:brand/on-primary(#ffffff)
      INSTANCE  "colHeaderGestion"  → "Workspace/SectionLabel / Estilo=Columna"  499x14  row  w:fill h:hug  props{Texto=Gestión}
        · textos: "Gestión"
      INSTANCE  "Workspace/StartPrompt"  → "Workspace/StartPrompt"  499x173  col  w:fill h:hug  p:28,24  gap:10  justify:center  items:center  r:12  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in dashed  props{Subtítulo=Aquí se ejecuta y registra el flujo de la llamada. Inicia para identificar al participante y capturar el resultado.; Título=Espacio de gestión}
        · textos: "Espacio de gestión" | "Aquí se ejecuta y registra el flujo de la llamada."
      FRAME  "spacer"  499x217  w:fill h:fill  clip
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "Workspace/ActionBar"  531x116  col  w:fill h:hug  p:12,20  gap:8
      FRAME  "actions-row"  491x42  row  w:fill h:hug  gap:8  clip
        INSTANCE  "secundario"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Mensaje}
          · textos: "Mensaje"
        INSTANCE  "primario"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Llamada}
          · textos: "Llamada"
      FRAME  "entrante-row"  491x42  row  w:fill h:hug  gap:8  clip
        INSTANCE  "btnSec"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:fill  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  props{MostrarIcono=False; Etiqueta=WhatsApp entrante}
          · textos: "WhatsApp entrante"
        INSTANCE  "btnSec"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:fill  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  props{MostrarIcono=False; Etiqueta=Llamada entrante}
          · textos: "Llamada entrante"
```
#### State=CallAcuerdo
```
COMPONENT  "State=CallAcuerdo"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x643  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=Acuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "¿El cliente aceptó un compromiso de pago?"  1520x19  w:fixed h:fill  text:"¿El cliente aceptó un compromiso de pago?" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      TEXT  "Marca la respuesta según el resultado de la conversación."  491x14  w:fill h:hug  text:"Marca la respuesta según el resultado de la conversación." Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
      FRAME  "opciones"  491x224  col  w:fill h:hug  gap:10  clip
        FRAME  "optCard/Si"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Sí, hubo compromiso"  383x18  w:fill h:hug  text:"Sí, hubo compromiso" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "Registrar una promesa de pago"  383x15  w:fill h:hug  text:"Registrar una promesa de pago" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
        FRAME  "optCard/RealizarPago"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Realizar pago"  383x18  w:fill h:hug  text:"Realizar pago" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "Registrar el pago que hará el cliente"  383x15  w:fill h:hug  text:"Registrar el pago que hará el cliente" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
        FRAME  "optCard/Comprobante"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Comprobante de pago recibido"  383x18  w:fill h:hug  text:"Comprobante de pago recibido" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "El cliente ya pagó y envió su comprobante"  383x15  w:fill h:hug  text:"El cliente ya pagó y envió su comprobante" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
      INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar rebaja de mora}
        · textos: "Solicitar rebaja de mora"
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
```
#### State=CallNoAcuerdo
```
COMPONENT  "State=CallNoAcuerdo"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=NoAcuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "Registrar gestión"  1520x19  w:fixed h:fill  text:"Registrar gestión" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "resultadoAutomatico"  491x30  row  w:fill h:hug  p:7,10  gap:8  items:center  r:10  bg:neutral/100(#f5f4f2)  clip
        FRAME  "Frame"  16x16  row  w:hug h:hug  justify:center  items:center
          INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Secundario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-x}
        FRAME  "Frame"  447x15  col  w:fill h:hug  gap:2  clip
          TEXT  "Contactado · sin acuerdo de pago"  447x15  w:fill h:hug  text:"Contactado · sin acuerdo de pago" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "resumen"  491x85  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Llamada saliente"  97x15  w:hug h:hug  text:"Llamada saliente" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Participante de la gestión"  144x15  w:hug h:hug  text:"Participante de la gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "María José Contreras · Titular"  164x15  w:hug h:hug  text:"María José Contreras · Titular" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Duración"  52x15  w:hug h:hug  text:"Duración" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "01:24"  33x15  w:hug h:hug  text:"01:24" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "reagenda"  491x110  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x16  row  w:fill h:hug  gap:8  items:center  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/refresh-cw}
          TEXT  "¿El cliente solicitó que se le contacte nuevamente?"  439x16  w:fill h:hug  text:"¿El cliente solicitó que se le contacte nuevamente?" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
        FRAME  "segmented"  463x40  row  w:fill h:hug  p:4  gap:4  r:10  bg:bg/canvas(#fafaf9)  clip
          FRAME  "seg/No"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
            TEXT  "No"  19x16  w:hug h:hug  text:"No" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          FRAME  "seg/Sí"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  clip
            TEXT  "Sí"  12x16  w:hug h:hug  text:"Sí" Plus Jakarta Sans 500 13/16.38 c:text/secondary(#6b6459)
        TEXT  "Cambia a Sí para agendar el seguimiento en tu cola de trabajo."  463x14  w:fill h:hug  text:"Cambia a Sí para agendar el seguimiento en tu cola de trabajo." Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=CallNoContacto
```
COMPONENT  "State=CallNoContacto"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x532  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=NoContacto"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "Registrar gestión"  1520x19  w:fixed h:fill  text:"Registrar gestión" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "resultadoAutomatico"  491x30  row  w:fill h:hug  p:7,10  gap:8  items:center  r:10  bg:bucket/b2/bg(#fcefc7)  clip
        FRAME  "Frame"  16x16  row  w:hug h:hug  justify:center  items:center
          INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Alerta"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/phone}
        FRAME  "Frame"  447x15  col  w:fill h:hug  gap:2  clip
          TEXT  "Cliente no respondió"  447x15  w:fill h:hug  text:"Cliente no respondió" Plus Jakarta Sans 600 12/15.12 c:status/warning/solid(#e8a927)
      FRAME  "resumen"  491x85  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Llamada saliente"  97x15  w:hug h:hug  text:"Llamada saliente" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Participante de la gestión"  144x15  w:hug h:hug  text:"Participante de la gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "María José Contreras · Titular"  164x15  w:hug h:hug  text:"María José Contreras · Titular" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Fecha y hora"  72x15  w:hug h:hug  text:"Fecha y hora" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Hoy · 10:03"  66x15  w:hug h:hug  text:"Hoy · 10:03" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x111  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x110  col  w:fill h:hug  p:8,16,10,16  gap:10  clip
        INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  499x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Iniciar acciones de rescate}
          · textos: "Iniciar acciones de rescate"
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=CallReagenda
```
COMPONENT  "State=CallReagenda"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=NoAcuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "Registrar gestión"  1520x19  w:fixed h:fill  text:"Registrar gestión" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "resultadoAutomatico"  491x30  row  w:fill h:hug  p:7,10  gap:8  items:center  r:10  bg:neutral/100(#f5f4f2)  clip
        FRAME  "Frame"  16x16  row  w:hug h:hug  justify:center  items:center
          INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Secundario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-x}
        FRAME  "Frame"  447x15  col  w:fill h:hug  gap:2  clip
          TEXT  "Contactado · sin acuerdo de pago"  447x15  w:fill h:hug  text:"Contactado · sin acuerdo de pago" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "resumen"  491x85  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Llamada saliente"  97x15  w:hug h:hug  text:"Llamada saliente" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Participante de la gestión"  144x15  w:hug h:hug  text:"Participante de la gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "María José Contreras · Titular"  164x15  w:hug h:hug  text:"María José Contreras · Titular" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Duración"  52x15  w:hug h:hug  text:"Duración" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "01:24"  33x15  w:hug h:hug  text:"01:24" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "reagenda"  491x189  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x16  row  w:fill h:hug  gap:8  items:center  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/refresh-cw}
          TEXT  "¿El cliente solicitó que se le contacte nuevamente?"  439x16  w:fill h:hug  text:"¿El cliente solicitó que se le contacte nuevamente?" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
        FRAME  "segmented"  463x40  row  w:fill h:hug  p:4  gap:4  r:10  bg:bg/canvas(#fafaf9)  clip
          FRAME  "seg/No"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  clip
            TEXT  "No"  19x16  w:hug h:hug  text:"No" Plus Jakarta Sans 500 13/16.38 c:text/secondary(#6b6459)
          FRAME  "seg/Sí"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1fa79b) 1in  clip
            TEXT  "Sí"  12x16  w:hug h:hug  text:"Sí" Plus Jakarta Sans 600 13/16.38 c:brand/primary(#1fa79b)
        FRAME  "Frame"  463x53  row  w:fill h:hug  gap:10  clip
          FRAME  "Frame"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Fecha de contacto"  100x14  w:hug h:hug  text:"Fecha de contacto" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  147.67x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
              TEXT  "08 ago 2026"  79.67x16  w:fill h:hug  text:"08 ago 2026" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
          FRAME  "Frame"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Hora"  26x14  w:hug h:hug  text:"Hora" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  147.67x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/clock}
              TEXT  "10:00 am"  79.67x16  w:fill h:hug  text:"10:00 am" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
          FRAME  "field/Medio"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "label"  34x14  w:hug h:hug  text:"Medio" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "medioIconSel"  94x34  row  w:hug h:hug  gap:6  clip
              FRAME  "opt/Llamada"  44x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1fa79b) 1in  clip
                INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/phone}
              FRAME  "opt/WhatsApp"  44x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bd:border/default(#d9d6d1) 1in  clip
                INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/message-circle}
        FRAME  "Frame"  463x32  row  w:fill h:hug  p:8,10  gap:8  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
          TEXT  "Se agendará automáticamente en tu cola de trabajo."  419x14  w:fill h:hug  text:"Se agendará automáticamente en tu cola de trabajo." Plus Jakarta Sans 500 11/13.86 c:brand/primary(#1fa79b)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=CallPromesa
```
COMPONENT  "State=CallPromesa"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x582  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=Acuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar promesa de pago"  1520x20  w:fixed h:fill  text:"Registrar promesa de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "Frame"  491x30  row  w:fill h:hug  p:7,12,7,10  gap:8  items:center  r:8  bg:status/success/alt-bg(#dff5e6)  clip
        INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Éxito"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/handshake}
        TEXT  "Compromiso aceptado · registra la promesa de pago"  445x15  w:fill h:hug  text:"Compromiso aceptado · registra la promesa de pago" Plus Jakarta Sans 600 12/15.12 c:status/success/alt-fg(#0f7a3d)
      FRAME  "promesaCard"  491x140  col  w:fill h:hug  p:12,14  gap:10  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x53  row  w:fill h:hug  gap:10  clip
          FRAME  "Frame"  226.5x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Monto"  35x14  w:hug h:hug  text:"Monto" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  226.5x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/banknote}
              TEXT  "Q1,850"  180.5x16  w:fill h:hug  text:"Q3,200" Plus Jakarta Sans 700 13/16.38 c:text/primary(#24211d)
          FRAME  "Frame"  226.5x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Fecha compromiso"  103x14  w:hug h:hug  text:"Fecha compromiso" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  226.5x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
              TEXT  "07 ago 2026"  158.5x16  w:fill h:hug  text:"07 ago 2026" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
        FRAME  "Frame"  463x53  col  w:fill h:hug  gap:5  clip
          TEXT  "Tipo de pago"  70x14  w:hug h:hug  text:"Tipo de pago" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
          FRAME  "Frame"  463x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
            TEXT  "Pago total de la cuota"  419x16  w:fill h:hug  text:"Pago total de la cuota" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
            INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x61  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x60  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x42  row  w:fill h:hug  p:12,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=CallPago
```
COMPONENT  "State=CallPago"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarPago"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x588  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=Acuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar pago"  107x19  w:hug h:hug  text:"Registrar pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Registra el pago que realizará el cliente y prepárale la información."  370x15  w:hug h:hug  text:"Registra el pago que realizará el cliente y prepárale la información." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      FRAME  "Workspace/Card/DeudaCuota"  491x39  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "a"  229.5x23  row  w:fill h:hug  gap:6  items:baseline  clip
          TEXT  "Deuda vencida"  86x15  w:hug h:hug  text:"Deuda vencida" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q6,800"  70x23  w:hug h:hug  text:"Q6,800" Plus Jakarta Sans 600 18/22.68 c:status/warning/text(#b37d0f)
        FRAME  "b"  229.5x16  row  w:fill h:hug  gap:6  items:baseline  clip
          TEXT  "Cuota normal"  78x15  w:hug h:hug  text:"Cuota normal" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q3,200"  51x16  w:hug h:hug  text:"Q3,200" Plus Jakarta Sans 600 13/16.38 c:text/tertiary(#8f887f)
      FRAME  "field"  491x62  col  w:fill h:hug  gap:4  clip
        TEXT  "Monto que pagará hoy"  130x15  w:hug h:hug  text:"Monto que pagará hoy" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x43  row  w:fill h:hug  p:12,14  gap:8  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Q 2,000"  62x19  w:hug h:hug  text:"Q 2,000" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "recalc"  491x35  row  w:fill h:hug  p:6,16  gap:10  justify:space_between  items:center  r:12  bg:status/warning/subtle(#fcefc7)  clip
        FRAME  "chip"  107x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/text(#b37d0f)
          TEXT  "Pago parcial"  72x15  w:hug h:hug  text:"Pago parcial" Plus Jakarta Sans 600 12/15.12 c:status/warning/text(#b37d0f)
        FRAME  "rr"  211x23  row  w:hug h:fill  gap:8  items:center  clip
          TEXT  "Deuda vencida restante"  147x16  w:hug h:hug  text:"Deuda vencida restante" Plus Jakarta Sans 400 13/16.38 c:text/secondary(#6b6459)
          TEXT  "Q4,800"  56x19  w:hug h:hug  text:"Q1,400" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      TEXT  "Método de pago"  97x15  w:hug h:hug  text:"Método de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
      FRAME  "mcard"  491x64  row  w:fill h:hug  p:6,16  gap:8  items:center  r:12  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1a8080) 1.5in  clip
        FRAME  "tx"  433x52  col  w:fill h:hug  gap:2  clip
          TEXT  "Link de pago"  86x18  w:hug h:hug  text:"Link de pago" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
          TEXT  "Recargo por pago con tarjeta · 5%"  177x14  w:hug h:hug  text:"Recargo por pago con tarjeta · 5%" Plus Jakarta Sans 400 11/13.86 c:text/secondary(#6b6459)
          TEXT  "desglose"  433x16  w:fill h:hug  text:"Monto Q2,000 · Recargo Q100 · Total Q2,100" Plus Jakarta Sans 600 12.5/15.75 c:text/primary(#24211d)
        ELLIPSE  "Ellipse"  18x18  w:fixed h:fixed  bg:brand/primary(#1fa79b)
      FRAME  "mcard"  491x64  row  w:fill h:hug  p:6,16  gap:8  items:center  r:12  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "tx"  433x52  col  w:fill h:hug  gap:2  clip
          TEXT  "Depósito o transferencia"  167x18  w:hug h:hug  text:"Depósito o transferencia" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
          TEXT  "Se enviarán los datos de la cuenta."  178x14  w:hug h:hug  text:"Se enviarán los datos de la cuenta." Plus Jakarta Sans 400 11/13.86 c:text/secondary(#6b6459)
          TEXT  "sinrecargo"  433x16  w:fill h:hug  text:"Sin recargo · Total Q2,000" Plus Jakarta Sans 500 12.5/15.75 c:text/tertiary(#8f887f)
        ELLIPSE  "Ellipse"  18x18  w:fixed h:fixed  bd:border/default(#d9d6d1) 1.5in
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x55  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x54  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x36  row  w:fill h:hug  p:9,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Continuar a WhatsApp"  152x18  w:hug h:hug  text:"Continuar a WhatsApp" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=CallCompVacio
```
COMPONENT  "State=CallCompVacio"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=Acuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Sube el comprobante que envió el cliente para detectar y validar la información."  491x15  w:fill h:hug  text:"Sube el comprobante que envió el cliente para detectar y validar la información." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x56  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x102  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x84  col  w:fill h:fixed  p:20,14  gap:4  justify:center  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Arrastra o sube la imagen del comprobante"  264x16  w:hug h:hug  text:"Arrastra o sube la imagen del comprobante" Plus Jakarta Sans 400 13/16.38 align-center c:text/secondary(#6b6459)
          TEXT  "JPG · PNG o PDF · máx. 10 MB"  149x14  w:hug h:hug  text:"JPG · PNG o PDF · máx. 10 MB" Plus Jakarta Sans 400 11/13.86 align-center c:text/secondary(#6b6459)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:#eceae7  clip
          TEXT  "Enviar a validación"  123x18  w:hug h:hug  text:"Enviar a validación" Plus Jakarta Sans 600 14/17.64 c:text/tertiary(#8f887f)
```
#### State=CallCompCargado
```
COMPONENT  "State=CallCompCargado"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=Acuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Revisa la información detectada y envíala a Contabilidad para validación."  491x15  w:fill h:hug  text:"Revisa la información detectada y envíala a Contabilidad para validación." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x56  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x41  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "chip"  268x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/text(#b37d0f)
          TEXT  "comprobante-mariajose.jpg · 240 KB"  233x15  w:hug h:hug  text:"comprobante-luisfernando.jpg · 240 KB" Plus Jakarta Sans 600 12/15.12 c:status/warning/text(#b37d0f)
      FRAME  "datosDetectados"  491x127  col  w:fill h:hug  p:7,16  gap:4[space/4]  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        TEXT  "Datos detectados del comprobante"  459x14  w:fill h:hug  text:"Datos detectados del comprobante" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
        FRAME  "montoRow"  459x19  row  w:fill h:hug  justify:space_between  items:center  clip
          TEXT  "Monto pagado"  85x15  w:hug h:hug  text:"Monto pagado" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q2,000"  60x19  w:hug h:hug  text:"Q2,000" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
        FRAME  "parcialChip"  285x15  row  w:hug h:hug  gap:4  items:center  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/solid(#e8a927)
          TEXT  "Pago parcial · quedan Q4,800 de deuda vencida"  274x15  w:hug h:hug  text:"Pago parcial · quedan Q1,400 de deuda vencida" Plus Jakarta Sans 500 12/15.12 c:status/warning/text(#b37d0f)
        FRAME  "div"  459x1  w:fill h:fixed  bg:border/default(#d9d6d1)  clip
        FRAME  "detail"  459x30  row  w:fill h:hug  gap:8  clip
          FRAME  "Frame"  225.5x30  col  w:fill h:hug  gap:2  clip
            TEXT  "Fecha de pago"  79x14  w:hug h:hug  text:"Fecha de pago" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "19 ago 2026"  64x14  w:hug h:hug  text:"19 ago 2026" Plus Jakarta Sans 600 11/13.86 c:text/primary(#24211d)
          FRAME  "Frame"  225.5x30  col  w:fill h:hug  gap:2  clip
            TEXT  "Referencia"  57x14  w:hug h:hug  text:"Referencia" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "0098-77451"  66x14  w:hug h:hug  text:"0098-77451" Plus Jakarta Sans 600 11/13.86 c:text/primary(#24211d)
        TEXT  "¿Algún dato incorrecto? Volver a subir"  200x14  w:hug h:hug  text:"¿Algún dato incorrecto? Volver a subir" Plus Jakarta Sans 600 11/13.86 c:text/tertiary(#8f887f)
      FRAME  "notaValidacion"  491x46  row  w:fill h:hug  p:6,12  gap:2  r:8  bg:status/info/subtle(#dce9ff)  clip
        TEXT  "El comprobante se enviará a Contabilidad para su validación. El pago quedará como Pendiente de validación."  467x34  w:fill h:hug  text:"El comprobante se enviará a Contabilidad para su validación. El pago quedará …" Plus Jakarta Sans 500 11/17 c:status/info/text(#2857a8)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Enviar a validación"  123x18  w:hug h:hug  text:"Enviar a validación" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=CallCompNoLegible
```
COMPONENT  "State=CallCompNoLegible"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado"  → "Workspace/SelectorResultado / Sel=Acuerdo"  491x40  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo" | "No hubo contacto"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x32  col  w:fill h:hug  gap:4  clip
        TEXT  "El cliente envió su comprobante, pero no pudimos leer la imagen. Sube una versión más clara para poder enviarla a validación."  491x32  w:fill h:hug  text:"El cliente envió su comprobante, pero no pudimos leer la imagen. Sube una ver…" Plus Jakarta Sans 400 13/16.38 c:text/secondary(#6b6459)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x68  row  w:fill h:hug  p:14,16  gap:12  justify:space_between  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x128  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x84  col  w:fill h:fixed  p:20,14  gap:4  justify:center  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Arrastra o sube la imagen del comprobante"  264x16  w:hug h:hug  text:"Arrastra o sube la imagen del comprobante" Plus Jakarta Sans 400 13/16.38 align-center c:text/secondary(#6b6459)
          TEXT  "JPG · PNG o PDF · máx. 10 MB"  149x14  w:hug h:hug  text:"JPG · PNG o PDF · máx. 10 MB" Plus Jakarta Sans 400 11/13.86 align-center c:text/secondary(#6b6459)
        FRAME  "chip"  257x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/danger/solid(#e5493a)
          TEXT  "comprobante-borroso.jpg · no legible"  222x15  w:hug h:hug  text:"comprobante-borroso.jpg · no legible" Plus Jakarta Sans 600 12/15.12 c:status/danger/text(#b32e22)
      FRAME  "errorBlock"  491x68  col  w:fill h:hug  p:8,14  gap:4  r:8  bg:status/danger/subtle(#fbdfdb)
        TEXT  "No pudimos leer el comprobante"  463x18  w:fill h:hug  text:"No pudimos leer el comprobante" Plus Jakarta Sans 600 14/17.64 c:status/danger/text(#b32e22)
        TEXT  "La imagen no permite identificar la información necesaria. Sube una imagen más clara del comprobante."  463x30  w:fill h:hug  text:"La imagen no permite identificar la información necesaria. Sube una imagen má…" Plus Jakarta Sans 400 12/15.12 c:status/danger/text(#b32e22)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Cambiar comprobante"  155x18  w:hug h:hug  text:"Cambiar comprobante" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=MsgConQuien
```
COMPONENT  "State=MsgConQuien"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion / Estado=ConQuien"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "‹  Atrás" | "¿A quién le escribimos?" | "¿A quién le escribimos?" | "LF" | "María José Contreras" | "Titular"
```
#### State=MsgWAcompose
```
COMPONENT  "State=MsgWAcompose"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x572  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "Nueva gestión · mensaje al titular"
      FRAME  "sepCanal"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorCanal"  → "Workspace/SelectorCanal / Canal=WhatsApp"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "WhatsApp" | "SMS" | "Correo"
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
      TEXT  "title"  131x19  w:hug h:hug  text:"Redactar mensaje" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      INSTANCE  "mensaje"  → "Workspace/Field-Textarea"  491x80  col  w:fill h:hug  gap:6  props{Placeholder=Hola Luis Fernando, le escribimos por su crédito con Club Cashin. Nos gustaría coordinar el pago pendiente. ¿Podría indicarnos una fecha estimada? Quedamos atentos.; Etiqueta=Mensaje sugerido}
        · textos: "Mensaje sugerido" | "Hola Luis Fernando, le escribimos por su crédito c"
      INSTANCE  "editarMensajeLink"  → "Button / Tipo=Ghost, Tamaño=Medium, Estado=Default"  148x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bd:border/default(#d9d6d1) 1in  props{MostrarIcono=False; Etiqueta=Editar mensaje}
        · textos: "Editar mensaje"
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "actionFoot (acciones = trabajo)"  531x70  row  w:fill h:hug  p:14,20  gap:10  clip
      INSTANCE  "Button"  → "Button / Tipo=Ghost, Tamaño=Medium, Estado=Default"  109x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bd:border/default(#d9d6d1) 1in  props{MostrarIcono=False; Etiqueta=Cancelar}
        · textos: "Cancelar"
      INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  149x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar mensaje}
        · textos: "Enviar mensaje"
```
#### State=MsgSMScompose
```
COMPONENT  "State=MsgSMScompose"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x572  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "Nueva gestión · SMS al titular"
      FRAME  "sepCanal"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorCanal"  → "Workspace/SelectorCanal / Canal=SMS"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "WhatsApp" | "SMS" | "Correo"
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
      TEXT  "title"  131x19  w:hug h:hug  text:"Redactar mensaje" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      INSTANCE  "mensaje"  → "Workspace/Field-Textarea"  491x80  col  w:fill h:hug  gap:6  props{Placeholder=Hola Luis Fernando, le escribimos por su crédito con Club Cashin. Nos gustaría coordinar el pago pendiente. ¿Podría indicarnos una fecha estimada? Quedamos atentos.; Etiqueta=Mensaje sugerido}
        · textos: "Mensaje sugerido" | "Hola Luis Fernando, le escribimos por su crédito c"
      INSTANCE  "editarMensajeLink"  → "Button / Tipo=Ghost, Tamaño=Medium, Estado=Default"  148x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bd:border/default(#d9d6d1) 1in  props{MostrarIcono=False; Etiqueta=Editar mensaje}
        · textos: "Editar mensaje"
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "actionFoot (acciones = trabajo)"  531x70  row  w:fill h:hug  p:14,20  gap:10  clip
      INSTANCE  "Button"  → "Button / Tipo=Ghost, Tamaño=Medium, Estado=Default"  109x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bd:border/default(#d9d6d1) 1in  props{MostrarIcono=False; Etiqueta=Cancelar}
        · textos: "Cancelar"
      INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  149x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar mensaje}
        · textos: "Enviar mensaje"
```
#### State=MsgCorreoCompose
```
COMPONENT  "State=MsgCorreoCompose"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x572  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "Nueva gestión · correo al titular"
      FRAME  "sepCanal"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorCanal"  → "Workspace/SelectorCanal / Canal=Correo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "WhatsApp" | "SMS" | "Correo"
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
      TEXT  "title"  130x19  w:hug h:hug  text:"Plantilla de correo" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "selectorPlantilla"  491x37  row  w:fill h:hug  p:4  gap:4  r:10  bg:brand/primary-subtle(#edfbfa)  clip
        FRAME  "segP"  158.33x29  row  w:fill h:hug  p:7,0  justify:center  items:center  r:8  clip
          TEXT  "Recordatorio"  77x15  w:hug h:hug  text:"Recordatorio" Plus Jakarta Sans 500 12/15.12 c:text/tertiary(#8f887f)
        FRAME  "segP"  158.33x29  row  w:fill h:hug  p:7,0  justify:center  items:center  r:8  bg:bg/surface-raised(#ffffff)  fx:[0,1 3 0 #0000000f]  clip
          TEXT  "Aviso de mora"  82x15  w:hug h:hug  text:"Aviso de mora" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "segP"  158.33x29  row  w:fill h:hug  p:7,0  justify:center  items:center  r:8  clip
          TEXT  "Convenio"  56x15  w:hug h:hug  text:"Convenio" Plus Jakarta Sans 500 12/15.12 c:text/tertiary(#8f887f)
      INSTANCE  "mensaje"  → "Workspace/Field-Textarea"  491x80  col  w:fill h:hug  gap:6  props{Placeholder=Estimado Luis Fernando, le recordamos que su crédito #48972 presenta 44 días de mora por Q3,200. Puede regularizar su pago mediante transferencia, boleta o link de pago. Quedamos atentos.; Etiqueta=Vista previa · Aviso de mora}
        · textos: "Vista previa · Aviso de mora" | "Estimado Luis Fernando, le recordamos que su crédi"
      INSTANCE  "editarMensajeLink"  → "Button / Tipo=Ghost, Tamaño=Medium, Estado=Default"  148x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bd:border/default(#d9d6d1) 1in  props{MostrarIcono=False; Etiqueta=Editar mensaje}
        · textos: "Editar mensaje"
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "actionFoot (acciones = trabajo)"  531x70  row  w:fill h:hug  p:14,20  gap:10  clip
      INSTANCE  "Button"  → "Button / Tipo=Ghost, Tamaño=Medium, Estado=Default"  109x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bd:border/default(#d9d6d1) 1in  props{MostrarIcono=False; Etiqueta=Cancelar}
        · textos: "Cancelar"
      INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  149x42  row  w:hug h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar mensaje}
        · textos: "Enviar mensaje"
```
#### State=MsgWAenviado
```
COMPONENT  "State=MsgWAenviado"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x472  col  w:fill h:fill  p:16,20  gap:10  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · enviado hace 12 min · esperando respues"
      FRAME  "exito"  491x95  col  w:fill h:hug  p:6,0  gap:4  justify:center  clip
        TEXT  "Mensaje enviado"  491x21  w:fill h:hug  text:"Mensaje enviado" Plus Jakarta Sans 700 17/21.42 c:text/primary(#24211d)
        TEXT  "Puedes continuar con tu siguiente caso. Este crédito permanecerá en seguimiento hasta recibir respuesta."  491x30  w:fill h:hug  text:"Puedes continuar con tu siguiente caso. Este crédito permanecerá en seguimien…" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
        FRAME  "okChip"  192x24  row  w:hug h:hug  p:5,10  gap:6  items:center  r:12  bg:status/success/alt-bg(#dff5e6)  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Éxito"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          TEXT  "Guardado en el historial · hoy"  152x14  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 11/13.86 c:status/success/alt-fg(#0f7a3d)
      FRAME  "seguimientoPill"  295x32  row  w:hug h:hug  p:8,12  gap:8  items:center  r:8  bg:status/warning/subtle(#fcefc7)  clip
        ELLIPSE  "Ellipse"  8x8  w:fixed h:fixed  bg:status/warning/solid(#e8a927)
        TEXT  "Sin respuesta inmediata · En seguimiento"  255x16  w:hug h:hug  text:"Sin respuesta inmediata · En seguimiento" Plus Jakarta Sans 600 13/16.38 c:status/warning/text(#b37d0f)
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "actionFoot (acciones = trabajo)"  531x170  col  w:fill h:hug  p:14,20  gap:8  clip
      FRAME  "secRow"  491x42  row  w:fill h:hug  gap:8  clip
        INSTANCE  "btnAbrir"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir WhatsApp}
          · textos: "Abrir WhatsApp"
        INSTANCE  "btnRegistrar"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Registrar resultado}
          · textos: "Registrar resultado"
      INSTANCE  "btnVolver"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Volver al inicio}
        · textos: "Volver al inicio"
      INSTANCE  "btnSiguiente"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Siguiente caso}
        · textos: "Siguiente caso"
```
#### State=MsgSMSenviado
```
COMPONENT  "State=MsgSMSenviado"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x472  col  w:fill h:fill  p:16,20  gap:10  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "SMS · enviado hace 12 min · esperando respuesta"
      FRAME  "exito"  491x95  col  w:fill h:hug  p:6,0  gap:4  justify:center  clip
        TEXT  "Mensaje enviado"  491x21  w:fill h:hug  text:"Mensaje enviado" Plus Jakarta Sans 700 17/21.42 c:text/primary(#24211d)
        TEXT  "Puedes continuar con tu siguiente caso. Este crédito permanecerá en seguimiento hasta recibir respuesta."  491x30  w:fill h:hug  text:"Puedes continuar con tu siguiente caso. Este crédito permanecerá en seguimien…" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
        FRAME  "okChip"  192x24  row  w:hug h:hug  p:5,10  gap:6  items:center  r:12  bg:status/success/alt-bg(#dff5e6)  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Éxito"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          TEXT  "Guardado en el historial · hoy"  152x14  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 11/13.86 c:status/success/alt-fg(#0f7a3d)
      FRAME  "seguimientoPill"  295x32  row  w:hug h:hug  p:8,12  gap:8  items:center  r:8  bg:status/warning/subtle(#fcefc7)  clip
        ELLIPSE  "Ellipse"  8x8  w:fixed h:fixed  bg:status/warning/solid(#e8a927)
        TEXT  "Sin respuesta inmediata · En seguimiento"  255x16  w:hug h:hug  text:"Sin respuesta inmediata · En seguimiento" Plus Jakarta Sans 600 13/16.38 c:status/warning/text(#b37d0f)
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "actionFoot (acciones = trabajo)"  531x170  col  w:fill h:hug  p:14,20  gap:8  clip
      FRAME  "secRow"  491x42  row  w:fill h:hug  gap:8  clip
        INSTANCE  "btnAbrir"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Mensajes}
          · textos: "Abrir Mensajes"
        INSTANCE  "btnRegistrar"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Registrar resultado}
          · textos: "Registrar resultado"
      INSTANCE  "btnVolver"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Volver al inicio}
        · textos: "Volver al inicio"
      INSTANCE  "btnSiguiente"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Siguiente caso}
        · textos: "Siguiente caso"
```
#### State=MsgCorreoEnviado
```
COMPONENT  "State=MsgCorreoEnviado"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x472  col  w:fill h:fill  p:16,20  gap:10  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "Correo · enviado hace 12 min · esperando respuesta"
      FRAME  "exito"  491x95  col  w:fill h:hug  p:6,0  gap:4  justify:center  clip
        TEXT  "Mensaje enviado"  491x21  w:fill h:hug  text:"Mensaje enviado" Plus Jakarta Sans 700 17/21.42 c:text/primary(#24211d)
        TEXT  "Puedes continuar con tu siguiente caso. Este crédito permanecerá en seguimiento hasta recibir respuesta."  491x30  w:fill h:hug  text:"Puedes continuar con tu siguiente caso. Este crédito permanecerá en seguimien…" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
        FRAME  "okChip"  192x24  row  w:hug h:hug  p:5,10  gap:6  items:center  r:12  bg:status/success/alt-bg(#dff5e6)  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Éxito"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          TEXT  "Guardado en el historial · hoy"  152x14  w:hug h:hug  text:"Guardado en el historial · hoy" Plus Jakarta Sans 600 11/13.86 c:status/success/alt-fg(#0f7a3d)
      FRAME  "seguimientoPill"  295x32  row  w:hug h:hug  p:8,12  gap:8  items:center  r:8  bg:status/warning/subtle(#fcefc7)  clip
        ELLIPSE  "Ellipse"  8x8  w:fixed h:fixed  bg:status/warning/solid(#e8a927)
        TEXT  "Sin respuesta inmediata · En seguimiento"  255x16  w:hug h:hug  text:"Sin respuesta inmediata · En seguimiento" Plus Jakarta Sans 600 13/16.38 c:status/warning/text(#b37d0f)
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "actionFoot (acciones = trabajo)"  531x170  col  w:fill h:hug  p:14,20  gap:8  clip
      FRAME  "secRow"  491x42  row  w:fill h:hug  gap:8  clip
        INSTANCE  "btnAbrir"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Correo}
          · textos: "Abrir Correo"
        INSTANCE  "btnRegistrar"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  241.5x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Registrar resultado}
          · textos: "Registrar resultado"
      INSTANCE  "btnVolver"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Volver al inicio}
        · textos: "Volver al inicio"
      INSTANCE  "btnSiguiente"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Siguiente caso}
        · textos: "Siguiente caso"
```
#### State=EntLlamAcuerdo
```
COMPONENT  "State=EntLlamAcuerdo"  531x643  col  w:fixed h:fixed  p:10,0,0,0  clip
  INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  64x20  row  w:hug h:hug  p:2,6,2,16  items:center  bg:#ffffff
    · textos: "‹  Atrás"
  FRAME  "ContenidoGestión"  531x613  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x613  col  w:fill h:fill  p:16,20  gap:12  clip
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "¿El cliente aceptó un compromiso de pago?"  1520x19  w:fixed h:fill  text:"¿El cliente aceptó un compromiso de pago?" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      TEXT  "Marca la respuesta según el resultado de la conversación."  491x14  w:fill h:hug  text:"Marca la respuesta según el resultado de la conversación." Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
      FRAME  "opciones"  491x224  col  w:fill h:hug  gap:10  clip
        FRAME  "optCard/Si"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Sí, hubo compromiso"  383x18  w:fill h:hug  text:"Sí, hubo compromiso" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "Registrar una promesa de pago"  383x15  w:fill h:hug  text:"Registrar una promesa de pago" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
        FRAME  "optCard/RealizarPago"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Realizar pago"  383x18  w:fill h:hug  text:"Realizar pago" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "Registrar el pago que hará el cliente"  383x15  w:fill h:hug  text:"Registrar el pago que hará el cliente" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
        FRAME  "optCard/Comprobante"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Comprobante de pago recibido"  383x18  w:fill h:hug  text:"Comprobante de pago recibido" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "El cliente ya pagó y envió su comprobante"  383x15  w:fill h:hug  text:"El cliente ya pagó y envió su comprobante" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
      INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar rebaja de mora}
        · textos: "Solicitar rebaja de mora"
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
```
#### State=EntLlamNoAcuerdo
```
COMPONENT  "State=EntLlamNoAcuerdo"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "Llamada entrante · en curso" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=NoAcuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "Registrar gestión"  1520x19  w:fixed h:fill  text:"Registrar gestión" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "resultadoAutomatico"  491x30  row  w:fill h:hug  p:7,10  gap:8  items:center  r:10  bg:neutral/100(#f5f4f2)  clip
        FRAME  "Frame"  16x16  row  w:hug h:hug  justify:center  items:center
          INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Secundario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-x}
        FRAME  "Frame"  447x15  col  w:fill h:hug  gap:2  clip
          TEXT  "Contactado · sin acuerdo de pago"  447x15  w:fill h:hug  text:"Contactado · sin acuerdo de pago" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "resumen"  491x85  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Llamada saliente"  97x15  w:hug h:hug  text:"Llamada saliente" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Participante de la gestión"  144x15  w:hug h:hug  text:"Participante de la gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "María José Contreras · Titular"  164x15  w:hug h:hug  text:"María José Contreras · Titular" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Duración"  52x15  w:hug h:hug  text:"Duración" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "01:24"  33x15  w:hug h:hug  text:"01:24" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "reagenda"  491x110  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x16  row  w:fill h:hug  gap:8  items:center  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/refresh-cw}
          TEXT  "¿El cliente solicitó que se le contacte nuevamente?"  439x16  w:fill h:hug  text:"¿El cliente solicitó que se le contacte nuevamente?" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
        FRAME  "segmented"  463x40  row  w:fill h:hug  p:4  gap:4  r:10  bg:bg/canvas(#fafaf9)  clip
          FRAME  "seg/No"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
            TEXT  "No"  19x16  w:hug h:hug  text:"No" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          FRAME  "seg/Sí"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  clip
            TEXT  "Sí"  12x16  w:hug h:hug  text:"Sí" Plus Jakarta Sans 500 13/16.38 c:text/secondary(#6b6459)
        TEXT  "Cambia a Sí para agendar el seguimiento en tu cola de trabajo."  463x14  w:fill h:hug  text:"Cambia a Sí para agendar el seguimiento en tu cola de trabajo." Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntLlamReagenda
```
COMPONENT  "State=EntLlamReagenda"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "Llamada entrante · en curso" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=NoAcuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "Registrar gestión"  1520x19  w:fixed h:fill  text:"Registrar gestión" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "resultadoAutomatico"  491x30  row  w:fill h:hug  p:7,10  gap:8  items:center  r:10  bg:neutral/100(#f5f4f2)  clip
        FRAME  "Frame"  16x16  row  w:hug h:hug  justify:center  items:center
          INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Secundario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-x}
        FRAME  "Frame"  447x15  col  w:fill h:hug  gap:2  clip
          TEXT  "Contactado · sin acuerdo de pago"  447x15  w:fill h:hug  text:"Contactado · sin acuerdo de pago" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "resumen"  491x85  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Llamada saliente"  97x15  w:hug h:hug  text:"Llamada saliente" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Participante de la gestión"  144x15  w:hug h:hug  text:"Participante de la gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "María José Contreras · Titular"  164x15  w:hug h:hug  text:"María José Contreras · Titular" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Duración"  52x15  w:hug h:hug  text:"Duración" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "01:24"  33x15  w:hug h:hug  text:"01:24" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "reagenda"  491x189  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x16  row  w:fill h:hug  gap:8  items:center  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/refresh-cw}
          TEXT  "¿El cliente solicitó que se le contacte nuevamente?"  439x16  w:fill h:hug  text:"¿El cliente solicitó que se le contacte nuevamente?" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
        FRAME  "segmented"  463x40  row  w:fill h:hug  p:4  gap:4  r:10  bg:bg/canvas(#fafaf9)  clip
          FRAME  "seg/No"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  clip
            TEXT  "No"  19x16  w:hug h:hug  text:"No" Plus Jakarta Sans 500 13/16.38 c:text/secondary(#6b6459)
          FRAME  "seg/Sí"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1fa79b) 1in  clip
            TEXT  "Sí"  12x16  w:hug h:hug  text:"Sí" Plus Jakarta Sans 600 13/16.38 c:brand/primary(#1fa79b)
        FRAME  "Frame"  463x53  row  w:fill h:hug  gap:10  clip
          FRAME  "Frame"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Fecha de contacto"  100x14  w:hug h:hug  text:"Fecha de contacto" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  147.67x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
              TEXT  "08 ago 2026"  79.67x16  w:fill h:hug  text:"08 ago 2026" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
          FRAME  "Frame"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Hora"  26x14  w:hug h:hug  text:"Hora" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  147.67x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/clock}
              TEXT  "10:00 am"  79.67x16  w:fill h:hug  text:"10:00 am" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
          FRAME  "field/Medio"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "label"  34x14  w:hug h:hug  text:"Medio" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "medioIconSel"  94x34  row  w:hug h:hug  gap:6  clip
              FRAME  "opt/Llamada"  44x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1fa79b) 1in  clip
                INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/phone}
              FRAME  "opt/WhatsApp"  44x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bd:border/default(#d9d6d1) 1in  clip
                INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/message-circle}
        FRAME  "Frame"  463x32  row  w:fill h:hug  p:8,10  gap:8  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
          TEXT  "Se agendará automáticamente en tu cola de trabajo."  419x14  w:fill h:hug  text:"Se agendará automáticamente en tu cola de trabajo." Plus Jakarta Sans 500 11/13.86 c:brand/primary(#1fa79b)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntLlamPromesa
```
COMPONENT  "State=EntLlamPromesa"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x582  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "Llamada entrante · en curso" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar promesa de pago"  1520x20  w:fixed h:fill  text:"Registrar promesa de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "Frame"  491x30  row  w:fill h:hug  p:7,12,7,10  gap:8  items:center  r:8  bg:status/success/alt-bg(#dff5e6)  clip
        INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Éxito"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/handshake}
        TEXT  "Compromiso aceptado · registra la promesa de pago"  445x15  w:fill h:hug  text:"Compromiso aceptado · registra la promesa de pago" Plus Jakarta Sans 600 12/15.12 c:status/success/alt-fg(#0f7a3d)
      FRAME  "promesaCard"  491x140  col  w:fill h:hug  p:12,14  gap:10  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x53  row  w:fill h:hug  gap:10  clip
          FRAME  "Frame"  226.5x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Monto"  35x14  w:hug h:hug  text:"Monto" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  226.5x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/banknote}
              TEXT  "Q1,850"  180.5x16  w:fill h:hug  text:"Q3,200" Plus Jakarta Sans 700 13/16.38 c:text/primary(#24211d)
          FRAME  "Frame"  226.5x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Fecha compromiso"  103x14  w:hug h:hug  text:"Fecha compromiso" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  226.5x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
              TEXT  "07 ago 2026"  158.5x16  w:fill h:hug  text:"07 ago 2026" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
        FRAME  "Frame"  463x53  col  w:fill h:hug  gap:5  clip
          TEXT  "Tipo de pago"  70x14  w:hug h:hug  text:"Tipo de pago" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
          FRAME  "Frame"  463x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
            TEXT  "Pago total de la cuota"  419x16  w:fill h:hug  text:"Pago total de la cuota" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
            INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x61  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x60  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x42  row  w:fill h:hug  p:12,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntLlamPago
```
COMPONENT  "State=EntLlamPago"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarPago"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x588  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "Llamada entrante · en curso" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar pago"  107x19  w:hug h:hug  text:"Registrar pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Registra el pago que realizará el cliente y prepárale la información."  370x15  w:hug h:hug  text:"Registra el pago que realizará el cliente y prepárale la información." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      FRAME  "Workspace/Card/DeudaCuota"  491x39  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "a"  229.5x23  row  w:fill h:hug  gap:6  items:baseline  clip
          TEXT  "Deuda vencida"  86x15  w:hug h:hug  text:"Deuda vencida" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q6,800"  70x23  w:hug h:hug  text:"Q6,800" Plus Jakarta Sans 600 18/22.68 c:status/warning/text(#b37d0f)
        FRAME  "b"  229.5x16  row  w:fill h:hug  gap:6  items:baseline  clip
          TEXT  "Cuota normal"  78x15  w:hug h:hug  text:"Cuota normal" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q3,200"  51x16  w:hug h:hug  text:"Q3,200" Plus Jakarta Sans 600 13/16.38 c:text/tertiary(#8f887f)
      FRAME  "field"  491x62  col  w:fill h:hug  gap:4  clip
        TEXT  "Monto que pagará hoy"  130x15  w:hug h:hug  text:"Monto que pagará hoy" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x43  row  w:fill h:hug  p:12,14  gap:8  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Q 2,000"  62x19  w:hug h:hug  text:"Q 2,000" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "recalc"  491x35  row  w:fill h:hug  p:6,16  gap:10  justify:space_between  items:center  r:12  bg:status/warning/subtle(#fcefc7)  clip
        FRAME  "chip"  107x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/text(#b37d0f)
          TEXT  "Pago parcial"  72x15  w:hug h:hug  text:"Pago parcial" Plus Jakarta Sans 600 12/15.12 c:status/warning/text(#b37d0f)
        FRAME  "rr"  211x23  row  w:hug h:fill  gap:8  items:center  clip
          TEXT  "Deuda vencida restante"  147x16  w:hug h:hug  text:"Deuda vencida restante" Plus Jakarta Sans 400 13/16.38 c:text/secondary(#6b6459)
          TEXT  "Q4,800"  56x19  w:hug h:hug  text:"Q1,400" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      TEXT  "Método de pago"  97x15  w:hug h:hug  text:"Método de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
      FRAME  "mcard"  491x64  row  w:fill h:hug  p:6,16  gap:8  items:center  r:12  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1a8080) 1.5in  clip
        FRAME  "tx"  433x52  col  w:fill h:hug  gap:2  clip
          TEXT  "Link de pago"  86x18  w:hug h:hug  text:"Link de pago" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
          TEXT  "Recargo por pago con tarjeta · 5%"  177x14  w:hug h:hug  text:"Recargo por pago con tarjeta · 5%" Plus Jakarta Sans 400 11/13.86 c:text/secondary(#6b6459)
          TEXT  "desglose"  433x16  w:fill h:hug  text:"Monto Q2,000 · Recargo Q100 · Total Q2,100" Plus Jakarta Sans 600 12.5/15.75 c:text/primary(#24211d)
        ELLIPSE  "Ellipse"  18x18  w:fixed h:fixed  bg:brand/primary(#1fa79b)
      FRAME  "mcard"  491x64  row  w:fill h:hug  p:6,16  gap:8  items:center  r:12  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "tx"  433x52  col  w:fill h:hug  gap:2  clip
          TEXT  "Depósito o transferencia"  167x18  w:hug h:hug  text:"Depósito o transferencia" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
          TEXT  "Se enviarán los datos de la cuenta."  178x14  w:hug h:hug  text:"Se enviarán los datos de la cuenta." Plus Jakarta Sans 400 11/13.86 c:text/secondary(#6b6459)
          TEXT  "sinrecargo"  433x16  w:fill h:hug  text:"Sin recargo · Total Q2,000" Plus Jakarta Sans 500 12.5/15.75 c:text/tertiary(#8f887f)
        ELLIPSE  "Ellipse"  18x18  w:fixed h:fixed  bd:border/default(#d9d6d1) 1.5in
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x55  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x54  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x36  row  w:fill h:hug  p:9,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Continuar a WhatsApp"  152x18  w:hug h:hug  text:"Continuar a WhatsApp" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntLlamCompVacio
```
COMPONENT  "State=EntLlamCompVacio"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "Llamada entrante · en curso" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Sube el comprobante que envió el cliente para detectar y validar la información."  491x15  w:fill h:hug  text:"Sube el comprobante que envió el cliente para detectar y validar la información." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x56  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x102  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x84  col  w:fill h:fixed  p:20,14  gap:4  justify:center  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Arrastra o sube la imagen del comprobante"  264x16  w:hug h:hug  text:"Arrastra o sube la imagen del comprobante" Plus Jakarta Sans 400 13/16.38 align-center c:text/secondary(#6b6459)
          TEXT  "JPG · PNG o PDF · máx. 10 MB"  149x14  w:hug h:hug  text:"JPG · PNG o PDF · máx. 10 MB" Plus Jakarta Sans 400 11/13.86 align-center c:text/secondary(#6b6459)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:#eceae7  clip
          TEXT  "Enviar a validación"  123x18  w:hug h:hug  text:"Enviar a validación" Plus Jakarta Sans 600 14/17.64 c:text/tertiary(#8f887f)
```
#### State=EntLlamCompCargado
```
COMPONENT  "State=EntLlamCompCargado"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "Llamada entrante · en curso" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Revisa la información detectada y envíala a Contabilidad para validación."  491x15  w:fill h:hug  text:"Revisa la información detectada y envíala a Contabilidad para validación." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x56  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x41  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "chip"  268x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/text(#b37d0f)
          TEXT  "comprobante-mariajose.jpg · 240 KB"  233x15  w:hug h:hug  text:"comprobante-luisfernando.jpg · 240 KB" Plus Jakarta Sans 600 12/15.12 c:status/warning/text(#b37d0f)
      FRAME  "datosDetectados"  491x127  col  w:fill h:hug  p:7,16  gap:4[space/4]  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        TEXT  "Datos detectados del comprobante"  459x14  w:fill h:hug  text:"Datos detectados del comprobante" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
        FRAME  "montoRow"  459x19  row  w:fill h:hug  justify:space_between  items:center  clip
          TEXT  "Monto pagado"  85x15  w:hug h:hug  text:"Monto pagado" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q2,000"  60x19  w:hug h:hug  text:"Q2,000" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
        FRAME  "parcialChip"  285x15  row  w:hug h:hug  gap:4  items:center  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/solid(#e8a927)
          TEXT  "Pago parcial · quedan Q4,800 de deuda vencida"  274x15  w:hug h:hug  text:"Pago parcial · quedan Q1,400 de deuda vencida" Plus Jakarta Sans 500 12/15.12 c:status/warning/text(#b37d0f)
        FRAME  "div"  459x1  w:fill h:fixed  bg:border/default(#d9d6d1)  clip
        FRAME  "detail"  459x30  row  w:fill h:hug  gap:8  clip
          FRAME  "Frame"  225.5x30  col  w:fill h:hug  gap:2  clip
            TEXT  "Fecha de pago"  79x14  w:hug h:hug  text:"Fecha de pago" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "19 ago 2026"  64x14  w:hug h:hug  text:"19 ago 2026" Plus Jakarta Sans 600 11/13.86 c:text/primary(#24211d)
          FRAME  "Frame"  225.5x30  col  w:fill h:hug  gap:2  clip
            TEXT  "Referencia"  57x14  w:hug h:hug  text:"Referencia" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "0098-77451"  66x14  w:hug h:hug  text:"0098-77451" Plus Jakarta Sans 600 11/13.86 c:text/primary(#24211d)
        TEXT  "¿Algún dato incorrecto? Volver a subir"  200x14  w:hug h:hug  text:"¿Algún dato incorrecto? Volver a subir" Plus Jakarta Sans 600 11/13.86 c:text/tertiary(#8f887f)
      FRAME  "notaValidacion"  491x46  row  w:fill h:hug  p:6,12  gap:2  r:8  bg:status/info/subtle(#dce9ff)  clip
        TEXT  "El comprobante se enviará a Contabilidad para su validación. El pago quedará como Pendiente de validación."  467x34  w:fill h:hug  text:"El comprobante se enviará a Contabilidad para su validación. El pago quedará …" Plus Jakarta Sans 500 11/17 c:status/info/text(#2857a8)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Enviar a validación"  123x18  w:hug h:hug  text:"Enviar a validación" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntLlamCompNoLegible
```
COMPONENT  "State=EntLlamCompNoLegible"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "Llamada entrante · en curso" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x32  col  w:fill h:hug  gap:4  clip
        TEXT  "El cliente envió su comprobante, pero no pudimos leer la imagen. Sube una versión más clara para poder enviarla a validación."  491x32  w:fill h:hug  text:"El cliente envió su comprobante, pero no pudimos leer la imagen. Sube una ver…" Plus Jakarta Sans 400 13/16.38 c:text/secondary(#6b6459)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x68  row  w:fill h:hug  p:14,16  gap:12  justify:space_between  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x128  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x84  col  w:fill h:fixed  p:20,14  gap:4  justify:center  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Arrastra o sube la imagen del comprobante"  264x16  w:hug h:hug  text:"Arrastra o sube la imagen del comprobante" Plus Jakarta Sans 400 13/16.38 align-center c:text/secondary(#6b6459)
          TEXT  "JPG · PNG o PDF · máx. 10 MB"  149x14  w:hug h:hug  text:"JPG · PNG o PDF · máx. 10 MB" Plus Jakarta Sans 400 11/13.86 align-center c:text/secondary(#6b6459)
        FRAME  "chip"  257x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/danger/solid(#e5493a)
          TEXT  "comprobante-borroso.jpg · no legible"  222x15  w:hug h:hug  text:"comprobante-borroso.jpg · no legible" Plus Jakarta Sans 600 12/15.12 c:status/danger/text(#b32e22)
      FRAME  "errorBlock"  491x68  col  w:fill h:hug  p:8,14  gap:4  r:8  bg:status/danger/subtle(#fbdfdb)
        TEXT  "No pudimos leer el comprobante"  463x18  w:fill h:hug  text:"No pudimos leer el comprobante" Plus Jakarta Sans 600 14/17.64 c:status/danger/text(#b32e22)
        TEXT  "La imagen no permite identificar la información necesaria. Sube una imagen más clara del comprobante."  463x30  w:fill h:hug  text:"La imagen no permite identificar la información necesaria. Sube una imagen má…" Plus Jakarta Sans 400 12/15.12 c:status/danger/text(#b32e22)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Cambiar comprobante"  155x18  w:hug h:hug  text:"Cambiar comprobante" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntWAAcuerdo
```
COMPONENT  "State=EntWAAcuerdo"  531x643  col  w:fixed h:fixed  p:10,0,0,0  clip
  INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  64x20  row  w:hug h:hug  p:2,6,2,16  items:center  bg:#ffffff
    · textos: "‹  Atrás"
  FRAME  "ContenidoGestión"  531x613  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x613  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "¿El cliente aceptó un compromiso de pago?"  1520x19  w:fixed h:fill  text:"¿El cliente aceptó un compromiso de pago?" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      TEXT  "Marca la respuesta según el resultado de la conversación."  491x14  w:fill h:hug  text:"Marca la respuesta según el resultado de la conversación." Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
      FRAME  "opciones"  491x224  col  w:fill h:hug  gap:10  clip
        FRAME  "optCard/Si"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Sí, hubo compromiso"  383x18  w:fill h:hug  text:"Sí, hubo compromiso" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "Registrar una promesa de pago"  383x15  w:fill h:hug  text:"Registrar una promesa de pago" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
        FRAME  "optCard/RealizarPago"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Realizar pago"  383x18  w:fill h:hug  text:"Realizar pago" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "Registrar el pago que hará el cliente"  383x15  w:fill h:hug  text:"Registrar el pago que hará el cliente" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
        FRAME  "optCard/Comprobante"  491x68  row  w:fill h:hug  p:14  gap:12  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          FRAME  "Frame"  40x40  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:status/success/alt-bg(#dff5e6)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Éxito"  20x20  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "Frame"  383x35  col  w:fill h:hug  gap:2  clip
            TEXT  "Comprobante de pago recibido"  383x18  w:fill h:hug  text:"Comprobante de pago recibido" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
            TEXT  "El cliente ya pagó y envió su comprobante"  383x15  w:fill h:hug  text:"El cliente ya pagó y envió su comprobante" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-right}
      INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar rebaja de mora}
        · textos: "Solicitar rebaja de mora"
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
```
#### State=EntWANoAcuerdo
```
COMPONENT  "State=EntWANoAcuerdo"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=NoAcuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "Registrar gestión"  1520x19  w:fixed h:fill  text:"Registrar gestión" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "resultadoAutomatico"  491x30  row  w:fill h:hug  p:7,10  gap:8  items:center  r:10  bg:neutral/100(#f5f4f2)  clip
        FRAME  "Frame"  16x16  row  w:hug h:hug  justify:center  items:center
          INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Secundario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-x}
        FRAME  "Frame"  447x15  col  w:fill h:hug  gap:2  clip
          TEXT  "Contactado · sin acuerdo de pago"  447x15  w:fill h:hug  text:"Contactado · sin acuerdo de pago" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "resumen"  491x85  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Llamada saliente"  97x15  w:hug h:hug  text:"Llamada saliente" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Participante de la gestión"  144x15  w:hug h:hug  text:"Participante de la gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "María José Contreras · Titular"  164x15  w:hug h:hug  text:"María José Contreras · Titular" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Duración"  52x15  w:hug h:hug  text:"Duración" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "01:24"  33x15  w:hug h:hug  text:"01:24" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "reagenda"  491x110  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x16  row  w:fill h:hug  gap:8  items:center  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/refresh-cw}
          TEXT  "¿El cliente solicitó que se le contacte nuevamente?"  439x16  w:fill h:hug  text:"¿El cliente solicitó que se le contacte nuevamente?" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
        FRAME  "segmented"  463x40  row  w:fill h:hug  p:4  gap:4  r:10  bg:bg/canvas(#fafaf9)  clip
          FRAME  "seg/No"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
            TEXT  "No"  19x16  w:hug h:hug  text:"No" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          FRAME  "seg/Sí"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  clip
            TEXT  "Sí"  12x16  w:hug h:hug  text:"Sí" Plus Jakarta Sans 500 13/16.38 c:text/secondary(#6b6459)
        TEXT  "Cambia a Sí para agendar el seguimiento en tu cola de trabajo."  463x14  w:fill h:hug  text:"Cambia a Sí para agendar el seguimiento en tu cola de trabajo." Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntWAReagenda
```
COMPONENT  "State=EntWAReagenda"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=NoAcuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x19  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        TEXT  "Registrar gestión"  1520x19  w:fixed h:fill  text:"Registrar gestión" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "resultadoAutomatico"  491x30  row  w:fill h:hug  p:7,10  gap:8  items:center  r:10  bg:neutral/100(#f5f4f2)  clip
        FRAME  "Frame"  16x16  row  w:hug h:hug  justify:center  items:center
          INSTANCE  "Icon"  → "Icon / Tamaño=M, Color=Secundario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-x}
        FRAME  "Frame"  447x15  col  w:fill h:hug  gap:2  clip
          TEXT  "Contactado · sin acuerdo de pago"  447x15  w:fill h:hug  text:"Contactado · sin acuerdo de pago" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "resumen"  491x85  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Llamada saliente"  97x15  w:hug h:hug  text:"Llamada saliente" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Participante de la gestión"  144x15  w:hug h:hug  text:"Participante de la gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "María José Contreras · Titular"  164x15  w:hug h:hug  text:"María José Contreras · Titular" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Duración"  52x15  w:hug h:hug  text:"Duración" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "01:24"  33x15  w:hug h:hug  text:"01:24" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "reagenda"  491x189  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x16  row  w:fill h:hug  gap:8  items:center  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/refresh-cw}
          TEXT  "¿El cliente solicitó que se le contacte nuevamente?"  439x16  w:fill h:hug  text:"¿El cliente solicitó que se le contacte nuevamente?" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
        FRAME  "segmented"  463x40  row  w:fill h:hug  p:4  gap:4  r:10  bg:bg/canvas(#fafaf9)  clip
          FRAME  "seg/No"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  clip
            TEXT  "No"  19x16  w:hug h:hug  text:"No" Plus Jakarta Sans 500 13/16.38 c:text/secondary(#6b6459)
          FRAME  "seg/Sí"  225.5x32  row  w:fill h:hug  p:8,0  justify:center  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1fa79b) 1in  clip
            TEXT  "Sí"  12x16  w:hug h:hug  text:"Sí" Plus Jakarta Sans 600 13/16.38 c:brand/primary(#1fa79b)
        FRAME  "Frame"  463x53  row  w:fill h:hug  gap:10  clip
          FRAME  "Frame"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Fecha de contacto"  100x14  w:hug h:hug  text:"Fecha de contacto" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  147.67x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
              TEXT  "08 ago 2026"  79.67x16  w:fill h:hug  text:"08 ago 2026" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
          FRAME  "Frame"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Hora"  26x14  w:hug h:hug  text:"Hora" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  147.67x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/clock}
              TEXT  "10:00 am"  79.67x16  w:fill h:hug  text:"10:00 am" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
          FRAME  "field/Medio"  147.67x53  col  w:fill h:hug  gap:5  clip
            TEXT  "label"  34x14  w:hug h:hug  text:"Medio" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "medioIconSel"  94x34  row  w:hug h:hug  gap:6  clip
              FRAME  "opt/Llamada"  44x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1fa79b) 1in  clip
                INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/phone}
              FRAME  "opt/WhatsApp"  44x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bd:border/default(#d9d6d1) 1in  clip
                INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/message-circle}
        FRAME  "Frame"  463x32  row  w:fill h:hug  p:8,10  gap:8  items:center  r:8  bg:brand/primary-subtle(#edfbfa)  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Marca"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
          TEXT  "Se agendará automáticamente en tu cola de trabajo."  419x14  w:fill h:hug  text:"Se agendará automáticamente en tu cola de trabajo." Plus Jakarta Sans 500 11/13.86 c:brand/primary(#1fa79b)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntWAPromesa
```
COMPONENT  "State=EntWAPromesa"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x582  col  w:fill h:fill  p:16,20  gap:12  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar promesa de pago"  1520x20  w:fixed h:fill  text:"Registrar promesa de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "Frame"  491x30  row  w:fill h:hug  p:7,12,7,10  gap:8  items:center  r:8  bg:status/success/alt-bg(#dff5e6)  clip
        INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Éxito"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/handshake}
        TEXT  "Compromiso aceptado · registra la promesa de pago"  445x15  w:fill h:hug  text:"Compromiso aceptado · registra la promesa de pago" Plus Jakarta Sans 600 12/15.12 c:status/success/alt-fg(#0f7a3d)
      FRAME  "promesaCard"  491x140  col  w:fill h:hug  p:12,14  gap:10  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "Frame"  463x53  row  w:fill h:hug  gap:10  clip
          FRAME  "Frame"  226.5x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Monto"  35x14  w:hug h:hug  text:"Monto" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  226.5x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/banknote}
              TEXT  "Q1,850"  180.5x16  w:fill h:hug  text:"Q3,200" Plus Jakarta Sans 700 13/16.38 c:text/primary(#24211d)
          FRAME  "Frame"  226.5x53  col  w:fill h:hug  gap:5  clip
            TEXT  "Fecha compromiso"  103x14  w:hug h:hug  text:"Fecha compromiso" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
            FRAME  "Frame"  226.5x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
              INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Terciario"  16x16  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/calendar}
              TEXT  "07 ago 2026"  158.5x16  w:fill h:hug  text:"07 ago 2026" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
              INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
        FRAME  "Frame"  463x53  col  w:fill h:hug  gap:5  clip
          TEXT  "Tipo de pago"  70x14  w:hug h:hug  text:"Tipo de pago" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
          FRAME  "Frame"  463x34  row  w:fill h:hug  p:9,11  gap:8  items:center  r:8  bg:bg/canvas(#fafaf9)  bd:border/default(#d9d6d1) 1in  clip
            TEXT  "Pago total de la cuota"  419x16  w:fill h:hug  text:"Pago total de la cuota" Plus Jakarta Sans 500 13/16.38 c:text/primary(#24211d)
            INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Terciario"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/chevron-down}
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x61  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x60  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x42  row  w:fill h:hug  p:12,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Guardar gestión"  110x18  w:hug h:hug  text:"Guardar gestión" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntWAPago
```
COMPONENT  "State=EntWAPago"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarPago"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x588  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar pago"  107x19  w:hug h:hug  text:"Registrar pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Registra el pago que realizará el cliente y prepárale la información."  370x15  w:hug h:hug  text:"Registra el pago que realizará el cliente y prepárale la información." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      FRAME  "Workspace/Card/DeudaCuota"  491x39  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "a"  229.5x23  row  w:fill h:hug  gap:6  items:baseline  clip
          TEXT  "Deuda vencida"  86x15  w:hug h:hug  text:"Deuda vencida" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q6,800"  70x23  w:hug h:hug  text:"Q6,800" Plus Jakarta Sans 600 18/22.68 c:status/warning/text(#b37d0f)
        FRAME  "b"  229.5x16  row  w:fill h:hug  gap:6  items:baseline  clip
          TEXT  "Cuota normal"  78x15  w:hug h:hug  text:"Cuota normal" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q3,200"  51x16  w:hug h:hug  text:"Q3,200" Plus Jakarta Sans 600 13/16.38 c:text/tertiary(#8f887f)
      FRAME  "field"  491x62  col  w:fill h:hug  gap:4  clip
        TEXT  "Monto que pagará hoy"  130x15  w:hug h:hug  text:"Monto que pagará hoy" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x43  row  w:fill h:hug  p:12,14  gap:8  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Q 2,000"  62x19  w:hug h:hug  text:"Q 2,000" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "recalc"  491x35  row  w:fill h:hug  p:6,16  gap:10  justify:space_between  items:center  r:12  bg:status/warning/subtle(#fcefc7)  clip
        FRAME  "chip"  107x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/text(#b37d0f)
          TEXT  "Pago parcial"  72x15  w:hug h:hug  text:"Pago parcial" Plus Jakarta Sans 600 12/15.12 c:status/warning/text(#b37d0f)
        FRAME  "rr"  211x23  row  w:hug h:fill  gap:8  items:center  clip
          TEXT  "Deuda vencida restante"  147x16  w:hug h:hug  text:"Deuda vencida restante" Plus Jakarta Sans 400 13/16.38 c:text/secondary(#6b6459)
          TEXT  "Q4,800"  56x19  w:hug h:hug  text:"Q1,400" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      TEXT  "Método de pago"  97x15  w:hug h:hug  text:"Método de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
      FRAME  "mcard"  491x64  row  w:fill h:hug  p:6,16  gap:8  items:center  r:12  bg:brand/primary-subtle(#edfbfa)  bd:brand/primary(#1a8080) 1.5in  clip
        FRAME  "tx"  433x52  col  w:fill h:hug  gap:2  clip
          TEXT  "Link de pago"  86x18  w:hug h:hug  text:"Link de pago" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
          TEXT  "Recargo por pago con tarjeta · 5%"  177x14  w:hug h:hug  text:"Recargo por pago con tarjeta · 5%" Plus Jakarta Sans 400 11/13.86 c:text/secondary(#6b6459)
          TEXT  "desglose"  433x16  w:fill h:hug  text:"Monto Q2,000 · Recargo Q100 · Total Q2,100" Plus Jakarta Sans 600 12.5/15.75 c:text/primary(#24211d)
        ELLIPSE  "Ellipse"  18x18  w:fixed h:fixed  bg:brand/primary(#1fa79b)
      FRAME  "mcard"  491x64  row  w:fill h:hug  p:6,16  gap:8  items:center  r:12  bd:border/default(#d9d6d1) 1in  clip
        FRAME  "tx"  433x52  col  w:fill h:hug  gap:2  clip
          TEXT  "Depósito o transferencia"  167x18  w:hug h:hug  text:"Depósito o transferencia" Plus Jakarta Sans 600 14/17.64 c:text/primary(#24211d)
          TEXT  "Se enviarán los datos de la cuenta."  178x14  w:hug h:hug  text:"Se enviarán los datos de la cuenta." Plus Jakarta Sans 400 11/13.86 c:text/secondary(#6b6459)
          TEXT  "sinrecargo"  433x16  w:fill h:hug  text:"Sin recargo · Total Q2,000" Plus Jakarta Sans 500 12.5/15.75 c:text/tertiary(#8f887f)
        ELLIPSE  "Ellipse"  18x18  w:fixed h:fixed  bd:border/default(#d9d6d1) 1.5in
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x55  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x54  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x36  row  w:fill h:hug  p:9,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Continuar a WhatsApp"  152x18  w:hug h:hug  text:"Continuar a WhatsApp" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntWACompVacio
```
COMPONENT  "State=EntWACompVacio"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Sube el comprobante que envió el cliente para detectar y validar la información."  491x15  w:fill h:hug  text:"Sube el comprobante que envió el cliente para detectar y validar la información." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x56  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x102  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x84  col  w:fill h:fixed  p:20,14  gap:4  justify:center  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Arrastra o sube la imagen del comprobante"  264x16  w:hug h:hug  text:"Arrastra o sube la imagen del comprobante" Plus Jakarta Sans 400 13/16.38 align-center c:text/secondary(#6b6459)
          TEXT  "JPG · PNG o PDF · máx. 10 MB"  149x14  w:hug h:hug  text:"JPG · PNG o PDF · máx. 10 MB" Plus Jakarta Sans 400 11/13.86 align-center c:text/secondary(#6b6459)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:#eceae7  clip
          TEXT  "Enviar a validación"  123x18  w:hug h:hug  text:"Enviar a validación" Plus Jakarta Sans 600 14/17.64 c:text/tertiary(#8f887f)
```
#### State=EntWACompCargado
```
COMPONENT  "State=EntWACompCargado"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Revisa la información detectada y envíala a Contabilidad para validación."  491x15  w:fill h:hug  text:"Revisa la información detectada y envíala a Contabilidad para validación." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x56  row  w:fill h:hug  p:8,16  gap:12  justify:space_between  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x41  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "chip"  268x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/text(#b37d0f)
          TEXT  "comprobante-mariajose.jpg · 240 KB"  233x15  w:hug h:hug  text:"comprobante-luisfernando.jpg · 240 KB" Plus Jakarta Sans 600 12/15.12 c:status/warning/text(#b37d0f)
      FRAME  "datosDetectados"  491x127  col  w:fill h:hug  p:7,16  gap:4[space/4]  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
        TEXT  "Datos detectados del comprobante"  459x14  w:fill h:hug  text:"Datos detectados del comprobante" Plus Jakarta Sans 600 11/13.86 c:text/secondary(#6b6459)
        FRAME  "montoRow"  459x19  row  w:fill h:hug  justify:space_between  items:center  clip
          TEXT  "Monto pagado"  85x15  w:hug h:hug  text:"Monto pagado" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q2,000"  60x19  w:hug h:hug  text:"Q2,000" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
        FRAME  "parcialChip"  285x15  row  w:hug h:hug  gap:4  items:center  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/warning/solid(#e8a927)
          TEXT  "Pago parcial · quedan Q4,800 de deuda vencida"  274x15  w:hug h:hug  text:"Pago parcial · quedan Q1,400 de deuda vencida" Plus Jakarta Sans 500 12/15.12 c:status/warning/text(#b37d0f)
        FRAME  "div"  459x1  w:fill h:fixed  bg:border/default(#d9d6d1)  clip
        FRAME  "detail"  459x30  row  w:fill h:hug  gap:8  clip
          FRAME  "Frame"  225.5x30  col  w:fill h:hug  gap:2  clip
            TEXT  "Fecha de pago"  79x14  w:hug h:hug  text:"Fecha de pago" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "19 ago 2026"  64x14  w:hug h:hug  text:"19 ago 2026" Plus Jakarta Sans 600 11/13.86 c:text/primary(#24211d)
          FRAME  "Frame"  225.5x30  col  w:fill h:hug  gap:2  clip
            TEXT  "Referencia"  57x14  w:hug h:hug  text:"Referencia" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "0098-77451"  66x14  w:hug h:hug  text:"0098-77451" Plus Jakarta Sans 600 11/13.86 c:text/primary(#24211d)
        TEXT  "¿Algún dato incorrecto? Volver a subir"  200x14  w:hug h:hug  text:"¿Algún dato incorrecto? Volver a subir" Plus Jakarta Sans 600 11/13.86 c:text/tertiary(#8f887f)
      FRAME  "notaValidacion"  491x46  row  w:fill h:hug  p:6,12  gap:2  r:8  bg:status/info/subtle(#dce9ff)  clip
        TEXT  "El comprobante se enviará a Contabilidad para su validación. El pago quedará como Pendiente de validación."  467x34  w:fill h:hug  text:"El comprobante se enviará a Contabilidad para su validación. El pago quedará …" Plus Jakarta Sans 500 11/17 c:status/info/text(#2857a8)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Enviar a validación"  123x18  w:hug h:hug  text:"Enviar a validación" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=EntWACompNoLegible
```
COMPONENT  "State=EntWACompNoLegible"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarComprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x584  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CanalStatusBar"  → "Workspace/CanalStatusBar"  491x31  row  w:fill h:hug  p:8,12  gap:8  items:center  r:10  bg:brand/primary-subtle(#edfbfa)
        · textos: "WhatsApp · atendiendo al cliente"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      INSTANCE  "Workspace/SelectorResultado·Entrante"  → "Workspace/SelectorResultado·Entrante / Sel=Acuerdo"  491x41  row  w:fill h:hug  p:4  gap:4  items:center  r:12  bg:#f3f4f6
        · textos: "Se llegó a un acuerdo" | "No hubo acuerdo"
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Registrar comprobante de pago"  232x19  w:hug h:hug  text:"Registrar comprobante de pago" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x32  col  w:fill h:hug  gap:4  clip
        TEXT  "El cliente envió su comprobante, pero no pudimos leer la imagen. Sube una versión más clara para poder enviarla a validación."  491x32  w:fill h:hug  text:"El cliente envió su comprobante, pero no pudimos leer la imagen. Sube una ver…" Plus Jakarta Sans 400 13/16.38 c:text/secondary(#6b6459)
      INSTANCE  "Workspace/Card/DeudaCuota"  → "Workspace/Card/DeudaCuota"  491x68  row  w:fill h:hug  p:14,16  gap:12  justify:space_between  r:12  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in
        · textos: "Deuda vencida" | "Q6,800" | "Cuota normal" | "Q3,200"
      FRAME  "comprobante"  491x128  col  w:fill h:hug  gap:3  r:12  clip
        TEXT  "Comprobante de pago"  133x15  w:hug h:hug  text:"Comprobante de pago" Plus Jakarta Sans 600 12/15.12 c:text/secondary(#6b6459)
        FRAME  "box"  491x84  col  w:fill h:fixed  p:20,14  gap:4  justify:center  items:center  r:10  bg:bg/surface(#ffffff)  bd:border/default(#d9d6d1) 1in  clip
          TEXT  "Arrastra o sube la imagen del comprobante"  264x16  w:hug h:hug  text:"Arrastra o sube la imagen del comprobante" Plus Jakarta Sans 400 13/16.38 align-center c:text/secondary(#6b6459)
          TEXT  "JPG · PNG o PDF · máx. 10 MB"  149x14  w:hug h:hug  text:"JPG · PNG o PDF · máx. 10 MB" Plus Jakarta Sans 400 11/13.86 align-center c:text/secondary(#6b6459)
        FRAME  "chip"  257x23  row  w:hug h:hug  p:4,12,4,10  gap:6  items:center  r:100  bg:bg/surface(#ffffff)  clip
          ELLIPSE  "Ellipse"  7x7  w:fixed h:fixed  bg:status/danger/solid(#e5493a)
          TEXT  "comprobante-borroso.jpg · no legible"  222x15  w:hug h:hug  text:"comprobante-borroso.jpg · no legible" Plus Jakarta Sans 600 12/15.12 c:status/danger/text(#b32e22)
      FRAME  "errorBlock"  491x68  col  w:fill h:hug  p:8,14  gap:4  r:8  bg:status/danger/subtle(#fbdfdb)
        TEXT  "No pudimos leer el comprobante"  463x18  w:fill h:hug  text:"No pudimos leer el comprobante" Plus Jakarta Sans 600 14/17.64 c:status/danger/text(#b32e22)
        TEXT  "La imagen no permite identificar la información necesaria. Sube una imagen más clara del comprobante."  463x30  w:fill h:hug  text:"La imagen no permite identificar la información necesaria. Sube una imagen má…" Plus Jakarta Sans 400 12/15.12 c:status/danger/text(#b32e22)
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x59  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x58  col  w:fill h:hug  p:8,16,10,16  clip
        FRAME  "Frame"  499x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
          TEXT  "Cambiar comprobante"  155x18  w:hug h:hug  text:"Cambiar comprobante" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=GuardandoNA
```
COMPONENT  "State=GuardandoNA"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion / Estado=Guardando"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Guardando gestión…" | "Estamos registrando el resultado en el historial d"
```
#### State=GuardandoNC
```
COMPONENT  "State=GuardandoNC"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion / Estado=Guardando"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Guardando gestión…" | "Estamos registrando el resultado en el historial d"
```
#### State=GuardandoPromesa
```
COMPONENT  "State=GuardandoPromesa"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion / Estado=Guardando"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Guardando gestión…" | "Estamos registrando el resultado en el historial d"
```
#### State=RegistradaNA
```
COMPONENT  "State=RegistradaNA"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion·Resultado/SinAcuerdo"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Gestión registrada" | "El resultado de la llamada quedó guardado en el hi" | "Guardado en el historial · hoy" | "RESUMEN DE LA GESTIÓN" | "Resultado"
```
#### State=RegistradaNC
```
COMPONENT  "State=RegistradaNC"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion·Resultado/SinContacto"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Gestión registrada" | "El resultado de la llamada quedó guardado en el hi" | "Guardado en el historial · hoy" | "RESUMEN DE LA GESTIÓN" | "Resultado"
```
#### State=RegistradaPromesa
```
COMPONENT  "State=RegistradaPromesa"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion·Resultado/Promesa"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Gestión registrada" | "El resultado de la llamada quedó guardado en el hi" | "Guardado en el historial · hoy" | "RESUMEN DE LA GESTIÓN" | "Resultado"
```
#### State=CallConQuien
```
COMPONENT  "State=CallConQuien"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion / Estado=ConQuien"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "‹  Atrás" | "¿Con quién estás hablando?" | "Selecciona el participante con quien vas a registr" | "LF" | "María José Contreras" | "Titular"
```
#### State=RegistradaPagoWA
```
COMPONENT  "State=RegistradaPagoWA"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "ContenidoGestión"  → "Workspace/Gestion·Form/WhatsApp"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Enviar información de pago" | "¿A quién quieres contactar?" | "Titular · María José Contreras" | "+502 5555-1234" | "Codeudor 1 · Roberto Contreras"
```
#### State=RegistradaComprobante
```
COMPONENT  "State=RegistradaComprobante"  531x643  col  w:fixed h:fixed  clip
  INSTANCE  "Workspace/Gestion·Resultado/Comprobante"  → "Workspace/Gestion·Resultado/Comprobante"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)
    · textos: "Gestión" | "Gestión registrada" | "El comprobante quedó guardado en el historial del " | "Pendiente de validación por Contabilidad." | "RESUMEN DE LA GESTIÓN" | "Resultado"
```
#### State=RebajaMora
```
COMPONENT  "State=RebajaMora"  531x643  col  w:fixed h:fixed  clip
  FRAME  "Workspace/Gestion·Form/RegistrarPago"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x582  col  w:fill h:fill  p:16[space/16],20  gap:12[space/12]  clip
      INSTANCE  "Workspace/CallStatusBar"  → "Workspace/CallStatusBar"  491x42  row  w:fill h:hug  p:7,10,7,12  justify:space_between  items:center  r:10  bg:status/success/alt-bg(#dff5e6)
        · textos: "En llamada · 01:24" | "Finalizar llamada"
      FRAME  "sepLlamada"  491x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "stateHeader"  491x20  row  w:fill h:hug  gap:8  items:center  bg:#ffffff  clip
        INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
          · textos: "‹  Atrás"
        TEXT  "Solicitar rebaja de mora"  171x19  w:hug h:hug  text:"Solicitar rebaja de mora" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
      FRAME  "t"  491x15  col  w:fill h:hug  gap:4  clip
        TEXT  "Registra la solicitud de rebaja de mora. Un supervisor la revisará y aprobará."  421x15  w:hug h:hug  text:"Registra la solicitud de rebaja de mora. Un supervisor la revisará y aprobará." Plus Jakarta Sans 400 12/15.12 c:text/tertiary(#8f887f)
      FRAME  "moraCard"  491x43  row  w:fill h:hug  p:12,14  justify:space_between  items:center  r:10  bg:#f7f5f2  bd:#e5e3de 1in  clip
        TEXT  "Mora acumulada"  103x16  w:hug h:hug  text:"Mora acumulada" Plus Jakarta Sans 500 13/16.38 c:#6b6359
        TEXT  "Q1,240"  54x19  w:hug h:hug  text:"Q1,240" Plus Jakarta Sans 600 15/18.9 c:#24211c
      INSTANCE  "Workspace/NotasGestion"  → "Workspace/NotasGestion / Estado=Colapsado"  491x56  row  w:fill h:hug  p:12,14  gap:12  items:center  r:10  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in
        · textos: "✎" | "Notas de la gestión" | "Una sola nota · disponible en los 3 resultados" | "Abrir ▾"
    FRAME  "gestionFooter"  531x61  col  w:fill h:hug  clip
      FRAME  "sepGuardar"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
      FRAME  "pad"  531x60  col  w:fill h:hug  p:8,16,10,16  clip
        INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  499x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar solicitud}
          · textos: "Enviar solicitud"
```
#### State=RegistradaRebaja
```
COMPONENT  "State=RegistradaRebaja"  531x643  col  w:fixed h:fixed  clip
  FRAME  "ContenidoGestión"  531x643  col  w:fill h:fill  bg:bg/surface(#ffffff)  clip
    FRAME  "workArea"  531x574  col  w:fill h:fill  p:16,20  gap:14  justify:center  clip
      TEXT  "colHeader"  491x14  w:fill h:hug  text:"Gestión" Plus Jakarta Sans 500 11/13.86 ls0.3 c:text/tertiary(#8f887f)
      FRAME  "exito"  491x222  col  w:fill h:hug  p:28,0,8,0  gap:10  justify:center  items:center  clip
        FRAME  "halo"  92x92  row  w:fixed h:fixed  justify:center  items:center  r:46  bg:status/success/alt-bg(#dff5e6)  clip
          FRAME  "Frame"  64x64  row  w:fixed h:fixed  justify:center  items:center  r:32  bg:status/success/solid(#22b267)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=XL, Color=Inverso"  32x32  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check-big}
        TEXT  "Solicitud de rebaja enviada"  491x25  w:fill h:hug  text:"Solicitud de rebaja enviada" Plus Jakarta Sans 700 20/25.2 align-center c:text/primary(#24211d)
        TEXT  "La solicitud de rebaja de mora quedó registrada. Un supervisor la revisará y aprobará."  491x15  w:fill h:hug  text:"La solicitud de rebaja de mora quedó registrada. Un supervisor la revisará y …" Plus Jakarta Sans 400 12/15.12 align-center c:text/secondary(#6b6459)
        FRAME  "okChip"  175x24  row  w:hug h:hug  p:5,10  gap:6  items:center  r:12  bg:status/success/alt-bg(#dff5e6)  clip
          INSTANCE  "Icon"  → "Icon / Tamaño=XS, Color=Éxito"  14x14  row  w:fixed h:fixed  justify:center  items:center  props{Icono=lucide/circle-check}
          TEXT  "Pendiente de aprobación"  135x14  w:hug h:hug  text:"Pendiente de aprobación" Plus Jakarta Sans 600 11/13.86 c:status/success/alt-fg(#0f7a3d)
      FRAME  "resumen"  491x129  col  w:fill h:hug  p:12,14  gap:8  r:10  bg:bg/canvas(#fafaf9)  bd:border/subtle(#ebe9e6) 1in  clip
        TEXT  "sectionLabel"  137x13  w:hug h:hug  text:"RESUMEN DE LA GESTIÓN" Plus Jakarta Sans 600 10/12.6 ls0.6 c:text/tertiary(#8f887f)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Tipo de gestión"  88x15  w:hug h:hug  text:"Tipo de gestión" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Solicitud de rebaja de mora"  158x15  w:hug h:hug  text:"Solicitud de rebaja de mora" Plus Jakarta Sans 600 12/15.12 c:status/success/alt-fg(#0f7a3d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Estado"  41x15  w:hug h:hug  text:"Estado" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Pendiente de aprobación del supervisor"  230x15  w:hug h:hug  text:"Pendiente de aprobación del supervisor" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Mora acumulada"  95x15  w:hug h:hug  text:"Mora acumulada" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q1,240"  43x15  w:hug h:hug  text:"Q1,240" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
        FRAME  "Frame"  463x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  clip
          TEXT  "Registrado por"  85x15  w:hug h:hug  text:"Registrado por" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Ana G. (asesor)"  88x15  w:hug h:hug  text:"Ana G. (asesor)" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
      FRAME  "spacer"  491x135  w:fill h:fill  clip
    FRAME  "divider"  531x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
    FRAME  "actionFoot (acciones = trabajo)"  531x68  row  w:fill h:hug  p:14,20  gap:10  clip
      FRAME  "Frame"  491x40  row  w:fill h:hug  p:11,16  gap:8  justify:center  items:center  r:8  bg:brand/primary(#1fa79b)  clip
        TEXT  "Siguiente caso →"  113x18  w:hug h:hug  text:"Siguiente caso →" Plus Jakarta Sans 600 14/17.64 c:brand/on-primary(#ffffff)
```
#### State=CallRescate
```
COMPONENT  "State=CallRescate"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:14,18  gap:8
    FRAME  "banner"  495x71  row  w:fill h:hug  p:12,14  gap:10  items:center  r:12  bg:status/success/subtle(#d9f5e3)  clip
      ELLIPSE  "Ellipse"  10x10  w:fixed h:fixed  bg:status/success/solid(#22b267)
      FRAME  "Frame"  447x47  col  w:fill h:hug  gap:1  clip
        TEXT  "Gestión registrada · Sin acuerdo de pago"  447x16  w:fill h:hug  text:"Gestión registrada · Sin acuerdo de pago" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
        TEXT  "El contacto inicial terminó sin recuperación. Elige la siguiente acción de rescate."  447x30  w:fill h:hug  text:"El contacto inicial terminó sin recuperación. Elige la siguiente acción de re…" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
    TEXT  "ACCIONES DE RESCATE · ELIGE SEGÚN EL CASO"  495x14  w:fill h:hug  text:"ACCIONES DE RESCATE · ELIGE SEGÚN EL CASO" Plus Jakarta Sans 600 11/13.86 ls0.55 c:text/tertiary(#8f887f)
    INSTANCE  "Workspace/AccionRescate"  → "Workspace/AccionRescate / Estado=Disponible"  495x63  row  w:fill h:hug  p:14,16  gap:12  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in
      · textos: "Contactar referencias" | "Llamar y registrar gestión" | "›"
    INSTANCE  "Workspace/AccionRescate"  → "Workspace/AccionRescate / Estado=Disponible"  495x63  row  w:fill h:hug  p:14,16  gap:12  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in
      · textos: "Programar visita" | "Domiciliaria / laboral · tarea futura" | "›"
    INSTANCE  "Workspace/AccionRescate"  → "Workspace/AccionRescate / Estado=Disponible"  495x63  row  w:fill h:hug  p:14,16  gap:12  items:center  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in
      · textos: "Investigación en redes" | "Registrar hallazgos" | "›"
    INSTANCE  "Workspace/AccionRescate"  → "Workspace/AccionRescate / Estado=Crítica"  495x63  row  w:fill h:hug  p:14,16  gap:12  items:center  r:12  bg:bg/surface(#ffffff)  bd:status/danger/solid(#e5493a) 1.5in
      · textos: "Apagado del vehículo" | "Incluye ubicación/monitoreo · confirmación reforza" | "Crítica" | "›"
```
#### State=RescateReferencias
```
COMPONENT  "State=RescateReferencias"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:18  gap:14
    FRAME  "Frame"  495x20  row  w:fill h:hug  gap:8  items:center  clip
      INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
        · textos: "‹  Atrás"
      TEXT  "Contactar referencias"  159x19  w:fixed h:hug  text:"Contactar referencias" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
    INSTANCE  "Workspace/Rescate·Referencias"  → "Workspace/Rescate·Referencias"  495x573  col  w:fill h:fixed  gap:12
      · textos: "María Elena Morales · Madre" | "5541-2233 · Sin intento" | "Llamar" | "Jorge Ríos · Ref. laboral" | "4478-9910 · No contestó 10 ago" | "Llamar"
```
#### State=RescateVisita
```
COMPONENT  "State=RescateVisita"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:18  gap:14
    FRAME  "Frame"  495x20  row  w:fill h:hug  gap:8  items:center  clip
      INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
        · textos: "‹  Atrás"
      TEXT  "Programar visita"  118x19  w:fixed h:hug  text:"Programar visita" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
    INSTANCE  "Workspace/Rescate·Visita"  → "Workspace/Rescate·Visita"  495x573  col  w:fill h:fixed  gap:12
      · textos: "Una visita programada genera una tarea futura para" | "Tipo" | "Domiciliaria" | "Laboral" | "Fecha" | "— seleccionar"
```
#### State=RescateRedes
```
COMPONENT  "State=RescateRedes"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:18  gap:14
    FRAME  "Frame"  495x20  row  w:fill h:hug  gap:8  items:center  clip
      INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
        · textos: "‹  Atrás"
      TEXT  "Investigación en redes"  163x19  w:fixed h:hug  text:"Investigación en redes" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
    INSTANCE  "Workspace/Rescate·Redes"  → "Workspace/Rescate·Redes"  495x573  col  w:fill h:fixed  gap:12
      · textos: "Registra los hallazgos. Quedan en el historial del" | "Red / fuente" | "Facebook · Instagram · LinkedIn" | "Hallazgos (nuevo teléfono, dirección, empleo…)" | "Guardar hallazgos"
```
#### State=RescateApagado
```
COMPONENT  "State=RescateApagado"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:18  gap:14
    FRAME  "Frame"  495x20  row  w:fill h:hug  gap:8  items:center  clip
      INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
        · textos: "‹  Atrás"
      TEXT  "Apagado del vehículo"  157x19  w:fixed h:hug  text:"Apagado del vehículo" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
    INSTANCE  "Workspace/Rescate·Apagado"  → "Workspace/Rescate·Apagado"  495x573  col  w:fill h:fixed  gap:12
      · textos: "⚠ No apagar mientras el vehículo esté en movimient" | "Estado del vehículo (monitoreo)" | "● DETENIDO" | "Ubicación" | "4a calle 5-23, zona 7" | "Velocidad"
```
#### State=RescateApagadoConfirmar
```
COMPONENT  "State=RescateApagadoConfirmar"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:18  gap:14
    FRAME  "Frame"  495x20  row  w:fill h:hug  gap:8  items:center  clip
      INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
        · textos: "‹  Atrás"
      TEXT  "Confirmar apagado"  141x19  w:fixed h:hug  text:"Confirmar apagado" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
    INSTANCE  "Workspace/Rescate·ApagadoConfirmar"  → "Workspace/Rescate·ApagadoConfirmar"  495x573  col  w:fill h:fixed  gap:12
      · textos: "Vehículo DETENIDO · zona 7. Vas a ejecutar el apag" | "Confirmación crítica: el apagado es irreversible d" | "Sí, ejecutar apagado"
```
#### State=RescateApagadoEjecutado
```
COMPONENT  "State=RescateApagadoEjecutado"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:18  gap:14
    FRAME  "Frame"  495x20  row  w:fill h:hug  gap:8  items:center  clip
      INSTANCE  "Workspace"  → "Workspace / Propiedad 1=BackNav"  48x20  row  w:hug h:hug  p:2,6,2,0  items:center  bg:#ffffff
        · textos: "‹  Atrás"
      TEXT  "Apagado ejecutado"  145x19  w:fixed h:hug  text:"Apagado ejecutado" Plus Jakarta Sans 600 15/18.9 c:text/primary(#24211d)
    INSTANCE  "Workspace/Rescate·ApagadoEjecutado"  → "Workspace/Rescate·ApagadoEjecutado"  495x573  col  w:fill h:fixed  gap:12
      · textos: "Gestión registrada · Apagado ejecutado" | "El apagado quedó registrado a tu nombre." | "EFECTO DE NEGOCIO" | "Vehículo → Unidad apagada" | "Siguiente gestión disponible: contactar al cliente" | "Llamar al cliente (post-apagado)"
```
#### State=RegistradaRescate
```
COMPONENT  "State=RegistradaRescate"  531x643
  FRAME  "ContenidoGestión"  531x643  col  w:fixed h:fixed  p:18,20  gap:12
    INSTANCE  "Workspace/SuccessState"  → "Workspace/SuccessState"  491x240  col  w:fill h:fixed  p:28,0,20,0  gap:10  justify:center  items:center  props{Subtítulo=La intervención de rescate quedó registrada en el historial del crédito.; Título=Gestión registrada}
      · textos: "Gestión registrada" | "La intervención de rescate quedó registrada en el " | "Guardado en el historial · hoy"
    FRAME  "spacer"  491x247  w:fill h:fill  clip
    INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Volver a acciones de rescate}
      · textos: "Volver a acciones de rescate"
    INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  491x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Siguiente caso}
      · textos: "Siguiente caso"
```

## 🟢 03 · Workspace v3 · Asesor Senior › Workspace/ContextoCaso · Senior

### Workspace/ContextoCaso · Senior  `3126:1190` — component_set, 14 variante(s)

- **Tab** (variante): Resumen · Historial · EstadoCuenta · Documentos · Referencias · Historico · AsistenteIA — default `Resumen`
- **Menu** (variante): Cerrado · Abierto — default `Cerrado`

#### Tab=Resumen, Menu=Cerrado
```
COMPONENT  "Tab=Resumen, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "Workspace/Consulta"  → "Workspace/Consulta / Vista=Resumen"  428x642  col  w:fill h:hug  p:4,12,0,0  gap:8
      · textos: "Estado del cobro" | "En mora" | "44" | "días en mora" | "bucket B2" | "Cuotas pagadas"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historial, Menu=Cerrado
```
COMPONENT  "Tab=Historial, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x835  col  w:fill h:hug  p:4,12,0,0  clip
      INSTANCE  "histSegmented"  → "SegmentedNav"  239x42  row  w:hug h:hug  p:4  gap:4  r:10  bg:#f1f2f4
        · textos: "Historial actual" | "Histórico"
      FRAME  "tlHeader"  416x39  col  w:fill h:hug  p:16,0,10,0  clip
        TEXT  "HISTORIAL DEL CRÉDITO · 8 GESTIONES"  416x13  w:fill h:hug  text:"HISTORIAL DEL CRÉDITO · 8 GESTIONES" Plus Jakarta Sans 600 10/12.6 ls0.6 c:text/tertiary(#8f887f)
      FRAME  "Workspace/TimelineItem"  416x81  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x81  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:status/success/solid(#22b267)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x61  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x81  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  66x14  w:hug h:hug  text:"20 jul · 10:30" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Info, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/info/subtle(#dce9ff)  props{Etiqueta=Documento enviado}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Se envió tarjeta de circulación" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Enviado por WhatsApp · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
      FRAME  "Workspace/TimelineItem"  416x81  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x81  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:status/success/solid(#22b267)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x61  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x81  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  60x14  w:hug h:hug  text:"18 jul · 16:45" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Solicitud}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Se solicitó cambio de placas al supervisor" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Solicitud al supervisor · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
      FRAME  "Workspace/TimelineItem"  416x115  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x115  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:status/success/solid(#22b267)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x95  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x115  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  61x14  w:hug h:hug  text:"15 jul · 09:12" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Cliente VIP}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Promesa de pago registrada · Q2,500" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Titular · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "notaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  374x10  col  w:fixed h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Escribe la nota del asesor…}  (oculto)
          INSTANCE  "Workspace/NotaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  390x29  col  w:fill h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Promesa de pago registrada automáticamente desde la gestión de llamada.}
            · textos: "Promesa de pago registrada automáticamente desde l" | "▼"
      FRAME  "Workspace/TimelineItem"  416x115  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x115  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:neutral/400(#b8b3ac)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x95  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x115  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  63x14  w:hug h:hug  text:"10 jul · 16:40" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Cliente VIP}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Contactado — sin acuerdo, solicita más plazo" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Titular · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Workspace/NotaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  390x29  col  w:fill h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Cliente perdió el empleo temporalmente; retomará pagos en agosto tras nuevo ingreso. Priorizar seguimiento y evitar escalamiento.}
            · textos: "Cliente perdió el empleo temporalmente; retomará p" | "▼"
      INSTANCE  "Workspace/TimelineItem"  → "Workspace/TimelineItem / Tono=Alerta"  416x81  row  w:fill h:hug  gap:12  props{MostrarBadge=False; MostrarMeta=True; MostrarConector=True; Meta=Codeudor 1 · Ana G. (asesor); Título=Llamada sin respuesta; Fecha=08 jul · 11:05}
        · textos: "08 jul · 11:05" | "Llamada sin respuesta" | "Codeudor 1 · Ana G. (asesor)"
      INSTANCE  "Workspace/TimelineItem"  → "Workspace/TimelineItem / Tono=Default"  416x81  row  w:fill h:hug  gap:12  props{MostrarMeta=True; MostrarConector=True; Meta=Titular · Sistema; Título=Recordatorio de pago enviado; MostrarBadge=False; Fecha=02 jul · 10:20}
        · textos: "02 jul · 10:20" | "Recordatorio de pago enviado" | "Titular · Sistema"
      INSTANCE  "Workspace/TimelineItem"  → "Workspace/TimelineItem / Tono=Peligro"  416x81  row  w:fill h:hug  gap:12  props{MostrarBadge=False; Meta=Titular; MostrarConector=True; MostrarMeta=True; Título=Promesa de pago incumplida; Fecha=28 jun · 09:00}
        · textos: "28 jun · 09:00" | "Promesa de pago incumplida" | "Titular"
      FRAME  "Workspace/TimelineItem"  416x115  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x115  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:neutral/400(#b8b3ac)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x95  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x115  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  69x14  w:hug h:hug  text:"20 jun · 15:30" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Cliente VIP}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Gestión inicial de cobro" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Titular · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Workspace/NotaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  390x29  col  w:fill h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Prefiere ser contactado después de las 6:00 pm. No responde en horario laboral.}
            · textos: "Prefiere ser contactado después de las 6:00 pm. No" | "▼"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=EstadoCuenta, Menu=Cerrado
```
COMPONENT  "Tab=EstadoCuenta, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=EstadoCuenta"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x513  col  w:fill h:hug  p:4,12,0,0  gap:14  clip
      INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  416x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar por WhatsApp}
        · textos: "Enviar por WhatsApp"
      FRAME  "resumenCuenta"  416x184  col  w:fill h:hug  p:13,14  gap:10  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,4 14 0 #0f0d081a]  clip
        INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  388x13  row  w:fill h:hug  props{Texto=RESUMEN DE CUENTA}
          · textos: "RESUMEN DE CUENTA"
        FRAME  "balance"  388x49  col  w:fill h:hug  gap:1  clip
          TEXT  "Saldo total del crédito"  127x15  w:hug h:hug  text:"Saldo total del crédito" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q42,000"  113x33  w:hug h:hug  text:"Q41,600" Plus Jakarta Sans 700 26/32.76 c:text/primary(#24211d)
        FRAME  "Frame"  388x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        INSTANCE  "Workspace/StatRow"  → "Workspace/StatRow / Tono=Peligro"  388x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  props{Ícono=Icon / Tamaño=XS, Color=Terciario; MostrarÍcono=False; Valor=Q3,200; Etiqueta=Saldo vencido}
          · textos: "Saldo vencido" | "Q3,200"
        INSTANCE  "Workspace/StatRow"  → "Workspace/StatRow / Tono=Default"  388x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  props{Ícono=Icon / Tamaño=XS, Color=Terciario; Valor=36 de 48; MostrarÍcono=False; Etiqueta=Cuotas restantes}
          · textos: "Cuotas restantes" | "36 de 48"
        INSTANCE  "Workspace/StatRow"  → "Workspace/StatRow / Tono=Default"  388x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  props{Ícono=Icon / Tamaño=XS, Color=Terciario; Valor=07 ago 2026; MostrarÍcono=False; Etiqueta=Próximo pago}
          · textos: "Próximo pago" | "07 ago 2026"
      INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  416x13  row  w:fill h:hug  props{Texto=PLAN DE PAGOS}
        · textos: "PLAN DE PAGOS"
      FRAME  "movimientos"  416x228  col  w:fill h:hug  clip
        INSTANCE  "Workspace/MovementRow"  → "Workspace/MovementRow / Estado=Vencida"  416x52  row  w:fill h:fixed  p:9,0  gap:10  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in  props{Fecha=Venció 07 jul 2026; Monto=Q3,200; Concepto=Cuota 13 de 48}
          · textos: "Cuota 13 de 48" | "Venció 07 jul 2026" | "Q3,200" | "Vencida"
        FRAME  "Workspace/MovementRow"  416x88  row  w:fill h:hug  p:9,0  gap:10  bd:border/subtle(#ebe9e6) 0,0,1,0in
          INSTANCE  "icono"  → "Icon / Tamaño=S, Color=Éxito"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "left"  300x70  col  w:fill h:hug  gap:3  clip
            TEXT  "concepto"  300x16  w:fill h:hug  text:"Cuota 12 de 48" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            FRAME  "metodo"  48x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip
              TEXT  "Boleta"  34x13  w:hug h:hug  text:"Boleta" Plus Jakarta Sans 500 10.5/13.23 c:brand/primary(#1fa79b)
            FRAME  "metodo"  82x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip  (oculto)
            TEXT  "fecha"  300x14  w:fill h:hug  text:"Pagó 03 jul 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "gestion"  312x14  w:fixed h:fixed  text:"Registrado —" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)  (oculto)
            TEXT  "gestion"  300x14  w:fill h:hug  text:"Registrado 05 jul 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          FRAME  "right"  80x42  col  w:hug h:hug  gap:3  items:max  clip
            TEXT  "monto"  51x16  w:hug h:hug  text:"Q3,200" Plus Jakarta Sans 600 13/16.38 c:text/secondary(#6b6459)
            INSTANCE  "estado"  → "Chip / Tipo=Éxito, Removible=No"  80x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/success/subtle(#d9f5e3)  props{Etiqueta=Pagada}
              · textos: "Pagada"
        FRAME  "Workspace/MovementRow"  416x88  row  w:fill h:hug  p:9,0  gap:10  bd:border/subtle(#ebe9e6) 0,0,1,0in
          INSTANCE  "icono"  → "Icon / Tamaño=S, Color=Éxito"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "left"  300x70  col  w:fill h:hug  gap:3  clip
            TEXT  "concepto"  300x16  w:fill h:hug  text:"Cuota 11 de 48" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            FRAME  "metodo"  82x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip
              TEXT  "Transferencia"  68x13  w:hug h:hug  text:"Transferencia" Plus Jakarta Sans 500 10.5/13.23 c:brand/primary(#1fa79b)
            FRAME  "metodo"  82x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip  (oculto)
            TEXT  "fecha"  300x14  w:fill h:hug  text:"Pagó 05 jun 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "gestion"  312x14  w:fixed h:fixed  text:"Registrado —" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)  (oculto)
            TEXT  "gestion"  300x14  w:fill h:hug  text:"Registrado 05 jun 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          FRAME  "right"  80x42  col  w:hug h:hug  gap:3  items:max  clip
            TEXT  "monto"  51x16  w:hug h:hug  text:"Q3,200" Plus Jakarta Sans 600 13/16.38 c:text/secondary(#6b6459)
            INSTANCE  "estado"  → "Chip / Tipo=Éxito, Removible=No"  80x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/success/subtle(#d9f5e3)  props{Etiqueta=Pagada}
              · textos: "Pagada"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Documentos, Menu=Cerrado
```
COMPONENT  "Tab=Documentos, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x457  col  w:fill h:hug  p:4,12,0,0  gap:14  clip
      INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  416x13  row  w:fill h:hug  props{Texto=ENVIAR AL CLIENTE}
        · textos: "ENVIAR AL CLIENTE"
      FRAME  "grupo/ENVIAR"  416x166  col  w:fill h:hug  p:4,12  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  268x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  268x16  w:fill h:hug  text:"Tarjeta de circulación" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  268x14  w:fill h:hug  text:"Documento vehicular" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Small, Estado=Default"  70x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar}
            · textos: "Enviar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  268x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  268x16  w:fill h:hug  text:"Información de seguro" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  268x14  w:fill h:hug  text:"Póliza vigente" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Small, Estado=Default"  70x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar}
            · textos: "Enviar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  268x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  268x16  w:fill h:hug  text:"Estado de cuenta" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  268x14  w:fill h:hug  text:"Resumen del crédito" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Small, Estado=Default"  70x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar}
            · textos: "Enviar"
      INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  416x13  row  w:fill h:hug  props{Texto=SOLICITAR AL SUPERVISOR}
        · textos: "SOLICITAR AL SUPERVISOR"
      FRAME  "grupo/SOLICITAR"  416x219  col  w:fill h:hug  p:4,12  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Contrato de crédito" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"PDF · Documento legal" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Carta poder" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"Requiere firma del titular" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Cambio de placas" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"Trámite vehicular" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Expertaje" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"Avalúo del vehículo" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Referencias, Menu=Cerrado
```
COMPONENT  "Tab=Referencias, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Referencias"  428x297  col  w:fill h:hug  p:4,12,0,0  gap:10
      · textos: "REFERENCIAS DEL CRÉDITO · 4" | "MJ" | "María José Aguilar" | "Hermana · 5555-0001" | "Verificada" | "CA"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historico, Menu=Cerrado
```
COMPONENT  "Tab=Historico, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x361  col  w:fill h:hug  p:4,12,0,0  clip
      INSTANCE  "histSegmented"  → "SegmentedNav"  239x42  row  w:hug h:hug  p:4  gap:4  r:10  bg:#f1f2f4
        · textos: "Historial actual" | "Histórico"
      FRAME  "tlHeader"  416x39  col  w:fill h:hug  p:16,0,10,0  clip
        TEXT  "VIDA COMPLETA DEL CRÉDITO"  416x13  w:fill h:hug  text:"VIDA COMPLETA DEL CRÉDITO" Plus Jakarta Sans 600 10/12.6 ls0.6 c:text/tertiary(#8f887f)
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B1 · Alerta temprana" | "06 ago 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Salió de Bucket B2 → B1" | "18 jul 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Reestructuración de pago aprobada" | "20 may 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Promesa cumplida · Q3,200" | "15 abr 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B2 · Mora 60" | "05 dic 2025"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Convenio de pago firmado" | "10 oct 2025"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Resumen, Menu=Abierto
```
COMPONENT  "Tab=Resumen, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "Workspace/Consulta"  → "Workspace/Consulta / Vista=Resumen"  428x642  col  w:fill h:hug  p:4,12,0,0  gap:8
      · textos: "Estado del cobro" | "En mora" | "44" | "días en mora" | "bucket B2" | "Cuotas pagadas"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historial, Menu=Abierto
```
COMPONENT  "Tab=Historial, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Historial"  428x571  col  w:fill h:hug  p:4,12,0,0
      · textos: "Historial actual" | "Histórico" | "HISTORIAL DEL CRÉDITO · 6 GESTIONES" | "15 jul · 09:12" | "Promesa de pago registrada · Q2,500" | "Titular · Ana G. (asesor)"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=EstadoCuenta, Menu=Abierto
```
COMPONENT  "Tab=EstadoCuenta, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=EstadoCuenta"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=EstadoCuenta"  428x541  col  w:fill h:hug  p:4,12,0,0  gap:14
      · textos: "RESUMEN DE CUENTA" | "Saldo total del crédito" | "Q41,600" | "Saldo vencido" | "Q3,200" | "Cuotas restantes"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Documentos, Menu=Abierto
```
COMPONENT  "Tab=Documentos, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Documentos"  428x505  col  w:fill h:hug  p:4,12,0,0  gap:14
      · textos: "IDENTIFICACIÓN" | "DPI — Titular" | "JPG · 1.2 MB · 12 ene 2026" | "DPI — Codeudor 1" | "JPG · 1.1 MB · 12 ene 2026" | "CONTRATO Y GARANTÍAS"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 600 13.5/17.01 c:brand/primary(#1fa79b)
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Referencias, Menu=Abierto
```
COMPONENT  "Tab=Referencias, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Referencias"  428x297  col  w:fill h:hug  p:4,12,0,0  gap:10
      · textos: "REFERENCIAS DEL CRÉDITO · 4" | "MJ" | "María José Aguilar" | "Hermana · 5555-0001" | "Verificada" | "CA"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 600 13.5/17.01 c:brand/primary(#1fa79b)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historico, Menu=Abierto
```
COMPONENT  "Tab=Historico, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x361  col  w:fill h:hug  p:4,12,0,0  clip
      INSTANCE  "histSegmented"  → "SegmentedNav"  239x42  row  w:hug h:hug  p:4  gap:4  r:10  bg:#f1f2f4
        · textos: "Historial actual" | "Histórico"
      FRAME  "tlHeader"  416x39  col  w:fill h:hug  p:16,0,10,0  clip
        TEXT  "VIDA COMPLETA DEL CRÉDITO"  416x13  w:fill h:hug  text:"VIDA COMPLETA DEL CRÉDITO" Plus Jakarta Sans 600 10/12.6 ls0.6 c:text/tertiary(#8f887f)
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B1 · Alerta temprana" | "06 ago 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Salió de Bucket B2 → B1" | "18 jul 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Reestructuración de pago aprobada" | "20 may 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Promesa cumplida · Q3,200" | "15 abr 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B2 · Mora 60" | "05 dic 2025"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Convenio de pago firmado" | "10 oct 2025"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=AsistenteIA, Menu=Cerrado
```
COMPONENT  "Tab=AsistenteIA, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  INSTANCE  "resumenIA"  → "Workspace/ResumenIA·Card / Estado=Colapsado"  428x40  col  w:fill h:hug  p:12,14  gap:8  r:12  bg:brand/primary-subtle(#edfbfa)  bd:border/subtle(#ebe9e6) 1in
    · textos: "✦" | "Resumen del caso" | "IA" | "▼"
  FRAME  "tabContent"  428x283  col  w:fill h:fill  p:10  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    FRAME  "chat"  408x182  col  w:fill h:hug  gap:10  clip
      FRAME  "Frame"  408x54  row  w:fill h:hug  clip
        FRAME  "Frame"  320x54  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas sobre este crédito."  296x36  w:fill h:hug  text:"Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
      FRAME  "Frame"  408x36  row  w:fill h:hug  justify:max  clip
        FRAME  "Frame"  320x36  col  w:fixed h:hug  p:9,12  r:12  bg:brand/primary(#1fa79b)  clip
          TEXT  "¿Cuál es el mejor canal para contactarlo?"  296x18  w:fill h:hug  text:"¿Cuál es el mejor canal para contactarlo?" Plus Jakarta Sans 400 12.5/18 c:brand/on-primary(#ffffff)
      FRAME  "Frame"  408x72  row  w:fill h:hug  clip
        FRAME  "Frame"  320x72  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La última llamada no tuvo respuesta."  296x54  w:fill h:hug  text:"Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La últi…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  FRAME  "inputIA"  428x50  row  w:fill h:hug  p:8,8,8,14  gap:8  items:center  r:24  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    TEXT  "Pregúntale a la IA…"  344x16  w:fill h:hug  text:"Pregúntale a la IA…" Plus Jakarta Sans 400 12.5/15.75 c:text/tertiary(#8f887f)
    FRAME  "send"  54x34  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:brand/primary(#1fa79b)  clip
      FRAME  "lucide/send-horizontal"  20x20  w:fixed h:fixed  clip
        VECTOR  "Vector"  15.84x15  bd:brand/on-primary(#ffffff) 1.67center
  FRAME  "tab-asistente"  69x21  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  69x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
    FRAME  "underline"  69x2  w:fill h:fixed  r:1  bg:brand/primary(#1fa79b)  clip
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
```
#### Tab=AsistenteIA, Menu=Abierto
```
COMPONENT  "Tab=AsistenteIA, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B2, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:status/warning/subtle(#fcefc7)
      · textos: "B2"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  103x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q600}
      · textos: "Mora Q600"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  INSTANCE  "resumenIA"  → "Workspace/ResumenIA·Card / Estado=Colapsado"  428x40  col  w:fill h:hug  p:12,14  gap:8  r:12  bg:brand/primary-subtle(#edfbfa)  bd:border/subtle(#ebe9e6) 1in
    · textos: "✦" | "Resumen del caso" | "IA" | "▼"
  FRAME  "tabContent"  428x283  col  w:fill h:fill  p:10  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    FRAME  "chat"  408x182  col  w:fill h:hug  gap:10  clip
      FRAME  "Frame"  408x54  row  w:fill h:hug  clip
        FRAME  "Frame"  320x54  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas sobre este crédito."  296x36  w:fill h:hug  text:"Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
      FRAME  "Frame"  408x36  row  w:fill h:hug  justify:max  clip
        FRAME  "Frame"  320x36  col  w:fixed h:hug  p:9,12  r:12  bg:brand/primary(#1fa79b)  clip
          TEXT  "¿Cuál es el mejor canal para contactarlo?"  296x18  w:fill h:hug  text:"¿Cuál es el mejor canal para contactarlo?" Plus Jakarta Sans 400 12.5/18 c:brand/on-primary(#ffffff)
      FRAME  "Frame"  408x72  row  w:fill h:hug  clip
        FRAME  "Frame"  320x72  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La última llamada no tuvo respuesta."  296x54  w:fill h:hug  text:"Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La últi…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  FRAME  "inputIA"  428x50  row  w:fill h:hug  p:8,8,8,14  gap:8  items:center  r:24  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    TEXT  "Pregúntale a la IA…"  344x16  w:fill h:hug  text:"Pregúntale a la IA…" Plus Jakarta Sans 400 12.5/15.75 c:text/tertiary(#8f887f)
    FRAME  "send"  54x34  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:brand/primary(#1fa79b)  clip
      FRAME  "lucide/send-horizontal"  20x20  w:fixed h:fixed  clip
        VECTOR  "Vector"  15.84x15  bd:brand/on-primary(#ffffff) 1.67center
  FRAME  "tab-asistente"  69x21  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  69x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
    FRAME  "underline"  69x2  w:fill h:fixed  r:1  bg:brand/primary(#1fa79b)  clip
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
```

## 🟢 03 · Workspace v3 · Asesor Senior › Workspace/ContextoCaso · Senior B3

### Workspace/ContextoCaso · Senior B3  `3149:12` — component_set, 14 variante(s)

- **Tab** (variante): Resumen · Historial · EstadoCuenta · Documentos · Referencias · Historico · AsistenteIA — default `Resumen`
- **Menu** (variante): Cerrado · Abierto — default `Cerrado`

#### Tab=Resumen, Menu=Cerrado
```
COMPONENT  "Tab=Resumen, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "Workspace/Consulta"  → "Workspace/Consulta / Vista=Resumen"  428x642  col  w:fill h:hug  p:4,12,0,0  gap:8
      · textos: "Estado del cobro" | "En mora" | "68" | "días en mora" | "bucket B3" | "Cuotas pagadas"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historial, Menu=Cerrado
```
COMPONENT  "Tab=Historial, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x835  col  w:fill h:hug  p:4,12,0,0  clip
      INSTANCE  "histSegmented"  → "SegmentedNav"  239x42  row  w:hug h:hug  p:4  gap:4  r:10  bg:#f1f2f4
        · textos: "Historial actual" | "Histórico"
      FRAME  "tlHeader"  416x39  col  w:fill h:hug  p:16,0,10,0  clip
        TEXT  "HISTORIAL DEL CRÉDITO · 8 GESTIONES"  416x13  w:fill h:hug  text:"HISTORIAL DEL CRÉDITO · 8 GESTIONES" Plus Jakarta Sans 600 10/12.6 ls0.6 c:text/tertiary(#8f887f)
      FRAME  "Workspace/TimelineItem"  416x81  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x81  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:status/success/solid(#22b267)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x61  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x81  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  66x14  w:hug h:hug  text:"20 jul · 10:30" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Info, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/info/subtle(#dce9ff)  props{Etiqueta=Documento enviado}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Se envió tarjeta de circulación" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Enviado por WhatsApp · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
      FRAME  "Workspace/TimelineItem"  416x81  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x81  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:status/success/solid(#22b267)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x61  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x81  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  60x14  w:hug h:hug  text:"18 jul · 16:45" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Solicitud}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Se solicitó cambio de placas al supervisor" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Solicitud al supervisor · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
      FRAME  "Workspace/TimelineItem"  416x115  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x115  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:status/success/solid(#22b267)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x95  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x115  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  61x14  w:hug h:hug  text:"15 jul · 09:12" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Cliente VIP}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Promesa de pago registrada · Q2,500" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Titular · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "notaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  374x10  col  w:fixed h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Escribe la nota del asesor…}  (oculto)
          INSTANCE  "Workspace/NotaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  390x29  col  w:fill h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Promesa de pago registrada automáticamente desde la gestión de llamada.}
            · textos: "Promesa de pago registrada automáticamente desde l" | "▼"
      FRAME  "Workspace/TimelineItem"  416x115  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x115  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:neutral/400(#b8b3ac)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x95  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x115  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  63x14  w:hug h:hug  text:"10 jul · 16:40" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Cliente VIP}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Contactado — sin acuerdo, solicita más plazo" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Titular · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Workspace/NotaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  390x29  col  w:fill h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Cliente perdió el empleo temporalmente; retomará pagos en agosto tras nuevo ingreso. Priorizar seguimiento y evitar escalamiento.}
            · textos: "Cliente perdió el empleo temporalmente; retomará p" | "▼"
      INSTANCE  "Workspace/TimelineItem"  → "Workspace/TimelineItem / Tono=Alerta"  416x81  row  w:fill h:hug  gap:12  props{MostrarBadge=False; MostrarMeta=True; MostrarConector=True; Meta=Codeudor 1 · Ana G. (asesor); Título=Llamada sin respuesta; Fecha=08 jul · 11:05}
        · textos: "08 jul · 11:05" | "Llamada sin respuesta" | "Codeudor 1 · Ana G. (asesor)"
      INSTANCE  "Workspace/TimelineItem"  → "Workspace/TimelineItem / Tono=Default"  416x81  row  w:fill h:hug  gap:12  props{MostrarMeta=True; MostrarConector=True; Meta=Titular · Sistema; Título=Recordatorio de pago enviado; MostrarBadge=False; Fecha=02 jul · 10:20}
        · textos: "02 jul · 10:20" | "Recordatorio de pago enviado" | "Titular · Sistema"
      INSTANCE  "Workspace/TimelineItem"  → "Workspace/TimelineItem / Tono=Peligro"  416x81  row  w:fill h:hug  gap:12  props{MostrarBadge=False; Meta=Titular; MostrarConector=True; MostrarMeta=True; Título=Promesa de pago incumplida; Fecha=28 jun · 09:00}
        · textos: "28 jun · 09:00" | "Promesa de pago incumplida" | "Titular"
      FRAME  "Workspace/TimelineItem"  416x115  row  w:fill h:hug  gap:12
        FRAME  "rail"  14x115  col  w:fixed h:fill  p:3,0,0,0  gap:6  items:center  clip
          FRAME  "dot"  11x11  w:fixed h:fixed  r:6  bg:neutral/400(#b8b3ac)  bd:#ffffff 2in  clip
          FRAME  "conector"  2x95  w:fixed h:fill  bg:border/subtle(#ebe9e6)  clip
        FRAME  "content"  390x115  col  w:fill h:hug  p:0,0,26,0  gap:5  clip
          FRAME  "header"  390x14  row  w:fill h:hug  gap:8  items:center  clip
            TEXT  "fecha"  69x14  w:hug h:hug  text:"20 jun · 15:30" Plus Jakarta Sans 500 11/13.86 c:text/tertiary(#8f887f)
            INSTANCE  "badge"  → "Chip / Tipo=Neutro, Removible=No"  99x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:neutral/100(#f5f4f2)  props{Etiqueta=Cliente VIP}  (oculto)
          TEXT  "titulo"  390x16  w:fill h:hug  text:"Gestión inicial de cobro" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
          TEXT  "meta"  390x15  w:fill h:hug  text:"Titular · Ana G. (asesor)" Plus Jakarta Sans 400 12/15.12 c:text/secondary(#6b6459)
          INSTANCE  "Workspace/NotaHistorial"  → "Workspace/NotaHistorial / Estado=Colapsado"  390x29  col  w:fill h:hug  p:7,10  r:8  bg:brand/primary-subtle(#edfbfa)  props{nota=Prefiere ser contactado después de las 6:00 pm. No responde en horario laboral.}
            · textos: "Prefiere ser contactado después de las 6:00 pm. No" | "▼"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=EstadoCuenta, Menu=Cerrado
```
COMPONENT  "Tab=EstadoCuenta, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=EstadoCuenta"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x513  col  w:fill h:hug  p:4,12,0,0  gap:14  clip
      INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Medium, Estado=Default"  416x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar por WhatsApp}
        · textos: "Enviar por WhatsApp"
      FRAME  "resumenCuenta"  416x184  col  w:fill h:hug  p:13,14  gap:10  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,4 14 0 #0f0d081a]  clip
        INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  388x13  row  w:fill h:hug  props{Texto=RESUMEN DE CUENTA}
          · textos: "RESUMEN DE CUENTA"
        FRAME  "balance"  388x49  col  w:fill h:hug  gap:1  clip
          TEXT  "Saldo total del crédito"  127x15  w:hug h:hug  text:"Saldo total del crédito" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
          TEXT  "Q42,000"  113x33  w:hug h:hug  text:"Q41,600" Plus Jakarta Sans 700 26/32.76 c:text/primary(#24211d)
        FRAME  "Frame"  388x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        INSTANCE  "Workspace/StatRow"  → "Workspace/StatRow / Tono=Peligro"  388x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  props{Ícono=Icon / Tamaño=XS, Color=Terciario; MostrarÍcono=False; Valor=Q3,200; Etiqueta=Saldo vencido}
          · textos: "Saldo vencido" | "Q3,200"
        INSTANCE  "Workspace/StatRow"  → "Workspace/StatRow / Tono=Default"  388x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  props{Ícono=Icon / Tamaño=XS, Color=Terciario; Valor=36 de 48; MostrarÍcono=False; Etiqueta=Cuotas restantes}
          · textos: "Cuotas restantes" | "36 de 48"
        INSTANCE  "Workspace/StatRow"  → "Workspace/StatRow / Tono=Default"  388x15  row  w:fill h:hug  gap:8  justify:space_between  items:center  props{Ícono=Icon / Tamaño=XS, Color=Terciario; Valor=07 ago 2026; MostrarÍcono=False; Etiqueta=Próximo pago}
          · textos: "Próximo pago" | "07 ago 2026"
      INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  416x13  row  w:fill h:hug  props{Texto=PLAN DE PAGOS}
        · textos: "PLAN DE PAGOS"
      FRAME  "movimientos"  416x228  col  w:fill h:hug  clip
        INSTANCE  "Workspace/MovementRow"  → "Workspace/MovementRow / Estado=Vencida"  416x52  row  w:fill h:fixed  p:9,0  gap:10  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in  props{Fecha=Venció 07 jul 2026; Monto=Q3,200; Concepto=Cuota 13 de 48}
          · textos: "Cuota 13 de 48" | "Venció 07 jul 2026" | "Q3,200" | "Vencida"
        FRAME  "Workspace/MovementRow"  416x88  row  w:fill h:hug  p:9,0  gap:10  bd:border/subtle(#ebe9e6) 0,0,1,0in
          INSTANCE  "icono"  → "Icon / Tamaño=S, Color=Éxito"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "left"  300x70  col  w:fill h:hug  gap:3  clip
            TEXT  "concepto"  300x16  w:fill h:hug  text:"Cuota 12 de 48" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            FRAME  "metodo"  48x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip
              TEXT  "Boleta"  34x13  w:hug h:hug  text:"Boleta" Plus Jakarta Sans 500 10.5/13.23 c:brand/primary(#1fa79b)
            FRAME  "metodo"  82x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip  (oculto)
            TEXT  "fecha"  300x14  w:fill h:hug  text:"Pagó 03 jul 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "gestion"  312x14  w:fixed h:fixed  text:"Registrado —" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)  (oculto)
            TEXT  "gestion"  300x14  w:fill h:hug  text:"Registrado 05 jul 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          FRAME  "right"  80x42  col  w:hug h:hug  gap:3  items:max  clip
            TEXT  "monto"  51x16  w:hug h:hug  text:"Q3,200" Plus Jakarta Sans 600 13/16.38 c:text/secondary(#6b6459)
            INSTANCE  "estado"  → "Chip / Tipo=Éxito, Removible=No"  80x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/success/subtle(#d9f5e3)  props{Etiqueta=Pagada}
              · textos: "Pagada"
        FRAME  "Workspace/MovementRow"  416x88  row  w:fill h:hug  p:9,0  gap:10  bd:border/subtle(#ebe9e6) 0,0,1,0in
          INSTANCE  "icono"  → "Icon / Tamaño=S, Color=Éxito"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/circle-check}
          FRAME  "left"  300x70  col  w:fill h:hug  gap:3  clip
            TEXT  "concepto"  300x16  w:fill h:hug  text:"Cuota 11 de 48" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            FRAME  "metodo"  82x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip
              TEXT  "Transferencia"  68x13  w:hug h:hug  text:"Transferencia" Plus Jakarta Sans 500 10.5/13.23 c:brand/primary(#1fa79b)
            FRAME  "metodo"  82x17  row  w:hug h:hug  p:2,7  r:20  bg:brand/primary-subtle(#edfbfa)  clip  (oculto)
            TEXT  "fecha"  300x14  w:fill h:hug  text:"Pagó 05 jun 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
            TEXT  "gestion"  312x14  w:fixed h:fixed  text:"Registrado —" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)  (oculto)
            TEXT  "gestion"  300x14  w:fill h:hug  text:"Registrado 05 jun 2026" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          FRAME  "right"  80x42  col  w:hug h:hug  gap:3  items:max  clip
            TEXT  "monto"  51x16  w:hug h:hug  text:"Q3,200" Plus Jakarta Sans 600 13/16.38 c:text/secondary(#6b6459)
            INSTANCE  "estado"  → "Chip / Tipo=Éxito, Removible=No"  80x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/success/subtle(#d9f5e3)  props{Etiqueta=Pagada}
              · textos: "Pagada"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Documentos, Menu=Cerrado
```
COMPONENT  "Tab=Documentos, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x457  col  w:fill h:hug  p:4,12,0,0  gap:14  clip
      INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  416x13  row  w:fill h:hug  props{Texto=ENVIAR AL CLIENTE}
        · textos: "ENVIAR AL CLIENTE"
      FRAME  "grupo/ENVIAR"  416x166  col  w:fill h:hug  p:4,12  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  268x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  268x16  w:fill h:hug  text:"Tarjeta de circulación" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  268x14  w:fill h:hug  text:"Documento vehicular" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Small, Estado=Default"  70x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar}
            · textos: "Enviar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  268x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  268x16  w:fill h:hug  text:"Información de seguro" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  268x14  w:fill h:hug  text:"Póliza vigente" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Small, Estado=Default"  70x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar}
            · textos: "Enviar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  268x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  268x16  w:fill h:hug  text:"Estado de cuenta" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  268x14  w:fill h:hug  text:"Resumen del crédito" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Primary, Tamaño=Small, Estado=Default"  70x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary(#1fa79b)  fx:Shadow/Clay-Subtle/Light  props{MostrarIcono=False; Etiqueta=Enviar}
            · textos: "Enviar"
      INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Mayúscula"  416x13  row  w:fill h:hug  props{Texto=SOLICITAR AL SUPERVISOR}
        · textos: "SOLICITAR AL SUPERVISOR"
      FRAME  "grupo/SOLICITAR"  416x219  col  w:fill h:hug  p:4,12  r:12  bg:bg/surface(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Contrato de crédito" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"PDF · Documento legal" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Carta poder" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"Requiere firma del titular" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Cambio de placas" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"Trámite vehicular" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
        FRAME  "Frame"  392x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
        FRAME  "Workspace/DocumentRow"  392x52  row  w:fill h:fixed  p:8,0  gap:10  items:center
          FRAME  "iconBox"  34x34  row  w:fixed h:fixed  justify:center  items:center  r:8  bg:status/danger/subtle(#fbdfdb)  clip
            INSTANCE  "Icon"  → "Icon / Tamaño=S, Color=Peligro"  16x16  row  w:fixed h:hug  justify:center  items:center  props{Icono=lucide/file-text}
          FRAME  "text"  254x31  col  w:fill h:hug  gap:1  clip
            TEXT  "nombre"  254x16  w:fill h:hug  text:"Expertaje" Plus Jakarta Sans 600 13/16.38 c:text/primary(#24211d)
            TEXT  "meta"  254x14  w:fill h:hug  text:"Avalúo del vehículo" Plus Jakarta Sans 400 11/13.86 c:text/tertiary(#8f887f)
          INSTANCE  "Button"  → "Button / Tipo=Secondary, Tamaño=Small, Estado=Default"  84x32  row  w:hug h:hug  p:8[space/8],16[space/16]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Solicitar}
            · textos: "Solicitar"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Referencias, Menu=Cerrado
```
COMPONENT  "Tab=Referencias, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Referencias"  428x297  col  w:fill h:hug  p:4,12,0,0  gap:10
      · textos: "REFERENCIAS DEL CRÉDITO · 4" | "MJ" | "María José Aguilar" | "Hermana · 5555-0001" | "Verificada" | "CA"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historico, Menu=Cerrado
```
COMPONENT  "Tab=Historico, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x361  col  w:fill h:hug  p:4,12,0,0  clip
      INSTANCE  "histSegmented"  → "SegmentedNav"  239x42  row  w:hug h:hug  p:4  gap:4  r:10  bg:#f1f2f4
        · textos: "Historial actual" | "Histórico"
      FRAME  "tlHeader"  416x39  col  w:fill h:hug  p:16,0,10,0  clip
        TEXT  "VIDA COMPLETA DEL CRÉDITO"  416x13  w:fill h:hug  text:"VIDA COMPLETA DEL CRÉDITO" Plus Jakarta Sans 600 10/12.6 ls0.6 c:text/tertiary(#8f887f)
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B1 · Alerta temprana" | "06 ago 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Salió de Bucket B2 → B1" | "18 jul 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Reestructuración de pago aprobada" | "20 may 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Promesa cumplida · Q3,200" | "15 abr 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B2 · Mora 60" | "05 dic 2025"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Convenio de pago firmado" | "10 oct 2025"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Resumen, Menu=Abierto
```
COMPONENT  "Tab=Resumen, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "Workspace/Consulta"  → "Workspace/Consulta / Vista=Resumen"  428x642  col  w:fill h:hug  p:4,12,0,0  gap:8
      · textos: "Estado del cobro" | "En mora" | "68" | "días en mora" | "bucket B3" | "Cuotas pagadas"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historial, Menu=Abierto
```
COMPONENT  "Tab=Historial, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Historial"  428x571  col  w:fill h:hug  p:4,12,0,0
      · textos: "Historial actual" | "Histórico" | "HISTORIAL DEL CRÉDITO · 6 GESTIONES" | "15 jul · 09:12" | "Promesa de pago registrada · Q2,500" | "Titular · Ana G. (asesor)"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=EstadoCuenta, Menu=Abierto
```
COMPONENT  "Tab=EstadoCuenta, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=EstadoCuenta"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=EstadoCuenta"  428x541  col  w:fill h:hug  p:4,12,0,0  gap:14
      · textos: "RESUMEN DE CUENTA" | "Saldo total del crédito" | "Q41,600" | "Saldo vencido" | "Q3,200" | "Cuotas restantes"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Documentos, Menu=Abierto
```
COMPONENT  "Tab=Documentos, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Documentos"  428x505  col  w:fill h:hug  p:4,12,0,0  gap:14
      · textos: "IDENTIFICACIÓN" | "DPI — Titular" | "JPG · 1.2 MB · 12 ene 2026" | "DPI — Codeudor 1" | "JPG · 1.1 MB · 12 ene 2026" | "CONTRATO Y GARANTÍAS"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 600 13.5/17.01 c:brand/primary(#1fa79b)
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Referencias, Menu=Abierto
```
COMPONENT  "Tab=Referencias, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    INSTANCE  "ContenidoConsulta"  → "Workspace/Consulta / Vista=Referencias"  428x297  col  w:fill h:hug  p:4,12,0,0  gap:10
      · textos: "REFERENCIAS DEL CRÉDITO · 4" | "MJ" | "María José Aguilar" | "Hermana · 5555-0001" | "Verificada" | "CA"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 600 13.5/17.01 c:brand/primary(#1fa79b)
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=Historico, Menu=Abierto
```
COMPONENT  "Tab=Historico, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Historial"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  FRAME  "tabContent"  428x343  col  w:fill h:fill  clip
    FRAME  "ContenidoConsulta"  428x361  col  w:fill h:hug  p:4,12,0,0  clip
      INSTANCE  "histSegmented"  → "SegmentedNav"  239x42  row  w:hug h:hug  p:4  gap:4  r:10  bg:#f1f2f4
        · textos: "Historial actual" | "Histórico"
      FRAME  "tlHeader"  416x39  col  w:fill h:hug  p:16,0,10,0  clip
        TEXT  "VIDA COMPLETA DEL CRÉDITO"  416x13  w:fill h:hug  text:"VIDA COMPLETA DEL CRÉDITO" Plus Jakarta Sans 600 10/12.6 ls0.6 c:text/tertiary(#8f887f)
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B1 · Alerta temprana" | "06 ago 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Salió de Bucket B2 → B1" | "18 jul 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Reestructuración de pago aprobada" | "20 may 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Promesa cumplida · Q3,200" | "15 abr 2026"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Ingresó a Bucket B2 · Mora 60" | "05 dic 2025"
      INSTANCE  "Ficha360/HistoricoEvent"  → "Ficha360/HistoricoEvent / Estado=Colapsado"  416x46  col  w:fill h:hug  p:14,18  gap:8  bg:#ffffff
        · textos: "Convenio de pago firmado" | "10 oct 2025"
    FRAME  "scrollbar"  5x300  w:fixed h:fixed  absolute  r:3  bg:border/subtle(#ebe9e6)  clip
    FRAME  "thumb"  5x150  w:fixed h:fixed  absolute  r:3  bg:neutral/500(#8f887f)  clip
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  INSTANCE  "Abrir Ficha 360"  → "Button / Tipo=Secondary, Tamaño=Medium, Estado=Default"  428x42  row  w:fill h:hug  p:12[space/12],24[space/24]  gap:8[space/8]  justify:center  items:center  r:radius/md(14)  bg:brand/primary-subtle(#edfbfa)  props{MostrarIcono=False; Etiqueta=Abrir Ficha 360}
    · textos: "Abrir Ficha 360"
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
  FRAME  "tab-asistente"  68x15  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  68x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 500 12/15.12 c:text/secondary(#6b6459)
    FRAME  "underline"  60x2  w:fixed h:fixed  r:1  bg:brand/primary(#1fa79b)  clip  (oculto)
```
#### Tab=AsistenteIA, Menu=Cerrado
```
COMPONENT  "Tab=AsistenteIA, Menu=Cerrado"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  INSTANCE  "resumenIA"  → "Workspace/ResumenIA·Card / Estado=Colapsado"  428x40  col  w:fill h:hug  p:12,14  gap:8  r:12  bg:brand/primary-subtle(#edfbfa)  bd:border/subtle(#ebe9e6) 1in
    · textos: "✦" | "Resumen del caso" | "IA" | "▼"
  FRAME  "tabContent"  428x283  col  w:fill h:fill  p:10  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    FRAME  "chat"  408x182  col  w:fill h:hug  gap:10  clip
      FRAME  "Frame"  408x54  row  w:fill h:hug  clip
        FRAME  "Frame"  320x54  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas sobre este crédito."  296x36  w:fill h:hug  text:"Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
      FRAME  "Frame"  408x36  row  w:fill h:hug  justify:max  clip
        FRAME  "Frame"  320x36  col  w:fixed h:hug  p:9,12  r:12  bg:brand/primary(#1fa79b)  clip
          TEXT  "¿Cuál es el mejor canal para contactarlo?"  296x18  w:fill h:hug  text:"¿Cuál es el mejor canal para contactarlo?" Plus Jakarta Sans 400 12.5/18 c:brand/on-primary(#ffffff)
      FRAME  "Frame"  408x72  row  w:fill h:hug  clip
        FRAME  "Frame"  320x72  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La última llamada no tuvo respuesta."  296x54  w:fill h:hug  text:"Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La últi…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  FRAME  "inputIA"  428x50  row  w:fill h:hug  p:8,8,8,14  gap:8  items:center  r:24  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    TEXT  "Pregúntale a la IA…"  344x16  w:fill h:hug  text:"Pregúntale a la IA…" Plus Jakarta Sans 400 12.5/15.75 c:text/tertiary(#8f887f)
    FRAME  "send"  54x34  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:brand/primary(#1fa79b)  clip
      FRAME  "lucide/send-horizontal"  20x20  w:fixed h:fixed  clip
        VECTOR  "Vector"  15.84x15  bd:brand/on-primary(#ffffff) 1.67center
  FRAME  "tab-asistente"  69x21  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  69x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
    FRAME  "underline"  69x2  w:fill h:fixed  r:1  bg:brand/primary(#1fa79b)  clip
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:text/tertiary(#8f887f)
    TEXT  "▼"  8x11  w:hug h:hug  text:"▼" Plus Jakarta Sans 500 9/11.34 c:text/tertiary(#8f887f)
```
#### Tab=AsistenteIA, Menu=Abierto
```
COMPONENT  "Tab=AsistenteIA, Menu=Abierto"  468x643  col  w:fixed h:fixed  p:16,20  gap:12  bg:bg/canvas(#fafaf9)  clip
  INSTANCE  "Workspace/SectionLabel"  → "Workspace/SectionLabel / Estilo=Columna"  428x14  row  w:fill h:hug  props{Texto=Contexto del caso}
    · textos: "Contexto del caso"
  INSTANCE  "Workspace/ParticipantSelector"  → "Workspace/ParticipantSelector"  428x73  col  w:fixed h:hug  gap:6  (oculto)
  INSTANCE  "Workspace/IdentityHeader"  → "Workspace/IdentityHeader"  428x40  row  w:fill h:hug  gap:10  items:center  props{Subtítulo=Crédito #48972 · Nissan Frontier · P-201KLM; Iniciales=MC; Nombre=María José Contreras}
    · textos: "MC" | "María José Contreras" | "Crédito #48972 · Nissan Frontier · P-201KLM"
  INSTANCE  "Indicador/SinContacto"  → "Indicador/SinContacto / Intentos=2Mas"  167x32  row  w:hug h:hug  gap:8
    · textos: "2 intentos sin contacto" | "Último intento: 11 ago 2026"
  FRAME  "badges"  428x23  row  w:fill h:hug  gap:6  clip
    INSTANCE  "Badge/Bucket"  → "Badge/Bucket / Bucket=B3, Formato=Compacta"  40x23  row  w:hug h:hug  p:4[space/4],8[space/8]  gap:8[space/8]  items:center  r:radius/sm(8)  bg:bucket/b3/bg(#ffe4d6)
      · textos: "B3"
    INSTANCE  "Chip"  → "Chip / Tipo=Peligro, Removible=No"  111x23  row  w:hug h:hug  p:4[space/4],12[space/12]  gap:6[space/6]  items:center  r:radius/full(999)  bg:status/danger/subtle(#fbdfdb)  props{Etiqueta=Mora Q1,200}
      · textos: "Mora Q1,200"
  INSTANCE  "tabs"  → "Workspace/WorkspaceTabs / Activa=Resumen"  428x32  row  w:fill h:fixed  gap:18  items:center  bd:border/subtle(#ebe9e6) 0,0,1,0in
    · textos: "Resumen" | "Historial" | "Estado de cuenta"
  INSTANCE  "resumenIA"  → "Workspace/ResumenIA·Card / Estado=Colapsado"  428x40  col  w:fill h:hug  p:12,14  gap:8  r:12  bg:brand/primary-subtle(#edfbfa)  bd:border/subtle(#ebe9e6) 1in
    · textos: "✦" | "Resumen del caso" | "IA" | "▼"
  FRAME  "tabContent"  428x283  col  w:fill h:fill  p:10  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    FRAME  "chat"  408x182  col  w:fill h:hug  gap:10  clip
      FRAME  "Frame"  408x54  row  w:fill h:hug  clip
        FRAME  "Frame"  320x54  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas sobre este crédito."  296x36  w:fill h:hug  text:"Hola, soy tu asistente del caso. Puedo resumir la situación o responder dudas…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
      FRAME  "Frame"  408x36  row  w:fill h:hug  justify:max  clip
        FRAME  "Frame"  320x36  col  w:fixed h:hug  p:9,12  r:12  bg:brand/primary(#1fa79b)  clip
          TEXT  "¿Cuál es el mejor canal para contactarlo?"  296x18  w:fill h:hug  text:"¿Cuál es el mejor canal para contactarlo?" Plus Jakarta Sans 400 12.5/18 c:brand/on-primary(#ffffff)
      FRAME  "Frame"  408x72  row  w:fill h:hug  clip
        FRAME  "Frame"  320x72  col  w:fixed h:hug  p:9,12  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
          TEXT  "Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La última llamada no tuvo respuesta."  296x54  w:fill h:hug  text:"Por el historial, responde mejor por WhatsApp después de las 6:00 pm. La últi…" Plus Jakarta Sans 400 12.5/18 c:text/tertiary(#8f887f)
  FRAME  "divider"  428x1  w:fill h:fixed  bg:border/subtle(#ebe9e6)  clip
  FRAME  "inputIA"  428x50  row  w:fill h:hug  p:8,8,8,14  gap:8  items:center  r:24  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  clip
    TEXT  "Pregúntale a la IA…"  344x16  w:fill h:hug  text:"Pregúntale a la IA…" Plus Jakarta Sans 400 12.5/15.75 c:text/tertiary(#8f887f)
    FRAME  "send"  54x34  row  w:fixed h:fixed  justify:center  items:center  r:20  bg:brand/primary(#1fa79b)  clip
      FRAME  "lucide/send-horizontal"  20x20  w:fixed h:fixed  clip
        VECTOR  "Vector"  15.84x15  bd:brand/on-primary(#ffffff) 1.67center
  FRAME  "tab-asistente"  69x21  col  w:hug h:hug  absolute  gap:4  items:center  clip
    TEXT  "Asistente IA"  69x15  w:hug h:hug  text:"Asistente IA" Plus Jakarta Sans 600 12/15.12 c:text/primary(#24211d)
    FRAME  "underline"  69x2  w:fill h:fixed  r:1  bg:brand/primary(#1fa79b)  clip
  FRAME  "mas-pill"  53x26  row  w:hug h:hug  absolute  p:5,8  gap:3  items:center  r:8  clip
    TEXT  "Más"  26x16  w:hug h:hug  text:"Más" Plus Jakarta Sans 500 13/16.38 c:brand/primary(#1fa79b)
    TEXT  "▲"  8x11  w:hug h:hug  text:"▲" Plus Jakarta Sans 500 9/11.34 c:brand/primary(#1fa79b)
  FRAME  "mas-dropdown"  196x90  col  w:fixed h:hug  absolute  p:6  gap:2  r:12  bg:bg/surface-raised(#ffffff)  bd:border/subtle(#ebe9e6) 1in  fx:[0,6 18 0 #0000001f]  clip
    FRAME  "item-Documentos"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Documentos"  160x17  w:fill h:hug  text:"Documentos" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
    FRAME  "item-Referencias"  184x38  row  w:fill h:fixed  p:9,12  gap:8  items:center  r:8  clip
      TEXT  "Referencias"  160x17  w:fill h:hug  text:"Referencias" Plus Jakarta Sans 500 13.5/17.01 c:#292e38
```

## 🟢 01 · Dashboard › Dashboard · Asesor Senior · Día

<details><summary>Textos de documentación de la sección</summary>

- DASHBOARD DE COBROS
- Buen día, Carlos
- Este es el estado de tu cartera hoy. Prioriza la negociación y protege tu recuperación.
- Mi desempeño
- Tu gestión personal como Supervisor (además del desempeño del equipo, en «Mi equipo»)
- Ordenados por prioridad de Bucket y días de mora. Abre la Ficha 360 para gestionar.
- Abre la distribución para filtrar Mi Cartera por Bucket.
- ● Prioridad alta · 4 casos requieren atención inmediata

</details>


## 🟢 01 · Dashboard › Dashboard · Asesor Senior · Semana

<details><summary>Textos de documentación de la sección</summary>

- DASHBOARD DE COBROS
- Buen día, Carlos
- Este es el estado de tu cartera hoy. Prioriza la negociación y protege tu recuperación.
- Mi desempeño
- Tu gestión personal como Supervisor (además del desempeño del equipo, en «Mi equipo»)
- Ordenados por prioridad de Bucket y días de mora. Abre la Ficha 360 para gestionar.
- Abre la distribución para filtrar Mi Cartera por Bucket.
- ● Prioridad alta · 4 casos requieren atención inmediata

</details>


## 🟢 01 · Dashboard › Dashboard · Asesor Senior · Mes

<details><summary>Textos de documentación de la sección</summary>

- DASHBOARD DE COBROS
- Buen día, Carlos
- Este es el estado de tu cartera hoy. Prioriza la negociación y protege tu recuperación.
- Mi desempeño
- Tu gestión personal como Supervisor (además del desempeño del equipo, en «Mi equipo»)
- Ordenados por prioridad de Bucket y días de mora. Abre la Ficha 360 para gestionar.
- Abre la distribución para filtrar Mi Cartera por Bucket.
- ● Prioridad alta · 4 casos requieren atención inmediata

</details>


## 🟢 02 · Mi Cartera › Mi Cartera · Asesor Senior (B2–B3)

<details><summary>Textos de documentación de la sección</summary>

- MÓDULO COBROS · BUCKET 2 y BUCKET 3
- Mi Cartera
- Tu cola de trabajo priorizada. Empieza por los casos que requieren atención hoy.
- Cartera Asignada
- 312 créditos
- CRÉDITO / CLIENTE
- BUCKET
- MORA
- DEUDA VENCIDA
- CUOTA NORMAL
- FECHA DE PAGO
- SEGUIMIENTO
- ESTADO DE GESTIÓN
- ACCIÓN PENDIENTE

</details>


## 🟢 03 · Workspace v3 · Asesor Senior › 🟩 Workspace v3 · Senior (2 paneles)

<details><summary>Textos de documentación de la sección</summary>

- Espacio de trabajo

</details>


## 🟢 03 · Workspace v3 · Asesor Senior › 🟩 Workspace v3 · Senior B3 (2 paneles)

<details><summary>Textos de documentación de la sección</summary>

- Espacio de trabajo

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Ficha 360 · Asesor Senior (B2)

<details><summary>Textos de documentación de la sección</summary>

- Contactabilidad
- Alta
- Días sin gestión
- 3
- Registrar gestión

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Ficha 360 · Codeudor (B2)

<details><summary>Textos de documentación de la sección</summary>

- Días en mora
- 44
- Contactabilidad
- Alta
- Días sin gestión
- 3
- GESTIÓN
- Próxima acción
- Llamar — dar seguimiento · hoy 10:00

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Ficha 360 · Edición · Información (B2)

<details><summary>Textos de documentación de la sección</summary>

- Editar información del cliente
- Información del cliente
- Historial de cambios
- Datos personales
- 🔒
- RENAP · Solo lectura
- Sincronizado desde RENAP · no editable
- Contacto
- Última modificación: 12 jul 2026, 09:14 · Ana Gómez
- Dirección de residencia
- Dirección de trabajo

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Ficha 360 · Edición · Historial de cambios (B2)

<details><summary>Textos de documentación de la sección</summary>

- Editar información del cliente
- Información del cliente
- Historial de cambios
- CAMPO
- CAMBIO (ANTES → DESPUÉS)
- AUTOR / ORIGEN
- Mostrando 5 de 128 cambios

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Ubicaciones verificadas · Residencia (B2)

<details><summary>Textos de documentación de la sección</summary>

- Ubicaciones verificadas
- María José Contreras
- Titular
- Dirección verificada
- 12 calle 4-55, Zona 10, Guatemala
- Ubicación en el mapa
- Fotografías de la visita
- Comentarios del verificador
- Se confirmó que el titular reside en la dirección indicada. Casa de dos niveles, portón negro. Atendió un familiar directo. Vehículo no se encontraba en el domicilio al momento de la visita.
- Verificada el 12 jun 2026 · Inspector: Carlos Ramírez

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Ubicaciones verificadas · Trabajo (B2)

<details><summary>Textos de documentación de la sección</summary>

- Ubicaciones verificadas
- María José Contreras
- Titular
- Sin verificación registrada
- Esta dirección aún no ha sido verificada en campo.
- La información de la visita (mapa, fotos, comentarios) se mostrará automáticamente aquí cuando se realice la verificación.

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Ubicación del vehículo (GPS) (B2)

<details><summary>Textos de documentación de la sección</summary>

- Ubicación del vehículo
- Toyota Hilux · P-482GHT · GPS de la garantía
- ESTADO DEL VEHÍCULO
- ÚLTIMA ACTUALIZACIÓN
- Hoy, 10:32
- hace 8 minutos
- Ubicación actual en el mapa
- 12 calle 4-55, Zona 10, Guatemala · aprox.
- Ubicaciones frecuentes
- Dónde permanece el vehículo con más frecuencia

</details>


## 🟦 04 · Consulta · Ficha 360 · Ubicaciones › Contacto (B2)

<details><summary>Textos de documentación de la sección</summary>

- Contacto
- Personas asociadas al crédito · Crédito #48972
- MC
- María José Contreras
- Titular
- Editar
- ML
- María López García
- Codeudor 1

</details>


## ⚫ 05 · Overlays y auxiliares › Sys · Abriendo WhatsApp

<details><summary>Textos de documentación de la sección</summary>

- Abriendo WhatsApp…
- Volverás al Workspace al terminar.

</details>


## Cartera completa · Asesor Senior › toolbar

<details><summary>Textos de documentación de la sección</summary>

- Cartera Asignada
- 312 créditos

</details>


## Cartera completa · Asesor Senior › col-head

<details><summary>Textos de documentación de la sección</summary>

- CRÉDITO / CLIENTE
- BUCKET
- MORA
- DEUDA VENCIDA
- CUOTA NORMAL
- FECHA DE PAGO
- SEGUIMIENTO
- ESTADO DE GESTIÓN
- ACCIÓN PENDIENTE

</details>


## Cartera completa · Asesor Senior › rowwrap

<details><summary>Textos de documentación de la sección</summary>

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


import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { NexaDashboardParams } from "../services/nexaDashboard.services";

// Barra de filtros del dashboard Nexa. Solo dibuja: el estado y las reglas (qué se aplica al
// instante, qué espera a "Buscar", qué se borra al cambiar de cuota) viven en NexaDashboard.
// Colores explícitos en todo: el tema deja en blanco el texto de los componentes de shadcn.

type CuotaMes = NexaDashboardParams["cuotaMes"];
type Medio = NexaDashboardParams["medio"];

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1";
const CAMPO = `h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 shadow-xs ${FOCO}`;
const ITEM = "text-slate-900 focus:bg-blue-50 focus:text-slate-900";

// La barra de navegación fija de la app (dashBoard.tsx) no tiene alto fijo: 64 px hasta xl (h-16),
// 84 px desde xl, y más cuando los menús de un ADMIN no caben en una fila (108 px a 1280). Por eso se
// mide en vivo: el borde de abajo de la nav fija visible. Los valores fijos solo cubren el primer render.
// El index.html no usa viewport-fit=cover, así que env(safe-area-inset-top) hoy vale 0; se suma igual.
const NAV_MOVIL = 64;
const NAV_XL = 84;
const SEGURO = "env(safe-area-inset-top, 0px)";

const medirNav = () => {
  let abajo = 0;
  document.querySelectorAll<HTMLElement>("nav.fixed").forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.height > 0 && r.top <= 0) abajo = Math.max(abajo, r.bottom);
  });
  return Math.round(abajo) || (window.innerWidth >= 1280 ? NAV_XL : NAV_MOVIL);
};

function useAltoNav() {
  const [alto, setAlto] = useState(NAV_XL);
  useEffect(() => {
    const actualizar = () => setAlto(medirNav());
    actualizar();
    window.addEventListener("resize", actualizar);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(actualizar);
    document.querySelectorAll("nav.fixed").forEach((n) => ro?.observe(n));
    return () => { window.removeEventListener("resize", actualizar); ro?.disconnect(); };
  }, []);
  return alto;
}

// true cuando el centinela (un punto sin alto) quedó por encima del borde de abajo de la nav fija.
// Se mira la posición en cada scroll (no un IntersectionObserver): un salto grande (Fin, Av Pág,
// restaurar el scroll al recargar) pasa de "abajo" a "arriba" sin cruzar el borde y el observer no avisa.
function usePasoDebajoDeLaBarra(ref: RefObject<HTMLElement | null>, alto: number) {
  const [paso, setPaso] = useState(false);
  useEffect(() => {
    let cuadro = 0;
    const revisar = () => {
      cuadro = 0;
      const el = ref.current;
      if (el) setPaso(el.getBoundingClientRect().top < alto + 1);
    };
    const pedir = () => { if (!cuadro) cuadro = requestAnimationFrame(revisar); };
    revisar();
    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", pedir);
    return () => {
      window.removeEventListener("scroll", pedir);
      window.removeEventListener("resize", pedir);
      if (cuadro) cancelAnimationFrame(cuadro);
    };
  }, [ref, alto]);
  return paso;
}

export interface ChipFiltro {
  id: string;
  texto: string;
  quitar: () => void;
}

type Tono = "neutro" | "nexa" | "manual";
const ACTIVO: Record<Tono, string> = {
  neutro: "bg-white font-medium text-blue-800 shadow-sm ring-1 ring-slate-200",
  nexa: "border border-purple-300 bg-purple-50 font-medium text-purple-800 shadow-sm",
  manual: "border border-green-300 bg-green-50 font-medium text-green-800 shadow-sm",
};
const PUNTO: Record<Tono, string> = { neutro: "", nexa: "bg-purple-600", manual: "bg-green-600" };

function Segmentado<T extends string>({ etiqueta, valor, opciones, onChange, deshabilitado, titulo }: {
  etiqueta: string;
  valor: T;
  opciones: { valor: T; texto: string; tono?: Tono }[];
  onChange: (v: T) => void;
  deshabilitado?: boolean;
  titulo?: string;
}) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      title={deshabilitado ? titulo : undefined}
      className={`inline-flex max-w-full flex-wrap rounded-md border border-slate-300 bg-slate-100 p-0.5 ${deshabilitado ? "opacity-50" : ""}`}
    >
      {opciones.map((o) => {
        const activo = o.valor === valor;
        const tono = o.tono ?? "neutro";
        return (
          <button
            key={o.valor}
            type="button"
            disabled={deshabilitado}
            aria-pressed={activo}
            onClick={() => onChange(o.valor)}
            className={`inline-flex h-[30px] items-center gap-1.5 rounded border border-transparent px-3 text-sm transition-colors disabled:cursor-not-allowed ${FOCO} ${
              activo ? ACTIVO[tono] : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tono !== "neutro" && <span aria-hidden className={`h-2 w-2 rounded-sm ${PUNTO[tono]}`} />}
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

function Campo({ etiqueta, htmlFor, children }: { etiqueta: string; htmlFor?: string; children: ReactNode }) {
  const Rotulo = htmlFor ? "label" : "span";
  return (
    <div className="flex min-w-0 flex-col gap-1 max-sm:w-full">
      <Rotulo {...(htmlFor ? { htmlFor } : {})} className="text-xs font-medium text-slate-600">{etiqueta}</Rotulo>
      {children}
    </div>
  );
}

export function NexaFiltros(props: {
  busqueda: string;
  onBusqueda: (v: string) => void;
  desde: string;
  hasta: string;
  onDesde: (v: string) => void;
  onHasta: (v: string) => void;
  /** Hay texto o fechas escritos que todavía no se aplicaron con "Buscar". */
  pendiente: boolean;
  onBuscar: () => void;
  cuotaMes: CuotaMes;
  onCuotaMes: (v: CuotaMes) => void;
  medio: Medio;
  onMedio: (v: Medio) => void;
  puedeFiltrarAsesor: boolean;
  asesor: string;
  onAsesor: (v: string) => void;
  opcionesAsesor: { asesor_id: number; nombre: string }[];
  chips: ChipFiltro[];
  onLimpiar: () => void;
}) {
  const { chips } = props;
  // Desde xl la barra entera queda pegada arriba (cabe en dos filas). Más angosto taparía media
  // pantalla: la barra se queda en su lugar y, al pasarla, aparece una fija con solo el buscador.
  const inicio = useRef<HTMLSpanElement>(null);
  const fin = useRef<HTMLSpanElement>(null);
  const seccion = useRef<HTMLElement>(null);
  const altoNav = useAltoNav();
  const pegada = usePasoDebajoDeLaBarra(inicio, altoNav);
  const compacta = usePasoDebajoDeLaBarra(fin, altoNav);
  const verFiltros = () => {
    const el = seccion.current;
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - altoNav - 12, behavior: "smooth" });
  };
  return (
    <>
    {/* Centinelas absolutos: no ocupan lugar ni mueven la página. */}
    <span ref={inicio} aria-hidden className="pointer-events-none absolute h-0 w-0" />
    <section
      ref={seccion}
      aria-label="Filtros"
      style={{ top: `calc(${altoNav}px + ${SEGURO})` }}
      className={`rounded-lg border bg-white xl:sticky xl:z-30 ${
        pegada ? "border-slate-300 shadow-md shadow-slate-900/10 xl:rounded-t-none" : "border-slate-200 shadow-sm"}`}
    >
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => { e.preventDefault(); props.onBuscar(); }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              className={`${CAMPO} w-full pl-9`}
              placeholder="Número de crédito o cliente"
              value={props.busqueda}
              onChange={(e) => props.onBusqueda(e.target.value)}
              aria-label="Buscar por número de crédito o cliente"
            />
          </div>
          <button
            type="submit"
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-medium text-white shadow-xs hover:bg-blue-800 ${FOCO}`}
          >
            <Search aria-hidden className="h-4 w-4" />
            Buscar
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <Campo etiqueta="Fecha de pago">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <input
                id="nexa-desde"
                type="date"
                aria-label="Pagos desde"
                className={`${CAMPO} min-w-0 flex-1 pl-2 pr-1.5 max-sm:text-[13px] sm:w-[9.5rem] sm:flex-none sm:px-3`}
                value={props.desde}
                max={props.hasta || undefined}
                onChange={(e) => props.onDesde(e.target.value)}
              />
              <span aria-hidden className="text-sm text-slate-500">a</span>
              <input
                id="nexa-hasta"
                type="date"
                aria-label="Pagos hasta"
                className={`${CAMPO} min-w-0 flex-1 pl-2 pr-1.5 max-sm:text-[13px] sm:w-[9.5rem] sm:flex-none sm:px-3`}
                value={props.hasta}
                min={props.desde || undefined}
                onChange={(e) => props.onHasta(e.target.value)}
              />
            </div>
          </Campo>

          <Campo etiqueta="Cuota del mes">
            <Segmentado<CuotaMes>
              etiqueta="Cuota del mes"
              valor={props.cuotaMes}
              onChange={props.onCuotaMes}
              opciones={[
                { valor: "", texto: "Todas" },
                { valor: "pagados", texto: "Pagadas" },
                { valor: "parciales", texto: "Parciales" },
                { valor: "sinpago", texto: "Sin pago" },
              ]}
            />
          </Campo>

          <Campo etiqueta="Medio">
            <Segmentado<Medio>
              etiqueta="Medio con que se pagó la cuota del mes"
              valor={props.medio}
              onChange={props.onMedio}
              deshabilitado={props.cuotaMes === "sinpago"}
              titulo="Sin pago no tiene medio"
              opciones={[
                { valor: "", texto: "Todos" },
                { valor: "nexa", texto: "Nexa", tono: "nexa" },
                { valor: "manual", texto: "Manual", tono: "manual" },
              ]}
            />
          </Campo>

          {props.puedeFiltrarAsesor && (
            <Campo etiqueta="Asesor">
              <Select value={props.asesor || "todos"} onValueChange={(v) => props.onAsesor(v === "todos" ? "" : v)}>
                <SelectTrigger aria-label="Asesor" className={`${CAMPO} w-full gap-2 sm:w-56 data-[placeholder]:text-slate-500 [&_svg]:text-slate-500`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-200 bg-white text-slate-900">
                  <SelectItem value="todos" className={ITEM}>Todos los asesores</SelectItem>
                  {props.opcionesAsesor.map((a) => (
                    <SelectItem key={a.asesor_id} value={String(a.asesor_id)} className={ITEM}>{a.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
        </div>
      </form>

      {(chips.length > 0 || props.pendiente) && (
        <div className="flex flex-wrap items-center gap-2 rounded-b-lg border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          {props.pendiente && (
            <p role="status" className={`text-xs text-amber-800 ${chips.length > 0 ? "w-full" : ""}`}>La búsqueda o las fechas cambiaron: pulsá Buscar para aplicarlas.</p>
          )}
          {chips.length > 0 && (
            <span className="text-xs font-medium text-slate-700">
              {chips.length === 1 ? "1 filtro activo" : `${chips.length} filtros activos`}
            </span>
          )}
          {chips.length > 0 && <ul className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <li key={c.id}>
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-blue-900">
                  {c.texto}
                  <button
                    type="button"
                    onClick={c.quitar}
                    aria-label={`Quitar filtro: ${c.texto}`}
                    className={`rounded-full p-0.5 text-blue-700 hover:bg-blue-100 hover:text-blue-900 ${FOCO}`}
                  >
                    <X aria-hidden className="h-3 w-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>}
          <button
            type="button"
            onClick={props.onLimpiar}
            className={`ml-auto rounded text-xs font-medium text-blue-700 underline-offset-2 hover:underline ${FOCO}`}
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </section>
    <span ref={fin} aria-hidden className="pointer-events-none absolute h-0 w-0" />

    {compacta && (
      <div
        className="fixed inset-x-0 z-30 border-b border-slate-300 bg-white px-4 py-2 shadow-md shadow-slate-900/10 xl:hidden"
        // margin 0: el contenedor de la página (space-y) le pone margen arriba a cada hijo.
        style={{ top: `calc(${altoNav}px + ${SEGURO})`, marginTop: 0 }}
      >
        <form
          role="search"
          aria-label="Buscar créditos"
          className="mx-auto flex max-w-3xl items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); props.onBuscar(); }}
        >
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              className={`${CAMPO} w-full pl-9`}
              placeholder="Crédito o cliente"
              value={props.busqueda}
              onChange={(e) => props.onBusqueda(e.target.value)}
              aria-label="Buscar por número de crédito o cliente"
            />
          </div>
          <button
            type="submit"
            aria-label="Buscar"
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-700 text-white hover:bg-blue-800 ${FOCO}`}
          >
            <Search aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={verFiltros}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 ${FOCO}`}
          >
            <SlidersHorizontal aria-hidden className="h-4 w-4 text-slate-600" />
            Filtros
            {chips.length > 0 && (
              <span className="rounded-full bg-blue-700 px-1.5 text-xs font-semibold tabular-nums text-white">{chips.length}</span>
            )}
          </button>
        </form>
      </div>
    )}
    </>
  );
}

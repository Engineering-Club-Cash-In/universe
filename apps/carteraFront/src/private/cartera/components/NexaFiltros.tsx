import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X } from "lucide-react";
import type { NexaDashboardParams } from "../services/nexaDashboard.services";

// Barra de filtros del dashboard Nexa. Solo dibuja: el estado y las reglas (qué se aplica al
// instante, qué espera a "Buscar", qué se borra al cambiar de cuota) viven en NexaDashboard.
// Colores explícitos en todo: el tema deja en blanco el texto de los componentes de shadcn.

type CuotaMes = NexaDashboardParams["cuotaMes"];
type Medio = NexaDashboardParams["medio"];

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1";
const CAMPO = `h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 shadow-xs ${FOCO}`;
const ITEM = "text-slate-900 focus:bg-blue-50 focus:text-slate-900";

export interface ChipFiltro {
  id: string;
  texto: string;
  quitar: () => void;
}

function Segmentado<T extends string>({ etiqueta, valor, opciones, onChange }: {
  etiqueta: string;
  valor: T;
  opciones: { valor: T; texto: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activo}
            onClick={() => onChange(o.valor)}
            className={`h-[30px] rounded px-3 text-sm transition-colors ${FOCO} ${
              activo ? "bg-white font-medium text-blue-800 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"
            }`}
          >
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
  return (
    <section aria-label="Filtros" className="rounded-lg border border-slate-200 bg-white shadow-sm">
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
            <div className="flex flex-wrap items-center gap-2">
              <Segmentado<CuotaMes>
                etiqueta="Cuota del mes"
                valor={props.cuotaMes}
                onChange={props.onCuotaMes}
                opciones={[
                  { valor: "", texto: "Todas" },
                  { valor: "pagados", texto: "Pagadas" },
                  { valor: "pendientes", texto: "Pendientes" },
                ]}
              />
              {props.cuotaMes === "pagados" && (
                <div className="flex items-center gap-2 border-l-2 border-blue-200 pl-2">
                  <span className="text-xs font-medium text-slate-600">por</span>
                  <Segmentado<Medio>
                    etiqueta="Medio con que se pagó la cuota del mes"
                    valor={props.medio}
                    onChange={props.onMedio}
                    opciones={[
                      { valor: "", texto: "Ambos" },
                      { valor: "nexa", texto: "Nexa" },
                      { valor: "manual", texto: "Manual" },
                    ]}
                  />
                </div>
              )}
            </div>
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
  );
}

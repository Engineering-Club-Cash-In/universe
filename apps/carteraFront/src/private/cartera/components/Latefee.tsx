/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileText,
  Flame,
  HandCoins,
  Loader2,
  Pencil,
  Receipt,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
  TableBody,
} from "@/components/ui/table";
import { useMoras, useMorasMasivo } from "../hooks/useLateFee";
import { usePersistedState } from "../hooks/usePersistedState";
import {
  getCondonacionesMoraService,
  getCreditosWithMorasService,
} from "../services/services";
import type { EstadoCredito } from "../services/services";
import { getApiErrorMessage } from "@/lib/apiError";
import { fmtFechaGT } from "@/lib/fechaGT";
import {
  MESES,
  anioActualGT,
  diasDelMes,
  etiquetaRango,
  rangoDesdeSeleccion,
  recortarDiaAlMes,
  type ModoFecha,
} from "@/lib/periodoGT";
import { fmtQ } from "@/lib/moneda";
import { estadoCreditoStyle } from "@/lib/estadoCredito";
import { useAuth } from "@/Provider/authProvider";

// ─────────────────────────── Tarjetas de totales ───────────────────────────
// Los totales SIEMPRE vienen del backend (`totales` de cada endpoint) y están
// calculados sobre TODO el conjunto filtrado, no sobre la página que se ve.
// Sumar las filas de la tabla daría un número más chico y silenciosamente falso.

const ACENTOS = {
  blue: { icono: "bg-blue-100 text-blue-700", valor: "text-blue-800" },
  red: { icono: "bg-red-100 text-red-700", valor: "text-red-700" },
  green: { icono: "bg-green-100 text-green-700", valor: "text-green-700" },
  emerald: { icono: "bg-emerald-100 text-emerald-700", valor: "text-emerald-700" },
} as const;

function TarjetaTotal({
  icono: Icono,
  titulo,
  valor,
  nota,
  cargando,
  acento,
}: {
  icono: LucideIcon;
  titulo: string;
  valor: string;
  nota: string;
  cargando: boolean;
  acento: keyof typeof ACENTOS;
}) {
  const c = ACENTOS[acento];
  return (
    <div className="bg-white/80 backdrop-blur rounded-2xl shadow border border-blue-100 p-4 flex items-center gap-4 min-h-[92px]">
      <div className={`rounded-xl p-3 shrink-0 ${c.icono}`}>
        <Icono className="w-6 h-6" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
          {titulo}
        </p>
        {/* El esqueleto mide lo mismo que el número: al llegar el dato la
            tarjeta no cambia de alto y la pantalla no salta. */}
        {cargando ? (
          <div className="h-8 w-32 mt-0.5 rounded bg-blue-100 animate-pulse" />
        ) : (
          <p className={`text-2xl font-extrabold tabular-nums h-8 ${c.valor}`}>
            {valor}
          </p>
        )}
        <p className="text-[11px] text-gray-500 truncate" title={nota}>
          {nota}
        </p>
      </div>
    </div>
  );
}

// ───────────────────── Filtro de fecha de condonaciones ─────────────────────
// Dos modos que NO conviven a la vez, para que nunca haya duda de qué se está
// filtrando: "Período" (Año/Mes/Día) y "Rango" (Desde–Hasta). Cambiar de modo
// limpia el otro. En ambos casos lo único que viaja al backend es un par
// desde/hasta de DÍAS DE GUATEMALA (`YYYY-MM-DD`); el período solo es una forma
// cómoda de escribir ese par.

// El período (Año/Mes/Día → par desde/hasta) vive en `@/lib/periodoGT`: es la
// parte que puede producir una fecha que no existe (`2026-02-31`) y allá se
// prueba sin montar la pantalla.

const claseSelectFiltro =
  "w-full border border-blue-200 rounded-md bg-blue-50 text-gray-900 text-sm px-2 py-2";

/**
 * Bloque de fechas de la pestaña Condonaciones. No aplica nada por su cuenta:
 * lo aplica el botón Buscar de la barra, igual que el resto de filtros.
 */
function FiltrosFechaCondonaciones({
  modo,
  setModo,
  anio,
  setAnio,
  mes,
  setMes,
  dia,
  setDia,
  desde,
  setDesde,
  hasta,
  setHasta,
  onBuscar,
}: {
  modo: ModoFecha;
  setModo: (m: ModoFecha) => void;
  anio: string;
  setAnio: (v: string) => void;
  mes: string;
  setMes: (v: string) => void;
  dia: string;
  setDia: (v: string) => void;
  desde: string;
  setDesde: (v: string) => void;
  hasta: string;
  setHasta: (v: string) => void;
  onBuscar: () => void;
}) {
  // Una sola lectura del año en curso: dentro del Array.from se recalculaba
  // (con su Intl.DateTimeFormat) una vez por opción, en cada render.
  const anioBase = anioActualGT();
  const anios = Array.from({ length: 8 }, (_, i) => anioBase - i);
  const maxDia =
    anio && mes ? diasDelMes(Number(anio), Number(mes)) : 31;
  const seleccion = rangoDesdeSeleccion({ modo, anio, mes, dia, desde, hasta });
  const previa = etiquetaRango(seleccion.desde, seleccion.hasta);

  /**
   * Al cambiar año o mes hay que recortar el día: con 31 elegido en Enero y un
   * cambio a Febrero, el select se dibuja en blanco ("Todo el mes") pero el
   * estado sigue en "31" y se arma `2026-02-31`, una fecha que no existe.
   * Recortar al último día del mes nuevo mantiene la intención del usuario
   * (día 31 → día 28/29 de febrero) sin poder construir una fecha imposible.
   */
  const recortarDia = (nuevoAnio: string, nuevoMes: string) => {
    const recortado = recortarDiaAlMes(dia, nuevoAnio, nuevoMes);
    if (recortado !== dia) setDia(recortado);
  };

  return (
    <div className="w-full border-t border-blue-100 pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="text-sm font-semibold text-blue-800 mb-1 flex items-center gap-1">
            <CalendarDays className="w-4 h-4" /> Fecha de condonación (GT)
          </span>
          <div className="flex gap-1">
            {/* Un modo a la vez: elegir uno limpia el otro, así nunca hay dos
                criterios de fecha compitiendo. */}
            <Button
              type="button"
              size="sm"
              className={
                modo === "periodo"
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }
              onClick={() => {
                setModo("periodo");
                setDesde("");
                setHasta("");
              }}
            >
              Año / Mes / Día
            </Button>
            <Button
              type="button"
              size="sm"
              className={
                modo === "rango"
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }
              onClick={() => {
                setModo("rango");
                setAnio("");
                setMes("");
                setDia("");
              }}
            >
              Rango de fechas
            </Button>
          </div>
        </div>

        {modo === "periodo" ? (
          <>
            <div className="w-[120px]">
              <label className="text-xs font-semibold text-blue-800 mb-1 block">
                Año
              </label>
              <select
                className={claseSelectFiltro}
                value={anio}
                onChange={(e) => {
                  const nuevoAnio = e.target.value;
                  setAnio(nuevoAnio);
                  // Sin año no hay mes ni día que valgan.
                  if (!nuevoAnio) {
                    setMes("");
                    setDia("");
                    return;
                  }
                  // Bisiesto: 29 de febrero de 2024 al pasar a 2025 no existe.
                  recortarDia(nuevoAnio, mes);
                }}
              >
                <option value="">Todos</option>
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[150px]">
              <label className="text-xs font-semibold text-blue-800 mb-1 block">
                Mes
              </label>
              <select
                className={claseSelectFiltro}
                value={mes}
                disabled={!anio}
                onChange={(e) => {
                  const nuevoMes = e.target.value;
                  setMes(nuevoMes);
                  recortarDia(anio, nuevoMes);
                }}
              >
                <option value="">Todo el año</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[110px]">
              <label className="text-xs font-semibold text-blue-800 mb-1 block">
                Día
              </label>
              <select
                className={claseSelectFiltro}
                value={dia}
                disabled={!anio || !mes}
                onChange={(e) => setDia(e.target.value)}
              >
                <option value="">Todo el mes</option>
                {Array.from({ length: maxDia }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="w-[180px]">
              <label className="text-xs font-semibold text-blue-800 mb-1 block">
                Desde
              </label>
              <Input
                type="date"
                value={desde}
                max={hasta || undefined}
                onChange={(e) => setDesde(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onBuscar()}
                className="text-gray-900 border-blue-200 bg-blue-50"
              />
            </div>
            <div className="w-[180px]">
              <label className="text-xs font-semibold text-blue-800 mb-1 block">
                Hasta
              </label>
              <Input
                type="date"
                value={hasta}
                min={desde || undefined}
                onChange={(e) => setHasta(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onBuscar()}
                className="text-gray-900 border-blue-200 bg-blue-50"
              />
            </div>
          </>
        )}

        <p className="text-xs text-gray-600 pb-2">
          {previa
            ? `Se buscará ${previa} (hora de Guatemala). Presiona Buscar.`
            : "Sin filtro de fecha: se muestran todas las condonaciones."}
        </p>
      </div>
    </div>
  );
}

/**
 * Barra de filtros compartida por las dos pestañas.
 *
 * El filtro de cuotas atrasadas solo lo usa la pestaña "Créditos con mora":
 * se dibuja únicamente si quien monta la barra pasa el setter.
 */
function FiltrosBar({
  sifcoInput,
  setSifcoInput,
  nombreInput,
  setNombreInput,
  cuotasInput,
  setCuotasInput,
  onBuscar,
  onLimpiar,
  activos,
  fechas,
}: {
  sifcoInput: string;
  setSifcoInput: (v: string) => void;
  nombreInput: string;
  setNombreInput: (v: string) => void;
  cuotasInput?: string;
  setCuotasInput?: (v: string) => void;
  onBuscar: () => void;
  onLimpiar: () => void;
  activos: number;
  /** Bloque extra de filtros (fechas de condonaciones); ocupa su propia línea. */
  fechas?: ReactNode;
}) {
  return (
    <div className="bg-white/80 backdrop-blur rounded-2xl shadow border border-blue-100 p-4 mb-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[170px]">
          <label className="text-sm font-semibold text-blue-800 mb-1 block">
            No. Crédito SIFCO
          </label>
          <Input
            placeholder="Buscar SIFCO..."
            value={sifcoInput}
            onChange={(e) => setSifcoInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onBuscar()}
            className="text-gray-900 border-blue-200 bg-blue-50"
          />
        </div>
        <div className="flex-1 min-w-[170px]">
          <label className="text-sm font-semibold text-blue-800 mb-1 block">
            Cliente
          </label>
          <Input
            placeholder="Buscar nombre..."
            value={nombreInput}
            onChange={(e) => setNombreInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onBuscar()}
            className="text-gray-900 border-blue-200 bg-blue-50"
          />
        </div>
        {setCuotasInput && (
          <div className="w-[190px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">
              Cuotas atrasadas (mínimo)
            </label>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder="Ej: 3 o más"
              title="Muestra los créditos con esa cantidad de cuotas atrasadas o más. Vacío = sin filtro."
              value={cuotasInput ?? ""}
              // El input numérico deja escribir "-" y "e"; nos quedamos solo con
              // dígitos para no mandar basura (ni negativos) al backend.
              onChange={(e) =>
                setCuotasInput(e.target.value.replace(/[^\d]/g, ""))
              }
              onKeyDown={(e) => e.key === "Enter" && onBuscar()}
              className="text-gray-900 border-blue-200 bg-blue-50"
            />
          </div>
        )}
        {/* w-full: el bloque de fechas se queda con su propia línea y los
            botones bajan a la siguiente. */}
        {fechas}
        <Button
          variant="outline"
          size="sm"
          onClick={onBuscar}
          className="text-blue-700 border-blue-300 hover:bg-blue-50"
        >
          <Search className="w-4 h-4 mr-1" /> Buscar
        </Button>
        {activos > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onLimpiar}
            className="text-gray-600 border-gray-300 hover:bg-gray-100"
          >
            <X className="w-4 h-4 mr-1" /> Limpiar
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
              {activos}
            </Badge>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Paginación compartida por las dos pestañas.
 *
 * ⚠️ `page` es SIEMPRE el estado local, nunca el eco del servidor: con
 * `placeholderData` la respuesta va una petición atrasada, así que dos clics
 * seguidos en "siguiente" calculaban el mismo número y el segundo no hacía
 * nada. El servidor solo manda `totalPages`/`total`.
 */
function Paginacion({
  page,
  setPage,
  pageSize,
  setPageSize,
  totalPages,
  total,
  label,
}: {
  page: number;
  setPage: (n: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  totalPages: number;
  total: number;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
      <span className="text-sm text-gray-600">
        Página {page} de {totalPages || 1} ({total} {label})
      </span>
      <div className="flex items-center gap-2">
        <select
          className="border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          {[20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} por página
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          className="border-blue-200 text-blue-700"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= (totalPages || 1)}
          onClick={() => setPage(page + 1)}
          className="border-blue-200 text-blue-700"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Cartel de "los datos que estás viendo no son los del filtro que pediste".
 *
 * Con `placeholderData` React Query deja en pantalla la respuesta anterior
 * mientras trae la nueva, y `isLoading` se queda en false: sin este aviso, la
 * tabla y las tarjetas muestran los montos del filtro VIEJO bajo la leyenda del
 * filtro NUEVO. Una condonación decidida leyendo ese número sería sobre datos
 * que no corresponden.
 */
function AvisoDesactualizado({ que }: { que: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-600" />
      Actualizando {que} con los filtros nuevos. Lo que se ve abajo todavía
      corresponde a la búsqueda anterior.
    </div>
  );
}

export default function MorasManager() {
  const [tab, setTab] = usePersistedState<"creditos" | "condonaciones">(
    "moras:tab",
    "creditos"
  );

  // --- Filtros pestaña créditos ---
  const [sifcoInput, setSifcoInput] = useState("");
  const [nombreInput, setNombreInput] = useState("");
  const [cuotasInput, setCuotasInput] = useState("");
  const [sifco, setSifco] = usePersistedState("moras:creditos:sifco", "");
  const [nombre, setNombre] = usePersistedState("moras:creditos:nombre", "");
  // Mínimo de cuotas atrasadas: el backend filtra con `gte`. Se guarda como
  // string para distinguir "sin filtro" ("") de un 0 escrito a propósito.
  const [cuotasMin, setCuotasMin] = usePersistedState(
    "moras:creditos:cuotasMin",
    ""
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedState(
    "moras:creditos:pageSize",
    20
  );
  // 0 no filtra nada con `gte` (todo crédito tiene >= 0 cuotas atrasadas), así
  // que lo tratamos igual que "vacío": ni se manda ni cuenta como filtro activo.
  const cuotasMinNum =
    Number(cuotasMin) > 0 ? Number(cuotasMin) : undefined;

  // --- Filtros pestaña condonaciones ---
  const [cSifcoInput, setCSifcoInput] = useState("");
  const [cNombreInput, setCNombreInput] = useState("");
  const [cSifco, setCSifco] = usePersistedState("moras:cond:sifco", "");
  const [cNombre, setCNombre] = usePersistedState("moras:cond:nombre", "");
  const [cPage, setCPage] = useState(1);
  const [cPageSize, setCPageSize] = usePersistedState("moras:cond:pageSize", 20);

  // Fechas: lo que se está editando (borrador) vs lo aplicado.
  const [cModoInput, setCModoInput] = useState<ModoFecha>("periodo");
  const [cAnioInput, setCAnioInput] = useState("");
  const [cMesInput, setCMesInput] = useState("");
  const [cDiaInput, setCDiaInput] = useState("");
  const [cDesdeInput, setCDesdeInput] = useState("");
  const [cHastaInput, setCHastaInput] = useState("");
  // Aplicado. `cDesde`/`cHasta` son lo ÚNICO que viaja al backend (días GT);
  // el modo y el año/mes/día se persisten solo para rehidratar la barra.
  const [cModo, setCModo] = usePersistedState<ModoFecha>(
    "moras:cond:modoFecha",
    "periodo"
  );
  const [cAnio, setCAnio] = usePersistedState("moras:cond:anio", "");
  const [cMes, setCMes] = usePersistedState("moras:cond:mes", "");
  const [cDia, setCDia] = usePersistedState("moras:cond:dia", "");
  const [cDesde, setCDesde] = usePersistedState("moras:cond:desde", "");
  const [cHasta, setCHasta] = usePersistedState("moras:cond:hasta", "");

  const navigate = useNavigate();

  // Ir al historial de pagos del crédito para revisar las cuotas en atraso
  const irAPagos = (numero_credito_sifco: string) =>
    navigate(`/pagos/${numero_credito_sifco}`);

  // Se llega acá desde la ficha del crédito con /mora?sifco=XXXX
  const [searchParams] = useSearchParams();
  const sifcoUrl = searchParams.get("sifco");
  useEffect(() => {
    if (!sifcoUrl) return;
    setTab("creditos");
    setSifcoInput(sifcoUrl);
    setSifco(sifcoUrl);
    setNombreInput("");
    setNombre("");
    // Un mínimo de cuotas heredado de la visita anterior escondería justo el
    // crédito al que nos mandaron desde la ficha.
    setCuotasInput("");
    setCuotasMin("");
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sifcoUrl]);

  // Rehidrata los inputs con lo que quedó aplicado de la visita anterior
  useEffect(() => {
    if (!sifcoUrl) {
      // con ?sifco= el efecto anterior manda: no lo pisamos con lo persistido
      setSifcoInput(sifco);
      setNombreInput(nombre);
      setCuotasInput(cuotasMin);
    }
    setCSifcoInput(cSifco);
    setCNombreInput(cNombre);
    setCModoInput(cModo);
    setCAnioInput(cAnio);
    setCMesInput(cMes);
    setCDiaInput(cDia);
    // En modo período los inputs Desde/Hasta no se dibujan: rehidratarlos con
    // el rango derivado haría que al cambiar de modo apareciera un rango que el
    // usuario nunca escribió.
    setCDesdeInput(cModo === "rango" ? cDesde : "");
    setCHastaInput(cModo === "rango" ? cHasta : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modal condonación masiva
  const [openModalCondonacionMasiva, setOpenModalCondonacionMasiva] =
    useState(false);
  const [confirmandoMasiva, setConfirmandoMasiva] = useState(false);
  const [motivoMasivo, setMotivoMasivo] = useState("");

  // Modal condonación individual
  const [openModalCondonacion, setOpenModalCondonacion] = useState(false);
  const [condonacionCreditoId, setCondonacionCreditoId] = useState<
    number | null
  >(null);
  const [motivo, setMotivo] = useState("");
  const [montoMoraSeleccionada, setMontoMoraSeleccionada] = useState<
    number | null
  >(null);

  // Modal editar mora
  const [openModalMora, setOpenModalMora] = useState(false);
  const [editCreditoId, setEditCreditoId] = useState<number | null>(null);
  const [nuevoMonto, setNuevoMonto] = useState<number | undefined>();
  const [nuevasCuotas, setNuevasCuotas] = useState<number | undefined>();
  const [motivoEdicion, setMotivoEdicion] = useState("");
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [tipoCambio, setTipoCambio] = useState<"INCREMENTO" | "DECREMENTO">(
    "INCREMENTO"
  );

  const {
    creditosMora,
    condonaciones,
    loadingCreditos,
    loadingCondonaciones,
    fetchingCreditos,
    fetchingCondonaciones,
    creditosDesactualizados,
    condonacionesDesactualizadas,
    errorCreditos,
    errorCondonaciones,
    condonarMora,
    updateMora,
  } = useMoras({
    // Solo se pide el listado de la pestaña visible: cada uno son 2 consultas
    // (filas + totales) y traer los dos siempre duplicaba la carga a la base.
    enabledCreditos: tab === "creditos",
    enabledCondonaciones: tab === "condonaciones",
    creditos: {
      estado: "MOROSO" as EstadoCredito,
      page,
      pageSize,
      numero_credito_sifco: sifco || undefined,
      nombre_usuario: nombre || undefined,
      cuotas_atrasadas: cuotasMinNum,
    },
    condonaciones: {
      page: cPage,
      pageSize: cPageSize,
      numero_credito_sifco: cSifco || undefined,
      nombre_usuario: cNombre || undefined,
      // Días de Guatemala `YYYY-MM-DD`; el backend los convierte a los
      // instantes UTC del día (la columna guarda UTC).
      fecha_desde: cDesde || undefined,
      fecha_hasta: cHasta || undefined,
    },
  });
  const { condonarMorasMasivo } = useMorasMasivo();

  // Totales GLOBALES de morosos: la condonación masiva del backend ignora los
  // filtros de pantalla, así que el diálogo debe mostrar el universo completo.
  const globalMorosos = useQuery({
    queryKey: ["creditosMora", "globalMorosos"],
    queryFn: () =>
      getCreditosWithMorasService({
        estado: "MOROSO" as EstadoCredito,
        page: 1,
        pageSize: 1,
      }),
    enabled: openModalCondonacionMasiva,
    refetchOnWindowFocus: false,
  });

  const { user } = useAuth();
  const queryClient = useQueryClient();

  const creditosRows = creditosMora?.data ?? [];
  const creditosPag = creditosMora?.pagination;
  const condRows = condonaciones?.data ?? [];
  const condPag = condonaciones?.pagination;

  // Quedarse fuera de rango es un callejón sin salida: si estabas en la página
  // 2 con un solo crédito y lo condonás, el refetch devuelve vacío y no hay
  // forma de volver. Al recortar la página, el propio cambio de estado dispara
  // la consulta de la página válida.
  const totalPagesCreditos = creditosPag?.totalPages;
  useEffect(() => {
    if (totalPagesCreditos == null) return;
    const ultima = Math.max(totalPagesCreditos, 1);
    if (page > ultima) setPage(ultima);
  }, [totalPagesCreditos, page]);

  const totalPagesCond = condPag?.totalPages;
  useEffect(() => {
    if (totalPagesCond == null) return;
    const ultima = Math.max(totalPagesCond, 1);
    if (cPage > ultima) setCPage(ultima);
  }, [totalPagesCond, cPage]);

  const filtrosCreditos =
    (sifco ? 1 : 0) + (nombre ? 1 : 0) + (cuotasMinNum ? 1 : 0);
  const filtrosCond =
    (cSifco ? 1 : 0) + (cNombre ? 1 : 0) + (cDesde ? 1 : 0) + (cHasta ? 1 : 0);
  const rangoCondAplicado = etiquetaRango(cDesde, cHasta);

  const aplicarCreditos = () => {
    setSifco(sifcoInput.trim());
    setNombre(nombreInput.trim());
    setCuotasMin(cuotasInput.trim());
    setPage(1);
  };
  const limpiarCreditos = () => {
    setSifcoInput("");
    setNombreInput("");
    setCuotasInput("");
    setSifco("");
    setNombre("");
    setCuotasMin("");
    setPage(1);
  };
  const aplicarCond = () => {
    setCSifco(cSifcoInput.trim());
    setCNombre(cNombreInput.trim());
    const { desde, hasta } = rangoDesdeSeleccion({
      modo: cModoInput,
      anio: cAnioInput,
      mes: cMesInput,
      dia: cDiaInput,
      desde: cDesdeInput,
      hasta: cHastaInput,
    });
    setCModo(cModoInput);
    setCAnio(cAnioInput);
    setCMes(cMesInput);
    setCDia(cDiaInput);
    setCDesde(desde);
    setCHasta(hasta);
    setCPage(1);
  };
  const limpiarCond = () => {
    setCSifcoInput("");
    setCNombreInput("");
    setCSifco("");
    setCNombre("");
    setCModoInput("periodo");
    setCAnioInput("");
    setCMesInput("");
    setCDiaInput("");
    setCDesdeInput("");
    setCHastaInput("");
    setCModo("periodo");
    setCAnio("");
    setCMes("");
    setCDia("");
    setCDesde("");
    setCHasta("");
    setCPage(1);
  };

  // --- Descarga de Excel ---
  // El backend genera el archivo con TODAS las filas que cumplen los filtros
  // (ignora page/pageSize), lo sube a R2 y devuelve la URL.
  const [exportandoCreditos, setExportandoCreditos] = useState(false);
  const [exportandoCond, setExportandoCond] = useState(false);
  // URL del último Excel que el bloqueador de emergentes no dejó abrir: se
  // muestra como enlace en pantalla para que el archivo no se pierda.
  const [excelBloqueado, setExcelBloqueado] = useState<{
    url: string;
    que: string;
  } | null>(null);

  /**
   * Las dos pestañas descargan igual: pedir la URL y abrirla.
   *
   * `window.open` corre DESPUÉS del await, o sea fuera del gesto del usuario:
   * el bloqueador de emergentes lo cancela devolviendo null, sin excepción ni
   * aviso, y el botón simplemente volvía a su estado normal. Detectamos ese
   * null y ofrecemos el enlace (toast con acción + enlace fijo en pantalla).
   */
  const descargarExcel = async (opts: {
    que: string;
    setExportando: (v: boolean) => void;
    pedirUrl: () => Promise<{ success?: boolean; excelUrl?: string }>;
  }) => {
    opts.setExportando(true);
    setExcelBloqueado(null);
    try {
      const res = await opts.pedirUrl();
      if (!res.success || !res.excelUrl) {
        toast.error(`No se pudo generar el Excel de ${opts.que}`);
        return;
      }
      const ventana = window.open(res.excelUrl, "_blank", "noopener");
      if (ventana) return;

      const url = res.excelUrl;
      setExcelBloqueado({ url, que: opts.que });
      toast.warning("El navegador bloqueó la ventana de descarga", {
        description: `El Excel de ${opts.que} ya está listo. Abrilo desde el enlace.`,
        duration: 15000,
        action: {
          label: "Abrir Excel",
          // Este click SÍ es un gesto del usuario: el bloqueador no lo frena.
          onClick: () => window.open(url, "_blank", "noopener"),
        },
      });
    } catch (err: any) {
      toast.error(`No se pudo generar el Excel de ${opts.que}`, {
        description: getApiErrorMessage(err, "Error desconocido"),
      });
    } finally {
      opts.setExportando(false);
    }
  };

  const descargarExcelCreditos = () =>
    descargarExcel({
      que: "créditos con mora",
      setExportando: setExportandoCreditos,
      pedirUrl: () =>
        getCreditosWithMorasService({
          estado: "MOROSO" as EstadoCredito,
          numero_credito_sifco: sifco || undefined,
          nombre_usuario: nombre || undefined,
          cuotas_atrasadas: cuotasMinNum,
          excel: true,
        }),
    });

  const descargarExcelCondonaciones = () =>
    descargarExcel({
      que: "condonaciones",
      setExportando: setExportandoCond,
      pedirUrl: () =>
        getCondonacionesMoraService({
          numero_credito_sifco: cSifco || undefined,
          nombre_usuario: cNombre || undefined,
          fecha_desde: cDesde || undefined,
          fecha_hasta: cHasta || undefined,
          excel: true,
        }),
    });

  // --- Condonación Masiva ---
  const abrirCondonacionMasiva = () => {
    setMotivoMasivo("");
    setConfirmandoMasiva(false);
    setOpenModalCondonacionMasiva(true);
  };

  const irAConfirmacionMasiva = () => {
    if (!motivoMasivo.trim()) {
      toast.error("Debes ingresar un motivo para la condonación masiva");
      return;
    }
    if (!user?.email) {
      toast.error("No se pudo obtener el email del usuario");
      return;
    }
    setConfirmandoMasiva(true);
  };

  const confirmCondonacionMasiva = () => {
    if (!user?.email) return;

    condonarMorasMasivo.mutate(
      {
        motivo: motivoMasivo.trim(),
        usuario_email: user.email,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["creditosMora"] });
          queryClient.invalidateQueries({ queryKey: ["condonacionesMora"] });
          setOpenModalCondonacionMasiva(false);
          setConfirmandoMasiva(false);
          setMotivoMasivo("");
        },
        onError: (err: any) => {
          toast.error("No se pudo condonar moras", {
            description: getApiErrorMessage(err, "Error desconocido"),
          });
        },
      }
    );
  };

  // --- Condonación Individual ---
  const handleCondonar = (credito_id: number, monto_mora: number) => {
    setCondonacionCreditoId(credito_id);
    setMontoMoraSeleccionada(monto_mora);
    setMotivo("");
    setOpenModalCondonacion(true);
  };

  const confirmCondonacion = () => {
    if (!condonacionCreditoId || !motivo.trim() || !user?.email) {
      toast.error("Completa todos los campos antes de condonar");
      return;
    }
    condonarMora.mutate(
      {
        credito_id: condonacionCreditoId,
        motivo: motivo.trim(),
        usuario_email: user.email,
      },
      {
        onSuccess: () => {
          toast.success("Mora condonada exitosamente");
          setOpenModalCondonacion(false);
          setMotivo("");
          setMontoMoraSeleccionada(null);
        },
        onError: (err: any) =>
          toast.error("No se pudo condonar mora", {
            description: getApiErrorMessage(err, "Error desconocido"),
          }),
      }
    );
  };

  // --- Editar Mora ---
  const handleEditarMora = (
    credito_id: number,
    monto: number,
    cuotas: number
  ) => {
    setEditCreditoId(credito_id);
    setNuevoMonto(undefined);
    setMontoMoraSeleccionada(monto);
    setNuevasCuotas(cuotas);
    setTipoCambio("INCREMENTO");
    setMotivoEdicion("");
    setErrorEdicion(null);
    setOpenModalMora(true);
  };

  const confirmGuardarMora = () => {
    setErrorEdicion(null);

    // 0 es un valor legítimo (el backend acepta monto_cambio >= 0 y no exige
    // cuotas >= 1): "vacío" es undefined/NaN, no cero. Con `!valor` no se podía
    // dejar la mora ni las cuotas atrasadas en 0.
    const faltaMonto = nuevoMonto === undefined || Number.isNaN(nuevoMonto);
    const faltanCuotas = nuevasCuotas === undefined || Number.isNaN(nuevasCuotas);
    if (faltaMonto || faltanCuotas) {
      setErrorEdicion("Debes ingresar monto y cuotas");
      return;
    }
    if (nuevoMonto < 0 || nuevasCuotas < 0) {
      setErrorEdicion("El monto y las cuotas no pueden ser negativos");
      return;
    }
    if (!motivoEdicion.trim()) {
      setErrorEdicion("El motivo es obligatorio");
      return;
    }
    if (!editCreditoId) return;

    updateMora.mutate(
      {
        credito_id: editCreditoId,
        monto_cambio: nuevoMonto,
        tipo: tipoCambio,
        cuotas_atrasadas: nuevasCuotas,
        motivo: motivoEdicion.trim(),
      },
      {
        onSuccess: () => {
          toast.success("Mora actualizada exitosamente");
          setOpenModalMora(false);
          setNuevoMonto(undefined);
          setNuevasCuotas(undefined);
          setMotivoEdicion("");
          setEditCreditoId(null);
        },
        onError: (err: any) => {
          // El backend rechaza con 400 si falta el motivo: mostramos su mensaje.
          setErrorEdicion(getApiErrorMessage(err, "No se pudo actualizar mora"));
        },
      }
    );
  };

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 overflow-auto bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 pt-8 pb-8">
      <div className="w-full max-w-[1400px] mx-auto">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-extrabold text-blue-700 text-center">
            Gestión de Moras
          </h1>
          <p className="text-gray-600 mt-2 text-center text-sm">
            Créditos morosos y condonaciones. Busca por número de crédito SIFCO
            o por nombre de cliente.
          </p>
        </div>

        {/* Condonación masiva */}
        <div className="mb-4">
          <Button
            onClick={abrirCondonacionMasiva}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3"
          >
            <Flame className="w-4 h-4 mr-2" />
            Condonar Todas las Moras (Masivo)
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <Button
            type="button"
            size="sm"
            className={
              tab === "creditos"
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }
            onClick={() => setTab("creditos")}
          >
            Créditos con Mora
          </Button>
          <Button
            type="button"
            size="sm"
            className={
              tab === "condonaciones"
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }
            onClick={() => setTab("condonaciones")}
          >
            Condonaciones
          </Button>
        </div>

        {/* El Excel se generó pero el bloqueador de emergentes tapó la ventana:
            el enlace queda a la vista para que el archivo no se pierda. */}
        {excelBloqueado && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <FileDown className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              El navegador bloqueó la ventana de descarga. El Excel de{" "}
              <b>{excelBloqueado.que}</b> ya está listo:
            </span>
            <a
              href={excelBloqueado.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-blue-700 underline underline-offset-2 hover:text-blue-900"
            >
              abrir Excel
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExcelBloqueado(null)}
              className="ml-auto border-amber-300 text-amber-900 hover:bg-amber-100"
            >
              <X className="w-4 h-4 mr-1" /> Descartar
            </Button>
          </div>
        )}

        {/* ---------- Créditos con mora ---------- */}
        {tab === "creditos" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <TarjetaTotal
                icono={FileText}
                titulo="Total de créditos"
                valor={(
                  creditosMora?.totales?.creditos ??
                  creditosPag?.total ??
                  0
                ).toLocaleString("es-GT")}
                nota={
                  filtrosCreditos > 0
                    ? "Total de los créditos filtrados"
                    : "Todos los créditos en estado MOROSO"
                }
                // Mientras lo que hay en caché es de OTRO filtro se muestra el
                // esqueleto: un número que no corresponde a la leyenda de abajo
                // es peor que no mostrar número.
                cargando={loadingCreditos || creditosDesactualizados}
                acento="blue"
              />
              <TarjetaTotal
                icono={AlertTriangle}
                titulo="Monto total de mora"
                valor={fmtQ(creditosMora?.totales?.mora_total)}
                nota={
                  filtrosCreditos > 0
                    ? "Suma de la mora de los créditos filtrados"
                    : "Suma de la mora de todos los créditos morosos"
                }
                cargando={loadingCreditos || creditosDesactualizados}
                acento="red"
              />
            </div>

            <FiltrosBar
              sifcoInput={sifcoInput}
              setSifcoInput={setSifcoInput}
              nombreInput={nombreInput}
              setNombreInput={setNombreInput}
              cuotasInput={cuotasInput}
              setCuotasInput={setCuotasInput}
              onBuscar={aplicarCreditos}
              onLimpiar={limpiarCreditos}
              activos={filtrosCreditos}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              {/* El conteo y la mora total viven en las tarjetas de arriba. */}
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                Créditos Morosos
                {/* Refetch de los MISMOS filtros (p. ej. después de condonar):
                    no hay datos de otro filtro en pantalla, pero lo que se ve
                    todavía es lo de antes de la operación. */}
                {fetchingCreditos && !creditosDesactualizados && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    actualizando...
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={descargarExcelCreditos}
                  disabled={exportandoCreditos || !creditosPag?.total}
                  className="text-green-700 border-green-300 hover:bg-green-50"
                >
                  {exportandoCreditos ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4 mr-1" />
                  )}
                  {exportandoCreditos ? "Generando..." : "Descargar Excel"}
                </Button>
              </div>
            </div>

            {creditosDesactualizados && (
              <AvisoDesactualizado que="los créditos con mora" />
            )}

            {/* Atenuado y sin clics mientras lo de adentro es de la búsqueda
                anterior, para que nadie condone leyendo la fila equivocada. */}
            <div
              className={
                creditosDesactualizados
                  ? "opacity-40 pointer-events-none transition-opacity"
                  : "transition-opacity"
              }
            >
            {loadingCreditos ? (
              <div className="flex items-center justify-center gap-2 py-16 text-blue-500 font-semibold">
                <Loader2 className="h-5 w-5 animate-spin" /> Cargando créditos...
              </div>
            ) : errorCreditos ? (
              <div className="text-center py-16 text-red-500 font-semibold">
                Error al cargar los créditos con mora
              </div>
            ) : !creditosRows.length ? (
              <div className="text-center py-16 text-gray-400 font-semibold">
                No hay créditos con mora para los filtros seleccionados
              </div>
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden md:block bg-white rounded-2xl shadow border border-blue-100 overflow-x-auto">
                  <Table className="w-full">
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="font-bold text-blue-800">
                          ID
                        </TableHead>
                        <TableHead className="font-bold text-blue-800">
                          Crédito SIFCO
                        </TableHead>
                        <TableHead className="font-bold text-blue-800">
                          Cliente
                        </TableHead>
                        <TableHead className="font-bold text-blue-800 text-center">
                          Estado
                        </TableHead>
                        <TableHead className="font-bold text-blue-800 text-right">
                          Monto Mora
                        </TableHead>
                        <TableHead className="font-bold text-blue-800 text-center">
                          Cuotas Atrasadas
                        </TableHead>
                        <TableHead className="font-bold text-blue-800 text-center">
                          Acciones
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {creditosRows.map((c: any) => (
                        <TableRow
                          key={c.credito_id}
                          className="text-gray-800 hover:bg-blue-50/40 transition"
                        >
                          <TableCell className="text-gray-500">
                            {c.credito_id}
                          </TableCell>
                          <TableCell className="font-semibold text-blue-700">
                            {c.numero_credito_sifco}
                          </TableCell>
                          <TableCell>{c.usuario}</TableCell>
                          <TableCell className="text-center">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${estadoCreditoStyle(
                                c.estado
                              )}`}
                            >
                              {c.estado}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-red-700 tabular-nums">
                            {fmtQ(c.monto_mora)}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {c.cuotas_atrasadas}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="px-2 whitespace-nowrap text-blue-700 border-blue-300 hover:bg-blue-50"
                                title="Ver pagos y cuotas en atraso de este crédito"
                                onClick={() =>
                                  irAPagos(c.numero_credito_sifco)
                                }
                              >
                                <Receipt className="w-4 h-4 mr-1" /> Pagos
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="px-2 whitespace-nowrap text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                                onClick={() =>
                                  handleEditarMora(
                                    c.credito_id,
                                    Number(c.monto_mora),
                                    c.cuotas_atrasadas
                                  )
                                }
                              >
                                <Pencil className="w-4 h-4 mr-1" /> Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="px-2 whitespace-nowrap text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() =>
                                  handleCondonar(
                                    c.credito_id,
                                    Number(c.monto_mora)
                                  )
                                }
                              >
                                <ShieldCheck className="w-4 h-4 mr-1" /> Condonar
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile */}
                <div className="md:hidden space-y-3">
                  {creditosRows.map((c: any) => (
                    <div
                      key={c.credito_id}
                      className="border border-blue-100 rounded-xl p-3 shadow-sm bg-white text-gray-800"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-blue-700">
                          SIFCO {c.numero_credito_sifco}
                        </p>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${estadoCreditoStyle(
                            c.estado
                          )}`}
                        >
                          {c.estado}
                        </span>
                      </div>
                      <p className="text-xs mt-1">{c.usuario}</p>
                      <p className="text-xs tabular-nums">
                        Mora:{" "}
                        <span className="font-semibold text-red-700">
                          {fmtQ(c.monto_mora)}
                        </span>
                      </p>
                      <p className="text-xs tabular-nums">
                        Cuotas atrasadas: {c.cuotas_atrasadas}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full mt-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                        title="Ver pagos y cuotas en atraso de este crédito"
                        onClick={() => irAPagos(c.numero_credito_sifco)}
                      >
                        <Receipt className="w-4 h-4 mr-1" /> Ver pagos
                      </Button>
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                          onClick={() =>
                            handleEditarMora(
                              c.credito_id,
                              Number(c.monto_mora),
                              c.cuotas_atrasadas
                            )
                          }
                        >
                          <Pencil className="w-4 h-4 mr-1" /> Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-green-700 border-green-300 hover:bg-green-50"
                          onClick={() =>
                            handleCondonar(c.credito_id, Number(c.monto_mora))
                          }
                        >
                          <ShieldCheck className="w-4 h-4 mr-1" /> Condonar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

              </>
            )}
            </div>

            {/* Fuera de la rama "hay filas": si la última fila de la página se
                condona, la lista queda vacía pero la paginación tiene que
                seguir ahí para poder volver. */}
            {!loadingCreditos && !errorCreditos && (
              <Paginacion
                page={page}
                setPage={setPage}
                pageSize={pageSize}
                setPageSize={setPageSize}
                totalPages={creditosPag?.totalPages ?? 1}
                total={creditosPag?.total ?? 0}
                label="créditos"
              />
            )}
          </>
        )}

        {/* ---------- Condonaciones ---------- */}
        {tab === "condonaciones" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <TarjetaTotal
                icono={ShieldCheck}
                titulo="Total de condonaciones"
                valor={(
                  condonaciones?.totales?.condonaciones ??
                  condPag?.total ??
                  0
                ).toLocaleString("es-GT")}
                nota={
                  filtrosCond > 0
                    ? `Total de lo filtrado${
                        rangoCondAplicado ? ` · ${rangoCondAplicado}` : ""
                      }`
                    : "Todas las condonaciones registradas"
                }
                cargando={loadingCondonaciones || condonacionesDesactualizadas}
                acento="green"
              />
              <TarjetaTotal
                icono={HandCoins}
                titulo="Monto total condonado"
                valor={fmtQ(condonaciones?.totales?.monto_total)}
                nota={
                  filtrosCond > 0
                    ? `Suma de lo filtrado${
                        rangoCondAplicado ? ` · ${rangoCondAplicado}` : ""
                      }`
                    : "Suma de todas las condonaciones"
                }
                cargando={loadingCondonaciones || condonacionesDesactualizadas}
                acento="emerald"
              />
            </div>

            <FiltrosBar
              sifcoInput={cSifcoInput}
              setSifcoInput={setCSifcoInput}
              nombreInput={cNombreInput}
              setNombreInput={setCNombreInput}
              onBuscar={aplicarCond}
              onLimpiar={limpiarCond}
              activos={filtrosCond}
              fechas={
                <FiltrosFechaCondonaciones
                  modo={cModoInput}
                  setModo={setCModoInput}
                  anio={cAnioInput}
                  setAnio={setCAnioInput}
                  mes={cMesInput}
                  setMes={setCMesInput}
                  dia={cDiaInput}
                  setDia={setCDiaInput}
                  desde={cDesdeInput}
                  setDesde={setCDesdeInput}
                  hasta={cHastaInput}
                  setHasta={setCHastaInput}
                  onBuscar={aplicarCond}
                />
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              {/* El conteo y el monto condonado viven en las tarjetas de arriba. */}
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                Historial de Condonaciones
                {fetchingCondonaciones && !condonacionesDesactualizadas && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    actualizando...
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={descargarExcelCondonaciones}
                  disabled={exportandoCond || !condPag?.total}
                  className="text-green-700 border-green-300 hover:bg-green-50"
                >
                  {exportandoCond ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4 mr-1" />
                  )}
                  {exportandoCond ? "Generando..." : "Descargar Excel"}
                </Button>
              </div>
            </div>

            {condonacionesDesactualizadas && (
              <AvisoDesactualizado que="las condonaciones" />
            )}

            <div
              className={
                condonacionesDesactualizadas
                  ? "opacity-40 pointer-events-none transition-opacity"
                  : "transition-opacity"
              }
            >
            {loadingCondonaciones ? (
              <div className="flex items-center justify-center gap-2 py-16 text-blue-500 font-semibold">
                <Loader2 className="h-5 w-5 animate-spin" /> Cargando
                condonaciones...
              </div>
            ) : errorCondonaciones ? (
              <div className="text-center py-16 text-red-500 font-semibold">
                Error al cargar las condonaciones
              </div>
            ) : !condRows.length ? (
              <div className="text-center py-16 text-gray-400 font-semibold">
                No hay condonaciones para los filtros seleccionados
              </div>
            ) : (
              <>
                <div className="hidden md:block bg-white rounded-2xl shadow border border-blue-100 overflow-x-auto">
                  <Table className="w-full">
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="font-bold text-blue-800">
                          ID
                        </TableHead>
                        <TableHead className="font-bold text-blue-800">
                          Crédito SIFCO
                        </TableHead>
                        <TableHead className="font-bold text-blue-800">
                          Cliente
                        </TableHead>
                        <TableHead className="font-bold text-blue-800">
                          Motivo
                        </TableHead>
                        <TableHead className="font-bold text-blue-800 text-right">
                          Monto
                        </TableHead>
                        <TableHead
                          className="font-bold text-blue-800 text-center"
                          title="Hora de Guatemala (GMT-6)"
                        >
                          Fecha (GT)
                        </TableHead>
                        <TableHead className="font-bold text-blue-800">
                          Condonó
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {condRows.map((c: any) => (
                        <TableRow
                          key={c.condonacion_id}
                          className="text-gray-800 hover:bg-blue-50/40 transition"
                        >
                          <TableCell className="text-gray-500">
                            {c.condonacion_id}
                          </TableCell>
                          <TableCell className="font-semibold text-blue-700">
                            {c.numero_credito_sifco}
                          </TableCell>
                          <TableCell>{c.usuario}</TableCell>
                          <TableCell
                            className="max-w-[300px] truncate text-gray-600"
                            title={c.motivo}
                          >
                            {c.motivo}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-green-700 tabular-nums">
                            {fmtQ(c.montoCondonacion)}
                          </TableCell>
                          <TableCell className="text-center text-sm text-gray-600">
                            {fmtFechaGT(c.fecha)}
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">
                            {c.usuario_email}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile */}
                <div className="md:hidden space-y-3">
                  {condRows.map((c: any) => (
                    <div
                      key={c.condonacion_id}
                      className="border border-blue-100 rounded-xl p-3 shadow-sm bg-white text-gray-800"
                    >
                      <p className="text-sm font-semibold text-blue-700">
                        SIFCO {c.numero_credito_sifco}
                      </p>
                      <p className="text-xs mt-1">{c.usuario}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        <span className="font-semibold">Motivo:</span>{" "}
                        {c.motivo}
                      </p>
                      <p className="text-xs font-semibold text-green-700 tabular-nums">
                        {fmtQ(c.montoCondonacion)}
                      </p>
                      <p className="text-xs" title="Hora de Guatemala (GMT-6)">
                        {fmtFechaGT(c.fecha)} · {c.usuario_email}
                      </p>
                    </div>
                  ))}
                </div>

              </>
            )}
            </div>

            {!loadingCondonaciones && !errorCondonaciones && (
              <Paginacion
                page={cPage}
                setPage={setCPage}
                pageSize={cPageSize}
                setPageSize={setCPageSize}
                totalPages={condPag?.totalPages ?? 1}
                total={condPag?.total ?? 0}
                label="condonaciones"
              />
            )}
          </>
        )}
      </div>

      {/* ---------- Dialog: Condonación Masiva ---------- */}
      <Dialog
        open={openModalCondonacionMasiva}
        onOpenChange={(o) => {
          if (condonarMorasMasivo.isPending) return;
          setOpenModalCondonacionMasiva(o);
          if (!o) {
            setConfirmandoMasiva(false);
            setMotivoMasivo("");
          }
        }}
      >
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <AlertTriangle className="w-5 h-5" />
              Condonación Masiva de Moras
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Esta acción condona la mora de <b>TODOS</b> los créditos en estado
              MOROSO. <b>No respeta los filtros de esta pantalla.</b>
            </DialogDescription>
          </DialogHeader>

          {!confirmandoMasiva ? (
            <div className="flex flex-col gap-3 text-gray-800">
              <div>
                <Label htmlFor="motivoMasivo">
                  Motivo de condonación masiva
                </Label>
                <Input
                  id="motivoMasivo"
                  value={motivoMasivo}
                  onChange={(e) => setMotivoMasivo(e.target.value)}
                  placeholder="Ej: Condonación fin de año..."
                />
              </div>
              <p className="text-sm text-gray-600">
                Se registrará con el usuario:{" "}
                <span className="font-semibold">{user?.email}</span>
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-gray-800">
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                {globalMorosos.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-orange-700">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculando
                    alcance...
                  </div>
                ) : globalMorosos.isError ? (
                  <p className="text-sm text-red-600">
                    No se pudo calcular el alcance global de la condonación.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-orange-800">
                      Se condonará la mora de
                    </p>
                    <p className="text-2xl font-extrabold text-orange-700 tabular-nums">
                      {globalMorosos.data?.pagination?.total ?? 0} créditos
                    </p>
                    <p className="text-sm text-orange-800 mt-1">
                      por un total de{" "}
                      <span className="font-bold tabular-nums">
                        {fmtQ(globalMorosos.data?.totales?.mora_total)}
                      </span>
                    </p>
                  </>
                )}
              </div>
              <p className="text-xs text-gray-600">
                Motivo: <span className="font-semibold">{motivoMasivo}</span>
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
              disabled={condonarMorasMasivo.isPending}
              onClick={() => {
                if (confirmandoMasiva) {
                  setConfirmandoMasiva(false);
                } else {
                  setOpenModalCondonacionMasiva(false);
                  setMotivoMasivo("");
                }
              }}
            >
              {confirmandoMasiva ? "Regresar" : "Cancelar"}
            </Button>
            {!confirmandoMasiva ? (
              <Button
                onClick={irAConfirmacionMasiva}
                className="bg-orange-600 hover:bg-orange-700"
              >
                Continuar
              </Button>
            ) : (
              <Button
                onClick={confirmCondonacionMasiva}
                className="bg-orange-600 hover:bg-orange-700"
                disabled={
                  condonarMorasMasivo.isPending || globalMorosos.isLoading
                }
              >
                {condonarMorasMasivo.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Confirmar Condonación
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog: Condonación Individual ---------- */}
      <Dialog
        open={openModalCondonacion}
        onOpenChange={(o) => {
          if (condonarMora.isPending) return;
          setOpenModalCondonacion(o);
          if (!o) {
            setMotivo("");
            setMontoMoraSeleccionada(null);
          }
        }}
      >
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <ShieldCheck className="w-5 h-5" />
              Condonar Mora Individual
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Crédito <b>#{condonacionCreditoId}</b> · Monto de mora{" "}
              <b className="text-red-600 tabular-nums">
                {fmtQ(montoMoraSeleccionada)}
              </b>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-gray-800">
            <div>
              <Label htmlFor="motivo">Motivo de condonación</Label>
              <Input
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: Cliente con dificultades económicas..."
              />
            </div>
            <p className="text-sm text-gray-600">
              Se registrará con el usuario:{" "}
              <span className="font-semibold">{user?.email}</span>
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
              disabled={condonarMora.isPending}
              onClick={() => {
                setOpenModalCondonacion(false);
                setMotivo("");
                setMontoMoraSeleccionada(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmCondonacion}
              className="bg-green-600 hover:bg-green-700"
              disabled={condonarMora.isPending}
            >
              {condonarMora.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Confirmar Condonación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog: Editar Mora ---------- */}
      <Dialog
        open={openModalMora}
        onOpenChange={(o) => {
          if (updateMora.isPending) return;
          setOpenModalMora(o);
          if (!o) setErrorEdicion(null);
        }}
      >
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-700">
              <Pencil className="w-5 h-5" />
              Editar Mora
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Crédito <b>#{editCreditoId}</b>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-gray-800">
            <div>
              <Label className="mb-1 block">Tipo de cambio</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className={`flex-1 ${
                    tipoCambio === "INCREMENTO"
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                  onClick={() => setTipoCambio("INCREMENTO")}
                >
                  Incremento
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={`flex-1 ${
                    tipoCambio === "DECREMENTO"
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                  onClick={() => setTipoCambio("DECREMENTO")}
                >
                  Decremento
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="montoActual">Monto Actual</Label>
              <Input
                id="montoActual"
                type="number"
                className="tabular-nums"
                value={montoMoraSeleccionada ?? ""}
                disabled
              />
            </div>
            <div>
              <Label htmlFor="montoCambio">
                {tipoCambio === "INCREMENTO"
                  ? "Monto a incrementar"
                  : "Monto a disminuir"}
              </Label>
              <Input
                id="montoCambio"
                type="number"
                className="tabular-nums"
                min={0}
                value={nuevoMonto ?? ""}
                // `Number("")` es 0: sin este guard, borrar el campo mandaba un
                // 0 explícito en vez de dejarlo vacío, y ya no se distinguía de
                // un 0 escrito a propósito.
                onChange={(e) =>
                  setNuevoMonto(
                    e.target.value === "" ? undefined : Number(e.target.value)
                  )
                }
              />
            </div>
            <div>
              <Label htmlFor="cuotas">Cuotas Atrasadas</Label>
              <Input
                id="cuotas"
                type="number"
                className="tabular-nums"
                min={0}
                step={1}
                value={nuevasCuotas ?? ""}
                onChange={(e) =>
                  setNuevasCuotas(
                    e.target.value === "" ? undefined : Number(e.target.value)
                  )
                }
              />
            </div>
            <div>
              <Label htmlFor="motivoEdicion">
                Motivo <span className="text-red-600">*</span>
              </Label>
              <Input
                id="motivoEdicion"
                value={motivoEdicion}
                onChange={(e) => {
                  setMotivoEdicion(e.target.value);
                  setErrorEdicion(null);
                }}
                placeholder="Ej: Ajuste por acuerdo con el cliente..."
              />
            </div>

            {errorEdicion && (
              <p className="text-sm text-red-600 flex items-start gap-1">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {errorEdicion}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
              disabled={updateMora.isPending}
              onClick={() => setOpenModalMora(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmGuardarMora}
              disabled={updateMora.isPending || !motivoEdicion.trim()}
            >
              {updateMora.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

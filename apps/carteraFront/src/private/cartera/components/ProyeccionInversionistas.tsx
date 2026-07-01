import { useState, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, ChevronsUpDown, Loader2, Search, TrendingUp, X } from "lucide-react";
import { Combobox, Transition } from "@headlessui/react";
import { getInvestors, type InvestorResponse, type CreditoSimulado, type DesgloseMes } from "../services/services";
import { useSimulacionInversionista } from "../hooks/useSimulacionInversionista";
import { useQuery } from "@tanstack/react-query";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function formatQ(val: string | number | null | undefined, moneda?: string | null): string {
  const n = Number(val ?? 0);
  if (isNaN(n)) return "Q 0.00";
  const sym = moneda === "dolares" ? "$" : "Q";
  return `${sym} ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMesLabel(mesKey: string): string {
  // UTC para ser consistente con el formateo de fechas de cuota (línea ~63)
  const d = new Date(`${mesKey}-01T00:00:00Z`);
  const label = d.toLocaleDateString("es-GT", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function CreditoDetalle({ cr, moneda }: { cr: CreditoSimulado; moneda?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const fq = (v: number) => formatQ(v, moneda);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="bg-blue-50 px-4 py-3 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-blue-900 text-sm">{cr.nombre_cliente ?? "—"}</p>
            <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">
              {TIPO_LABELS[cr.tipo_reinversion] ?? cr.tipo_reinversion.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {fq(cr.capital)} · {cr.porcentaje_interes}% · {cr.porcentaje_participacion}% part.
          </p>
        </div>
        <Button variant="outline" size="sm" className="text-blue-700 border-blue-300 shrink-0" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Ocultar" : `${cr.subtotal.cuotas_pendientes} cuota(s)`}
        </Button>
      </div>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-t border-slate-200">
                <th className="px-3 py-2 text-left text-slate-400 font-medium">#</th>
                <th className="px-3 py-2 text-left text-slate-400 font-medium">Fecha</th>
                <th className="px-3 py-2 text-right text-slate-400 font-medium">Capital</th>
                <th className="px-3 py-2 text-right text-slate-400 font-medium">Interés</th>
                <th className="px-3 py-2 text-right text-slate-400 font-medium">IVA</th>
                <th className="px-3 py-2 text-right text-slate-400 font-medium">ISR</th>
                <th className="px-3 py-2 text-right text-slate-400 font-bold">Total recibido</th>
                <th className="px-3 py-2 text-right text-slate-400 font-medium">Capital restante</th>
              </tr>
            </thead>
            <tbody>
              {cr.cuotas_proyectadas.map((c, idx) => (
                <tr key={c.numero_cuota} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-3 py-1.5 text-slate-400">{c.numero_cuota}</td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {new Date(c.fecha_vencimiento.slice(0, 10) + "T00:00:00Z")
                      .toLocaleDateString("es-GT", { month: "long", year: "numeric", timeZone: "UTC" })}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">{fq(c.abono_capital)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">{fq(c.abono_interes)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">{fq(c.abono_iva)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">{fq(c.abono_isr)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold text-blue-800">{fq(c.monto_neto)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500">{fq(c.saldo_actual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TIPO_LABELS: Record<string, string> = {
  reinversion_capital: "Reinv. Capital",
  reinversion_interes: "Reinv. Interés",
  reinversion_total: "Reinv. Total",
  reinversion_variable: "Reinv. Variable",
  reinversion_excedente: "Reinv. Excedente",
};

const TIPO_REINV_LABEL: Record<string, string> = {
  sin_reinversion: "Tradicional",
  reinversion_capital: "Reinv. Capital",
  reinversion_total: "Interés Compuesto",
  reinversion_interes: "Reinv. Interés",
  reinversion_variable: "Variable",
  reinversion_excedente: "Excedente",
  reinversion_combinada: "Combinada",
};

function FilaCreditoMes({ cr, moneda }: { cr: DesgloseMes["creditos"][number]; moneda?: string | null }) {
  const [detalle, setDetalle] = useState(false);
  const fq = (v: number) => formatQ(v, moneda);
  const esFicticio = cr.credito_id === -1;
  const tipoLabel = cr.tipo_reinversion ? (TIPO_REINV_LABEL[cr.tipo_reinversion] ?? cr.tipo_reinversion) : null;
  return (
    <div className={esFicticio ? "bg-amber-50" : "bg-white"}>
      <button
        onClick={() => setDetalle((v) => !v)}
        className={`w-full grid grid-cols-[1fr_auto] items-center gap-6 px-5 py-2 text-left transition-colors ${esFicticio ? "hover:bg-amber-100" : "hover:bg-slate-50"}`}
      >
        <span className={`text-xs truncate flex items-center gap-1.5 ${esFicticio ? "text-amber-700 font-semibold" : "text-slate-600"}`}>
          {esFicticio ? "↻ Reinversión (ficticio)" : (cr.nombre_cliente ?? "—")}
          {tipoLabel && !esFicticio && (
            <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-500 border border-blue-100">{tipoLabel}</span>
          )}
        </span>
        <span className={`text-xs font-mono text-right w-28 ${esFicticio ? "text-amber-600" : "text-slate-600"}`}>{fq(cr.saldo_actual)}</span>
      </button>
      {detalle && (
        <div className="mx-5 mb-2 rounded-lg border border-slate-200 overflow-hidden">
          <div className="bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cuota</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-1.5 text-left text-slate-500 font-medium">Capital</th>
                <th className="px-3 py-1.5 text-left text-slate-500 font-medium">Interés</th>
                <th className="px-3 py-1.5 text-left text-slate-500 font-medium">IVA</th>
                <th className="px-3 py-1.5 text-left text-slate-500 font-medium">ISR</th>
                <th className="px-3 py-1.5 text-right text-slate-700 font-bold">Neto</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-white">
                <td className="px-3 py-1.5 font-mono text-slate-600">{fq(cr.abono_capital)}</td>
                <td className="px-3 py-1.5 font-mono text-slate-600">{fq(cr.abono_interes)}</td>
                <td className="px-3 py-1.5 font-mono text-slate-600">{fq(cr.abono_iva)}</td>
                <td className="px-3 py-1.5 font-mono text-slate-600">{fq(cr.abono_isr)}</td>
                <td className="px-3 py-1.5 font-mono font-semibold text-blue-800 text-right">{fq(cr.monto_neto)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilaMes({ mes, moneda, tipoReinversion, montoReinvMensual, defaultExpanded = true }: {
  mes: DesgloseMes;
  moneda?: string | null;
  tipoReinversion?: string | null;
  montoReinvMensual?: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => { setExpanded(defaultExpanded); }, [defaultExpanded]);
  const fq = (v: number) => formatQ(v, moneda);
  // Semántica alineada con el reporte de inversiones:
  //   sinReinv = flujo bruto (cap + interés neto) = lo que recibiría SIN reinvertir
  //   conReinv = lo que recibe en mano TRAS reinvertir
  //   reinvertido = lo reinvertido (sinReinv − conReinv)
  const totalSinReinv = Number(mes.total_sin_reinversion);
  const totalConReinv = Number(mes.total_con_reinversion);
  const totalReinvertido = Number(mes.total_reinversion);
  const tieneReinversion = !!(tipoReinversion && tipoReinversion !== "sin_reinversion");
  const esExcedente = tipoReinversion === "reinversion_excedente";

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      {/* Cabecera clickeable */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
          <span className="font-semibold text-slate-700 text-sm">{formatMesLabel(mes.mes)}</span>
        </div>
      </button>

      {/* Totales del mes (semántica del reporte): Sin Reinversión (bruto) · Con Reinversión (recibe) ·
          Reinversión (reinvertido) · Capital Restante */}
      <div className={`grid gap-px bg-slate-100 border-b border-slate-200 ${tieneReinversion ? "grid-cols-4" : "grid-cols-2"}`}>
        <div className="bg-white px-4 py-1.5">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Cuota Sin Reinversión</p>
          <p className="text-sm font-bold font-mono text-blue-800">{fq(totalSinReinv)}</p>
        </div>
        {tieneReinversion && (
          <div className="bg-white px-4 py-1.5">
            <p className="text-xs text-teal-600 uppercase tracking-wide">Cuota Con Reinversión</p>
            <p className="text-sm font-bold font-mono text-teal-700">{fq(totalConReinv)}</p>
            {esExcedente && montoReinvMensual != null && (
              <p className="text-[10px] text-slate-400 font-mono">tope {fq(montoReinvMensual)}</p>
            )}
          </div>
        )}
        {tieneReinversion && (
          <div className="bg-amber-50 px-4 py-1.5">
            <p className="text-xs text-amber-500 uppercase tracking-wide">Reinversión</p>
            <p className="text-sm font-bold font-mono text-amber-700">{fq(totalReinvertido)}</p>
          </div>
        )}
        <div className="bg-white px-4 py-1.5">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Capital Restante</p>
          <p className="text-sm font-bold font-mono text-slate-600">{fq(mes.total_capital_restante)}</p>
        </div>
      </div>

      {/* Detalle créditos — colapsable */}
      {expanded && (
        <div>
          {mes.creditos.length > 0 && (
            <div className="grid grid-cols-[1fr_auto] items-center gap-6 px-5 py-1.5 bg-slate-50 border-b border-slate-100">
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">Crédito</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wide text-right w-28">Capital restante</span>
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {mes.creditos.map((cr) => (
              <FilaCreditoMes key={cr.credito_id} cr={cr} moneda={moneda} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


export function ProyeccionInversionistas() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queryEnabled, setQueryEnabled] = useState(false);
  const [investorQuery, setInvestorQuery] = useState("");

  const currentYear = new Date().getFullYear();
  // hastaFiltro: filtro visual "hasta este mes" — no va al backend
  const [hastaFiltro, setHastaFiltro] = useState<{ mes: number; anio: number } | null>(null);
  const [mesSeleccionado, setMesSeleccionado] = useState<number | null>(null);
  const [anioSeleccionado, setAnioSeleccionado] = useState<number>(currentYear);
  const [mostrarCuotasDetalle, setMostrarCuotasDetalle] = useState(false);
  const [allExpanded, setAllExpanded] = useState(true);

  const { data: investorsData, isLoading: loadingInvestors } = useQuery({
    queryKey: ["investors"],
    queryFn: getInvestors,
    staleTime: 1000 * 60 * 10,
  });

  const investors: InvestorResponse[] = investorsData ?? [];
  const filteredInvestors =
    investorQuery === ""
      ? investors
      : investors.filter((inv) => inv.nombre.toLowerCase().includes(investorQuery.toLowerCase()));
  // Backend siempre recibe sin mesLiquidacion — devuelve toda la proyección
  const { data, isLoading, isError, refetch } = useSimulacionInversionista(selectedId, queryEnabled);

  const sim = data?.data;
  const moneda = sim?.moneda;
  const fq = (v: number) => formatQ(v, moneda);
  const tieneReinversion = !!(sim?.tipo_reinversion && sim.tipo_reinversion !== "sin_reinversion");
  const yearOptions = Array.from({ length: 7 }, (_, i) => currentYear - 1 + i);

  // El ficticio ahora viene integrado en cada mes del desglose (fila con credito_id=-1),
  // ya no se renderiza como bloque aparte.

  // Filtrar meses del desglose: desde el primer mes disponible hasta el mes elegido.
  // Si no hay mes específico, cortar en Diciembre del año seleccionado.
  const mesesFiltrados = sim?.desglose_acumulado.meses.filter((m) => {
    if (hastaFiltro) {
      const limitKey = `${hastaFiltro.anio}-${String(hastaFiltro.mes).padStart(2, "0")}`;
      return m.mes <= limitKey;
    }
    // Sin mes específico: mostrar hasta Diciembre del año seleccionado
    const limitKey = `${anioSeleccionado}-12`;
    return m.mes <= limitKey;
  }) ?? [];

  // Recalcular totales acumulados sobre los meses filtrados
  const totalesFiltrados = mesesFiltrados.reduce(
    (acc, m) => ({
      total_sin_reinversion: acc.total_sin_reinversion + Number(m.total_sin_reinversion),
      total_con_reinversion: acc.total_con_reinversion + Number(m.total_con_reinversion),
      total_reinversion: acc.total_reinversion + Number(m.total_reinversion),
    }),
    { total_sin_reinversion: 0, total_con_reinversion: 0, total_reinversion: 0 }
  );

  const handleGenerar = () => {
    if (!selectedId) return;
    setHastaFiltro(mesSeleccionado ? { mes: mesSeleccionado, anio: anioSeleccionado } : null);
    setMostrarCuotasDetalle(false);
    if (queryEnabled) {
      // Ya estaba habilitada (ej. reintento tras error): setQueryEnabled(true) sería
      // no-op y React Query no re-ejecuta sin cambio de key → forzar con refetch().
      refetch();
    } else {
      setQueryEnabled(true);
    }
  };

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setQueryEnabled(false);
    setHastaFiltro(null);
    setMostrarCuotasDetalle(false);
  };

  const handleLimpiarMes = () => {
    setMesSeleccionado(null);
    setHastaFiltro(null);
    setQueryEnabled(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4">

        {/* Encabezado */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <TrendingUp className="h-6 w-6 text-blue-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-blue-900">Proyección Inversionistas</h1>
          </div>
        </div>

        {/* Selector */}
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow border border-blue-100 p-4">
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-sm font-semibold text-blue-800 mb-1 block">Inversionista</label>
              {loadingInvestors ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                </div>
              ) : (
                <Combobox value={selectedId} onChange={(id: number | null) => id && handleSelect(id)}>
                  <div className="relative">
                    <Combobox.Input
                      className="w-full border border-blue-200 rounded-lg bg-blue-50 px-3 py-2 pr-9 text-sm text-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      displayValue={(id: number | null) =>
                        investors.find((i) => i.inversionista_id === id)?.nombre ?? ""
                      }
                      onChange={(e) => setInvestorQuery(e.target.value)}
                      placeholder="Buscar inversionista..."
                    />
                    <Combobox.Button className="absolute right-2 top-2.5">
                      <ChevronsUpDown className="w-4 h-4 text-blue-500" />
                    </Combobox.Button>

                    <Transition
                      as={Fragment}
                      leave="transition ease-in duration-100"
                      leaveFrom="opacity-100"
                      leaveTo="opacity-0"
                      afterLeave={() => setInvestorQuery("")}
                    >
                      <Combobox.Options className="absolute z-50 mt-1 w-full rounded-lg border border-blue-200 bg-white shadow-xl max-h-60 overflow-auto">
                        {filteredInvestors.length === 0 ? (
                          <div className="px-4 py-3 text-center text-sm text-slate-400">
                            No se encontró inversionista
                          </div>
                        ) : (
                          filteredInvestors.map((inv) => (
                            <Combobox.Option
                              key={inv.inversionista_id}
                              value={inv.inversionista_id}
                              className={({ active }) =>
                                `cursor-pointer px-4 py-2 text-sm transition-colors ${
                                  active ? "bg-blue-50 text-blue-900" : "text-slate-700"
                                }`
                              }
                            >
                              {inv.nombre}
                            </Combobox.Option>
                          ))
                        )}
                      </Combobox.Options>
                    </Transition>
                  </div>
                </Combobox>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-sm font-semibold text-blue-800 mb-1 block">
                  Proyectar hasta
                </label>
                <div className="flex items-center gap-2">
                  <select
                    className="border border-blue-200 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    value={mesSeleccionado ?? ""}
                    onChange={(e) => setMesSeleccionado(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Todos los meses</option>
                    {MESES.map((nombre, i) => (
                      <option key={i + 1} value={i + 1}>{nombre}</option>
                    ))}
                  </select>
                  <select
                    className="border border-blue-200 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    value={anioSeleccionado}
                    onChange={(e) => setAnioSeleccionado(Number(e.target.value))}
                  >
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {mesSeleccionado && (
                    <button onClick={handleLimpiarMes} className="text-slate-400 hover:text-slate-600 p-1">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <Button
                onClick={handleGenerar}
                disabled={!selectedId || isLoading}
                className="bg-blue-700 hover:bg-blue-800 text-white"
              >
                {isLoading
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <Search className="h-4 w-4 mr-2" />
                }
                {mesSeleccionado ? `Ver hasta ${MESES[mesSeleccionado - 1]} ${anioSeleccionado}` : "Generar Proyección"}
              </Button>
            </div>
          </div>
        </div>

        {/* Estados */}
        {queryEnabled && isLoading && (
          <div className="flex items-center justify-center h-40 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Calculando proyección...
          </div>
        )}
        {queryEnabled && isError && (
          <div className="flex items-center justify-center h-40 text-red-500">
            Error al cargar la proyección. Intente de nuevo.
          </div>
        )}

        {sim && !isLoading && (
          <>
            {/* Info inversionista */}
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <div>
                <p className="font-bold text-blue-900">{sim.nombre}</p>
                <p className="text-xs text-slate-400">
                  {sim.moneda ?? "quetzales"} · {sim.tipo_reinversion?.replace(/_/g, " ") ?? "sin reinversión"} · {sim.emite_factura ? "Factura" : "No factura"}
                </p>
              </div>
              {sim.mes_liquidacion && (
                <p className="text-xs font-semibold text-blue-700">
                  Liquidación: {MESES[sim.mes_liquidacion.mes - 1]} {sim.mes_liquidacion.anio}
                </p>
              )}
            </div>

            {mesesFiltrados.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-slate-400 bg-white rounded-xl border border-slate-200">
                Sin cuotas en el período seleccionado.
              </div>
            ) : (
              <>
                {/* ── TOTALES ACUMULADOS (siempre arriba, grande) ── */}
                <div className="bg-blue-900 text-white rounded-2xl shadow-lg px-5 py-5">
                  <p className="text-xs font-semibold text-blue-300 uppercase tracking-widest mb-1">
                    Total acumulado proyectado
                  </p>
                  {hastaFiltro && (
                    <p className="text-xs text-blue-400 mb-4">
                      Hasta {MESES[hastaFiltro.mes - 1]} {hastaFiltro.anio}
                    </p>
                  )}
                  <div className={`grid gap-4 ${tieneReinversion ? "grid-cols-3" : "grid-cols-2"}`}>
                    <div>
                      <p className="text-xs text-blue-400 uppercase tracking-wide mb-1">Cuota Sin Reinversión</p>
                      <p className="text-2xl font-bold font-mono">{fq(totalesFiltrados.total_sin_reinversion)}</p>
                    </div>
                    {tieneReinversion && (
                      <div>
                        <p className="text-xs text-amber-400 uppercase tracking-wide mb-1">Reinversión</p>
                        <p className="text-2xl font-bold font-mono text-amber-300">{fq(totalesFiltrados.total_reinversion)}</p>
                      </div>
                    )}
                    <div className="border-l border-blue-700 pl-4">
                      <p className="text-xs text-blue-200 uppercase tracking-wide mb-1">Cuota Con Reinversión</p>
                      <p className="text-3xl font-bold font-mono">{fq(totalesFiltrados.total_con_reinversion)}</p>
                    </div>
                  </div>
                  {/* Capital restante al final del período filtrado */}
                  <div className="mt-5 pt-4 border-t border-blue-800">
                    <div>
                      <p className="text-xs text-blue-300 uppercase tracking-wide mb-1">Capital Restante</p>
                      <p className="text-lg font-bold font-mono">
                        {fq(Number(mesesFiltrados.at(-1)?.total_capital_restante ?? sim.capital_restante_global))}
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── DESGLOSE POR MES (siempre visible, sin colapso) ── */}
                <div className="space-y-3">
                  {mesesFiltrados.length > 0 && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => setAllExpanded((v) => !v)}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
                      >
                        {allExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {allExpanded ? "Colapsar todo" : "Expandir todo"}
                      </button>
                    </div>
                  )}
                  {mesesFiltrados.map((mes) => (
                    <FilaMes key={mes.mes} mes={mes} moneda={moneda} tipoReinversion={sim.tipo_reinversion} montoReinvMensual={Number(sim.monto_reinversion_mensual)} defaultExpanded={allExpanded} />
                  ))}
                </div>

                {/* ── DETALLE DE CUOTAS (colapsable, para quien quiera ver el detalle técnico) ── */}
                {sim.creditos.length > 0 && (
                  <div>
                    <button
                      onClick={() => setMostrarCuotasDetalle((v) => !v)}
                      className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {mostrarCuotasDetalle ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {mostrarCuotasDetalle ? "Ocultar detalle de cuotas" : "Ver detalle de cuotas por crédito"}
                    </button>

                    {mostrarCuotasDetalle && (
                      <div className="mt-3 space-y-3">
                        {sim.creditos.map((cr) => (
                          <CreditoDetalle key={cr.credito_id} cr={cr} moneda={moneda} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

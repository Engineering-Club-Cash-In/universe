import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2, Search, TrendingUp, X } from "lucide-react";
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
          <p className="font-semibold text-blue-900 text-sm">#{cr.numero_credito_sifco}</p>
          {cr.nombre_cliente && <p className="text-xs text-blue-700">{cr.nombre_cliente}</p>}
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
                <th className="px-3 py-2 text-right text-slate-400 font-bold">Neto</th>
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

type CuotaFicticioMes = {
  tipo: string;
  abono_capital: number;
  abono_interes: number;
  abono_iva: number;
  abono_isr: number;
  monto_neto: number;
  debug?: {
    saldo_antes_deposito: number;
    deposito_mes: number;
    saldo_con_deposito: number;
    interes_sobre_saldo: number;
    cuota_calculada: number;
    capital_cuota_minus_interes: number;
    saldo_despues: number;
    meses_restantes: number;
    tasa_mensual: number;
    porcentaje_participacion: number;
  };
};

function FilaFicticio({ fic, moneda }: { fic: CuotaFicticioMes; moneda?: string | null }) {
  const [detalle, setDetalle] = useState(false);
  const fq = (v: number) => formatQ(v, moneda);
  return (
    <div className="bg-amber-50 border-t border-amber-100">
      <div className="flex items-center justify-between px-5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-amber-700">
            {TIPO_LABELS[fic.tipo] ?? fic.tipo.replace(/_/g, " ")}
          </span>
          <span className="text-xs bg-amber-200 text-amber-800 rounded-full px-1.5 py-0.5 font-semibold leading-none">FICTICIO</span>
          <button
            onClick={() => setDetalle((v) => !v)}
            className="text-xs text-amber-500 hover:text-amber-700 underline underline-offset-2"
          >
            {detalle ? "ocultar" : "detalle"}
          </button>
        </div>
        <span className="text-xs font-mono font-semibold text-amber-700">{fq(fic.monto_neto)}</span>
      </div>
      {detalle && (
        <div className="mx-5 mb-2 space-y-2">
          {/* Cuota desglosada */}
          <div className="rounded-lg border border-amber-200 overflow-hidden">
            <div className="bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 uppercase tracking-wide">Cuota</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-amber-50">
                  <th className="px-3 py-1.5 text-left text-amber-600 font-medium">Capital</th>
                  <th className="px-3 py-1.5 text-left text-amber-600 font-medium">Interés</th>
                  <th className="px-3 py-1.5 text-left text-amber-600 font-medium">IVA</th>
                  <th className="px-3 py-1.5 text-left text-amber-600 font-medium">ISR</th>
                  <th className="px-3 py-1.5 text-right text-amber-700 font-bold">Neto</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-white">
                  <td className="px-3 py-1.5 font-mono text-slate-600">{fq(fic.abono_capital)}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{fq(fic.abono_interes)}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{fq(fic.abono_iva)}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{fq(fic.abono_isr)}</td>
                  <td className="px-3 py-1.5 font-mono font-semibold text-amber-800 text-right">{fq(fic.monto_neto)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Cálculo interno — siempre visible para validación */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cálculo interno</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {fic.debug ? (
                  <>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-400 text-xs italic" colSpan={2}>— Saldo —</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">Saldo mes anterior</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.debug.saldo_antes_deposito)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-500">+ Depósito este mes</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.debug.deposito_mes)}</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-600 font-semibold">= Saldo base (con depósito)</td>
                      <td className="px-3 py-1.5 font-mono font-bold text-slate-800 text-right">{fq(fic.debug.saldo_con_deposito)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-400 text-xs italic" colSpan={2}>— Cuota francesa: saldo × r / (1 - (1+r)^-n) —</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">Tasa mensual (r)</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{(fic.debug.tasa_mensual * 100).toFixed(4)}%</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-500">Meses restantes (n)</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fic.debug.meses_restantes}</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-blue-600 font-semibold">Cuota calculada</td>
                      <td className="px-3 py-1.5 font-mono font-bold text-blue-700 text-right">{fq(fic.debug.cuota_calculada)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-400 text-xs italic" colSpan={2}>— Desglose cuota —</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">Interés = saldo × r</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.debug.interes_sobre_saldo)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-500">Capital = cuota − interés</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.debug.capital_cuota_minus_interes)}</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">Saldo siguiente mes</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.debug.saldo_despues)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-400 text-xs italic" colSpan={2}>— Participación —</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">% participación inversionista</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fic.debug.porcentaje_participacion}%</td>
                    </tr>
                  </>
                ) : (
                  <>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">Capital amortizado</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.abono_capital)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-500">Interés bruto</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.abono_interes)}</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">IVA (12%)</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.abono_iva)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-500">ISR (7%)</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 text-right">{fq(fic.abono_isr)}</td>
                    </tr>
                    <tr className="bg-white">
                      <td className="px-3 py-1.5 text-slate-500">Cuota inversionista</td>
                      <td className="px-3 py-1.5 font-mono font-semibold text-blue-700 text-right">{fq(fic.monto_neto)}</td>
                    </tr>
                    <tr className="bg-amber-50">
                      <td className="px-3 py-1.5 text-amber-600 text-xs italic" colSpan={2}>
                        Detalle de cálculo no disponible para esta cuota
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaMes({ mes, moneda, ficticiosMes }: {
  mes: DesgloseMes;
  moneda?: string | null;
  ficticiosMes: CuotaFicticioMes[];
}) {
  const [expanded, setExpanded] = useState(true);
  const fq = (v: number) => formatQ(v, moneda);
  const totalRecibe = Number(mes.total_creditos);
  const totalReinv = Number(mes.total_reinversion);
  const tieneReinversion = totalReinv > 0;

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
        <span className="font-bold font-mono text-blue-900 text-sm">{fq(mes.total_mes)}</span>
      </button>

      {/* Totales del mes: recibe vs reinvierte — siempre visibles */}
      <div className={`grid gap-px bg-slate-100 border-b border-slate-200 ${tieneReinversion ? "grid-cols-3" : "grid-cols-1"}`}>
        <div className="bg-white px-4 py-1.5">
          <p className="text-xs text-slate-400 uppercase tracking-wide">Recibe</p>
          <p className="text-sm font-bold font-mono text-blue-800">{fq(totalRecibe)}</p>
        </div>
        {tieneReinversion && (
          <div className="bg-white px-4 py-1.5">
            <p className="text-xs text-amber-500 uppercase tracking-wide">Reinvierte</p>
            <p className="text-sm font-bold font-mono text-amber-700">{fq(totalReinv)}</p>
          </div>
        )}
        {tieneReinversion && (
          <div className="bg-blue-50 px-4 py-1.5">
            <p className="text-xs text-blue-400 uppercase tracking-wide">Total mes</p>
            <p className="text-sm font-bold font-mono text-blue-900">{fq(mes.total_mes)}</p>
          </div>
        )}
      </div>

      {/* Detalle créditos — colapsable */}
      {expanded && (
        <div className="divide-y divide-slate-100">
          {mes.creditos.map((cr) => (
            <div key={cr.credito_id} className="flex items-center justify-between px-5 py-2 bg-white">
              <div>
                <span className="text-xs font-semibold text-blue-700">#{cr.numero_credito_sifco}</span>
                {cr.nombre_cliente && (
                  <span className="text-xs text-slate-500 ml-2">{cr.nombre_cliente}</span>
                )}
              </div>
              <span className="text-xs font-mono font-semibold text-slate-600">{fq(cr.monto_neto)}</span>
            </div>
          ))}
          {ficticiosMes.map((fic, idx) => (
            <FilaFicticio key={`${fic.tipo}-${idx}`} fic={fic} moneda={moneda} />
          ))
          }
        </div>
      )}
    </div>
  );
}


export function ProyeccionInversionistas() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queryEnabled, setQueryEnabled] = useState(false);

  const currentYear = new Date().getFullYear();
  // hastaFiltro: filtro visual "hasta este mes" — no va al backend
  const [hastaFiltro, setHastaFiltro] = useState<{ mes: number; anio: number } | null>(null);
  const [mesSeleccionado, setMesSeleccionado] = useState<number | null>(null);
  const [anioSeleccionado, setAnioSeleccionado] = useState<number>(currentYear);
  const [mostrarCuotasDetalle, setMostrarCuotasDetalle] = useState(false);

  const { data: investorsData, isLoading: loadingInvestors } = useQuery({
    queryKey: ["investors"],
    queryFn: getInvestors,
    staleTime: 1000 * 60 * 10,
  });

  const investors: InvestorResponse[] = investorsData ?? [];
  // Backend siempre recibe sin mesLiquidacion — devuelve toda la proyección
  const { data, isLoading, isError } = useSimulacionInversionista(selectedId, queryEnabled);

  const sim = data?.data;
  const moneda = sim?.moneda;
  const fq = (v: number) => formatQ(v, moneda);
  const tieneReinversion = !!(sim?.reinversion_proyectada && sim.reinversion_proyectada.length > 0);
  const yearOptions = Array.from({ length: 7 }, (_, i) => currentYear - 1 + i);

  // Índice: mesKey -> ficticios con detalle completo de cuota ese mes
  const ficticiosPorMes = new Map<string, CuotaFicticioMes[]>();
  if (sim?.reinversion_proyectada) {
    for (const fic of sim.reinversion_proyectada) {
      for (const cuota of fic.cuotas_por_mes) {
        const mesKey = cuota.fecha_vencimiento.slice(0, 7);
        const arr = ficticiosPorMes.get(mesKey) ?? [];
        arr.push({
          tipo: fic.tipo,
          abono_capital: Number(cuota.abono_capital),
          abono_interes: Number(cuota.abono_interes),
          abono_iva: Number(cuota.abono_iva),
          abono_isr: Number(cuota.abono_isr),
          monto_neto: Number(cuota.monto_neto),
          debug: cuota.debug ? {
            saldo_antes_deposito: Number(cuota.debug.saldo_antes_deposito),
            deposito_mes: Number(cuota.debug.deposito_mes),
            saldo_con_deposito: Number(cuota.debug.saldo_con_deposito),
            interes_sobre_saldo: Number(cuota.debug.interes_sobre_saldo),
            cuota_calculada: Number(cuota.debug.cuota_calculada),
            capital_cuota_minus_interes: Number(cuota.debug.capital_cuota_minus_interes),
            saldo_despues: Number(cuota.debug.saldo_despues),
            meses_restantes: cuota.debug.meses_restantes,
            tasa_mensual: cuota.debug.tasa_mensual,
            porcentaje_participacion: cuota.debug.porcentaje_participacion,
          } : undefined,
        });
        ficticiosPorMes.set(mesKey, arr);
      }
    }
  }

  // Filtrar meses del desglose: desde el primer mes disponible hasta el mes elegido.
  // El primer mes disponible = primer mes con cuotas pendientes (post última liquidación).
  // Si no hay filtro de hasta-mes, mostrar todos.
  const mesesFiltrados = sim?.desglose_acumulado.meses.filter((m) => {
    if (!hastaFiltro) return true;
    const limitKey = `${hastaFiltro.anio}-${String(hastaFiltro.mes).padStart(2, "0")}`;
    return m.mes <= limitKey;
  }) ?? [];

  // Recalcular totales acumulados sobre los meses filtrados
  const totalesFiltrados = mesesFiltrados.reduce(
    (acc, m) => ({
      total_creditos: acc.total_creditos + Number(m.total_creditos),
      total_reinversion: acc.total_reinversion + Number(m.total_reinversion),
      total_acumulado: acc.total_acumulado + Number(m.total_mes),
    }),
    { total_creditos: 0, total_reinversion: 0, total_acumulado: 0 }
  );

  const handleGenerar = () => {
    if (!selectedId) return;
    setHastaFiltro(mesSeleccionado ? { mes: mesSeleccionado, anio: anioSeleccionado } : null);
    setQueryEnabled(true);
    setMostrarCuotasDetalle(false);
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
                <select
                  className="w-full border border-blue-200 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={selectedId ?? ""}
                  onChange={(e) => handleSelect(Number(e.target.value))}
                >
                  <option value="">Seleccionar inversionista...</option>
                  {investors.map((inv) => (
                    <option key={inv.inversionista_id} value={inv.inversionista_id}>{inv.nombre}</option>
                  ))}
                </select>
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
                      <p className="text-xs text-blue-400 uppercase tracking-wide mb-1">Créditos reales</p>
                      <p className="text-2xl font-bold font-mono">{fq(totalesFiltrados.total_creditos)}</p>
                    </div>
                    {tieneReinversion && (
                      <div>
                        <p className="text-xs text-amber-400 uppercase tracking-wide mb-1">Reinversión</p>
                        <p className="text-2xl font-bold font-mono text-amber-300">{fq(totalesFiltrados.total_reinversion)}</p>
                      </div>
                    )}
                    <div className="border-l border-blue-700 pl-4">
                      <p className="text-xs text-blue-200 uppercase tracking-wide mb-1">Total a recibir</p>
                      <p className="text-3xl font-bold font-mono">{fq(totalesFiltrados.total_acumulado)}</p>
                    </div>
                  </div>
                </div>

                {/* ── DESGLOSE POR MES (siempre visible, sin colapso) ── */}
                <div className="space-y-3">
                  {mesesFiltrados.map((mes) => (
                    <FilaMes key={mes.mes} mes={mes} moneda={moneda} ficticiosMes={ficticiosPorMes.get(mes.mes) ?? []} />
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

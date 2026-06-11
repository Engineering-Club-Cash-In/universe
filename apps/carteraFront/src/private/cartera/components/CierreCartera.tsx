import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  getCierreMensual,
  generarCierreMensual,
  type CierreMensualItem,
} from "../services/services";

function formatQ(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  if (isNaN(n)) return "Q 0.00";
  return `Q ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNum(n: number): string {
  return n.toLocaleString("es-GT");
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// "2026-05-01" -> "Mayo 2026"
function labelPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-");
  const idx = Number(mes) - 1;
  return `${MESES[idx] ?? mes} ${anio}`;
}

// Orden de presentación de los estados (los "vivos" primero).
const ORDEN_ESTADOS = [
  "ACTIVO",
  "MOROSO",
  "EN_CONVENIO",
  "CAIDO",
  "INCOBRABLE",
  "PENDIENTE_CANCELACION",
  "CANCELADO",
];

const ESTADO_STYLE: Record<string, string> = {
  ACTIVO: "bg-green-100 text-green-700",
  MOROSO: "bg-red-100 text-red-700",
  EN_CONVENIO: "bg-amber-100 text-amber-700",
  CAIDO: "bg-orange-100 text-orange-700",
  INCOBRABLE: "bg-rose-100 text-rose-700",
  PENDIENTE_CANCELACION: "bg-blue-100 text-blue-700",
  CANCELADO: "bg-gray-100 text-gray-600",
};

export function CierreCartera() {
  const [rows, setRows] = useState<CierreMensualItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [periodoSel, setPeriodoSel] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const cargar = async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const data = await getCierreMensual();
      setRows(data);
      // Seleccionar el periodo más reciente por defecto.
      const periodos = Array.from(new Set(data.map((r) => r.periodo))).sort().reverse();
      setPeriodoSel((prev) => (prev && periodos.includes(prev) ? prev : periodos[0] ?? ""));
    } catch (e) {
      console.error("Error cargando cierre mensual:", e);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const periodos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.periodo))).sort().reverse(),
    [rows]
  );

  const filasPeriodo = useMemo(() => {
    const delMes = rows.filter((r) => r.periodo === periodoSel);
    return delMes.sort(
      (a, b) => ORDEN_ESTADOS.indexOf(a.status_credit) - ORDEN_ESTADOS.indexOf(b.status_credit)
    );
  }, [rows, periodoSel]);

  const totales = useMemo(() => {
    return filasPeriodo.reduce(
      (acc, r) => {
        acc.creditos += r.cantidad_creditos;
        acc.capital += Number(r.capital_total || 0);
        acc.conMora += r.creditos_con_mora;
        acc.capitalMora += Number(r.capital_en_mora || 0);
        return acc;
      },
      { creditos: 0, capital: 0, conMora: 0, capitalMora: 0 }
    );
  }, [filasPeriodo]);

  const handleGenerar = async () => {
    setIsGenerating(true);
    setFeedback(null);
    try {
      // Sin periodo: el back genera la foto del mes anterior a hoy.
      const res = await generarCierreMensual();
      await cargar();
      setPeriodoSel(res.periodo);
      setFeedback({ ok: true, msg: `Cierre de ${labelPeriodo(res.periodo)} generado (${res.filas} estados).` });
    } catch (e) {
      console.error("Error generando cierre:", e);
      setFeedback({ ok: false, msg: "No se pudo generar el cierre. Intenta de nuevo." });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
      <div className="w-full max-w-[1300px]">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-extrabold text-blue-700 text-center">
            Cierre de Cartera
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed text-center mt-2">
            Con cuánto cerramos cada mes: capital por estado y detalle de mora.
          </p>
        </div>

        {/* Controles */}
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-5 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[200px]">
              <label className="text-sm font-semibold text-blue-800 mb-1 block">Periodo (mes cerrado)</label>
              <select
                className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400 disabled:opacity-50"
                value={periodoSel}
                onChange={(e) => setPeriodoSel(e.target.value)}
                disabled={!periodos.length}
              >
                {!periodos.length && <option value="">Sin datos</option>}
                {periodos.map((p) => (
                  <option key={p} value={p}>{labelPeriodo(p)}</option>
                ))}
              </select>
            </div>

            <Button
              variant="default"
              size="sm"
              onClick={handleGenerar}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700 text-white border-none"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-1" />
              )}
              {isGenerating ? "Generando..." : "Generar cierre del mes anterior"}
            </Button>

            {feedback && (
              <span
                className={`inline-flex items-center gap-1 text-sm font-medium ${
                  feedback.ok ? "text-green-600" : "text-red-600"
                }`}
              >
                {feedback.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {feedback.msg}
              </span>
            )}
          </div>
        </div>

        {/* Tarjetas resumen */}
        {!!filasPeriodo.length && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Créditos", value: formatNum(totales.creditos), accent: "text-blue-700" },
              { label: "Capital total", value: formatQ(totales.capital), accent: "text-blue-700" },
              { label: "Créditos con mora", value: formatNum(totales.conMora), accent: "text-red-600" },
              { label: "Capital en mora", value: formatQ(totales.capitalMora), accent: "text-red-600" },
            ].map((c) => (
              <div key={c.label} className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-4 text-center">
                <p className="text-xs text-gray-500 font-medium">{c.label}</p>
                <p className={`text-lg font-bold ${c.accent}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabla */}
        {isLoading ? (
          <div className="text-center py-16 text-blue-400 font-semibold text-lg">Cargando...</div>
        ) : isError ? (
          <div className="text-center py-16 text-red-500 font-semibold">Error al cargar el cierre de cartera</div>
        ) : !filasPeriodo.length ? (
          <div className="text-center py-16 text-gray-400 font-semibold text-lg">
            No hay datos de cierre todavía. Generá el primero con el botón de arriba.
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-x-auto">
            <Table className="w-full border-collapse">
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-blue-50 to-blue-100">
                  <TableHead className="font-bold text-blue-800 border-r border-b border-blue-200">Estado</TableHead>
                  <TableHead className="font-bold text-blue-800 text-center border-r border-b border-blue-200">Créditos</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Capital total</TableHead>
                  <TableHead className="font-bold text-red-800 text-center border-r border-b border-blue-200">Créditos con mora</TableHead>
                  <TableHead className="font-bold text-red-800 text-right border-b border-blue-200">Capital en mora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filasPeriodo.map((r) => (
                  <TableRow key={r.id} className="hover:bg-[#f3f8ff] transition-colors">
                    <TableCell className="border-r border-b border-blue-100">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${ESTADO_STYLE[r.status_credit] ?? "bg-gray-100 text-gray-600"}`}>
                        {r.status_credit}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-black border-r border-b border-blue-100">{formatNum(r.cantidad_creditos)}</TableCell>
                    <TableCell className="text-right font-medium text-black border-r border-b border-blue-100">{formatQ(r.capital_total)}</TableCell>
                    <TableCell className="text-center text-black border-r border-b border-blue-100">{formatNum(r.creditos_con_mora)}</TableCell>
                    <TableCell className="text-right text-red-700 font-semibold bg-red-50/30 border-b border-blue-100">{formatQ(r.capital_en_mora)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-blue-50/60 font-bold">
                  <TableCell className="text-blue-900 border-r border-t border-blue-200">TOTAL</TableCell>
                  <TableCell className="text-center text-blue-900 border-r border-t border-blue-200">{formatNum(totales.creditos)}</TableCell>
                  <TableCell className="text-right text-blue-900 border-r border-t border-blue-200">{formatQ(totales.capital)}</TableCell>
                  <TableCell className="text-center text-red-700 border-r border-t border-blue-200">{formatNum(totales.conMora)}</TableCell>
                  <TableCell className="text-right text-red-700 border-t border-blue-200">{formatQ(totales.capitalMora)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}

        {!!periodoSel && !!filasPeriodo.length && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Foto generada el {new Date(filasPeriodo[0].created_at).toLocaleString("es-GT")}. La mora refleja el atraso al momento de generar el cierre.
          </p>
        )}
      </div>
    </div>
  );
}

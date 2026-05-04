import { useState } from "react";
import { usePagosPorVencimiento } from "../hooks/usePagosPorVencimiento";
import type { PagoPorVencimientoItem } from "../services/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, X, ChevronLeft, ChevronRight, CheckCircle2, Clock } from "lucide-react";

function formatQ(val: string | null | undefined): string {
  if (!val) return "Q 0.00";
  const n = Number(val);
  if (isNaN(n)) return "Q 0.00";
  return `Q ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatFecha(val: string | null | undefined): string {
  if (!val) return "--";
  try {
    const d = new Date(val);
    // Usamos los componentes UTC para evitar que el navegador reste horas por la zona horaria local (GTM-6)
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).toLocaleDateString("es-GT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "--";
  }
}

const currentDate = new Date();

export function PagosPorVencimiento() {
  const [mes, setMes] = useState(currentDate.getMonth() + 1);
  const [anio, setAnio] = useState(currentDate.getFullYear());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [tipoFecha, setTipoFecha] = useState<"vencimiento" | "creacion">("vencimiento");

  const [sifcoInput, setSifcoInput] = useState("");
  const [sifcoFilter, setSifcoFilter] = useState("");
  const [nombreInput, setNombreInput] = useState("");
  const [nombreFilter, setNombreFilter] = useState("");
  const [asesorInput, setAsesorInput] = useState("");
  const [asesorFilter, setAsesorFilter] = useState("");
  const [rangoMoraInput, setRangoMoraInput] = useState("");
  const [rangoMoraFilter, setRangoMoraFilter] = useState("");

  const { data, isLoading, isError } = usePagosPorVencimiento({
    mes,
    anio,
    page,
    pageSize,
    numero_credito_sifco: sifcoFilter || undefined,
    nombre_usuario: nombreFilter || undefined,
    tipo_fecha: tipoFecha,
    asesor: asesorFilter || undefined,
    rango_mora: rangoMoraFilter || undefined,
  });

  const handleSearch = () => {
    setSifcoFilter(sifcoInput.trim());
    setNombreFilter(nombreInput.trim());
    setAsesorFilter(asesorInput.trim());
    setRangoMoraFilter(rangoMoraInput);
    setPage(1);
  };

  const clearFilters = () => {
    setSifcoInput("");
    setSifcoFilter("");
    setNombreInput("");
    setNombreFilter("");
    setAsesorInput("");
    setAsesorFilter("");
    setRangoMoraInput("");
    setRangoMoraFilter("");
    setPage(1);
  };

  const items: PagoPorVencimientoItem[] = data?.data ?? [];
  const pagination = data?.pagination;
  const totales = data?.totales;

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
    <div className="w-full max-w-[1400px]">
      <div className="flex flex-col items-center mb-6">
        <h1 className="text-3xl font-extrabold text-blue-700 text-center">
          {tipoFecha === "vencimiento" ? "Pagos por Vencimiento" : "Pagos por Creación de Crédito"}
        </h1>
        <p className="text-lg text-gray-600 leading-relaxed text-center mt-2">
          Detalle de pagos y cuotas por mes de vencimiento.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[170px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Filtrar por</label>
            <select
              className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
              value={tipoFecha}
              onChange={(e) => { setTipoFecha(e.target.value as any); setPage(1); }}
            >
              <option value="vencimiento">Fecha Vencimiento</option>
              <option value="creacion">Fecha Creación</option>
            </select>
          </div>

          <div className="min-w-[140px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Mes</label>
            <select
              className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
              value={mes}
              onChange={(e) => { setMes(Number(e.target.value)); setPage(1); }}
            >
              {meses.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[100px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Año</label>
            <Input
              type="number"
              min={2020}
              value={anio}
              onChange={(e) => { setAnio(Number(e.target.value)); setPage(1); }}
              className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
            />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">No. Crédito SIFCO</label>
            <Input
              placeholder="Buscar por SIFCO..."
              value={sifcoInput}
              onChange={(e) => setSifcoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
            />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Nombre Usuario</label>
            <Input
              placeholder="Buscar por nombre..."
              value={nombreInput}
              onChange={(e) => setNombreInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
            />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Asesor</label>
            <Input
              placeholder="Buscar por asesor..."
              value={asesorInput}
              onChange={(e) => setAsesorInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
            />
          </div>

          <div className="min-w-[150px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Días Mora</label>
            <select
              className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
              value={rangoMoraInput}
              onChange={(e) => { 
                setRangoMoraInput(e.target.value); 
                setRangoMoraFilter(e.target.value);
                setPage(1); 
              }}
            >
              <option value="">Todos</option>
              <option value="0-30">0-30 días</option>
              <option value="31-60">31-60 días</option>
              <option value="61-90">61-90 días</option>
              <option value="+90">Más de 90 días</option>
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSearch}
            className="text-blue-700 border-blue-300 hover:bg-blue-50"
          >
            <Search className="w-4 h-4 mr-1" /> Buscar
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="text-gray-600 border-gray-300 hover:bg-gray-100"
          >
            <X className="w-4 h-4 mr-1" /> Limpiar
          </Button>
        </div>
      </div>

      {/* Totales globales */}
      {totales && (
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-5 mb-6">
          <h2 className="text-sm font-bold text-blue-800 mb-3 uppercase tracking-wide">
            Totales del mes — {meses[mes - 1]} {anio}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: "Capital", value: totales.capital_restante },
              { label: "Interés", value: totales.interes_restante },
              { label: "IVA 12%", value: totales.iva_12_restante },
              { label: "Seguro", value: totales.seguro_restante },
              { label: "GPS", value: totales.gps_restante },
              { label: "Membresías", value: totales.membresias },
              { label: "Interés CUBE", value: totales.interes_cube },
              { label: "IVA CUBE", value: totales.iva_cube },
            ].map((t) => (
              <div key={t.label} className="text-center">
                <p className="text-xs text-gray-500 font-medium">{t.label}</p>
                <p className="text-sm font-bold text-blue-700">{formatQ(t.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contenido */}
      {isLoading ? (
        <div className="text-center py-16 text-blue-400 font-semibold text-lg">Cargando...</div>
      ) : isError ? (
        <div className="text-center py-16 text-red-500 font-semibold">
          Error al cargar pagos por vencimiento
        </div>
      ) : !items.length ? (
        <div className="text-center py-16 text-gray-400 font-semibold text-lg">
          No hay pagos para este periodo
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-blue-50 to-blue-100">
                  <TableHead className="font-bold text-blue-800">No. SIFCO</TableHead>
                  <TableHead className="font-bold text-blue-800">Cliente</TableHead>
                  <TableHead className="font-bold text-blue-800">Asesor</TableHead>
                  <TableHead className="font-bold text-blue-800">Cuota</TableHead>
                  <TableHead className="font-bold text-blue-800">Vencimiento</TableHead>
                  <TableHead className="font-bold text-blue-800">Fecha Pago</TableHead>
                  <TableHead className="font-bold text-blue-800 text-center">Estado</TableHead>
                  <TableHead className="font-bold text-blue-800 text-center">Días Mora</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Boleta</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Capital</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Interés</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">IVA 12%</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Seguro</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">GPS</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Membresías</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Int. CUBE</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">IVA CUBE</TableHead>
                  <TableHead className="font-bold text-purple-800 text-right">Royalti</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.pago_id} className="hover:bg-blue-50/50 transition">
                    <TableCell className="font-semibold text-blue-700">
                      {item.numero_credito_sifco}
                    </TableCell>
                    <TableCell className="text-black">{item.nombre_usuario}</TableCell>
                    <TableCell className="text-black text-xs">{item.asesor || "--"}</TableCell>
                    <TableCell className="text-black text-center">{item.numero_cuota}</TableCell>
                    <TableCell className="text-black">{formatFecha(item.fecha_vencimiento)}</TableCell>
                    <TableCell className="text-black">{formatFecha(item.fecha_pago)}</TableCell>
                    <TableCell className="text-center">
                      {item.pagado ? (
                        <span className="inline-flex items-center gap-1 text-green-600 font-semibold text-xs">
                          <CheckCircle2 className="w-4 h-4" /> Pagado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-semibold text-xs">
                          <Clock className="w-4 h-4" /> Pendiente
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-medium text-red-600">{item.dias_mora || 0}</TableCell>
                    <TableCell className="text-right font-medium text-black">{formatQ(item.monto_boleta)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.capital_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.interes_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.iva_12_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.seguro_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.gps_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.membresias)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.interes_cube)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.iva_cube)}</TableCell>
                    <TableCell className="text-right text-purple-700 font-semibold">
                      {item.numero_cuota === 0 ? formatQ(item.royalti) : "--"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Paginación */}
          <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
            <span className="text-sm text-gray-600">
              Página {pagination?.page ?? 1} de {pagination?.totalPages ?? 1} ({pagination?.total ?? 0} total)
            </span>
            <div className="flex items-center gap-2">
              <select
                className="border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>{n} por página</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border-blue-200 text-blue-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (pagination?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                className="border-blue-200 text-blue-700"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
 
import { Input } from "@/components/ui/input";
import { usePagosByMesAnio } from "../hooks/payments";

// ---- utilidades ----
const meses = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const currentYear = new Date().getFullYear();
const years = Array.from({ length: (currentYear + 2) - 2020 + 1 }, (_, i) => 2020 + i);

function formatCurrency(val: any) {
  if (val == null) return "--";
  return Number(val).toLocaleString("es-GT", { style: "currency", currency: "GTQ", minimumFractionDigits: 2 });
}
function formatDate(dateStr: string) {
  return dateStr ? new Date(dateStr).toLocaleDateString() : "--";
}

// ---- componente principal ----
export function PaymentsTable() {
  const [mes, setMes] = React.useState(new Date().getMonth() + 1);
  const [anio, setAnio] = React.useState(new Date().getFullYear());
  const [sifcoFilter, setSifcoFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  const perPage = 10;
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);

  const { pagos, loading, totalPages, totalCount } = usePagosByMesAnio(mes, anio, page, perPage);

  // Filtro local por SIFCO
  const pagosFiltrados = React.useMemo(() => {
    if (!sifcoFilter.trim()) return pagos;
    return pagos.filter(row =>
      row.numero_credito_sifco?.toString().toLowerCase().includes(sifcoFilter.trim().toLowerCase())
    );
  }, [pagos, sifcoFilter]);

  return (
    <div className="max-w-7xl mx-auto mt-8">
      <div className="bg-blue-50 rounded-xl shadow-md p-6 mb-5">
        <h2 className="text-2xl font-bold text-blue-900 mb-3">Pagos registrados por mes/año</h2>
        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-4 items-center mb-6">
          <div>
            <label className="block text-blue-900 font-semibold">Año:</label>
            <select
              value={anio}
              onChange={e => setAnio(Number(e.target.value))}
              className="w-24 border border-blue-300 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {years.map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-blue-900 font-semibold">Mes:</label>
            <select
              value={mes}
              onChange={e => setMes(Number(e.target.value))}
              className="w-32 border border-blue-300 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {meses.map((nombre, i) => (
                <option key={i + 1} value={i + 1}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-blue-900 font-semibold">Filtrar por SIFCO:</label>
            <Input
              type="text"
              value={sifcoFilter}
              onChange={e => setSifcoFilter(e.target.value)}
              placeholder="Núm. de SIFCO"
              className="w-36 border-2 border-blue-800 text-blue-900 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-700 placeholder:text-blue-400"
            />
          </div>
        </div>
        {loading ? (
          <div className="text-blue-700 font-bold p-6 text-center">Cargando pagos...</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg">
              <Table className="w-full text-lg text-blue-900">
                <TableHeader>
                  <TableRow className="bg-blue-100 border-b-2 border-blue-200">
                    <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base w-12"></TableHead>
                    <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">#</TableHead>
                    <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">SIFCO</TableHead>
                    <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Monto Boleta</TableHead>
                    <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Fecha de Pago</TableHead>
                    <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Cuota</TableHead>
                    <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Pagado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagosFiltrados.map((row: any, idx: number) => (
                    <React.Fragment key={row.pagos_credito?.pago_id ?? idx}>
                      <TableRow
                        className={idx % 2 === 0 ? "bg-white" : "bg-blue-50"}
                        style={{ cursor: "pointer" }}
                        onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                      >
                        <TableCell className="text-center">
                          {openIdx === idx ? (
                            <ChevronUp className="mx-auto text-blue-500" />
                          ) : (
                            <ChevronDown className="mx-auto text-blue-400" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">{(page - 1) * perPage + idx + 1}</TableCell>
                        <TableCell className="text-center text-blue-700 font-bold">{row.numero_credito_sifco}</TableCell>
                        <TableCell className="text-center">{formatCurrency(row.pagos_credito?.monto_boleta)}</TableCell>
                        <TableCell className="text-center">{formatDate(row.pagos_credito?.fecha_pago)}</TableCell>
                        <TableCell className="text-center text-indigo-700 font-semibold">{formatCurrency(row.pagos_credito?.cuota)}</TableCell>
                        <TableCell className="text-center">
                          {row.pagos_credito?.pagado ? (
                            <span className="px-2 py-1 rounded bg-green-100 text-green-700 font-bold">Sí</span>
                          ) : (
                            <span className="px-2 py-1 rounded bg-red-100 text-red-600 font-bold">No</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {openIdx === idx && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-blue-50 p-0">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 px-8 py-4 text-base">
                              {/* Todos los campos de pagos_credito */}
                              <div><span className="font-bold text-blue-700">ID pago:</span><div>{row.pagos_credito?.pago_id}</div></div>
                              <div><span className="font-bold text-blue-700">ID crédito:</span><div>{row.pagos_credito?.credito_id}</div></div>
                              <div><span className="font-bold text-blue-700"># cuota:</span><div>{row.pagos_credito?.numero_cuota}</div></div>
                              <div><span className="font-bold text-blue-700">Fecha pago:</span><div>{formatDate(row.pagos_credito?.fecha_pago)}</div></div>
                              <div><span className="font-bold text-blue-700">Monto boleta:</span><div>{formatCurrency(row.pagos_credito?.monto_boleta)}</div></div>
                              <div><span className="font-bold text-blue-700">Monto boleta cuota:</span><div>{formatCurrency(row.pagos_credito?.monto_boleta_cuota)}</div></div>
                              <div><span className="font-bold text-blue-700">Cuota:</span><div>{formatCurrency(row.pagos_credito?.cuota)}</div></div>
                              <div><span className="font-bold text-blue-700">Cuota interés:</span><div>{formatCurrency(row.pagos_credito?.cuota_interes)}</div></div>
                              <div><span className="font-bold text-blue-700">Abono capital:</span><div>{formatCurrency(row.pagos_credito?.abono_capital)}</div></div>
                              <div><span className="font-bold text-blue-700">Abono interés:</span><div>{formatCurrency(row.pagos_credito?.abono_interes)}</div></div>
                              <div><span className="font-bold text-blue-700">Abono IVA 12:</span><div>{formatCurrency(row.pagos_credito?.abono_iva_12)}</div></div>
                              <div><span className="font-bold text-blue-700">Abono interés CI:</span><div>{formatCurrency(row.pagos_credito?.abono_interes_ci)}</div></div>
                              <div><span className="font-bold text-blue-700">Abono IVA CI:</span><div>{formatCurrency(row.pagos_credito?.abono_iva_ci)}</div></div>
                              <div><span className="font-bold text-blue-700">Abono seguro:</span><div>{formatCurrency(row.pagos_credito?.abono_seguro)}</div></div>
                              <div><span className="font-bold text-blue-700">Abono GPS:</span><div>{formatCurrency(row.pagos_credito?.abono_gps)}</div></div>
                              <div><span className="font-bold text-blue-700">Pago del mes:</span><div>{formatCurrency(row.pagos_credito?.pago_del_mes)}</div></div>
                              <div><span className="font-bold text-blue-700">Capital restante:</span><div>{formatCurrency(row.pagos_credito?.capital_restante)}</div></div>
                              <div><span className="font-bold text-blue-700">Interés restante:</span><div>{formatCurrency(row.pagos_credito?.interes_restante)}</div></div>
                              <div><span className="font-bold text-blue-700">IVA 12% restante:</span><div>{formatCurrency(row.pagos_credito?.iva_12_restante)}</div></div>
                              <div><span className="font-bold text-blue-700">Seguro restante:</span><div>{formatCurrency(row.pagos_credito?.seguro_restante)}</div></div>
                              <div><span className="font-bold text-blue-700">GPS restante:</span><div>{formatCurrency(row.pagos_credito?.gps_restante)}</div></div>
                              <div><span className="font-bold text-blue-700">Total restante:</span><div>{formatCurrency(row.pagos_credito?.total_restante)}</div></div>
                              <div><span className="font-bold text-blue-700">Tipo crédito:</span><div>{row.pagos_credito?.tipoCredito || "--"}</div></div>
                              <div><span className="font-bold text-blue-700">Membresías:</span><div>{row.pagos_credito?.membresias}</div></div>
                              <div><span className="font-bold text-blue-700">Membresías pago:</span><div>{row.pagos_credito?.membresias_pago}</div></div>
                              <div><span className="font-bold text-blue-700">Membresías mes:</span><div>{row.pagos_credito?.membresias_mes}</div></div>
                              <div><span className="font-bold text-blue-700">Otros:</span><div>{row.pagos_credito?.otros}</div></div>
                              <div><span className="font-bold text-blue-700">Mora:</span><div>{formatCurrency(row.pagos_credito?.mora)}</div></div>
                              <div><span className="font-bold text-blue-700">Seguro total:</span><div>{formatCurrency(row.pagos_credito?.seguro_total)}</div></div>
                              <div><span className="font-bold text-blue-700">Seguro facturado:</span><div>{formatCurrency(row.pagos_credito?.seguro_facturado)}</div></div>
                              <div><span className="font-bold text-blue-700">GPS facturado:</span><div>{formatCurrency(row.pagos_credito?.gps_facturado)}</div></div>
                              <div><span className="font-bold text-blue-700">Reserva:</span><div>{formatCurrency(row.pagos_credito?.reserva)}</div></div>
                              <div><span className="font-bold text-blue-700">Llamada:</span><div>{row.pagos_credito?.llamada || "--"}</div></div>
                              <div><span className="font-bold text-blue-700">Renuevo/Nuevo:</span><div>{row.pagos_credito?.renuevo_o_nuevo || "--"}</div></div>
                              <div><span className="font-bold text-blue-700">Pagado:</span><div>{row.pagos_credito?.pagado ? "Sí" : "No"}</div></div>
                              <div><span className="font-bold text-blue-700">Facturación:</span><div>{row.pagos_credito?.facturacion || "--"}</div></div>
                              <div><span className="font-bold text-blue-700">Mes pagado:</span><div>{row.pagos_credito?.mes_pagado || "--"}</div></div>
                              <div><span className="font-bold text-blue-700">Observaciones:</span><div>{row.pagos_credito?.observaciones || "--"}</div></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
              {pagosFiltrados.length === 0 && (
                <div className="p-6 text-blue-700 font-semibold text-center">No hay pagos para el mes/año o filtro seleccionado.</div>
              )}
            </div>
            {/* Paginación */}
            <div className="flex justify-between items-center mt-6">
              <button
                className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                <ChevronLeft className="mr-1" /> Anterior
              </button>
              <div className="text-blue-900 font-semibold">
                Página {page} de {totalPages} ({totalCount} pagos)
              </div>
              <button
                className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Siguiente <ChevronRight className="ml-1" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPagosByCredito } from "../services/services";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow, 
} from "@/components/ui/table";
 
import { useState } from "react";
import React from "react";
import { Label } from "@/components/ui/label";
function formatCurrency(q: any) {
  return "Q" + Number(q ?? 0).toLocaleString("es-GT");
}
import { ChevronDown, ChevronUp, Search, Calendar } from "lucide-react";
function formatDate(d: string) {
  if (!d) return "--";
  const date = new Date(d);
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}
 
export function PaymentsCredits() {
      const [fechaFiltro, setFechaFiltro] = useState("");
  const [search, setSearch] = useState("");



  const { numero_credito_sifco } = useParams<{ numero_credito_sifco: string }>();
  const navigate = useNavigate();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pagosByCredito", numero_credito_sifco],
    queryFn: () => getPagosByCredito(numero_credito_sifco!),
    enabled: !!numero_credito_sifco,
  });
    const pagosFiltrados = (data || [])
    .filter((pago: any) =>
      !fechaFiltro ||
      (pago.fecha_pago && pago.fecha_pago.startsWith(fechaFiltro))
    )
    .filter((pago: any) =>
      !search ||
      Object.values(pago)
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  return (
    <div className="flex flex-col min-h-screen w-full bg-white px-4 py-10">
      <div className="w-full max-w-6xl mx-auto">
        <button
          className="mb-6 px-6 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold text-gray-700 shadow"
          onClick={() => navigate(-1)}
        >
          ← Volver
        </button>
      <Label className="block text-3xl md:text-4xl font-extrabold mb-2 text-blue-700 text-center drop-shadow">
  Historial de Pagos del Crédito
</Label>
<Label className="block text-xl md:text-2xl font-bold mb-8 text-blue-600 text-center">
  {numero_credito_sifco}
</Label>
  {/* Filtros bonitos */}
       <div className="flex flex-col md:flex-row gap-4 mb-8 justify-center items-center">
  <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md transition-all">
    <Calendar className="text-blue-500 w-5 h-5" />
    <input
      type="date"
      value={fechaFiltro}
      onChange={(e) => setFechaFiltro(e.target.value)}
      className="border-none outline-none bg-transparent text-blue-800 font-semibold placeholder-blue-400 focus:ring-0"
    />
  </div>
  <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-2 shadow-md transition-all">
    <Search className="text-blue-500 w-5 h-5" />
    <input
      type="text"
      placeholder="Buscar pago (general)..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="border-none outline-none bg-transparent text-blue-800 font-semibold placeholder-blue-400 focus:ring-0"
    />
  </div>
</div>
        {isLoading ? (
          <div className="text-blue-500 text-center py-16 text-xl">Cargando pagos...</div>
        ) : isError ? (
          <div className="text-red-500 text-center py-16 text-lg font-semibold">
            Error cargando pagos
          </div>
        ) : !pagosFiltrados || pagosFiltrados.length === 0 ? (
          <div className="text-blue-700 bg-blue-50 text-center p-6 rounded-xl font-semibold shadow-inner">
            No hay pagos registrados para este crédito.
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-xl p-6 w-full overflow-x-auto">
            <Table className="w-full text-lg text-gray-900">
              <TableHeader>
                <TableRow className="bg-blue-100 border-b-2 border-blue-200">
                  <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base w-12"></TableHead>
                  <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base"># Pago</TableHead>
                  <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Monto Boleta</TableHead>
                  <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Fecha de Pago</TableHead>
                  <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Cuota</TableHead>
                  <TableHead className="px-2 py-3 font-bold text-blue-800 text-center text-base">Pagado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagosFiltrados.map((pago: any, idx: number) => (
                  <React.Fragment key={pago.pago_id}>
                    {/* Fila principal */}
                    <TableRow
                      className={idx % 2 === 0 ? "bg-gray-50" : "bg-white"}
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
                      <TableCell className="text-center font-semibold">{pago.numero_cuota ?? idx + 1}</TableCell>
                      <TableCell className="text-center text-blue-700 font-bold">
                        {formatCurrency(pago.monto_boleta)}
                      </TableCell>
                      <TableCell className="text-center">{formatDate(pago.fecha_pago)}</TableCell>
                      <TableCell className="text-center text-indigo-700 font-semibold">
                        {formatCurrency(pago.cuota)}
                      </TableCell>
                      <TableCell className="text-center">
                        {pago.pagado ? (
                          <span className="px-2 py-1 rounded bg-green-100 text-green-700 font-bold">Sí</span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-red-100 text-red-600 font-bold">No</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {/* Fila expandible */}
                  {openIdx === idx && (
  <TableRow>
    <TableCell colSpan={6} className="bg-gray-100 p-0">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 px-8 py-4 text-sm">
        {/* Abonos principales */}
        <div>
          <span className="font-bold text-gray-500">Abono capital:</span>
          <div className="text-blue-700">{formatCurrency(pago.abono_capital)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Abono interés:</span>
          <div className="text-indigo-600">{formatCurrency(pago.abono_interes)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Abono IVA 12%:</span>
          <div className="text-pink-500">{formatCurrency(pago.abono_iva_12)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Abono interés CI:</span>
          <div className="text-indigo-400">{formatCurrency(pago.abono_interes_ci)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Abono IVA CI:</span>
          <div className="text-pink-400">{formatCurrency(pago.abono_iva_ci)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Abono Seguro:</span>
          <div className="text-orange-500">{formatCurrency(pago.abono_seguro)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Abono GPS:</span>
          <div className="text-blue-400">{formatCurrency(pago.abono_gps)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Pago del mes:</span>
          <div className="text-green-700">{formatCurrency(pago.pago_del_mes)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Número cuota:</span>
          <div>{pago.numero_cuota}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Monto boleta cuota:</span>
          <div>{formatCurrency(pago.monto_boleta_cuota)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Observaciones:</span>
          <div>{pago.observaciones || "--"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Factura:</span>
          <div>{pago.facturacion === "si" ? "Sí" : "No"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Renuevo/Nuevo:</span>
          <div>{pago.renuevo_o_nuevo || "--"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Membresías:</span>
          <div>{pago.membresias || "--"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Poliza:</span>
          <div>{pago.no_poliza || "--"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Otros:</span>
          <div>{pago.otros || "--"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Mora:</span>
          <div>{pago.mora || "--"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Pagado:</span>
          <div>{pago.pagado ? "Sí" : "No"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Mes pagado:</span>
          <div>{pago.mes_pagado || "--"}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Reserva:</span>
          <div>{formatCurrency(pago.reserva)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">Seguro facturado:</span>
          <div>{formatCurrency(pago.seguro_facturado)}</div>
        </div>
        <div>
          <span className="font-bold text-gray-500">GPS facturado:</span>
          <div>{formatCurrency(pago.gps_facturado)}</div>
        </div>
      </div>
      {/* Restantes */}
      <div className="border-t border-blue-200 mt-2 pt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 px-8 text-xs text-center">
        <div>
          <span className="font-bold text-blue-700">Capital rest.:</span>
          <div>{formatCurrency(pago.capital_restante)}</div>
        </div>
        <div>
          <span className="font-bold text-blue-700">Interés rest.:</span>
          <div>{formatCurrency(pago.interes_restante)}</div>
        </div>
        <div>
          <span className="font-bold text-blue-700">IVA 12% rest.:</span>
          <div>{formatCurrency(pago.iva_12_restante)}</div>
        </div>
        <div>
          <span className="font-bold text-blue-700">Seguro rest.:</span>
          <div>{formatCurrency(pago.seguro_restante)}</div>
        </div>
        <div>
          <span className="font-bold text-blue-700">GPS rest.:</span>
          <div>{formatCurrency(pago.gps_restante)}</div>
        </div>
        <div>
          <span className="font-bold text-blue-700">Total rest.:</span>
          <div>{formatCurrency(pago.total_restante)}</div>
        </div>
      </div>
    </TableCell>
  </TableRow>
)}

                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

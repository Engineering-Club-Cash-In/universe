/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BadgeDollarSign,
  CalendarDays,
  Hash,
  FileText,
  Users2,
} from "lucide-react";
import { usePagosConInversionistas } from "../hooks/reportPayments";
import type { PagoData } from "../services/services";
import { ModalInversionistas } from "./modalViewInvestor";
 
// --- utilidades ---
const meses = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear + 2 - 2020 + 1 }, (_, i) => 2020 + i);

const formatCurrency = (val?: number) =>
  val == null
    ? "--"
    : val.toLocaleString("es-GT", { style: "currency", currency: "GTQ", minimumFractionDigits: 2 });

const formatDate = (d?: string) => (d ? new Date(d).toLocaleDateString("es-GT") : "--");

// --- componente principal ---
export function PaymentsTable() {
  const [mes, setMes] = React.useState(new Date().getMonth() + 1);
  const [anio, setAnio] = React.useState(new Date().getFullYear());
  const [dia, setDia] = React.useState<number | undefined>();
  const [sifco, setSifco] = React.useState("");
  const [inversionistaId, setInversionistaId] = React.useState<number | undefined>();
  const [page, setPage] = React.useState(1);
  const pageSize = 10;

  const { data, isLoading } = usePagosConInversionistas({
    page,
    pageSize,
    numeroCredito: sifco || undefined,
    dia,
    mes,
    anio,
    inversionistaId,
  });

  const pagos = data?.data || [];
  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const [selectedInv, setSelectedInv] = React.useState<PagoData["inversionistas"]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);

  const handleOpenInversionistas = (inv: PagoData["inversionistas"]) => {
    setSelectedInv(inv);
    setModalOpen(true);
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center bg-gradient-to-br from-blue-50 to-white px-4 pt-10 overflow-auto">
      <div className="bg-blue-50 rounded-xl shadow-md p-5 w-full max-w-6xl">
        <h2 className="text-2xl font-bold text-blue-900 mb-4 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-blue-700" />
          Pagos con Inversionistas
        </h2>

        {/* filtros */}
        <div className="flex flex-col sm:flex-row gap-4 mb-5 flex-wrap">
          <div>
            <label className="block text-blue-900 font-semibold">Año</label>
            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-blue-900 font-semibold">Mes</label>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="border-2 border-blue-600 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400"
            >
              {meses.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-blue-900 font-semibold">Día</label>
            <Input
              type="number"
              min={1}
              max={31}
              value={dia ?? ""}
              onChange={(e) => setDia(Number(e.target.value))}
              placeholder="1-31"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400 w-[90px]"
            />
          </div>

          <div>
            <label className="block text-blue-900 font-semibold">N° Crédito SIFCO</label>
            <Input
              value={sifco}
              onChange={(e) => setSifco(e.target.value)}
              placeholder="Buscar SIFCO"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-blue-900 font-semibold">ID Inversionista</label>
            <Input
              type="number"
              min={1}
              value={inversionistaId ?? ""}
              onChange={(e) => setInversionistaId(Number(e.target.value))}
              placeholder="ID"
              className="border-2 border-blue-600 text-blue-900 font-semibold bg-white focus:ring-2 focus:ring-blue-400 w-[120px]"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setSifco("");
              setMes(new Date().getMonth() + 1);
              setAnio(new Date().getFullYear());
              setDia(undefined);
              setInversionistaId(undefined);
              setPage(1);
            }}
            className="self-end px-3 py-2 rounded-lg bg-blue-100 border border-blue-400 text-blue-800 font-bold hover:bg-blue-200"
          >
            Limpiar filtro
          </button>
        </div>

        {isLoading ? (
          <div className="text-blue-700 font-bold p-6 text-center">Cargando pagos...</div>
        ) : pagos.length === 0 ? (
          <div className="text-blue-700 font-semibold text-center py-8">
            No hay pagos para los filtros seleccionados.
          </div>
        ) : (
          <>
            {/* tabla */}
            <div className="overflow-x-auto rounded-xl bg-white shadow border border-blue-100">
              <Table className="min-w-[1100px] border-separate border-spacing-y-1">
                <TableHeader>
                  <TableRow className="bg-blue-100">
                    <TableHead className="w-12 text-center"></TableHead>
                    <TableHead className="text-center font-bold text-blue-800">SIFCO</TableHead>
                    <TableHead className="text-center font-bold text-blue-800">Monto Boleta</TableHead>
                    <TableHead className="text-center font-bold text-blue-800">Fecha Pago</TableHead>
                    <TableHead className="text-center font-bold text-blue-800">Usuario</TableHead>
                    <TableHead className="text-center font-bold text-blue-800">Cuota</TableHead>
                    <TableHead className="text-center font-bold text-blue-800">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagos.map((pago, idx) => (
                    <React.Fragment key={pago.pagoId}>
                      <TableRow
                        className={`hover:bg-blue-50 cursor-pointer ${
                          openIdx === idx ? "ring-2 ring-blue-300" : ""
                        }`}
                        onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                      >
                        <TableCell className="text-center">
                          {openIdx === idx ? <ChevronUp /> : <ChevronDown />}
                        </TableCell>
                        <TableCell className="text-center text-blue-700 font-bold">
                          {pago.numeroCredito}
                        </TableCell>
                        <TableCell className="text-center text-green-800 font-bold">
                          {formatCurrency(pago.montoBoleta)}
                        </TableCell>
                        <TableCell className="text-center text-blue-700 font-bold">
                          {formatDate(pago.fechaPago)}
                        </TableCell>
                        <TableCell className="text-center text-blue-900 font-semibold">
                          {pago.usuarioNombre}
                        </TableCell>
                        <TableCell className="text-center text-indigo-700 font-semibold">
                          {pago.cuota?.numeroCuota ?? "--"}
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenInversionistas(pago.inversionistas);
                            }}
                            className="text-blue-700 hover:text-blue-900 flex items-center gap-1 font-semibold"
                          >
                            <Users2 className="w-4 h-4" /> Ver Inversionistas
                          </button>
                        </TableCell>
                      </TableRow>

                      {openIdx === idx && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-blue-50 p-4">
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {[
                                { label: "Pago ID", value: pago.pagoId },
                                { label: "Crédito ID", value: pago.creditoId },
                                { label: "Capital Crédito", value: formatCurrency(pago.capital) },
                                { label: "Deuda Total", value: formatCurrency(pago.deudaTotal) },
                                { label: "Abono Interés", value: formatCurrency(pago.abono_interes) },
                                { label: "Abono IVA 12%", value: formatCurrency(pago.abono_iva_12) },
                                { label: "Abono Interés CI", value: formatCurrency(pago.abono_interes_ci) },
                                { label: "Abono IVA CI", value: formatCurrency(pago.abono_iva_ci) },
                                { label: "Abono Seguro", value: formatCurrency(pago.abono_seguro) },
                                { label: "Abono GPS", value: formatCurrency(pago.abono_gps) },
                                { label: "Fecha Vencimiento", value: formatDate(pago.cuota?.fechaVencimiento) },
                                { label: "Pagado", value: pago.cuota?.pagado ? "Sí" : "No" },
                                {
                                  label: "Boleta",
                                  value: pago.boleta?.urlBoleta ? (
                                    <a
                                      href={pago.boleta.urlBoleta}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-700 underline"
                                    >
                                      Ver Boleta
                                    </a>
                                  ) : (
                                    "--"
                                  ),
                                },
                              ].map((f, i) => (
                                <div
                                  key={i}
                                  className="bg-white border border-blue-200 rounded-lg px-3 py-2 shadow-sm flex flex-col"
                                >
                                  <span className="text-blue-800 font-bold">{f.label}</span>
                                  <span className="text-blue-900 font-semibold">{f.value ?? "--"}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* paginación */}
            <div className="flex justify-between items-center mt-6">
              <button
                className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="mr-1" /> Anterior
              </button>
              <div className="text-blue-900 font-semibold">
                Página {page} de {totalPages} ({data?.total ?? 0} pagos)
              </div>
              <button
                className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Siguiente <ChevronRight className="ml-1" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* modal inversionistas */}
      <ModalInversionistas
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        inversionistas={selectedInv}
      />
    </div>
  );
}

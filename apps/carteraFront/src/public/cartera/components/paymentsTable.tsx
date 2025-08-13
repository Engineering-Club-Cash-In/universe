/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BadgeDollarSign,
  CalendarDays,
  Hash,
  Info,
  FileText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePagosByMesAnio } from "../hooks/payments";

// ---- utilidades ----
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
const years = Array.from(
  { length: currentYear + 2 - 2020 + 1 },
  (_, i) => 2020 + i
);

function formatCurrency(val: any) {
  if (val == null) return "--";
  return Number(val).toLocaleString("es-GT", {
    style: "currency",
    currency: "GTQ",
    minimumFractionDigits: 2,
  });
}
function formatDate(dateStr: string) {
  return dateStr ? new Date(dateStr).toLocaleDateString("es-GT") : "--";
}

// ---- componente principal ----
export function PaymentsTable() {
  const [mes, setMes] = React.useState(new Date().getMonth() + 1);
  const [anio, setAnio] = React.useState(new Date().getFullYear());
  const [sifcoFilter, setSifcoFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  const perPage = 10;
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);

  const { pagos, loading, totalPages, totalItems } = usePagosByMesAnio(
    mes,
    anio,
    page,
    perPage
  );

  // Filtro local por SIFCO
  const pagosFiltrados = React.useMemo(() => {
    if (!sifcoFilter.trim()) return pagos;
    return pagos.filter((row) =>
      row.numero_credito_sifco
        ?.toString()
        .toLowerCase()
        .includes(sifcoFilter.trim().toLowerCase())
    );
  }, [pagos, sifcoFilter]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <div className="bg-blue-50 rounded-xl shadow-md p-4 sm:p-6 mb-5  ">
        <h2 className="text-2xl font-bold text-blue-900 mb-3 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-blue-700" />
          Pagos registrados por mes/año
        </h2>
        {/* Filtros responsivos */}
        <div
          className="
      flex flex-col
      gap-3 sm:gap-5
      sm:flex-row sm:items-end
      sm:flex-wrap
      md:gap-8
      mb-4
      w-full
      "
        >
          <div className="w-full sm:w-auto flex flex-col">
            <label className="block text-blue-900 font-semibold">Año:</label>
            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="w-full min-w-[80px] border border-blue-300 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-auto flex flex-col">
            <label className="block text-blue-900 font-semibold">Mes:</label>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="w-full min-w-[100px] border border-blue-300 rounded px-2 py-1 text-blue-900 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {meses.map((nombre, i) => (
                <option key={i + 1} value={i + 1}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-auto flex flex-col">
            <label className="block text-blue-900 font-semibold">
              Filtrar por SIFCO:
            </label>
            <Input
              type="text"
              value={sifcoFilter}
              onChange={(e) => setSifcoFilter(e.target.value)}
              placeholder="Núm. de SIFCO"
              className="w-full min-w-[110px] border-2 border-blue-800 text-blue-900 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-700 placeholder:text-blue-400"
            />
          </div>
          <div className="w-full sm:w-auto flex flex-col">
            <button
              type="button"
              className="mt-2 sm:mt-0 px-3 py-2 rounded-lg bg-blue-100 hover:bg-blue-200 border border-blue-300 text-blue-800 font-bold transition shadow flex items-center gap-2 justify-center"
              onClick={() => {
                setSifcoFilter("");
                setMes(new Date().getMonth() + 1);
                setAnio(new Date().getFullYear());
              }}
              title="Limpiar filtro"
            >
              Limpiar filtro
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-blue-700 font-bold p-6 text-center">
            Cargando pagos...
          </div>
        ) : (
          <>
            <div className="w-full overflow-x-auto rounded-2xl bg-white shadow border border-blue-100 hidden xl:block">
              <Table className="min-w-[1100px] w-full border-separate border-spacing-y-1">
                <TableHeader>
                  <TableRow className="bg-blue-100 border-b-2 border-blue-200">
                    <TableHead className="w-12 text-center"></TableHead>
                    <TableHead className="text-center font-bold text-blue-800">
                      #
                    </TableHead>
                    <TableHead className="text-center font-bold text-blue-800">
                      <Hash className="inline w-4 h-4 text-indigo-700" /> SIFCO
                    </TableHead>
                    <TableHead className="text-center font-bold text-blue-800">
                      <BadgeDollarSign className="inline w-4 h-4 text-green-600" />{" "}
                      Monto Boleta
                    </TableHead>
                    <TableHead className="text-center font-bold text-blue-800">
                      <CalendarDays className="inline w-4 h-4 text-blue-500" />{" "}
                      Fecha Pago
                    </TableHead>
                    <TableHead className="text-center font-bold text-blue-800">
                      Cuota
                    </TableHead>
                    <TableHead className="text-center font-bold text-blue-800">
                      Pagado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagosFiltrados.map((row: any, idx: number) => (
                    <React.Fragment key={row.pagos_credito?.pago_id ?? idx}>
                      {/* Fila principal */}
                      <TableRow
                        className={`hover:bg-blue-50 transition cursor-pointer ${
                          openIdx === idx ? "ring-2 ring-blue-300" : ""
                        }`}
                        onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                      >
                        <TableCell className="text-center align-middle">
                          {openIdx === idx ? (
                            <ChevronUp className="mx-auto text-blue-500" />
                          ) : (
                            <ChevronDown className="mx-auto text-blue-400" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {(page - 1) * perPage + idx + 1}
                        </TableCell>
                        <TableCell className="text-center text-blue-700 font-bold">
                          {row.numero_credito_sifco}
                        </TableCell>
                        <TableCell className="text-center text-green-800 font-bold">
                          {formatCurrency(row?.monto_boleta)}
                        </TableCell>
                        <TableCell className="text-center text-blue-700 font-bold">
                          {formatDate(row?.fecha_pago)}
                        </TableCell>
                        <TableCell className="text-center text-indigo-700 font-semibold">
                          {formatCurrency(row?.cuota)}
                        </TableCell>
                        <TableCell className="text-center">
                          {row?.pagado ? (
                            <span className="px-2 py-1 rounded bg-green-100 text-green-700 font-bold flex items-center justify-center gap-1">
                              <BadgeDollarSign className="w-4 h-4" /> Sí
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded bg-red-100 text-red-600 font-bold flex items-center justify-center gap-1">
                              <FileText className="w-4 h-4" /> No
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                      {/* Row expandida */}
                      {openIdx === idx && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="p-0 bg-blue-50 rounded-b-2xl"
                          >
                            <div className="px-8 py-5 grid grid-cols-1 md:grid-cols-3 gap-6 text-base place-items-center">
                              {/* Aquí tus campos con iconos, puedes ajustar el grid igual que en la otra tabla */}
                              {[
                                {
                                  label: "ID pago",
                                  value: row.pago_id,
                                  icon: (
                                    <Hash className="w-4 h-4 text-blue-700" />
                                  ),
                                },
                                {
                                  label: "ID crédito",
                                  value: row.credito_id,
                                  icon: (
                                    <Hash className="w-4 h-4 text-blue-700" />
                                  ),
                                },
                                {
                                  label: "# cuota",
                                  value: row.numero_cuota,
                                  icon: (
                                    <Info className="w-4 h-4 text-indigo-700" />
                                  ),
                                },
                                {
                                  label: "Fecha pago",
                                  value: formatDate(row.fecha_pago),
                                  icon: (
                                    <CalendarDays className="w-4 h-4 text-blue-500" />
                                  ),
                                },
                                {
                                  label: "Monto boleta",
                                  value: formatCurrency(row.monto_boleta),
                                  icon: (
                                    <BadgeDollarSign className="w-4 h-4 text-green-700" />
                                  ),
                                },
                                {
                                  label: "Cuota",
                                  value: formatCurrency(row.cuota),
                                  icon: (
                                    <BadgeDollarSign className="w-4 h-4 text-indigo-600" />
                                  ),
                                },
                                {
                                  label: "Abono capital",
                                  value: formatCurrency(row.abono_capital),
                                  icon: (
                                    <BadgeDollarSign className="w-4 h-4 text-blue-800" />
                                  ),
                                },
                                {
                                  label: "Capital restante",
                                  value: formatCurrency(row.capital_restante),
                                  icon: (
                                    <BadgeDollarSign className="w-4 h-4 text-blue-700" />
                                  ),
                                },
                                {
                                  label: "Otros",
                                  value: row.otros,
                                  icon: (
                                    <Info className="w-4 h-4 text-blue-400" />
                                  ),
                                },
                                {
                                  label: "Mora",
                                  value: formatCurrency(row.mora),
                                  icon: (
                                    <BadgeDollarSign className="w-4 h-4 text-red-400" />
                                  ),
                                },
                                {
                                  label: "Pagado",
                                  value: row.pagado ? "Sí" : "No",
                                  icon: (
                                    <BadgeDollarSign className="w-4 h-4 text-green-600" />
                                  ),
                                },
                                {
                                  label: "Mes pagado",
                                  value: row.mes_pagado || "--",
                                  icon: (
                                    <CalendarDays className="w-4 h-4 text-blue-400" />
                                  ),
                                },
                                {
                                  label: "Observaciones",
                                  value: row.observaciones || "--",
                                  icon: (
                                    <FileText className="w-4 h-4 text-blue-400" />
                                  ),
                                },
                                {
                                  label: "Boleta",
                                  value:
                                    Array.isArray(row.boletas) &&
                                    row.boletas.length > 0 ? (
                                      <div className="flex flex-col gap-1">
                                        {row.boletas.map(
                                          (
                                            url: string | undefined,
                                            idx: React.Key | null | undefined
                                          ) => (
                                            <a
                                              key={idx}
                                              href={url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="underline text-blue-600 hover:text-blue-900"
                                            >
                                              Ver boleta #
                                              {row.boletas.length > 1
                                                ? typeof idx === "number"
                                                  ? idx + 1
                                                  : ""
                                                : ""}
                                            </a>
                                          )
                                        )}
                                      </div>
                                    ) : (
                                      "--"
                                    ),
                                  icon: (
                                    <FileText className="w-4 h-4 text-blue-600" />
                                  ),
                                },
                              ].map((field, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-white shadow-sm w-full"
                                >
                                  {field.icon}
                                  <span className="font-bold text-blue-800">
                                    {field.label}:
                                  </span>
                                  <span className="ml-1 text-blue-900 font-semibold">
                                    {field.value ?? "--"}
                                  </span>
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
            {/* LISTA - Solo mobile */}
            <div className="xl:hidden flex flex-col gap-4 mt-4">
              {pagosFiltrados.length === 0 ? (
                <div className="text-blue-700 font-semibold text-center py-8">
                  No hay pagos para el mes/año o filtro seleccionado.
                </div>
              ) : (
                pagosFiltrados.map((row: any, idx: number) => (
                  <div
                    key={row.pagos_credito?.pago_id ?? idx}
                    className="bg-white border border-blue-200 rounded-xl shadow p-4 flex flex-col gap-2"
                  >
                    <button
                      className="flex justify-between items-center mb-2 w-full focus:outline-none"
                      onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
                    >
                      <span className="text-blue-900 font-bold text-lg flex items-center gap-1">
                        <Hash className="w-4 h-4 text-indigo-700" />
                        {row.numero_credito_sifco}
                      </span>
                      <span className="text-green-800 font-extrabold text-lg flex items-center gap-1">
                        <BadgeDollarSign className="w-4 h-4 text-green-600" />
                        {formatCurrency(row?.monto_boleta)}
                        {openIdx === idx ? (
                          <ChevronUp className="ml-2 w-5 h-5 text-blue-700" />
                        ) : (
                          <ChevronDown className="ml-2 w-5 h-5 text-blue-400" />
                        )}
                      </span>
                    </button>
                    {/* Resumen siempre visible */}
                    <div className="flex flex-col gap-1 text-sm text-blue-800">
                      <div className="flex items-center gap-1">
                        <CalendarDays className="w-4 h-4 text-blue-500" />
                        Fecha pago:{" "}
                        <span className="font-bold">
                          {formatDate(row?.fecha_pago)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Info className="w-4 h-4 text-indigo-700" />
                        Cuota:{" "}
                        <span className="font-bold">
                          {formatCurrency(row?.cuota)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <BadgeDollarSign className="w-4 h-4 text-green-600" />
                        Pagado:{" "}
                        <span
                          className={`font-bold ${
                            row?.pagado ? "text-green-700" : "text-red-600"
                          }`}
                        >
                          {row?.pagado ? "Sí" : "No"}
                        </span>
                      </div>
                      {row?.url_boleta && (
                        <div className="flex items-center gap-1">
                          <FileText className="w-4 h-4 text-blue-400" />
                          <a
                            href={row.url_boleta}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-blue-600 hover:text-blue-900 font-semibold"
                          >
                            Ver boleta
                          </a>
                        </div>
                      )}
                    </div>
                    {/* Collapse details */}
                    {openIdx === idx && (
                      <div className="grid grid-cols-1 gap-2 mt-4 animate-fade-in">
                        {[
                          {
                            label: "ID pago",
                            value: row.pago_id,
                            icon: <Hash className="w-4 h-4 text-blue-700" />,
                          },
                          {
                            label: "ID crédito",
                            value: row.credito_id,
                            icon: <Hash className="w-4 h-4 text-blue-700" />,
                          },
                          {
                            label: "# cuota",
                            value: row.numero_cuota,
                            icon: <Info className="w-4 h-4 text-indigo-700" />,
                          },
                          {
                            label: "Fecha pago",
                            value: formatDate(row.fecha_pago),
                            icon: (
                              <CalendarDays className="w-4 h-4 text-blue-500" />
                            ),
                          },
                          {
                            label: "Monto boleta",
                            value: formatCurrency(row.monto_boleta),
                            icon: (
                              <BadgeDollarSign className="w-4 h-4 text-green-700" />
                            ),
                          },
                          {
                            label: "Cuota",
                            value: formatCurrency(row.cuota),
                            icon: (
                              <BadgeDollarSign className="w-4 h-4 text-indigo-600" />
                            ),
                          },
                          {
                            label: "Abono capital",
                            value: formatCurrency(row.abono_capital),
                            icon: (
                              <BadgeDollarSign className="w-4 h-4 text-blue-800" />
                            ),
                          },
                          {
                            label: "Capital restante",
                            value: formatCurrency(row.capital_restante),
                            icon: (
                              <BadgeDollarSign className="w-4 h-4 text-blue-700" />
                            ),
                          },
                          {
                            label: "Otros",
                            value: row.otros,
                            icon: <Info className="w-4 h-4 text-blue-400" />,
                          },
                          {
                            label: "Mora",
                            value: formatCurrency(row.mora),
                            icon: (
                              <BadgeDollarSign className="w-4 h-4 text-red-400" />
                            ),
                          },
                          {
                            label: "Pagado",
                            value: row.pagado ? "Sí" : "No",
                            icon: (
                              <BadgeDollarSign className="w-4 h-4 text-green-600" />
                            ),
                          },
                          {
                            label: "Mes pagado",
                            value: row.mes_pagado || "--",
                            icon: (
                              <CalendarDays className="w-4 h-4 text-blue-400" />
                            ),
                          },
                          {
                            label: "Observaciones",
                            value: row.observaciones || "--",
                            icon: (
                              <FileText className="w-4 h-4 text-blue-400" />
                            ),
                          },
                          {
                            label: "Boleta",
                            value:
                              Array.isArray(row.boletas) &&
                              row.boletas.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  {row.boletas.map((url: string | undefined, idx: React.Key | null | undefined) => (
                                    <a
                                      key={idx}
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline text-blue-600 hover:text-blue-900"
                                    >
                                      Ver boleta #
                                      {row.boletas.length > 1 ? (typeof idx === "number" ? idx + 1 : "") : ""}
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                "--"
                              ),
                            icon: (
                              <FileText className="w-4 h-4 text-blue-600" />
                            ),
                          },
                        ].map((field, fieldIdx) => (
                          <div
                            key={fieldIdx}
                            className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-blue-50 shadow-sm w-full"
                          >
                            {field.icon}
                            <span className="font-bold text-blue-800">
                              {field.label}:
                            </span>
                            <span className="ml-1 text-blue-900 font-semibold">
                              {field.value ?? "--"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {pagosFiltrados.length === 0 && (
              <div className="p-6 text-blue-700 font-semibold text-center">
                No hay pagos para el mes/año o filtro seleccionado.
              </div>
            )}
            {/* Paginación */}
            <div className="flex justify-between items-center mt-6">
              <button
                className="flex items-center px-4 py-2 rounded bg-blue-100 text-blue-800 font-bold disabled:opacity-50"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="mr-1" /> Anterior
              </button>
              <div className="text-blue-900 font-semibold">
                Página {page} de {totalPages} ({totalItems} pagos)
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
    </div>
  );
}

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useGetInvestors } from "../hooks/getInvestor";
import { useCatalogs } from "../hooks/catalogs";
import type { Investor, InvestorPayload } from "../services/services";
import { useLiquidateByInvestor } from "../hooks/liquidateAllInvestor";
import { useDownloadInvestorPDF } from "../hooks/downloadInvestorReport";
import { Spinner } from "./spinner";
import { InvestorModal } from "./modalInvestor";
import { useInvestor } from "../hooks/investor";
const PER_PAGE_OPTIONS = [5, 10, 20, 50];

export function TableInvestors() {
  const downloadPDF = useDownloadInvestorPDF();
  const [selectedInvestor, setSelectedInvestor] = useState<number | "">(1);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [expandedCredit, setExpandedCredit] = useState<number | null>(null);
  const liquidateMutation = useLiquidateByInvestor();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "update">("create");
  const [selectedInvestorData, setSelectedInvestorData] =
    useState<InvestorPayload | null>(null);
const { resumenExcelMutation } = useInvestor();
  // Catálogo de inversionistas (para el filtro)
  const { investors = [], loading: loadingCatalogs } = useCatalogs() as {
    investors: Investor[];
    loading: boolean;
  };
 
  // Consulta con paginación y filtro por id
  const { data, isLoading, isError, isFetching, refetch } = useGetInvestors({
    id: selectedInvestor !== "" ? Number(selectedInvestor) : undefined,
    page,
    perPage,
  });
  const tienePagosPendientes =
    data?.inversionistas.some((inv) =>
      inv.creditosData.some((cred) => cred.pagos && cred.pagos.length > 0)
    ) ?? false;

  console.log(
    "[DEBUG] ¿Algún inversionista tiene pagos pendientes?:",
    tienePagosPendientes
  );

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <InvestorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={mode}
        initialData={selectedInvestorData || undefined}
      />
      <h2 className="text-3xl font-extrabold text-blue-700 mb-6 text-center">
        Inversionistas y sus Créditos
      </h2>
      <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center sm:justify-between gap-3 mb-5">
        {/* Select inversionista */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <label className="text-blue-900 font-bold" htmlFor="investor-filter">
            Filtrar inversionista:
          </label>
          <select
            id="investor-filter"
            className="border border-blue-300 rounded-lg px-3 py-2 bg-blue-50 text-blue-900 focus:ring-2 focus:ring-blue-400"
            value={selectedInvestor}
            onChange={(e) => {
              setSelectedInvestor(
                e.target.value === "" ? "" : Number(e.target.value)
              );
              setPage(1);
              setExpandedRow(null);
              setExpandedCredit(null);
            }}
            disabled={loadingCatalogs}
          >
            <option value="">Todos</option>
            {investors.map((inv) => (
              <option key={inv.inversionista_id} value={inv.inversionista_id}>
                {inv.nombre}
              </option>
            ))}
          </select>
        </div>{" "}
     <div className="flex flex-col sm:flex-row sm:items-center gap-3">
  <button
    onClick={() => {
      setMode("create");
      setSelectedInvestor("");
      setModalOpen(true);
    }}
    className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 transition"
  >
    + Nuevo Inversionista
  </button>
<button
  onClick={() => {
    resumenExcelMutation.mutate(
      { mes: 9, anio: 2025 }, // o params dinámicos
      {
        onSuccess: (res) => {
          if ("url" in res) {
            window.open(res.url, "_blank"); // abre el Excel directo
          }
        },
      }
    );
  }}
  disabled={resumenExcelMutation.isPending}
  className="px-4 py-2 rounded-lg bg-indigo-500 text-white font-bold hover:bg-indigo-600 transition"
>
  {resumenExcelMutation.isPending ? "Generando..." : "📊 Resumen General"}
</button>
</div>
        {/* Select por página */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <label className="text-blue-900 font-bold" htmlFor="per-page">
            Por página:
          </label>
          <select
            id="per-page"
            className="border border-blue-300 rounded-lg px-2 py-1 bg-blue-50 text-blue-900 focus:ring-2 focus:ring-blue-400"
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
              setExpandedRow(null);
              setExpandedCredit(null);
            }}
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {/* Info paginación */}
      </div>

      {/* Tabla principal */}
      {isLoading || isFetching ? (
        <div className="p-8 text-blue-600 text-lg">
          Cargando inversionistas...
        </div>
      ) : isError ? (
        <div className="p-8 text-red-600">Error al cargar datos.</div>
      ) : (
        <div className="hidden xl:block">
          <div className="max-w-6xl mx-auto">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="bg-blue-50">
                  <TableHead></TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Nombre
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Banco
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Tipo Cuenta
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Número Cuenta
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Reinversión
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Total Capital
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Total Interés
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Emite Factura
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Total Cuota
                  </TableHead>
                  <TableHead className="text-blue-900 font-bold">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.inversionistas.map((inv, idx) => (
                  <>
                    <TableRow
                      key={inv.inversionista_id}
                      className="hover:bg-blue-50 cursor-pointer transition"
                      onClick={() => {
                        setExpandedRow(expandedRow === idx ? null : idx);
                        setExpandedCredit(null);
                      }}
                    >
                      <TableCell className="text-center">
                        {expandedRow === idx ? (
                          <ChevronUp className="w-5 h-5 text-blue-500" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-blue-400" />
                        )}
                      </TableCell>
                      <TableCell className="font-bold text-blue-800">
                        {inv.inversionista}
                      </TableCell>
                      <TableCell className="font-bold text-blue-800">
                        {inv.banco || "--"}
                      </TableCell>
                      <TableCell className="font-bold text-blue-800">
                        {inv.tipo_cuenta || "--"}
                      </TableCell>
                      <TableCell className="font-bold text-blue-800">
                        {inv.numero_cuenta || "--"}
                      </TableCell>
                      <TableCell className="font-bold text-blue-800">
                        {inv.reinversion ? "Sí" : "No"}
                      </TableCell>
                      <TableCell className="text-blue-700">
                        Q
                        {Number(
                          inv.subtotal.total_abono_capital ?? 0
                        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-indigo-700">
                        Q
                        {Number(
                          inv.subtotal.total_abono_interes ?? 0
                        ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-indigo-700">
                        {inv.emite_factura ? "Sí" : "No"}
                      </TableCell>
                      <TableCell className="text-green-700 font-bold">
                        Q
                        {Number(inv.subtotal.total_cuota ?? 0).toLocaleString(
                          "es-GT",
                          { minimumFractionDigits: 2 }
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-col gap-2">
                          <button
                            className="px-3 py-1 rounded-lg bg-blue-500 text-white font-bold hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                            aria-busy={downloadPDF.isPending}
                            onClick={() =>
                              downloadPDF.mutate({ id: inv.inversionista_id })
                            }
                          >
                            {downloadPDF.isPending ? (
                              <>
                                <Spinner />
                                <span>Descargando…</span>
                              </>
                            ) : (
                              "Descargar PDF"
                            )}
                          </button>

                          <button
                            className="px-3 py-1 rounded-lg bg-green-500 text-white font-bold hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                            aria-busy={liquidateMutation.isPending}
                            onClick={() => {
                              liquidateMutation.mutate(
                                { inversionista_id: inv.inversionista_id },
                                {
                                  onSuccess: () => {
                                    refetch();
                                  },
                                }
                              );
                            }}
                          >
                            {liquidateMutation.isPending ? (
                              <>
                                <Spinner />
                                <span>Liquidando…</span>
                              </>
                            ) : (
                              "Liquidar"
                            )}
                          </button>

                          <button
                            onClick={() => {
                              setMode("update");
                              setSelectedInvestorData({
                                inversionista_id: inv.inversionista_id,
                                nombre: inv.inversionista,
                                emite_factura: inv.emite_factura,
                                reinversion: inv.reinversion, // si tu backend devuelve esto lo mapeas
                                banco: inv.banco, // igual acá
                                tipo_cuenta: inv.tipo_cuenta,
                                numero_cuenta: inv.numero_cuenta,
                              });
                              setModalOpen(true);
                            }}
                            className="px-3 py-1 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white font-bold"
                          >
                            Editar
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {/* Colapsable con créditos y subtotales */}
                    {expandedRow === idx && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="bg-white px-6 py-6 border-b-2 border-blue-100"
                        >
                          {/* --- Subtotal Card --- */}
                          <div className="mb-5">
                            <div className="font-extrabold text-indigo-700 mb-3 text-lg flex items-center gap-2">
                              <span className="inline-block text-2xl">💰</span>{" "}
                              Subtotal Inversionista:
                            </div>
                            <div className="border border-blue-300 rounded-xl p-6 bg-indigo-50 shadow flex flex-wrap gap-10 justify-start text-lg">
                              <div>
                                <span className="font-bold text-blue-900">
                                  Total Capital:{" "}
                                </span>
                                <span className="text-blue-800 font-bold">
                                  Q
                                  {Number(
                                    inv.subtotal?.total_abono_capital ?? 0
                                  ).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                              <div>
                                <span className="font-bold text-blue-900">
                                  Total Interés:{" "}
                                </span>
                                <span className="text-indigo-700 font-bold">
                                  Q
                                  {Number(
                                    inv.subtotal?.total_abono_interes ?? 0
                                  ).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                              <div>
                                <span className="font-bold text-blue-900">
                                  Total IVA:{" "}
                                </span>
                                <span className="text-violet-700 font-bold">
                                  Q
                                  {Number(
                                    inv.subtotal?.total_abono_iva ?? 0
                                  ).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                              <div>
                                <span className="font-bold text-blue-900">
                                  Total ISR:{" "}
                                </span>
                                <span className="text-yellow-700 font-bold">
                                  Q
                                  {Number(
                                    inv.subtotal?.total_isr ?? 0
                                  ).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                              <div>
                                <span className="font-bold text-blue-900">
                                  Total Cuota:{" "}
                                </span>
                                <span className="text-green-700 font-bold">
                                  Q
                                  {Number(
                                    inv.subtotal?.total_cuota ?? 0
                                  ).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                            </div>
                          </div>
                          {/* --- Créditos Asociados --- */}
                          <div>
                            <div className="font-bold text-blue-900 mb-4 text-lg">
                              Créditos Asociados:
                            </div>
                            <Table className="w-full mb-2">
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-blue-900 font-bold"></TableHead>
                                  <TableHead className="text-blue-900 font-bold">
                                    # Crédito
                                  </TableHead>
                                  <TableHead className="text-blue-900 font-bold">
                                    Cliente
                                  </TableHead>
                                  <TableHead className="text-blue-900 font-bold">
                                    NIT
                                  </TableHead>
                                  <TableHead className="text-blue-900 font-bold">
                                    Capital
                                  </TableHead>
                                  <TableHead className="text-indigo-700 font-bold">
                                    % Interés
                                  </TableHead>
                                  <TableHead className="text-indigo-700 font-bold">
                                    Plazo
                                  </TableHead>

                                  <TableHead className="text-indigo-700 font-bold">
                                    Credito Capital
                                  </TableHead>

                                  <TableHead className="text-blue-700 font-bold">
                                    Suma Abono Capital
                                  </TableHead>
                                  <TableHead className="text-indigo-700 font-bold">
                                    Suma Abono Interés
                                  </TableHead>
                                  <TableHead className="text-violet-700 font-bold">
                                    Suma Abono IVA
                                  </TableHead>
                                  <TableHead className="text-yellow-700 font-bold">
                                    Suma ISR
                                  </TableHead>
                                  <TableHead className="text-green-700 font-bold">
                                    Total a Recibir
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {inv.creditosData.length === 0 ? (
                                  <TableRow>
                                    <TableCell
                                      colSpan={15}
                                      className="text-center text-gray-500"
                                    >
                                      Este inversionista no tiene créditos
                                      asociados.
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  inv.creditosData.map((cred) => (
                                    <>
                                      <TableRow
                                        key={cred.credito_id}
                                        className="hover:bg-blue-100 cursor-pointer"
                                        onClick={() =>
                                          setExpandedCredit(
                                            expandedCredit === cred.credito_id
                                              ? null
                                              : cred.credito_id
                                          )
                                        }
                                      >
                                        <TableCell className="text-center">
                                          {expandedCredit ===
                                          cred.credito_id ? (
                                            <ChevronUp className="w-5 h-5 text-indigo-500" />
                                          ) : (
                                            <ChevronDown className="w-5 h-5 text-indigo-400" />
                                          )}
                                        </TableCell>
                                        <TableCell className="text-blue-900 font-bold">
                                          {cred.numero_credito_sifco}
                                        </TableCell>
                                        <TableCell className="text-blue-900 font-bold">
                                          {cred.nombre_usuario}
                                        </TableCell>
                                        <TableCell className="text-blue-900 font-bold">
                                          {cred.nit_usuario}
                                        </TableCell>
                                        <TableCell className="text-blue-900 font-bold">
                                          Q
                                          {Number(
                                            cred.monto_aportado
                                          ).toLocaleString("es-GT", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </TableCell>
                                        <TableCell className="text-indigo-700 font-bold">
                                          {cred.porcentaje_interes}%
                                        </TableCell>
                                        <TableCell className="text-blue-900 font-bold">
                                          {cred.meses_en_credito}
                                        </TableCell>
                                        <TableCell className="text-blue-900 font-bold">
                                          Q
                                          {Number(cred.capital).toLocaleString(
                                            "es-GT",
                                            { minimumFractionDigits: 2 }
                                          )}
                                        </TableCell>

                                        <TableCell className="text-blue-700 font-bold">
                                          Q
                                          {Number(
                                            cred.total_abono_capital
                                          ).toLocaleString("es-GT", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </TableCell>
                                        <TableCell className="text-indigo-700 font-bold">
                                          Q
                                          {Number(
                                            cred.total_abono_interes
                                          ).toLocaleString("es-GT", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </TableCell>
                                        <TableCell className="text-violet-700 font-bold">
                                          Q
                                          {Number(
                                            cred.total_abono_iva
                                          ).toLocaleString("es-GT", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </TableCell>
                                        <TableCell className="text-yellow-700 font-bold">
                                          Q
                                          {Number(
                                            cred.total_isr
                                          ).toLocaleString("es-GT", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </TableCell>
                                        <TableCell className="text-green-700 font-bold">
                                          Q
                                          {Number(
                                            cred.total_cuota
                                          ).toLocaleString("es-GT", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </TableCell>
                                      </TableRow>
                                      {/* Pagos no liquidados para este crédito */}
                                      {expandedCredit === cred.credito_id && (
                                        <TableRow>
                                          <TableCell
                                            colSpan={15}
                                            className="bg-blue-50 p-5"
                                          >
                                            <div className="font-extrabold text-blue-700 mb-3 flex items-center gap-2 text-lg">
                                              <span className="inline-block text-2xl">
                                                💸
                                              </span>{" "}
                                              Pagos No Liquidados:
                                            </div>
                                            <Table className="w-full">
                                              <TableHeader>
                                                <TableRow className="bg-indigo-50">
                                                  <TableHead className="text-blue-800 font-bold">
                                                    % Inversionista
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold">
                                                    % TASA INTERES INVERSOR
                                                  </TableHead>
                                                  <TableHead className="text-violet-800 font-bold">
                                                    Cuota Inversionista
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold">
                                                    Iva
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold">
                                                    ISR
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold">
                                                    Abono Capital
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold">
                                                    % Inversor
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold">
                                                    Mes
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold">
                                                    Fecha Pago
                                                  </TableHead>
                                                  <TableHead className="text-blue-800 font-bold"></TableHead>
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                {cred.pagos &&
                                                cred.pagos.length > 0 ? (
                                                  cred.pagos.map(
                                                    (pago, pagoIdx) => (
                                                      <TableRow
                                                        key={pagoIdx}
                                                        className="hover:bg-white transition"
                                                      >
                                                        <TableCell className="font-bold text-indigo-700">
                                                          {Number(
                                                            pago.porcentaje_inversor
                                                          )}{" "}
                                                          %
                                                        </TableCell>
                                                        <TableCell className="font-bold text-indigo-700">
                                                          {Number(
                                                            pago.tasaInteresInvesor
                                                          )}{" "}
                                                          %
                                                        </TableCell>
                                                        <TableCell className="font-bold text-violet-700">
                                                          Q
                                                          {Number(
                                                            pago.abono_interes
                                                          ).toLocaleString(
                                                            "es-GT",
                                                            {
                                                              minimumFractionDigits: 2,
                                                            }
                                                          )}
                                                        </TableCell>
                                                        <TableCell className="font-bold text-violet-700">
                                                          Q
                                                          {Number(
                                                            pago.abono_iva
                                                          ).toLocaleString(
                                                            "es-GT",
                                                            {
                                                              minimumFractionDigits: 2,
                                                            }
                                                          )}
                                                        </TableCell>
                                                        <TableCell className="font-bold text-yellow-700">
                                                          Q
                                                          {Number(
                                                            pago.isr
                                                          ).toLocaleString(
                                                            "es-GT",
                                                            {
                                                              minimumFractionDigits: 2,
                                                            }
                                                          )}
                                                        </TableCell>
                                                        <TableCell className="font-bold text-blue-700">
                                                          Q
                                                          {Number(
                                                            pago.abono_capital
                                                          ).toLocaleString(
                                                            "es-GT",
                                                            {
                                                              minimumFractionDigits: 2,
                                                            }
                                                          )}
                                                        </TableCell>
                                                        <TableCell className="font-bold text-indigo-700">
                                                          Q
                                                          {Number(
                                                            pago.abonoGeneralInteres
                                                          ).toLocaleString(
                                                            "es-GT",
                                                            {
                                                              minimumFractionDigits: 2,
                                                            }
                                                          )}
                                                        </TableCell>
                                                        <TableCell className="font-semibold text-blue-900">
                                                          {pago.mes ?? "--"}
                                                        </TableCell>
                                                        <TableCell className="text-blue-900">
                                                          {pago.fecha_pago
                                                            ? new Date(
                                                                pago.fecha_pago
                                                              ).toLocaleDateString(
                                                                "es-GT"
                                                              )
                                                            : "--"}
                                                        </TableCell>
                                                      </TableRow>
                                                    )
                                                  )
                                                ) : (
                                                  <TableRow>
                                                    <TableCell
                                                      colSpan={8}
                                                      className="text-center text-gray-500"
                                                    >
                                                      Sin pagos no liquidados.
                                                    </TableCell>
                                                  </TableRow>
                                                )}
                                              </TableBody>
                                            </Table>
                                          </TableCell>
                                        </TableRow>
                                      )}
                                    </>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* LISTA MOBILE - SOLO EN MOBILE */}
      <div className="  xl:hidden flex flex-col gap-4">
        {data?.inversionistas.map((inv, idx) => (
          <div
            key={inv.inversionista_id}
            className="border rounded-xl shadow p-4 bg-white"
          >
            {/* HEADER de la card de inversionista */}
            <button
              className="w-full flex justify-between items-center mb-3"
              onClick={() => {
                setExpandedRow(expandedRow === idx ? null : idx);
                setExpandedCredit(null); // Cierra creditos al cambiar inversionista
              }}
            >
              <span className="font-bold text-blue-900 text-lg flex items-center gap-2">
                {inv.inversionista}
              </span>
              {expandedRow === idx ? (
                <ChevronUp className="w-5 h-5 text-blue-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-blue-400" />
              )}
            </button>
            {/* SUBTOTALES resumen */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-2 text-sm">
              <div>
                <span className="font-bold text-blue-900">Banco: </span>
                <span className="text-blue-800">{inv.banco || "--"}</span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Tipo Cuenta: </span>
                <span className="text-blue-800">{inv.tipo_cuenta || "--"}</span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Número Cuenta: </span>
                <span className="text-blue-800">
                  {inv.numero_cuenta || "--"}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Reinversión: </span>
                <span className="text-blue-800">
                  {inv.reinversion ? "Sí" : "No"}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Total Capital: </span>
                <span className="text-blue-800 font-bold">
                  Q
                  {Number(
                    inv.subtotal?.total_abono_capital ?? 0
                  ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Total Interés: </span>
                <span className="text-indigo-700 font-bold">
                  Q
                  {Number(
                    inv.subtotal?.total_abono_interes ?? 0
                  ).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Total IVA: </span>
                <span className="text-violet-700 font-bold">
                  Q
                  {Number(inv.subtotal?.total_abono_iva ?? 0).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Total ISR: </span>
                <span className="text-yellow-700 font-bold">
                  Q
                  {Number(inv.subtotal?.total_isr ?? 0).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Total Cuota: </span>
                <span className="text-green-700 font-bold">
                  Q
                  {Number(inv.subtotal?.total_cuota ?? 0).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}
                </span>
              </div>
              <div>
                <span className="font-bold text-blue-900">Emite Factura: </span>
                <span className="text-indigo-700 font-bold">
                  {inv.emite_factura ? "Sí" : "No"}
                </span>
              </div>
            </div>
            {/* BOTONES */}
            <div className="flex gap-2 mb-2">
              <button
                className="
    w-full sm:w-auto                /* Ocupa todo el ancho en móvil, solo auto en pantallas medianas */
    px-3 py-2                       /* Un poco más de padding vertical para mobile */
    rounded-lg
    bg-blue-500
    text-white font-bold
    hover:bg-blue-600
    transition
    disabled:opacity-50 disabled:cursor-not-allowed
    flex items-center justify-center gap-2 /* Para centrar ícono y texto */
  "
                disabled={
                  Number(inv.subtotal?.total_cuota ?? 0) <= 0 ||
                  downloadPDF.isPending
                }
                onClick={() => downloadPDF.mutate({ id: inv.inversionista_id })}
              >
                {downloadPDF.isPending ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    <span className="text-sm sm:text-base">Descargando...</span>
                  </>
                ) : (
                  <span className="text-sm sm:text-base">Descargar PDF</span>
                )}
              </button>

              <button
                className="px-3 py-1 rounded-lg bg-green-500 text-white font-bold hover:bg-green-600 transition disabled:opacity-50"
                disabled={Number(inv.subtotal?.total_cuota ?? 0) <= 0}
                onClick={() => {
                  liquidateMutation.mutate(
                    { inversionista_id: inv.inversionista_id },
                    {
                      onSuccess: () => refetch(),
                    }
                  );
                }}
              >
                Liquidar
              </button>
              <button
                onClick={() => {
                  setMode("update");
                  setSelectedInvestorData({
                    inversionista_id: inv.inversionista_id,
                    nombre: inv.inversionista,
                    emite_factura: inv.emite_factura,
                    reinversion: inv.reinversion, // si tu backend devuelve esto lo mapeas
                    banco: inv.banco, // igual acá
                    tipo_cuenta: inv.tipo_cuenta,
                    numero_cuenta: inv.numero_cuenta,
                  });
                  setModalOpen(true);
                }}
                className="px-3 py-1 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white font-bold"
              >
                Editar
              </button>
            </div>

            {/* COLLAPSE: Créditos Asociados */}
            {expandedRow === idx && (
              <div className="mt-2">
                <div className="font-bold text-blue-900 mb-2">
                  Créditos asociados:
                </div>
                {inv.creditosData.length === 0 ? (
                  <div className="text-gray-500 text-center">
                    Este inversionista no tiene créditos asociados.
                  </div>
                ) : (
                  inv.creditosData.map((cred) => (
                    <div
                      key={cred.credito_id}
                      className="mb-3 border rounded-lg p-2 bg-blue-50"
                    >
                      <button
                        className="w-full flex justify-between items-center"
                        onClick={() =>
                          setExpandedCredit(
                            expandedCredit === cred.credito_id
                              ? null
                              : cred.credito_id
                          )
                        }
                      >
                        <span className="font-semibold text-indigo-700">
                          # Crédito: {cred.numero_credito_sifco}
                        </span>
                        {expandedCredit === cred.credito_id ? (
                          <ChevronUp className="w-5 h-5 text-indigo-500" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-indigo-400" />
                        )}
                      </button>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm text-blue-900">
                        <div>
                          <span className="font-bold">Cliente: </span>
                          {cred.nombre_usuario}
                        </div>
                        <div>
                          <span className="font-bold">NIT: </span>
                          {cred.nit_usuario}
                        </div>
                        <div>
                          <span className="font-bold">Capital: </span>Q
                          {Number(cred.monto_aportado).toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </div>
                        <div>
                          <span className="font-bold">% Interés: </span>
                          {cred.porcentaje_interes}%
                        </div>
                        <div>
                          <span className="font-bold">Plazo: </span>
                          {cred.meses_en_credito}
                        </div>
                        <div>
                          <span className="font-bold">Crédito Capital: </span>Q
                          {Number(cred.capital).toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </div>
                        <div>
                          <span className="font-bold">
                            Suma Abono Capital:{" "}
                          </span>
                          Q
                          {Number(cred.total_abono_capital).toLocaleString(
                            "es-GT",
                            { minimumFractionDigits: 2 }
                          )}
                        </div>
                        <div>
                          <span className="font-bold">
                            Suma Abono Interés:{" "}
                          </span>
                          Q
                          {Number(cred.total_abono_interes).toLocaleString(
                            "es-GT",
                            { minimumFractionDigits: 2 }
                          )}
                        </div>
                        <div>
                          <span className="font-bold">Suma Abono IVA: </span>Q
                          {Number(cred.total_abono_iva).toLocaleString(
                            "es-GT",
                            { minimumFractionDigits: 2 }
                          )}
                        </div>
                        <div>
                          <span className="font-bold">Suma ISR: </span>Q
                          {Number(cred.total_isr).toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </div>
                        <div>
                          <span className="font-bold">Total a Recibir: </span>Q
                          {Number(cred.total_cuota).toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </div>
                      </div>
                      {/* COLLAPSE: Pagos no liquidados */}
                      {expandedCredit === cred.credito_id && (
                        <div className="mt-3">
                          <div className="font-extrabold text-blue-700 mb-2 flex items-center gap-2 text-lg">
                            <span className="inline-block text-2xl">💸</span>
                            Pagos No Liquidados:
                          </div>
                          {cred.pagos && cred.pagos.length > 0 ? (
                            cred.pagos.map((pago, pagoIdx) => (
                              <div
                                key={pagoIdx}
                                className="border rounded-lg p-2 mb-2 bg-white text-blue-900 text-sm"
                              >
                                <div>
                                  <span className="font-bold text-indigo-700">
                                    % Inversionista:{" "}
                                  </span>
                                  {Number(pago.porcentaje_inversor)} %
                                </div>
                                <div>
                                  <span className="font-bold text-indigo-700">
                                    % Tasa Interés Inversor:{" "}
                                  </span>
                                  {Number(pago.tasaInteresInvesor)} %
                                </div>
                                <div>
                                  <span className="font-bold text-violet-700">
                                    Cuota Inversionista:{" "}
                                  </span>
                                  Q
                                  {Number(pago.abono_interes).toLocaleString(
                                    "es-GT",
                                    { minimumFractionDigits: 2 }
                                  )}
                                </div>
                                <div>
                                  <span className="font-bold text-violet-700">
                                    IVA:{" "}
                                  </span>
                                  Q
                                  {Number(pago.abono_iva).toLocaleString(
                                    "es-GT",
                                    { minimumFractionDigits: 2 }
                                  )}
                                </div>
                                <div>
                                  <span className="font-bold text-yellow-700">
                                    ISR:{" "}
                                  </span>
                                  Q
                                  {Number(pago.isr).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </div>
                                <div>
                                  <span className="font-bold text-blue-700">
                                    Abono Capital:{" "}
                                  </span>
                                  Q
                                  {Number(pago.abono_capital).toLocaleString(
                                    "es-GT",
                                    { minimumFractionDigits: 2 }
                                  )}
                                </div>
                                <div>
                                  <span className="font-bold text-indigo-700">
                                    % Inversor:{" "}
                                  </span>
                                  Q
                                  {Number(
                                    pago.abonoGeneralInteres
                                  ).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </div>
                                <div>
                                  <span className="font-semibold text-blue-900">
                                    Mes:{" "}
                                  </span>
                                  {pago.mes ?? "--"}
                                </div>
                                <div>
                                  <span className="font-semibold text-blue-900">
                                    Fecha Pago:{" "}
                                  </span>
                                  {pago.fecha_pago
                                    ? new Date(
                                        pago.fecha_pago
                                      ).toLocaleDateString("es-GT")
                                    : "--"}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-gray-500">
                              Sin pagos no liquidados.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Paginación abajo */}
      {data && (
        <div className="flex items-center justify-between mt-6">
          <button
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-bold disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isLoading || isFetching}
          >
            Anterior
          </button>
          <span className="text-gray-800 font-bold">
            Página {data.page} de {data.totalPages}
          </span>
          <button
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-bold disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages || isLoading || isFetching}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

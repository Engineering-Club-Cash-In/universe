/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { ChevronDown, ChevronUp, Download, Edit } from "lucide-react";
import { useGetInvestors } from "../hooks/getInvestor";
import { useCatalogs } from "../hooks/catalogs";
import { inversionistasService, type Investor, type InvestorPayload } from "../services/services";
import { useLiquidateByInvestor } from "../hooks/liquidateAllInvestor";
import { useDownloadInvestorPDF } from "../hooks/downloadInvestorReport";
import { Spinner } from "./spinner";
import { InvestorModal } from "./modalInvestor"; 
const PER_PAGE_OPTIONS = [5, 10, 20, 50];

export function TableInvestors() {
  const downloadPDF = useDownloadInvestorPDF();
  const [selectedInvestor, setSelectedInvestor] = useState<number | "">(1);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [expandedCredit, setExpandedCredit] = useState<number | null>(null);
  const liquidateMutation = useLiquidateByInvestor();

  // Catálogo de inversionistas (para el filtro)
  const { investors = [], loading: loadingCatalogs } = useCatalogs() as {
    investors: Investor[];
    loading: boolean;
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "update">("create");
  const [selectedInvestorData, setSelectedInvestorData] = useState<
    InvestorPayload | undefined
  >();
  // Consulta con pag inación y filtro por id
  const { data, isLoading, isError, isFetching, refetch } = useGetInvestors({
    id: selectedInvestor !== "" ? Number(selectedInvestor) : undefined,
    page,
    perPage,
  });
  const tienePagosPendientes =
    data?.inversionistas.some((inv) =>
      (inv.creditos ?? []).some((cred) => (cred.pagos ?? []).length > 0)
    ) ?? false;

  console.log(
    "[DEBUG] ¿Algún inversionista tiene pagos pendientes?:",
    tienePagosPendientes
  );

  // Rangos para el label de paginado
  const from = (page - 1) * perPage + 1;
  const to = Math.min(
    (page - 1) * perPage + (data?.inversionistas?.length ?? 0),
    data?.totalItems ?? 0
  );
  const handleCreateInvestor = () => {
    setModalMode("create");
    setSelectedInvestorData(undefined);
    setModalOpen(true);
  };
 
  const handleDescargarExcel = async () => {
    try {
      const result = await inversionistasService.getResumenGlobal({
 
        excel: true,
      });

      if ("success" in result && result.success) {
        // Abrir en nueva pestaña o descargar
        window.open(result.url, "_blank");
        alert(`✅ Excel generado: ${result.filename}`);
      }
    } catch (err) {
      alert("❌ Error al generar el Excel");
      console.error(err);
    }
  };

  const handleEditInvestor = (inv: any) => {
    setModalMode("update");
    console.log(inv)
    setSelectedInvestorData({
      inversionista_id: inv.inversionista_id,
      nombre: inv.nombre_inversionista,
      emite_factura: inv.emite_factura,
      reinversion: inv.reinversion ?? false,
      banco: inv.banco ?? "",
      tipo_cuenta: inv.tipo_cuenta ?? "",
      numero_cuenta: inv.numero_cuenta ?? "",
    });
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedInvestorData(undefined);
    refetch(); // Refresca la tabla después de crear/editar
  };
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
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
        {data && (
          <div className="text-gray-600 font-semibold sm:ml-auto">
            Mostrando <span className="text-blue-700">{from}</span> -{" "}
            <span className="text-blue-700">{to}</span> de{" "}
            <span className="text-blue-700">{data.totalItems}</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
  {/* Crear Inversionista */}
  <button
    onClick={handleCreateInvestor}
    className="px-4 py-2 rounded-lg bg-green-500 text-white font-bold hover:bg-green-600 transition flex items-center gap-2 justify-center"
  >
    <span className="text-xl">➕</span>
    Crear Inversionista
  </button>

  {/* Descargar Resumen Global Excel */}
  <div className="relative group">
    <button
      onClick={handleDescargarExcel}
      className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 transition flex items-center gap-2 justify-center"
    >
      <Download className="w-5 h-5" />
      Descargar Resumen Global
    </button>
    
    {/* Tooltip */}
    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block w-64 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 z-50">
      <div className="text-center">
        ℹ️ Este reporte muestra solo los <span className="font-bold text-yellow-300">pagos NO liquidados</span> de todos los inversionistas
      </div>
      {/* Flechita del tooltip */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
    </div>
  </div>
</div>
<div className="flex flex-wrap items-center gap-3 mb-5">
  {/* Crear Inversionista */}
  
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
                        {inv.nombre_inversionista}
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
                            className="px-3 py-1 rounded-lg bg-yellow-500 text-white font-bold hover:bg-yellow-600 transition inline-flex items-center justify-center gap-2"
                            onClick={(e) => {
                              e.stopPropagation(); // Evita que se expanda/colapse la fila
                              handleEditInvestor(inv);
                            }}
                          >
                            <Edit className="w-4 h-4" />
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
                                {(inv.creditos ?? []).length === 0 ? (
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
                                  inv.creditos.map((cred) => (
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
                {inv.nombre_inversionista}{" "}
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
                className="px-3 py-1 rounded-lg bg-yellow-500 text-white font-bold hover:bg-yellow-600 transition inline-flex items-center justify-center gap-2"
                onClick={(e) => {
                  e.stopPropagation(); // Evita que se expanda/colapse la fila
                  handleEditInvestor(inv);
                }}
              >
                <Edit className="w-4 h-4" />
                Editar
              </button>
            </div>

            {/* COLLAPSE: Créditos Asociados */}
         {expandedRow === idx && (
  <div className="mt-2">
    <div className="font-bold text-blue-900 mb-2">
      Créditos asociados:
    </div>
    {(inv.creditos ?? []).length === 0 ? (
      <div className="text-gray-500 text-center py-4">
        Este inversionista no tiene créditos asociados.
      </div>
    ) : (
      inv.creditos.map((cred) => (
        <div
          key={cred.credito_id}
          className="mb-4 border-2 border-blue-200 rounded-xl p-4 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm"
        >
          {/* HEADER DEL CRÉDITO */}
          <button
            className="w-full flex justify-between items-center mb-3"
            onClick={() =>
              setExpandedCredit(
                expandedCredit === cred.credito_id
                  ? null
                  : cred.credito_id
              )
            }
          >
            <span className="font-bold text-lg text-indigo-700">
              📋 Crédito: {cred.numero_credito_sifco}
            </span>
            {expandedCredit === cred.credito_id ? (
              <ChevronUp className="w-5 h-5 text-indigo-500" />
            ) : (
              <ChevronDown className="w-5 h-5 text-indigo-400" />
            )}
          </button>

          {/* INFO GENERAL - MINI CARDS */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {/* Cliente */}
            <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
              <div className="text-xs text-gray-500 mb-1">Cliente</div>
              <div className="font-semibold text-blue-900 text-sm">
                {cred.nombre_usuario}
              </div>
            </div>

            {/* NIT */}
            <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
              <div className="text-xs text-gray-500 mb-1">NIT</div>
              <div className="font-semibold text-blue-900 text-sm">
                {cred.nit_usuario}
              </div>
            </div>

            {/* Capital Aportado */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 shadow-sm border border-green-200">
              <div className="text-xs text-green-700 mb-1">💰 Capital Aportado</div>
              <div className="font-bold text-green-900 text-sm">
                Q{Number(cred.monto_aportado).toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>

            {/* % Interés */}
            <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-lg p-3 shadow-sm border border-purple-200">
              <div className="text-xs text-purple-700 mb-1">📊 % Interés</div>
              <div className="font-bold text-purple-900 text-sm">
                {cred.porcentaje_interes}%
              </div>
            </div>

            {/* Capital Total Crédito */}
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-3 shadow-sm border border-blue-200">
              <div className="text-xs text-blue-700 mb-1">🏦 Capital Crédito</div>
              <div className="font-bold text-blue-900 text-sm">
                Q{Number(cred.capital).toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>

            {/* Total a Recibir */}
            <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-3 shadow-sm border border-yellow-300">
              <div className="text-xs text-yellow-700 mb-1">✨ Total a Recibir</div>
              <div className="font-bold text-yellow-900 text-sm">
                Q{Number(cred.total_cuota).toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>
          </div>

          {/* TOTALES - MINI CARDS */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
              <div className="text-xs text-gray-600">Abono Capital</div>
              <div className="font-semibold text-blue-900 text-xs">
                Q{Number(cred.total_abono_capital).toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>

            <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
              <div className="text-xs text-gray-600">Abono Interés</div>
              <div className="font-semibold text-blue-900 text-xs">
                Q{Number(cred.total_abono_interes).toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>

            <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
              <div className="text-xs text-gray-600">IVA</div>
              <div className="font-semibold text-blue-900 text-xs">
                Q{Number(cred.total_abono_iva).toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>

            <div className="bg-white rounded-lg p-2 shadow-sm border border-gray-200">
              <div className="text-xs text-gray-600">ISR</div>
              <div className="font-semibold text-blue-900 text-xs">
                Q{Number(cred.total_isr).toLocaleString("es-GT", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>
          </div>

          {/* COLLAPSE: Pagos no liquidados */}
          {expandedCredit === cred.credito_id && (
            <div className="mt-4 pt-4 border-t-2 border-blue-200">
              <div className="font-extrabold text-blue-700 mb-3 flex items-center gap-2 text-base">
                <span className="inline-block text-2xl">💸</span>
                Pagos No Liquidados
              </div>

              {cred.pagos && cred.pagos.length > 0 ? (
                <div className="space-y-3">
                  {cred.pagos.map((pago, pagoIdx) => (
                    <div
                      key={pagoIdx}
                      className="bg-white border-2 border-indigo-200 rounded-xl p-3 shadow-md"
                    >
                      {/* Header del Pago */}
                      <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">📅</span>
                          <div>
                            <div className="font-bold text-indigo-900 text-sm">
                              {pago.mes ?? "--"}
                            </div>
                            <div className="text-xs text-gray-500">
                              {pago.fecha_pago
                                ? new Date(pago.fecha_pago).toLocaleDateString("es-GT")
                                : "--"}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">% Inversor</div>
                          <div className="font-bold text-indigo-700">
                            {Number(pago.porcentaje_inversor)}%
                          </div>
                        </div>
                      </div>

                      {/* Mini Cards de Montos */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-2 border border-blue-200">
                          <div className="text-xs text-blue-700">💵 Abono Capital</div>
                          <div className="font-bold text-blue-900 text-sm">
                            Q{Number(pago.abono_capital).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                        </div>

                        <div className="bg-gradient-to-br from-violet-50 to-violet-100 rounded-lg p-2 border border-violet-200">
                          <div className="text-xs text-violet-700">💰 Cuota Inversor</div>
                          <div className="font-bold text-violet-900 text-sm">
                            Q{Number(pago.abono_interes).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                        </div>

                        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-2 border border-green-200">
                          <div className="text-xs text-green-700">📈 IVA</div>
                          <div className="font-bold text-green-900 text-sm">
                            Q{Number(pago.abono_iva).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                        </div>

                        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-2 border border-yellow-200">
                          <div className="text-xs text-yellow-700">📉 ISR</div>
                          <div className="font-bold text-yellow-900 text-sm">
                            Q{Number(pago.isr).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                        </div>

                        <div className="col-span-2 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-2 border border-indigo-300">
                          <div className="text-xs text-indigo-700">💎 Total Inversor</div>
                          <div className="font-bold text-indigo-900 text-base">
                            Q{Number(pago.abonoGeneralInteres).toLocaleString("es-GT", {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Tasa Interés */}
                      <div className="mt-2 pt-2 border-t border-gray-200 text-center">
                        <span className="text-xs text-gray-600">Tasa Interés Inversor: </span>
                        <span className="font-semibold text-purple-700">
                          {Number(pago.tasaInteresInvesor)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-center py-4 bg-gray-50 rounded-lg">
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
      {/* Modal */}
      <InvestorModal
        open={modalOpen}
        onClose={handleCloseModal}
        mode={modalMode}
        initialData={selectedInvestorData}
      />
      </div>
    </div>
  );
}

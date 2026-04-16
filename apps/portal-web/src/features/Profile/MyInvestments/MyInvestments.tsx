import {
  NavBar,
  IconSignDollar,
  IconGraph,
  Loading,
  ModalChatBot,
} from "@/components";
import {
  getInvestmentsStats,
  getLiquidaciones,
  getHistorialReporte,
} from "../services";
import { useQuery } from "@tanstack/react-query";
import { useModalOptionsCall } from "@/hooks";
import { ContainerMenu } from "../components/ContainerMenu";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib";

export const MyInvestments = () => {
  const { user } = useAuth();
  const [expandedLiquidacion, setExpandedLiquidacion] = useState<number | null>(
    null,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 5;
  const [pagosPage, setPagosPage] = useState(1);
  const pagosPerPage = 25;

  const { isModalOpen, modalOptionsInvestors, setIsModalOpen } =
    useModalOptionsCall();

  // Obtener estadísticas usando email o DPI del perfil
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["investments-stats", user?.id],
    queryFn: () => getInvestmentsStats(user?.dpi || "", user?.email || ""),
    enabled: !!user?.id,
  });

  // Obtener liquidaciones con paginación
  const {
    data: liquidacionesData,
    isLoading: loadingLiquidaciones,
    isFetching: fetchingLiquidaciones,
  } = useQuery({
    queryKey: ["liquidaciones", user?.id, currentPage, perPage],
    queryFn: () =>
      getLiquidaciones(
        user?.dpi || "",
        user?.email || "",
        currentPage,
        perPage,
      ),
    enabled: !!user?.id,
  });

  // Obtener historial de reporte de liquidaciones
  const { data: historialReporte } = useQuery({
    queryKey: ["historial-reporte", user?.email],
    queryFn: () => getHistorialReporte(user?.email || ""),
    enabled: !!user?.email,
  });

  // Solo mostrar loading de página completa en la carga inicial
  const isInitialLoading = loadingStats || loadingLiquidaciones;
  const liquidaciones = liquidacionesData?.liquidaciones || [];
  const totalPages = liquidacionesData?.totalPages || 1;
  const totalItems = liquidacionesData?.totalItems || 0;

  const toggleExpand = (id: number) => {
    setExpandedLiquidacion(expandedLiquidacion === id ? null : id);
    setPagosPage(1);
  };

  const formatCurrency = (amount: number, currencySymbol: string = "Q.") => {
    const formatted = new Intl.NumberFormat("es-GT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return `${currencySymbol}${formatted}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-GT", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatShortDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-GT", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatMonthYear = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-GT", {
      year: "numeric",
      month: "long",
    });
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      setExpandedLiquidacion(null);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      setExpandedLiquidacion(null);
    }
  };

  if (isInitialLoading) {
    return (
      <div>
        <NavBar />
        <ContainerMenu>
          <div className="max-w-7xl mx-auto mt-26 mb-20">
            <Loading />
          </div>
        </ContainerMenu>
      </div>
    );
  }

  return (
    <div>
      <NavBar />
      <ContainerMenu>
        <div className="">
          <h1 className="text-2xl lg:text-header-body font-bold mb-8">
            Mis Inversiones
          </h1>

          {/* Estadísticas */}
          {stats && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-12 mb-12">
              {/* Total Invertido */}
              <div
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 lg:p-6"
                style={
                  {
                    /* borderRadius: "9.13px",
                background:
                  "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                boxShadow:
                  "0 2.282px 4.565px -2.282px rgba(0, 0, 0, 0.10), 0 4.565px 6.847px -1.141px rgba(0, 0, 0, 0.10), 0 0 0 0 rgba(0, 0, 0, 0.00), 0 0 0 0 rgba(0, 0, 0, 0.00)",
              */
                  }
                }
              >
                <div className="flex items-center gap-4">
                  <div className="bg-blue-200 text-blue-700 p-4 lg:p-6 rounded-xl">
                    <IconSignDollar />
                  </div>
                  <div>
                    <p className="text-sm lg:text-base  mb-1">
                      Total Invertido
                    </p>
                    <p className="text-lg lg:text-2xl font-bold">
                      {formatCurrency(stats.capital_total_aportado)}
                    </p>
                  </div>
                </div>
              </div>

              

              {/* Inversiones Activas */}
              <div
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 lg:p-6"
                style={
                  {
                    /* borderRadius: "9.13px",
                background:
                  "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                boxShadow:
                  "0 2.282px 4.565px -2.282px rgba(0, 0, 0, 0.10), 0 4.565px 6.847px -1.141px rgba(0, 0, 0, 0.10), 0 0 0 0 rgba(0, 0, 0, 0.00), 0 0 0 0 rgba(0, 0, 0, 0.00)",
             */
                  }
                }
              >
                <div className="flex items-center gap-4">
                  <div className=" bg-fuchsia-200 p-4 lg:p-6 rounded-xl">
                    <IconGraph />
                  </div>
                  <div>
                    <p className="text-sm lg:text-base  mb-1">
                      Créditos Financiados Activos
                    </p>
                    <p className="text-lg lg:text-2xl font-bold">
                      {stats.cantidad_inversiones}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Lista de Liquidaciones */}
          <div>
            {fetchingLiquidaciones ? (
              <div className="py-12">
                <Loading />
              </div>
            ) : liquidaciones && liquidaciones.length > 0 ? (
              <div className="space-y-6">
                {liquidaciones.map((liquidacion) => (
                  <div
                    key={liquidacion.liquidacion_id}
                    className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition-[border-color]"
                  >
                    {/* Header + Cuota hero */}
                    <div className="p-6 lg:p-8">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-xl lg:text-2xl font-bold">
                              Liquidación de{" "}
                              {formatMonthYear(liquidacion.fecha_liquidacion)}
                            </h3>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium border ${
                                liquidacion.emite_factura
                                  ? "text-white/70 bg-white/5 border-white/10"
                                  : "text-white/70 bg-white/5 border-white/10"
                              }`}
                            >
                              {liquidacion.emite_factura
                                ? "Con Factura"
                                : "Sin Factura"}
                            </span>
                          </div>
                          <p className="text-sm text-white/50">
                            {formatDate(liquidacion.fecha_liquidacion)}
                          </p>
                        </div>
                        {/* Cuota - dato principal */}
                        <div className="md:text-right">
                          <span className="text-sm text-white/50 block mb-1">
                            Total Pago
                          </span>
                          <span className="text-2xl lg:text-3xl font-bold text-primary tabular-nums">
                            {formatCurrency(liquidacion.totales.total_cuota, liquidacion.currencySymbol)}
                          </span>
                        </div>
                      </div>

                      {/* Totales - grid con jerarquía clara */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-4 mb-6">
                        <div>
                          <span className="text-sm text-white/50 block mb-1">
                            Amortización Capital
                          </span>
                          <span className="text-base lg:text-lg text-white/90 tabular-nums">
                            {formatCurrency(liquidacion.totales.total_capital, liquidacion.currencySymbol)}
                          </span>
                        </div>
                        <div>
                          <span className="text-sm text-white/50 block mb-1">
                            Interés
                          </span>
                          <span className="text-base lg:text-lg text-green-400 tabular-nums">
                            {formatCurrency(liquidacion.totales.total_interes, liquidacion.currencySymbol)}
                          </span>
                        </div>
                        <div>
                          <span className="text-sm text-white/50 block mb-1">
                            IVA
                          </span>
                          <span className="text-base lg:text-lg text-white/70 tabular-nums">
                            {formatCurrency(liquidacion.totales.total_iva, liquidacion.currencySymbol)}
                          </span>
                        </div>
                        {liquidacion.totales.total_isr > 0 && (
                          <div>
                            <span className="text-sm text-white/50 block mb-1">
                              ISR
                            </span>
                            <span className="text-base lg:text-lg text-red-400 tabular-nums">
                              {formatCurrency(liquidacion.totales.total_isr, liquidacion.currencySymbol)}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="text-sm text-white/50 block mb-1">
                            Pagos Liquidados
                          </span>
                          <span className="text-base lg:text-lg text-white/90 tabular-nums">
                            {liquidacion.totales.total_pagos_liquidados}
                          </span>
                        </div>
                      </div>

                      {/* Boleta y Reinversión */}
                      {(liquidacion.boleta || liquidacion.reinversion) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                          {/* Boleta */}
                          {liquidacion.boleta && (
                            <div className="bg-white/3 rounded-xl p-5 border border-white/10">
                              <h4 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-3">
                                Boleta
                              </h4>
                              <div className="grid grid-cols-3 gap-4">
                                <div>
                                  <span className="text-xs text-white/40 block mb-1">
                                    Monto
                                  </span>
                                  <span className="text-base text-white/90 tabular-nums">
                                    {formatCurrency(
                                      Math.abs(liquidacion.boleta.monto_boleta),
                                      liquidacion.currencySymbol,
                                    )}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-white/40 block mb-1">
                                    Estado
                                  </span>
                                  <span
                                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                      liquidacion.boleta.estado === "PROCESADO"
                                        ? "text-green-400 bg-green-500/10"
                                        : "text-yellow-400 bg-yellow-500/10"
                                    }`}
                                  >
                                    {liquidacion.boleta.estado}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-white/40 block mb-1">
                                    Fecha de subida
                                  </span>
                                  <span className="text-sm text-white/70">
                                    {formatShortDate(
                                      liquidacion.boleta.fecha_subida,
                                    )}
                                  </span>
                                </div>
                              </div>
                              {liquidacion.boleta.boleta_url && (
                                <a
                                  href={liquidacion.boleta.boleta_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:text-primary/80 text-sm font-medium mt-4 inline-flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-primary rounded"
                                >
                                  Ver boleta
                                  <span aria-hidden="true">&rarr;</span>
                                </a>
                              )}
                            </div>
                          )}

                          {/* Reinversión */}
                          {liquidacion.reinversion && (
                            <div className="bg-white/3 rounded-xl p-5 border border-white/10">
                              <h4 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-3">
                                Reinversión
                              </h4>
                              <div>
                                <span className="text-xs text-white/40 block mb-1">
                                  Total Reinvertido
                                </span>
                                <span className="text-base font-semibold text-white tabular-nums">
                                  {formatCurrency(
                                    liquidacion.reinversion.reinversion_total,
                                    liquidacion.currencySymbol,
                                  )}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Footer con botón expandir y link de reporte */}
                      <div className="border-t border-white/10 pt-5 flex flex-wrap justify-between items-center gap-3">
                        <button
                          onClick={() =>
                            toggleExpand(liquidacion.liquidacion_id)
                          }
                          className="flex items-center gap-2 text-primary hover:text-primary/80 transition-[color] text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary rounded-lg px-2 py-1 -mx-2"
                        >
                          <motion.svg
                            animate={{
                              rotate:
                                expandedLiquidacion ===
                                liquidacion.liquidacion_id
                                  ? 180
                                  : 0,
                            }}
                            transition={{ duration: 0.2 }}
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </motion.svg>
                          {expandedLiquidacion === liquidacion.liquidacion_id
                            ? "Ocultar pagos"
                            : `Ver ${liquidacion.pagos.length} pagos`}
                        </button>

                        {liquidacion.reporte_liquidacion && (
                          <a
                            href={liquidacion.reporte_liquidacion}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:text-primary/80 transition-[color] text-sm font-medium inline-flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-primary rounded-lg px-2 py-1 -mx-2"
                          >
                            Ver reporte de liquidación
                            <span aria-hidden="true">&rarr;</span>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Sección expandible de pagos */}
                    <AnimatePresence>
                      {expandedLiquidacion === liquidacion.liquidacion_id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="bg-white/3 border-t border-white/10 p-6 lg:p-8">
                            <h4 className="text-base lg:text-lg font-semibold text-white mb-5">
                              Detalle de Pagos ({liquidacion.pagos.length})
                            </h4>
                            <div className="space-y-3">
                              {liquidacion.pagos
                                .slice(
                                  (pagosPage - 1) * pagosPerPage,
                                  pagosPage * pagosPerPage,
                                )
                                .map((pago) => (
                                  <div
                                    key={pago.pago_id}
                                    className="bg-white/5 rounded-xl p-5 border border-white/10"
                                  >
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                                      <div className="min-w-0">
                                        <p className="text-base lg:text-lg font-semibold text-white truncate">
                                          {pago.nombre_cliente}
                                        </p>
                                        <p className="text-sm text-white/50">
                                          Crédito: {pago.numero_credito_sifco}{" "}
                                          &middot;{" "}
                                          {formatShortDate(pago.fecha_pago)}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-sm text-white/50">
                                          Pago:
                                        </span>
                                        <span className="text-xl lg:text-2xl text-primary font-bold tabular-nums">
                                          {formatCurrency(pago.cuota, liquidacion.currencySymbol)}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                      <div>
                                        <span className="text-xs text-white/40 block mb-1">
                                          Tasa Interés + IVA
                                        </span>
                                        <span className="text-base text-white/80 tabular-nums">
                                          {pago.tasa_interes ?? "0"}%
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-xs text-white/40 block mb-1">
                                          Participación
                                        </span>
                                        <span className="text-base text-white/80 tabular-nums">
                                          {pago.porcentaje_participacion ?? "0"}
                                          %
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-xs text-white/40 block mb-1">
                                          % Tasa Interés Inversionista + IVA
                                        </span>
                                        <span className="text-base text-white/80 tabular-nums">
                                          {pago.porcentaje_tasa_interes ?? "0"}%
                                        </span>
                                      </div>

                                      <div>
                                        <span className="text-xs text-white/40 block mb-1">
                                          Amortización Capital
                                        </span>
                                        <span className="text-base text-white/80 tabular-nums">
                                          {formatCurrency(pago.abono_capital, liquidacion.currencySymbol)}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-xs text-white/40 block mb-1">
                                          Interés
                                        </span>
                                        <span className="text-base text-green-400 tabular-nums">
                                          {formatCurrency(pago.abono_interes, liquidacion.currencySymbol)}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-xs text-white/40 block mb-1">
                                          IVA
                                        </span>
                                        <span className="text-base text-white/70 tabular-nums">
                                          {formatCurrency(pago.abono_iva, liquidacion.currencySymbol)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                            </div>

                            {/* Paginación de pagos (client-side, 25 por página) */}
                            {liquidacion.pagos.length > pagosPerPage &&
                              (() => {
                                const pagosTotalPages = Math.ceil(
                                  liquidacion.pagos.length / pagosPerPage,
                                );
                                return (
                                  <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/10">
                                    <p className="text-sm text-white/50">
                                      Mostrando{" "}
                                      {Math.min(
                                        pagosPage * pagosPerPage,
                                        liquidacion.pagos.length,
                                      )}{" "}
                                      de {liquidacion.pagos.length} pagos
                                    </p>
                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={() =>
                                          setPagosPage((p) =>
                                            Math.max(1, p - 1),
                                          )
                                        }
                                        disabled={pagosPage === 1}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-primary ${
                                          pagosPage === 1
                                            ? "bg-white/5 text-white/30 cursor-not-allowed"
                                            : "bg-white/10 text-white hover:bg-white/20"
                                        }`}
                                      >
                                        Anterior
                                      </button>
                                      <span className="text-sm text-white/60 tabular-nums">
                                        {pagosPage} / {pagosTotalPages}
                                      </span>
                                      <button
                                        onClick={() =>
                                          setPagosPage((p) =>
                                            Math.min(pagosTotalPages, p + 1),
                                          )
                                        }
                                        disabled={pagosPage === pagosTotalPages}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-primary ${
                                          pagosPage === pagosTotalPages
                                            ? "bg-white/5 text-white/30 cursor-not-allowed"
                                            : "bg-white/10 text-white hover:bg-white/20"
                                        }`}
                                      >
                                        Siguiente
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}

                {/* Paginación */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
                    <p className="text-sm text-white/65">
                      Mostrando {liquidaciones.length} de {totalItems}{" "}
                      liquidaciones
                    </p>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={handlePreviousPage}
                        disabled={currentPage === 1}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          currentPage === 1
                            ? "bg-white/5 text-white/30 cursor-not-allowed"
                            : "bg-white/10 text-white hover:bg-white/20"
                        }`}
                      >
                        ← Anterior
                      </button>
                      <span className="text-sm text-white/80">
                        Página {currentPage} de {totalPages}
                      </span>
                      <button
                        onClick={handleNextPage}
                        disabled={currentPage === totalPages}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          currentPage === totalPages
                            ? "bg-white/5 text-white/30 cursor-not-allowed"
                            : "bg-white/10 text-white hover:bg-white/20"
                        }`}
                      >
                        Siguiente →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-12 text-center">
                <svg
                  className="w-16 h-16 text-white/30 mx-auto mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                <p className="text-white/65 text-lg">
                  No tienes liquidaciones aún
                </p>
                <p className="text-white/50 text-sm mt-2">
                  Las liquidaciones aparecerán aquí cuando se procesen pagos de
                  tus inversiones
                </p>
              </div>
            )}
          </div>

                    {/* Historial de Liquidaciones - Card */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 lg:p-8 my-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-xl lg:text-2xl font-bold mb-1">
                  Historial de Liquidaciones
                </h2>
                <p className="text-sm text-white/50">
                  Historial de liquidaciones generadas en el sistema anterior
                </p>
              </div>
              {historialReporte?.reporte_url && (
                <a
                  href={historialReporte.reporte_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white text-sm font-medium rounded-xl hover:bg-secondary/90 transition-[background-color] focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-black shrink-0"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Ver Reporte General
                </a>
              )}
            </div>
          </div>
        </div>
      </ContainerMenu>

      {isModalOpen && (
        <ModalChatBot
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          options={modalOptionsInvestors}
        />
      )}
    </div>
  );
};

import {
  NavBar,
  IconSignDollar,
  IconArrow,
  IconGraph,
  Loading,
  ModalChatBot,
} from "@/components";
import { getInvestmentsStats, getLiquidaciones } from "../services";
import { useQuery } from "@tanstack/react-query";
import { useModalOptionsCall } from "@/hooks";
import { ContainerMenu } from "../components/ContainerMenu";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib";

export const MyInvestments = () => {
  const {user} = useAuth();
  const [expandedLiquidacion, setExpandedLiquidacion] = useState<number | null>(
    null
  );
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 10;
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
      getLiquidaciones(user?.dpi || "", user?.email || "", currentPage, perPage),
    enabled: !!user?.id,
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-GT", {
      style: "currency",
      currency: "GTQ",
    }).format(amount);
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

              {/* Total Rendimiento */}
              <div
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 lg:p-6"
                style={
                  {
                    /*
                borderRadius: "9.13px",
                background:
                  "linear-gradient(180deg, rgba(148, 153, 236, 0.25) 0%, rgba(84, 87, 134, 0.25) 100%)",
                boxShadow:
                  "0 2.282px 4.565px -2.282px rgba(0, 0, 0, 0.10), 0 4.565px 6.847px -1.141px rgba(0, 0, 0, 0.10), 0 0 0 0 rgba(0, 0, 0, 0.00), 0 0 0 0 rgba(0, 0, 0, 0.00)",
             */
                  }
                }
              >
                <div className="flex items-center gap-4">
                  <div className=" bg-green-200 text-green-700 p-4 lg:p-6 rounded-xl">
                    <IconArrow width={24} height={24} />
                  </div>
                  <div>
                    <p className="text-sm lg:text-base  mb-1">
                      Rendimiento obtenido hasta ahora
                    </p>
                    <p className="text-lg lg:text-2xl font-bold">
                      {formatCurrency(stats.rendimiento_estimado)}
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
            <h2 className="text-2xl lg:text-header-body font-bold mb-6">
              Historial de Liquidaciones
            </h2>

            {fetchingLiquidaciones ? (
              <div className="py-12">
                <Loading />
              </div>
            ) : liquidaciones && liquidaciones.length > 0 ? (
              <div className="space-y-6">
                {liquidaciones.map((liquidacion) => (
                  <div
                    key={liquidacion.liquidacion_id}
                    className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden hover:border-primary/30 transition-colors"
                  >
                    {/* Header de la card */}
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-xl lg:text-2xl font-bold mb-1 ">
                            Liquidación de{" "}
                            {formatMonthYear(liquidacion.fecha_liquidacion)}
                          </h3>
                          <p className="text-sm text-white/65">
                            {formatDate(liquidacion.fecha_liquidacion)}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                            liquidacion.emite_factura
                              ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
                              : "text-orange-400 bg-orange-500/10 border-orange-500/30"
                          }`}
                        >
                          {liquidacion.emite_factura
                            ? "Con Factura"
                            : "Sin Factura"}
                        </span>
                      </div>

                      {/* Información principal - Totales */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                        <div>
                          <span className="text-sm text-white/65 block mb-1">
                            Total Capital
                          </span>
                          <span className="text-primary font-semibold">
                            {formatCurrency(liquidacion.totales.total_capital)}
                          </span>
                        </div>
                        <div>
                          <span className="text-sm text-white/65 block mb-1">
                            Total Interés
                          </span>
                          <span className="font-semibold text-green-500">
                            {formatCurrency(liquidacion.totales.total_interes)}
                          </span>
                        </div>
                        <div>
                          <span className="text-sm text-white/65 block mb-1">
                            Total Cuota
                          </span>
                          <span className="text-primary font-semibold">
                            {formatCurrency(liquidacion.totales.total_cuota)}
                          </span>
                        </div>
                        <div>
                          <span className="text-sm text-white/65 block mb-1">
                            IVA
                          </span>
                          <span className="text-white/80 font-semibold">
                            {formatCurrency(liquidacion.totales.total_iva)}
                          </span>
                        </div>
                        {liquidacion.totales.total_isr > 0 && (
                          <div>
                            <span className="text-sm text-white/65 block mb-1">
                              ISR
                            </span>
                            <span className="text-red-400 font-semibold">
                              {formatCurrency(liquidacion.totales.total_isr)}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="text-sm text-white/65 block mb-1">
                            Pagos Liquidados
                          </span>
                          <span className="text-white/80 font-semibold">
                            {liquidacion.totales.total_pagos_liquidados}
                          </span>
                        </div>
                      </div>

                      {/* Boleta y Reinversión */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        {/* Boleta */}
                        {liquidacion.boleta && (
                          <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                            <h4 className="text-sm font-semibold text-white/80 mb-3">
                              Boleta
                            </h4>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <span className="text-white/50 block text-xs">Monto</span>
                                <span className="font-semibold">
                                  {formatCurrency(Math.abs(liquidacion.boleta.monto_boleta))}
                                </span>
                              </div>
                              <div>
                                <span className="text-white/50 block text-xs">Estado</span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                                  liquidacion.boleta.estado === "PROCESADO"
                                    ? "text-green-400 bg-green-500/10 border-green-500/30"
                                    : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                                }`}>
                                  {liquidacion.boleta.estado}
                                </span>
                              </div>
                              <div>
                                <span className="text-white/50 block text-xs">Subida</span>
                                <span className="text-white/80">
                                  {formatShortDate(liquidacion.boleta.fecha_subida)}
                                </span>
                              </div>
                            </div>
                            {liquidacion.boleta.boleta_url && (
                              <a
                                href={liquidacion.boleta.boleta_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 hover:underline text-xs font-medium mt-3 inline-block"
                              >
                                Ver boleta →
                              </a>
                            )}
                          </div>
                        )}

                        {/* Reinversión */}
                        {liquidacion.reinversion && (
                          <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                            <h4 className="text-sm font-semibold text-white/80 mb-3">
                              Reinversión
                            </h4>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <span className="text-white/50 block text-xs">Capital</span>
                                <span className="text-primary font-semibold">
                                  {formatCurrency(liquidacion.reinversion.reinversion_capital)}
                                </span>
                              </div>
                              <div>
                                <span className="text-white/50 block text-xs">Interés</span>
                                <span className="text-green-400 font-semibold">
                                  {formatCurrency(liquidacion.reinversion.reinversion_interes)}
                                </span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-white/50 block text-xs">Total Reinvertido</span>
                                <span className="text-lg font-bold">
                                  {formatCurrency(liquidacion.reinversion.reinversion_total)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer con botón expandir y link de reporte */}
                      <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                        <button
                          onClick={() =>
                            toggleExpand(liquidacion.liquidacion_id)
                          }
                          className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors text-sm font-medium"
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
                            className="text-primary hover:text-primary/80 hover:underline transition-colors text-sm font-medium"
                          >
                            Ver reporte de liquidación →
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
                          <div className="bg-white/5 border-t border-white/10 p-6">
                            <h4 className="text-base lg:text-lg font-bold text-white mb-4">
                              Detalle de Pagos ({liquidacion.pagos.length})
                            </h4>
                            <div className="space-y-3">
                              {liquidacion.pagos
                                .slice((pagosPage - 1) * pagosPerPage, pagosPage * pagosPerPage)
                                .map((pago) => (
                                <div
                                  key={pago.pago_id}
                                  className="bg-white/5 rounded-xl p-5 border border-white/10"
                                >
                                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                                    <div>
                                      <p className="text-base lg:text-lg font-bold text-white">
                                        {pago.nombre_cliente}
                                      </p>
                                      <p className="text-sm text-white/50">
                                        Crédito: {pago.numero_credito_sifco} &middot; {formatShortDate(pago.fecha_pago)}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 md:text-right">
                                      <span className="text-sm text-white/50">Cuota:</span>
                                      <span className="text-xl lg:text-2xl text-primary font-bold">
                                        {formatCurrency(pago.cuota)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                      <span className="text-white/50 block text-xs mb-1">
                                        Capital
                                      </span>
                                      <span className="text-base font-semibold text-white/90">
                                        {formatCurrency(pago.abono_capital)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-white/50 block text-xs mb-1">
                                        Interés
                                      </span>
                                      <span className="text-base font-semibold text-green-400">
                                        {formatCurrency(pago.abono_interes)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-white/50 block text-xs mb-1">
                                        IVA
                                      </span>
                                      <span className="text-base font-semibold text-white/90">
                                        {formatCurrency(pago.abono_iva)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-white/50 block text-xs mb-1">
                                        Participación
                                      </span>
                                      <span className="text-base font-semibold text-white/90">
                                        {pago.porcentaje_participacion
                                          ? pago?.porcentaje_participacion
                                          : ""}
                                        %
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Paginación de pagos (client-side, 25 por página) */}
                            {liquidacion.pagos.length > pagosPerPage && (() => {
                              const pagosTotalPages = Math.ceil(liquidacion.pagos.length / pagosPerPage);
                              return (
                                <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                                  <p className="text-xs text-white/50">
                                    Mostrando {Math.min(pagosPage * pagosPerPage, liquidacion.pagos.length)} de {liquidacion.pagos.length} pagos
                                  </p>
                                  <div className="flex items-center gap-3">
                                    <button
                                      onClick={() => setPagosPage((p) => Math.max(1, p - 1))}
                                      disabled={pagosPage === 1}
                                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                        pagosPage === 1
                                          ? "bg-white/5 text-white/30 cursor-not-allowed"
                                          : "bg-white/10 text-white hover:bg-white/20"
                                      }`}
                                    >
                                      ← Anterior
                                    </button>
                                    <span className="text-xs text-white/60">
                                      {pagosPage} / {pagosTotalPages}
                                    </span>
                                    <button
                                      onClick={() => setPagosPage((p) => Math.min(pagosTotalPages, p + 1))}
                                      disabled={pagosPage === pagosTotalPages}
                                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                        pagosPage === pagosTotalPages
                                          ? "bg-white/5 text-white/30 cursor-not-allowed"
                                          : "bg-white/10 text-white hover:bg-white/20"
                                      }`}
                                    >
                                      Siguiente →
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

import { useState, useRef, useEffect, useCallback } from "react";
import { BarFilters, PreLovedCar } from "../components";
import { useFilteredVehiclesFromStore } from "../hooks/useFilteredVehicles";
import { IconLeftArrow, IconRightArrow } from "@/components/icons";
import { ITEMS_PER_PAGE, DEFAULT_PAGE } from "../constants/marketplace.constants";
import { motion, AnimatePresence } from "framer-motion";

export const ViewCars = () => {
  const { filteredVehicles, isLoading } = useFilteredVehiclesFromStore();
  const [currentPage, setCurrentPage] = useState(DEFAULT_PAGE);
  const contentRef = useRef<HTMLDivElement>(null);

  // Pagination
  const totalPages = Math.ceil(filteredVehicles.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - DEFAULT_PAGE) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentVehicles = filteredVehicles.slice(startIndex, endIndex);

  // Reset page when filters change
  useEffect(() => {
    if (
      currentPage > Math.ceil(filteredVehicles.length / ITEMS_PER_PAGE) &&
      filteredVehicles.length > 0
    ) {
      setCurrentPage(DEFAULT_PAGE);
    }
  }, [filteredVehicles.length, currentPage]);

  // Scroll to top when page changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [currentPage]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [currentPage, totalPages]);

  const handlePageClick = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const renderContent = useCallback(() => {
    if (isLoading) {
      return <p className="text-white/70">Cargando vehículos...</p>;
    }

    if (filteredVehicles.length === 0) {
      return (
        <p className="text-white/70">
          No se encontraron vehículos con los filtros seleccionados.
        </p>
      );
    }

    return (
      <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
          <AnimatePresence mode="popLayout">
            {currentVehicles.map((vehicle, index) => (
              <motion.div
                key={vehicle.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{
                  duration: 0.4,
                  delay: index * 0.05,
                  ease: "easeOut",
                }}
              >
                <PreLovedCar vehicle={vehicle} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Paginación */}
        {totalPages > DEFAULT_PAGE && (
          <div className="flex items-center justify-center gap-4 mt-12">
            {/* Flecha izquierda */}
            <button
              onClick={handlePrevPage}
              disabled={currentPage === DEFAULT_PAGE}
              className={`
                border-none rounded-full w-10 h-10 flex items-center justify-center
                transition-all duration-300
                ${
                  currentPage === DEFAULT_PAGE
                    ? "bg-white/10 cursor-not-allowed opacity-50"
                    : "bg-primary cursor-pointer opacity-100 hover:scale-110"
                }
              `}
            >
              <IconLeftArrow width={24} height={24} />
            </button>

            {/* Puntitos */}
            <div className="flex gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + DEFAULT_PAGE).map(
                (page) => (
                  <button
                    key={page}
                    onClick={() => handlePageClick(page)}
                    className={`
                    h-3 rounded-md border-none cursor-pointer transition-all duration-300
                    ${
                      currentPage === page
                        ? "w-8 bg-primary"
                        : "w-3 bg-white/30 hover:bg-white/50"
                    }
                  `}
                    aria-label={`Página ${page}`}
                  />
                )
              )}
            </div>

            {/* Flecha derecha */}
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className={`
                border-none rounded-full w-10 h-10 flex items-center justify-center
                transition-all duration-300
                ${
                  currentPage === totalPages
                    ? "bg-white/10 cursor-not-allowed opacity-50"
                    : "bg-primary cursor-pointer opacity-100 hover:scale-110"
                }
              `}
            >
              <IconRightArrow width={24} height={24} />
            </button>
          </div>
        )}
      </>
    );
  }, [isLoading, filteredVehicles.length, currentVehicles, currentPage, totalPages, handlePrevPage, handleNextPage, handlePageClick]);

  return (
    <div className="flex min-h-screen relative pt-12">
      {/* Sidebar de filtros */}
      <div className="w-80 sticky left-0 top-0 h-screen overflow-y-auto bg-linear-to-b from-[rgba(154,159,245,0.05)] to-[rgba(90,93,143,0.05)] p-8 px-6 border-r border-white/10 self-start">
        <BarFilters />
      </div>

      {/* Contenido principal */}
      <div ref={contentRef} className="flex-1 flex flex-col items-center">
        <div className="w-full max-w-[1400px]">
          <h1 className="text-header-4 text-white/80 mb-8  ">
            Resultados de vehículos
          </h1>
          {renderContent()}
        </div>

        {!isLoading && filteredVehicles.length > 0 && (
          <p className="mt-8 text-center text-white/50">
            Mostrando {startIndex + 1}-
            {Math.min(endIndex, filteredVehicles.length)} de{" "}
            {filteredVehicles.length} vehículos
          </p>
        )}
      </div>
    </div>
  );
};

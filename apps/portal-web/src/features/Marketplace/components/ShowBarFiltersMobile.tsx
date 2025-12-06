import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components";
import { BarFilters } from "./BarFilters";
import { useFilterStore } from "../store/filters";

interface ShowBarFiltersMobileProps {
  showClearButton?: boolean;
}

export const ShowBarFiltersMobile = ({
  showClearButton = false,
}: ShowBarFiltersMobileProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { resetFilters } = useFilterStore();

  return (
    <>
      {/* Botones de filtros */}
      <div className="flex items-center gap-2">
        <Button onClick={() => setIsOpen(true)} size="sm">
          <div className="flex items-center gap-2">
            <span>Más filtros</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="17"
              height="17"
              viewBox="0 0 17 17"
              fill="none"
            >
              <path
                d="M3.54102 4.95837H13.4577"
                stroke="white"
                strokeWidth="1.0625"
                strokeLinecap="round"
              />
              <path
                d="M3.54102 8.5H13.4577"
                stroke="white"
                strokeWidth="1.0625"
                strokeLinecap="round"
              />
              <path
                d="M3.54102 12.0416H13.4577"
                stroke="white"
                strokeWidth="1.0625"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </Button>

        {showClearButton && (
          <Button onClick={() => resetFilters()} size="sm">
            <div className="flex items-center gap-2">
              <span>Borrar filtros</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="17"
                height="17"
                viewBox="0 0 17 17"
                fill="none"
              >
                <path
                  d="M12.75 4.25L4.25 12.75"
                  stroke="currentColor"
                  strokeWidth="1.0625"
                  strokeLinecap="round"
                />
                <path
                  d="M4.25 4.25L12.75 12.75"
                  stroke="currentColor"
                  strokeWidth="1.0625"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </Button>
        )}
      </div>

      {/* Panel de filtros a pantalla completa */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black"
          >
            {/* Header con botón de cerrar */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h2 className="text-white text-lg font-semibold"></h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/80 hover:text-white p-2"
                aria-label="Cerrar filtros"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Contenido de filtros con scroll */}
            <div className="h-[calc(100vh-64px)] overflow-y-auto px-10 py-6">
              <BarFilters
                onComplete={() => {
                  setIsOpen(false);
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

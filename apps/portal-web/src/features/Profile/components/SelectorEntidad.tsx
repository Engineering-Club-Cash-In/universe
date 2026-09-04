import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEntidades } from "../hooks/useEntidades";
import type { Entidad } from "../services/entitiesService";

const EtiquetaTipo = ({ entidad }: { entidad: Entidad }) => (
  <span className="text-[11px] uppercase tracking-wider text-white/50 border border-white/15 rounded px-1.5 py-0.5 shrink-0">
    {entidad.tipo === "persona" ? "Personal" : "Empresa"}
  </span>
);

/**
 * Selector de la entidad que se está viendo.
 *
 * Solo aparece cuando la persona representa a más de un inversionista; quien
 * tiene uno solo no ve nada distinto de antes.
 */
export const SelectorEntidad = () => {
  const { entidades, entidadActiva, seleccionar } = useEntidades();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;

    const alClicFuera = (event: MouseEvent) => {
      if (!contenedor.current?.contains(event.target as Node)) {
        setAbierto(false);
      }
    };
    const alPresionar = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbierto(false);
    };

    document.addEventListener("mousedown", alClicFuera);
    document.addEventListener("keydown", alPresionar);
    return () => {
      document.removeEventListener("mousedown", alClicFuera);
      document.removeEventListener("keydown", alPresionar);
    };
  }, [abierto]);

  if (entidades.length <= 1 || !entidadActiva) return null;

  return (
    <div className="mb-8 lg:mb-10" ref={contenedor}>
      <p className="text-xs uppercase tracking-wider text-white/50 mb-2">
        Estás viendo
      </p>

      <div className="relative w-full max-w-md">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={abierto}
          className="w-full flex items-center gap-3 bg-white/5 backdrop-blur-sm border border-white/10 hover:border-secondary/60 rounded-xl px-4 py-3 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        >
          <span className="flex-1 font-semibold text-white truncate">
            {entidadActiva.nombre}
          </span>
          <EtiquetaTipo entidad={entidadActiva} />
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-white/60 shrink-0 transition-transform ${abierto ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <AnimatePresence>
          {abierto && (
            <motion.ul
              role="listbox"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
              className="absolute z-40 mt-2 w-full bg-[#1a1a1f] border border-white/10 rounded-xl overflow-hidden shadow-xl"
            >
              {entidades.map((entidad) => {
                const activa =
                  entidad.inversionista_id === entidadActiva.inversionista_id;

                return (
                  <li key={entidad.inversionista_id} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={activa}
                      onClick={() => {
                        seleccionar(entidad.inversionista_id);
                        setAbierto(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                        activa
                          ? "bg-secondary text-white"
                          : "text-white/80 hover:bg-white/10"
                      }`}
                    >
                      <span className="flex-1 truncate">{entidad.nombre}</span>
                      {entidad.status !== "activo" && (
                        <span className="text-[11px] uppercase tracking-wider text-yellow-300/80 shrink-0">
                          {entidad.status.replace(/_/g, " ")}
                        </span>
                      )}
                      <EtiquetaTipo entidad={entidad} />
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

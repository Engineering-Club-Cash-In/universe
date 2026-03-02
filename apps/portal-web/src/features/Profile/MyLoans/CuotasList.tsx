import { useState, useMemo } from "react";
import type { Cuota } from "../services/creditService";

type CuotaConEstado = Cuota & {
  estado: "pagada" | "pendiente" | "atrasada";
};

const CUOTAS_PER_PAGE = 5;

interface CuotasListProps {
  cuotasPendientes: Cuota[];
  cuotasAtrasadas: Cuota[];
  cuotasPagadas: Cuota[];
  formatCurrency: (amount: string | number) => string;
  formatDate: (dateString: string) => string;
}

const getEstadoBadge = (estado: CuotaConEstado["estado"]) => {
  switch (estado) {
    case "pagada":
      return {
        className: "text-green-400 bg-green-500/10 border-green-500/30",
        label: "Pagada",
      };
    case "atrasada":
      return {
        className: "text-red-400 bg-red-500/10 border-red-500/30",
        label: "Atrasada",
      };
    case "pendiente":
      return {
        className: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
        label: "Pendiente",
      };
  }
};

export const CuotasList = ({
  cuotasPendientes,
  cuotasAtrasadas,
  cuotasPagadas,
  formatCurrency,
  formatDate,
}: CuotasListProps) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const allCuotas = useMemo(() => {
    // Unificar por cuota_id para no repetir
    const map = new Map<number, CuotaConEstado>();

    for (const c of cuotasPagadas) {
      map.set(c.cuota_id, { ...c, estado: "pagada" });
    }
    for (const c of cuotasAtrasadas) {
      if (!map.has(c.cuota_id)) {
        map.set(c.cuota_id, { ...c, estado: "atrasada" });
      }
    }
    for (const c of cuotasPendientes) {
      if (!map.has(c.cuota_id)) {
        map.set(c.cuota_id, { ...c, estado: "pendiente" });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(a.fecha_vencimiento).getTime() -
        new Date(b.fecha_vencimiento).getTime()
    );
  }, [cuotasPendientes, cuotasAtrasadas, cuotasPagadas]);

  const totalPages = Math.ceil(allCuotas.length / CUOTAS_PER_PAGE);
  const paginatedCuotas = allCuotas.slice(
    currentPage * CUOTAS_PER_PAGE,
    (currentPage + 1) * CUOTAS_PER_PAGE
  );

  if (allCuotas.length === 0) return null;

  return (
    <div className="mt-6 border-t border-white/10 pt-6">
      {/* Header expandible */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between mb-4 cursor-pointer"
      >
        <h4 className="text-sm lg:text-base font-semibold text-white/80">
          Detalle de Cuotas
        </h4>
        <svg
          className={`w-5 h-5 text-white/50 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
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
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="space-y-2">
            {paginatedCuotas.map((cuota) => {
              const badge = getEstadoBadge(cuota.estado);

              return (
                <div
                  key={cuota.cuota_id}
                  className="bg-white/5 rounded-lg border border-white/10 p-3 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium">
                      Cuota #{cuota.numero_cuota}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs border ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {cuota.pagado ? (
                      cuota.fecha_pago && (
                        <span className="text-xs text-white/40">
                          Pagada: {formatDate(cuota.fecha_pago)}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-white/40">
                        Vence: {formatDate(cuota.fecha_vencimiento)}
                      </span>
                    )}
                    {cuota.monto_boleta && parseFloat(cuota.monto_boleta) > 0 && (
                      <span className="text-xs text-white/60">
                        Boleta: {formatCurrency(cuota.monto_boleta)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-4">
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <span className="text-sm text-white/60">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={currentPage === totalPages - 1}
                className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

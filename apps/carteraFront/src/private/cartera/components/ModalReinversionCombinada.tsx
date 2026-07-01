import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Search, X, Save, Loader2 } from "lucide-react";
import { useGetInvestors } from "../hooks/getInvestor";
import { useAsignarReinversion } from "../hooks/getInvestor";
import type { TipoReinversionEspejo, CreditoInversionistaData } from "../services/services";
import { toast } from "sonner";

interface ModalReinversionCombinadaProps {
  open: boolean;
  onClose: () => void;
  inversionistaId: number;
  inversionistaNombre: string;
  // Monto de reinversión actual del form del inversionista (puede no estar
  // guardado aún). Permite habilitar Excedente/Variable en el setup por primera
  // vez, antes de persistir el monto en DB.
  montoReinversion?: number;
  onSaved?: () => void;
}

const TIPOS_REINVERSION: {
  value: TipoReinversionEspejo;
  label: string;
  cardColor: string;
  selectColor: string;
  // Modalidades que solo se habilitan si el inversionista ya tiene monto de
  // reinversión en DB (o algún crédito ya viene marcado con ese tipo).
  extra?: boolean;
}[] = [
  { value: "sin_reinversion", label: "Sin Reinversión", cardColor: "bg-gray-100 text-gray-700", selectColor: "border-gray-300 bg-gray-50 text-gray-600" },
  { value: "reinversion_capital", label: "Capital", cardColor: "bg-green-100 text-green-700", selectColor: "border-green-300 bg-green-50 text-green-700" },
  { value: "reinversion_total", label: "Interés Compuesto", cardColor: "bg-purple-100 text-purple-700", selectColor: "border-purple-300 bg-purple-50 text-purple-700" },
  { value: "reinversion_excedente", label: "Excedente", cardColor: "bg-blue-100 text-blue-700", selectColor: "border-blue-300 bg-blue-50 text-blue-700", extra: true },
  { value: "reinversion_variable", label: "Variable", cardColor: "bg-amber-100 text-amber-700", selectColor: "border-amber-300 bg-amber-50 text-amber-700", extra: true },
];

const ALL_CREDITS_PER_PAGE = 500;
const DISPLAY_PER_PAGE = 25;

export function ModalReinversionCombinada({
  open,
  onClose,
  inversionistaId,
  inversionistaNombre,
  montoReinversion,
  onSaved,
}: ModalReinversionCombinadaProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // Map: credito_inversionista_espejo_id -> tipo_reinversion seleccionado (solo los que cambiaron)
  const [asignaciones, setAsignaciones] = useState<Record<number, TipoReinversionEspejo>>({});

  // Traer todos los créditos de una vez (500) para totales correctos
  const { data, isLoading, refetch } = useGetInvestors({
    id: inversionistaId,
    page: 1,
    perPage: ALL_CREDITS_PER_PAGE,
    tipo: "espejos",
  });

  // Refrescar datos y resetear estados cada vez que se abre el modal
  useEffect(() => {
    if (open) {
      setPage(1);
      setSearch("");
      setAsignaciones({});
      refetch();
    }
  }, [open, refetch]);

  const { mutate: asignarReinversion, isPending: isSaving } = useAsignarReinversion();

  // Inversionista actual (para leer monto_reinversion y sus créditos)
  const inversionista = useMemo(
    () => data?.inversionistas?.find((i) => i.inversionista_id === inversionistaId) ?? null,
    [data, inversionistaId]
  );

  // Todos los créditos del inversionista actual
  const allCreditos: CreditoInversionistaData[] = useMemo(
    () => inversionista?.creditos ?? [],
    [inversionista]
  );

  // Excedente y Variable son modalidades que normalmente no se usan. Se habilitan
  // si hay monto de reinversión: el del form actual (aunque no esté guardado, para
  // el setup por primera vez) o el persistido en DB, o si algún crédito ya viene
  // marcado con esos tipos.
  const habilitarExtras = useMemo(() => {
    if (Number(montoReinversion ?? 0) > 0) return true;
    if (Number(inversionista?.monto_reinversion ?? 0) > 0) return true;
    return allCreditos.some(
      (c) =>
        c.tipo_reinversion === "reinversion_excedente" ||
        c.tipo_reinversion === "reinversion_variable"
    );
  }, [montoReinversion, inversionista, allCreditos]);

  // Tipos que se muestran en el resumen y en el select según habilitación.
  const tiposDisponibles = useMemo(
    () => TIPOS_REINVERSION.filter((t) => !t.extra || habilitarExtras),
    [habilitarExtras]
  );

  // Filtro visual por búsqueda (no afecta totales)
  const creditosFiltrados = useMemo(() => {
    if (!search.trim()) return allCreditos;
    const term = search.toLowerCase();
    return allCreditos.filter((c) =>
      c.nombre_usuario?.toLowerCase().includes(term) ||
      c.numero_credito_sifco?.toLowerCase().includes(term)
    );
  }, [allCreditos, search]);

  // Paginación en el cliente sobre los filtrados
  const totalPages = Math.max(1, Math.ceil(creditosFiltrados.length / DISPLAY_PER_PAGE));
  const creditosPagina = useMemo(() => {
    const start = (page - 1) * DISPLAY_PER_PAGE;
    return creditosFiltrados.slice(start, start + DISPLAY_PER_PAGE);
  }, [creditosFiltrados, page]);

  // Resumen: contar por tipo y sumar montos — siempre sobre TODOS los créditos
  const resumen = useMemo(() => {
    const counts: Record<string, { cantidad: number; monto: number }> = {};
    TIPOS_REINVERSION.forEach((t) => {
      counts[t.value] = { cantidad: 0, monto: 0 };
    });

    allCreditos.forEach((cred) => {
      const espejoId = cred.credito_inversionista_espejo_id;
      const tipoOriginal = cred.tipo_reinversion ?? "sin_reinversion";
      const tipo = (espejoId && asignaciones[espejoId]) ? asignaciones[espejoId] : tipoOriginal;
      if (counts[tipo]) {
        counts[tipo].cantidad++;
        counts[tipo].monto += Number(cred.monto_aportado || 0);
      }
    });

    return counts;
  }, [allCreditos, asignaciones]);

  const handleTipoChange = (espejoId: number, tipo: TipoReinversionEspejo, tipoOriginal: string) => {
    setAsignaciones((prev) => {
      const next = { ...prev };
      // Si vuelve al valor original, quitar del map (no hubo cambio)
      if (tipo === tipoOriginal) {
        delete next[espejoId];
      } else {
        next[espejoId] = tipo;
      }
      return next;
    });
  };

  const handleGuardar = () => {
    // Enviar TODOS los créditos con su tipo actual (original o modificado)
    // El backend marca como sin_reinversion los que no recibe
    const todos = allCreditos
      .filter((c) => c.credito_inversionista_espejo_id)
      .map((cred) => {
        const espejoId = cred.credito_inversionista_espejo_id!;
        const tipoOriginal = cred.tipo_reinversion ?? "sin_reinversion";
        return {
          id_inversionista: inversionistaId,
          id_credito_inversionista_espejo: espejoId,
          tipo_reinversion: asignaciones[espejoId] ?? tipoOriginal,
        };
      });

    if (Object.keys(asignaciones).length === 0) {
      toast.error("No hay cambios para guardar.");
      return;
    }

    // No permitir mezclar Excedente y Variable en el mismo inversionista: el
    // monto_reinversion es único y significaría dos cosas opuestas a la vez
    // (recibir un monto fijo vs reinvertir un monto fijo). Debe usarse solo una.
    const tieneExcedente = todos.some((t) => t.tipo_reinversion === "reinversion_excedente");
    const tieneVariable = todos.some((t) => t.tipo_reinversion === "reinversion_variable");
    if (tieneExcedente && tieneVariable) {
      toast.error(
        "No se puede mezclar Excedente y Variable en el mismo inversionista. El monto de reinversión es único; usá solo una de las dos modalidades."
      );
      return;
    }

    asignarReinversion(
      { inversionista_id: inversionistaId, asignaciones: todos },
      {
        onSuccess: () => {
          toast.success("Reinversión combinada guardada correctamente.");
          onSaved?.();
          onClose();
        },
        onError: (err) => {
          toast.error(`Error al asignar reinversión: ${err.message}`);
        },
      }
    );
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-blue-800">
              Reinversión Combinada
            </h2>
            <p className="text-sm text-gray-500">{inversionistaNombre}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Resumen por tipo */}
        <div className="px-6 py-3 border-b bg-gray-50">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${tiposDisponibles.length}, minmax(0, 1fr))` }}
          >
            {tiposDisponibles.map((tipo) => {
              const stat = resumen[tipo.value];
              return (
                <div key={tipo.value} className={`rounded-lg px-3 py-2 ${tipo.cardColor}`}>
                  <div className="text-xs font-medium opacity-75">{tipo.label}</div>
                  <div className="text-lg font-bold">{stat?.cantidad ?? 0} créditos</div>
                  <div className="text-xs">
                    Q {(stat?.monto ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Buscador */}
        <div className="px-6 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nombre del cliente..."
              className="w-full pl-10 pr-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900 placeholder-blue-400 focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            />
          </div>
        </div>

        {/* Lista de créditos */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="ml-2 text-gray-500">Cargando créditos...</span>
            </div>
          ) : creditosPagina.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No se encontraron créditos.
            </div>
          ) : (
            <div className="space-y-2">
              {creditosPagina.filter((c) => c.credito_inversionista_espejo_id).map((cred) => {
                const espejoId = cred.credito_inversionista_espejo_id!;
                const tipoOriginal = cred.tipo_reinversion ?? "sin_reinversion";
                const tipoActual = asignaciones[espejoId] ?? tipoOriginal;
                // Opciones del select: las disponibles + la actual si por algún
                // motivo no estuviera (para no perder el valor del crédito).
                const opcionesCredito = tiposDisponibles.some((t) => t.value === tipoActual)
                  ? tiposDisponibles
                  : [
                      ...tiposDisponibles,
                      ...TIPOS_REINVERSION.filter((t) => t.value === tipoActual),
                    ];
                const colorActual =
                  (TIPOS_REINVERSION.find((t) => t.value === tipoActual) ?? TIPOS_REINVERSION[0])
                    .selectColor;
                return (
                  <div
                    key={espejoId}
                    className="border border-gray-200 rounded-lg p-3 hover:border-blue-300 transition flex items-center gap-4"
                  >
                    {/* Info del crédito resumida */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-indigo-900 text-sm">
                          {cred.numero_credito_sifco}
                        </span>
                        <span className="text-xs text-gray-400">|</span>
                        <span className="text-xs text-gray-600 truncate">
                          {cred.nombre_usuario}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>
                          Capital:{" "}
                          <span className="font-semibold text-green-700">
                            Q {Number(cred.monto_aportado).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                          </span>
                        </span>
                        <span>Plazo: {cred.plazo}m</span>
                        <span>Interés: {cred.porcentaje_interes}%</span>
                      </div>
                    </div>

                    {/* Select de tipo reinversión */}
                    <select
                      value={tipoActual}
                      onChange={(e) =>
                        handleTipoChange(espejoId, e.target.value as TipoReinversionEspejo, tipoOriginal)
                      }
                      className={`text-sm border rounded-lg px-3 py-1.5 font-medium transition ${colorActual}`}
                    >
                      {opcionesCredito.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="px-6 py-2 border-t border-gray-200 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40 hover:bg-gray-100"
            >
              Anterior
            </button>
            <span className="text-sm text-gray-600">
              Página {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40 hover:bg-gray-100"
            >
              Siguiente
            </button>
          </div>
        )}

        {/* Footer con botones */}
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <div className="text-xs text-gray-400">
            {Object.keys(asignaciones).length} créditos con cambios
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleGuardar}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar Asignaciones
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

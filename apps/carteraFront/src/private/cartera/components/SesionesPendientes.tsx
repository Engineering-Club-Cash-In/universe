/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback } from "react";
import { useSesionesPendientes } from "../hooks/useSesionesPendientes";
import type { InversionistaSesionPendiente } from "../services/services";
import {
  Loader2,
  Search,
  AlertTriangle,
  ArrowRight,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Undo2,
  User,
  Mail,
  CreditCard,
  X,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

function formatQ(v: number | string | null | undefined, moneda?: string): string {
  const num = Number(v ?? 0);
  const s = moneda === "dolares" ? "$" : "Q";
  return `${s}${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string): string {
  return status === "pendiente_reinversion" ? "Reinversión"
    : status === "pendiente_compra_cartera" ? "Compra Cartera"
    : status;
}

function statusColor(status: string): string {
  return status === "pendiente_reinversion" ? "border-purple-300 text-purple-700 bg-purple-50"
    : status === "pendiente_compra_cartera" ? "border-amber-300 text-amber-700 bg-amber-50"
    : "border-gray-300 text-gray-700 bg-gray-50";
}

// ============================================
// Tipos
// ============================================
interface CreditoDestino {
  id: number;
  label: string;
  capacidad: number; // max que puede absorber (monto_aportado_cash_in)
  tipo: "existente" | "pendiente";
}

// Distribuye monto respetando la capacidad de cada destino seleccionado
function distribuirMonto(
  montoTotal: number,
  destinos: CreditoDestino[],
  selectedIds: Set<number>
): Map<number, number> {
  const result = new Map<number, number>();
  let restante = montoTotal;
  const selected = destinos.filter((d) => selectedIds.has(d.id));
  for (const d of selected) {
    if (restante <= 0) break;
    const asignar = Math.min(d.capacidad, restante);
    result.set(d.id, Math.round(asignar * 100) / 100);
    restante -= asignar;
  }
  return result;
}

// ============================================
// Componente principal
// ============================================
export function SesionesPendientes() {
  const { data, isLoading, isError, error, refetch, isFetching } = useSesionesPendientes();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((inv) =>
      inv.nombre.toLowerCase().includes(q) ||
      String(inv.dpi ?? "").includes(q) ||
      (inv.email ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  const totalCreditos = useMemo(
    () => data?.reduce((a, inv) => a + inv.creditosPendientes.length, 0) ?? 0,
    [data]
  );

  if (isLoading) {
    return (
      <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>Cargando sesiones pendientes&hellip;</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-red-600">
          <AlertTriangle className="w-8 h-8" aria-hidden="true" />
          <p className="font-medium">Error al cargar las sesiones pendientes</p>
          <p className="text-sm text-gray-500">{(error as any)?.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Reintentar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-6 pb-8">
      <div className="w-full max-w-[1400px] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Sesiones Pendientes</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Créditos pendientes de reinversión o compra de cartera
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Actualizar
          </Button>
        </div>

        {/* Search + Stats inline */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <Input
              placeholder="Buscar por nombre, DPI o email&hellip;"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-xs"
              aria-label="Buscar inversionistas"
            />
          </div>
          <Badge variant="outline" className="text-[11px] border-blue-200 text-blue-700 bg-blue-50 tabular-nums">
            {data?.length ?? 0} inversionistas
          </Badge>
          <Badge variant="outline" className="text-[11px] border-purple-200 text-purple-700 bg-purple-50 tabular-nums">
            {totalCreditos} créditos
          </Badge>
        </div>

        {/* Cards */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <CreditCard className="w-8 h-8 text-gray-300" aria-hidden="true" />
            <p className="text-xs">
              {search ? "Sin resultados para tu búsqueda" : "No hay sesiones pendientes"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((inv) => (
              <InvestorCard key={inv.inversionista_id} investor={inv} onRefetch={refetch} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Construir destinos con capacidad
// ============================================
function buildDestinos(
  investor: InversionistaSesionPendiente,
  removedCreditId: number,
  moneda: string
): CreditoDestino[] {
  const destinos: CreditoDestino[] = [];

  for (const oc of investor.otrosCreditos) {
    destinos.push({
      id: oc.credito_id,
      label: `${oc.numero_credito_sifco || `#${oc.credito_id}`} · Aportado: ${formatQ(oc.monto_aportado_cash_in, moneda)}`,
      capacidad: Number(oc.monto_aportado_cash_in) || Infinity,
      tipo: "existente",
    });
  }

  for (const cp of investor.creditosPendientes) {
    if (cp.id === removedCreditId) continue;
    destinos.push({
      id: cp.credito_id * -1,
      label: `#${cp.credito_id} · ${statusLabel(cp.status)} · Aportado: ${formatQ(cp.monto_aportado, moneda)}`,
      capacidad: Number(cp.monto_aportado) || Infinity,
      tipo: "pendiente",
    });
  }

  return destinos;
}

// ============================================
// Card por inversionista (compacta)
// ============================================
function InvestorCard({
  investor,
  onRefetch,
}: {
  investor: InversionistaSesionPendiente;
  onRefetch: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showCreditos, setShowCreditos] = useState(false);
  const [editingCreditId, setEditingCreditId] = useState<number | null>(null);
  const [selectedDestinoIds, setSelectedDestinoIds] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const isEditing = editingCreditId !== null;
  const editingCredit = investor.creditosPendientes.find((c) => c.id === editingCreditId);

  const destinos = useMemo(() => {
    if (!editingCreditId) return [];
    return buildDestinos(investor, editingCreditId, investor.moneda);
  }, [editingCreditId, investor]);

  const montoAportado = editingCredit ? Number(editingCredit.monto_aportado) : 0;

  const distribucion = useMemo(
    () => distribuirMonto(montoAportado, destinos, selectedDestinoIds),
    [montoAportado, destinos, selectedDestinoIds]
  );

  const totalAsignado = useMemo(() => {
    let t = 0;
    for (const m of distribucion.values()) t += m;
    return t;
  }, [distribucion]);

  const restante = montoAportado - totalAsignado;
  const isBalanced = Math.abs(restante) < 0.01;

  const handleStartEdit = useCallback((creditId: number) => {
    setEditingCreditId(creditId);
    setSelectedDestinoIds(new Set());
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingCreditId(null);
    setSelectedDestinoIds(new Set());
  }, []);

  const handleToggleDestino = useCallback((destinoId: number) => {
    setSelectedDestinoIds((prev) => {
      const next = new Set(prev);
      if (next.has(destinoId)) next.delete(destinoId);
      else next.add(destinoId);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingCreditId || !isBalanced) return;
    setIsSaving(true);
    try {
      const payload = {
        inversionista_id: investor.inversionista_id,
        credito_espejo_removido_id: editingCreditId,
        reasignaciones: Array.from(distribucion.entries()).map(([destId, monto]) => ({
          credito_destino_id: destId,
          monto,
        })),
      };

      // TODO: reemplazar con el POST real cuando el endpoint exista
      console.log("POST /reasignar-credito-espejo", payload);
      toast.info("Reasignación guardada (endpoint pendiente).");
      setEditingCreditId(null);
      setSelectedDestinoIds(new Set());
      onRefetch();
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setIsSaving(false);
    }
  }, [editingCreditId, isBalanced, distribucion, investor, onRefetch]);

  const handleConfirm = useCallback(async () => {
    setIsConfirming(true);
    try {
      const payload = {
        inversionista_id: investor.inversionista_id,
        creditos_ids: investor.creditosPendientes.map((c) => c.id),
      };

      // TODO: reemplazar con el POST real cuando el endpoint exista
      console.log("POST /confirmar-sesion-inversionista", payload);
      toast.info("Sesión confirmada (endpoint pendiente).");
      onRefetch();
    } catch (err: any) {
      toast.error(err?.message || "Error al confirmar");
    } finally {
      setIsConfirming(false);
    }
  }, [investor, onRefetch]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header compacto */}
      <button
        type="button"
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50/80 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <User className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 truncate">{investor.nombre}</span>
              <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 bg-blue-50 shrink-0">
                {investor.creditosPendientes.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              {investor.dpi && <span className="tabular-nums">DPI: {investor.dpi}</span>}
              {investor.email && (
                <span className="flex items-center gap-0.5">
                  <Mail className="w-2.5 h-2.5" aria-hidden="true" />{investor.email}
                </span>
              )}
              <span className="capitalize">{investor.moneda}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {investor.saldo_reinversion && Number(investor.saldo_reinversion) > 0 && (
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-gray-400">Saldo</p>
              <p className="text-xs font-bold text-gray-800 tabular-nums">
                {formatQ(investor.saldo_reinversion, investor.moneda)}
              </p>
            </div>
          )}
          {investor.monto_reinversion && Number(investor.monto_reinversion) > 0 && (
            <div className="text-right hidden md:block">
              <p className="text-[10px] text-gray-400">Reinversión</p>
              <p className="text-xs font-bold text-gray-800 tabular-nums">
                {formatQ(investor.monto_reinversion, investor.moneda)}
              </p>
            </div>
          )}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
            : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
          }
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {/* Créditos pendientes */}
          <div className="space-y-2">
            {investor.creditosPendientes.map((credito) => {
              const isCreditEditing = editingCreditId === credito.id;
              return (
                <div
                  key={credito.id}
                  className={`rounded-lg border transition-all ${
                    isCreditEditing
                      ? "border-amber-300 bg-amber-50/30"
                      : isEditing
                        ? "border-gray-100 bg-gray-50/50 opacity-50"
                        : "border-gray-200 bg-white"
                  }`}
                >
                  {/* Crédito inline */}
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-gray-900">#{credito.credito_id}</span>
                        <Badge variant="outline" className={`text-[9px] py-0 ${statusColor(credito.status)}`}>
                          {statusLabel(credito.status)}
                        </Badge>
                        {credito.tipo_reinversion && (
                          <Badge variant="outline" className="text-[9px] py-0 border-indigo-200 text-indigo-700 bg-indigo-50">
                            {credito.tipo_reinversion.replaceAll("_", " ")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-[11px] text-gray-500">
                        <span><b className="text-gray-800">{formatQ(credito.monto_aportado, investor.moneda)}</b> aportado</span>
                        <span>Cuota: {formatQ(credito.cuota_inversionista, investor.moneda)}</span>
                        <span>{credito.porcentaje_participacion_inversionista}% part.</span>
                        <span className="hidden sm:inline">Cash In: {formatQ(credito.monto_cash_in, investor.moneda)} ({credito.porcentaje_cash_in}%)</span>
                      </div>
                    </div>

                    {/* Botón quitar / cancelar */}
                    {isCreditEditing ? (
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-100 shrink-0"
                      >
                        <Undo2 className="w-3 h-3" aria-hidden="true" />Cancelar
                      </button>
                    ) : !isEditing ? (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(credito.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-50 shrink-0"
                        title="Quitar crédito y reasignar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </div>

                  {/* Panel de reasignación */}
                  {isCreditEditing && (
                    <div className="border-t border-amber-200 bg-amber-50/30 px-3 py-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-amber-800">
                          <ArrowRight className="w-3 h-3 inline mr-1" aria-hidden="true" />
                          Reasignar <b className="tabular-nums">{formatQ(montoAportado, investor.moneda)}</b>
                        </p>
                        {restante > 0.01 && (
                          <span className="text-[11px] text-amber-600 font-semibold tabular-nums">
                            Pendiente: {formatQ(restante, investor.moneda)}
                          </span>
                        )}
                        {isBalanced && (
                          <span className="text-[11px] text-green-600 font-semibold flex items-center gap-0.5">
                            <Check className="w-3 h-3" aria-hidden="true" />Completo
                          </span>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        {destinos.length === 0 ? (
                          <p className="text-[11px] text-gray-500 italic">Sin créditos disponibles</p>
                        ) : (
                          destinos.map((d) => {
                            const sel = selectedDestinoIds.has(d.id);
                            const asignado = distribucion.get(d.id) ?? 0;
                            return (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => handleToggleDestino(d.id)}
                                className={`w-full flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-all text-xs focus-visible:ring-2 focus-visible:ring-blue-500 ${
                                  sel
                                    ? "border-blue-400 bg-blue-50"
                                    : "border-gray-200 bg-white hover:border-gray-300"
                                }`}
                              >
                                <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                                  sel ? "bg-blue-600 border-blue-600" : "border-gray-300"
                                }`}>
                                  {sel && <Check className="w-2 h-2 text-white" aria-hidden="true" />}
                                </div>
                                <span className="flex-1 min-w-0 truncate text-gray-700">{d.label}</span>
                                <Badge variant="outline" className={`text-[9px] py-0 shrink-0 ${
                                  d.tipo === "existente" ? "border-green-200 text-green-700 bg-green-50" : "border-purple-200 text-purple-700 bg-purple-50"
                                }`}>
                                  {d.tipo === "existente" ? "Existente" : "Pendiente"}
                                </Badge>
                                {sel && asignado > 0 && (
                                  <span className="text-[11px] font-bold text-blue-700 tabular-nums shrink-0">
                                    +{formatQ(asignado, investor.moneda)}
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>

                      {/* Guardar */}
                      {selectedDestinoIds.size > 0 && (
                        <div className="flex justify-end pt-1">
                          <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={isSaving || !isBalanced}
                            className={`gap-1 text-[11px] h-7 text-white ${
                              isBalanced ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"
                            }`}
                          >
                            {isSaving
                              ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                              : <Check className="w-3 h-3" aria-hidden="true" />
                            }
                            Guardar Reasignación
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Créditos disponibles (colapsado) */}
          {investor.otrosCreditos.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors"
                onClick={() => setShowCreditos((p) => !p)}
              >
                {showCreditos
                  ? <ChevronDown className="w-3 h-3" aria-hidden="true" />
                  : <ChevronRight className="w-3 h-3" aria-hidden="true" />
                }
                Créditos Disponibles ({investor.otrosCreditos.length})
              </button>
              {showCreditos && (
                <div className="space-y-1.5 mt-2">
                  {investor.otrosCreditos.map((oc) => (
                    <div key={oc.credito_id} className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 border border-gray-100 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-gray-800">{oc.numero_credito_sifco || `#${oc.credito_id}`}</span>
                        <span className="text-gray-400 ml-2">
                          {oc.tipoCredito && <span className="capitalize">{oc.tipoCredito.toLowerCase()}</span>}
                          {oc.capital && Number(oc.capital) > 0 && <span> · Capital: {formatQ(oc.capital, investor.moneda)}</span>}
                        </span>
                        {oc.statusCredit && (
                          <Badge variant="outline" className="text-[9px] py-0 ml-2 border-green-200 text-green-700 bg-green-50">
                            {oc.statusCredit}
                          </Badge>
                        )}
                      </div>
                      <span className="font-bold text-blue-700 tabular-nums shrink-0 ml-3">
                        {formatQ(oc.monto_aportado_cash_in, investor.moneda)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Confirmar sesión - solo visible cuando NO hay reasignación activa */}
          {!isEditing && (
            <div className="flex justify-end pt-1 border-t border-gray-100">
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={isConfirming}
                className="gap-1 text-[11px] h-7 bg-blue-600 text-white hover:bg-blue-700"
              >
                {isConfirming
                  ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  : <Check className="w-3 h-3" aria-hidden="true" />
                }
                Confirmar Sesión
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

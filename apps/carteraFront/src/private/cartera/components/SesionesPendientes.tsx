/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback, useEffect } from "react";
import { useSesionesPendientes, useCompletarEspejo, useReemplazarInversionistaCredito, useCreditCandidates, useDevolverPendientesACube } from "../hooks/useSesionesPendientes";
import type { InversionistaSesionPendiente, OtroCreditoDisponible } from "../services/services";
import {
  Loader2,
  Search,
  AlertTriangle,
  ArrowRight,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Undo2,
  User,
  Mail,
  CreditCard,
  X,
  Ban,
  AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

function formatQ(v: number | string | null | undefined): string {
  const num = Number(v ?? 0);
  return `Q${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
const PAGE_SIZE = 10;

export function SesionesPendientes() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { data: response, isLoading, isError, error, refetch, isFetching } = useSesionesPendientes(page, PAGE_SIZE, debouncedSearch);

  // Debounce search to avoid firing on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 800);
    return () => clearTimeout(timer);
  }, [search]);

  const investors = useMemo(() => response?.data ?? [], [response]);
  const total = response?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const totalCreditos = useMemo(
    () => investors.reduce((a, inv) => a + inv.creditosPendientes.length, 0),
    [investors]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(1);
    },
    [],
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
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-6 pb-20">
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
              placeholder="Buscar por nombre"
              value={search}
              onChange={handleSearchChange}
              className="pl-9 h-8 text-xs text-gray-900"
              aria-label="Buscar inversionistas"
            />
          </div>
          <Badge variant="outline" className="text-[11px] border-blue-200 text-blue-700 bg-blue-50 tabular-nums">
            {total} inversionistas
          </Badge>
          <Badge variant="outline" className="text-[11px] border-purple-200 text-purple-700 bg-purple-50 tabular-nums">
            {totalCreditos} créditos
          </Badge>
          <span className="text-xs text-gray-500">
            Página {page} de {totalPages}
          </span>
        </div>

        {/* Cards */}
        {investors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <CreditCard className="w-8 h-8 text-gray-300" aria-hidden="true" />
            <p className="text-xs">
              {search ? "Sin resultados para tu búsqueda" : "No hay sesiones pendientes"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {investors.map((inv) => (
              <InvestorCard key={inv.inversionista_id} investor={inv} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination - fixed bottom */}
      {totalPages > 1 && (
        <div className="border-t border-gray-200 bg-white px-6 py-3 flex items-center justify-center gap-1.5 fixed bottom-0 inset-x-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (page <= 3) {
              pageNum = i + 1;
            } else if (page >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = page - 2 + i;
            }
            return (
              <button
                key={pageNum}
                type="button"
                onClick={() => setPage(pageNum)}
                className={`h-8 w-9 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors ${
                  pageNum === page
                    ? "bg-blue-600 text-white border border-blue-600"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function getCashInMonto(oc: OtroCreditoDisponible): number {
  const cube = oc.inversionistas.find((i) => i.es_cube);
  return cube?.monto_aportado ?? 0;
}

// ============================================
// Construir destinos con capacidad
// ============================================
function buildDestinos(
  candidates: OtroCreditoDisponible[],
): CreditoDestino[] {
  const destinos: CreditoDestino[] = [];

  for (const oc of candidates) {
    const cashInMonto = getCashInMonto(oc);
    destinos.push({
      id: oc.credito_id,
      label: `${oc.numero_credito_sifco || `#${oc.credito_id}`} · ${oc.credito_completo?.usuario?.nombre ?? ""} · Aportado: ${formatQ(cashInMonto)}`,
      capacidad: cashInMonto || oc.capital_activo,
      tipo: "existente",
    });
  }

  return destinos;
}

// ============================================
// Card por inversionista (compacta)
// ============================================
function InvestorCard({
  investor,
}: {
  investor: InversionistaSesionPendiente;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingCreditId, setEditingCreditId] = useState<number | null>(null);
  const [selectedDestinoIds, setSelectedDestinoIds] = useState<Set<number>>(new Set());
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const reemplazar = useReemplazarInversionistaCredito();
  const completarEspejo = useCompletarEspejo();
  const devolverPendientes = useDevolverPendientesACube();

  const isEditing = editingCreditId !== null;
  const editingCredit = investor.creditosPendientes.find((c) => c.id === editingCreditId);

  const montoParaCandidatos = editingCredit ? Number(editingCredit.monto_aportado) : null;
  const { data: candidates, isLoading: isLoadingCandidates } = useCreditCandidates(montoParaCandidatos);

  const destinos = useMemo(() => {
    if (!editingCreditId || !candidates) return [];
    return buildDestinos(candidates);
  }, [editingCreditId, candidates]);

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

  const handleSave = useCallback(() => {
    if (!editingCreditId || !isBalanced || !editingCredit) return;

    const tipoOp = editingCredit.status === "pendiente_reinversion"
      ? "reinversion" as const
      : "compra_cartera" as const;

    reemplazar.mutate(
      {
        inversionista_id: investor.inversionista_id,
        credito_espejo_removido_id: editingCredit.credito_id,
        tipo_operacion: tipoOp,
        porcentaje_cash_in: Number(editingCredit.porcentaje_cash_in),
        porcentaje_inversion: Number(editingCredit.porcentaje_participacion_inversionista),
        reasignaciones: Array.from(distribucion.entries()).map(([destId, monto]) => ({
          credito_destino_id: destId,
          monto,
        })),
      },
      {
        onSuccess: () => {
          toast.success("Reasignación guardada correctamente.");
          setEditingCreditId(null);
          setSelectedDestinoIds(new Set());
        },
        onError: (err) => {
          toast.error(err?.message || "Error al guardar la reasignación");
        },
      }
    );
  }, [editingCreditId, isBalanced, editingCredit, distribucion, investor, reemplazar]);

  const handleConfirm = useCallback(() => {
    completarEspejo.mutate(
      {
        creditos: investor.creditosPendientes.map((c) => c.credito_id),
        inversionista_id: investor.inversionista_id,
      },
      {
        onSuccess: () => {
          toast.success("Sesión confirmada correctamente.");
        },
        onError: (err) => {
          toast.error(err?.message || "Error al confirmar la sesión");
        },
      }
    );
  }, [completarEspejo, investor]);

  const tieneCompraCartera = investor.creditosPendientes.some(
    (c) => c.status === "pendiente_compra_cartera"
  );
  const cancelLabel = tieneCompraCartera ? "Cancelar Compra Cartera" : "Cancelar Sesión";

  const handleCancelSesion = useCallback(() => {
    const creditoIds = investor.creditosPendientes.map((c) => c.credito_id);
    if (creditoIds.length === 0) return;

    devolverPendientes.mutate(
      { creditos: creditoIds.length === 1 ? creditoIds[0] : creditoIds },
      {
        onSuccess: (res) => {
          const count = res.creditos_limpiados?.length ?? creditoIds.length;
          toast.success(res.message || `${count} crédito(s) devueltos a cube.`);
          setConfirmingCancel(false);
        },
        onError: (err) => {
          toast.error(err?.message || "Error al cancelar la sesión");
        },
      }
    );
  }, [devolverPendientes, investor]);

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
                {formatQ(investor.saldo_reinversion)}
              </p>
            </div>
          )}
          {investor.monto_reinversion && Number(investor.monto_reinversion) > 0 && (
            <div className="text-right hidden md:block">
              <p className="text-[10px] text-gray-400">Reinversión</p>
              <p className="text-xs font-bold text-gray-800 tabular-nums">
                {formatQ(investor.monto_reinversion)}
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
                        <span className="text-xs font-bold text-gray-900">{credito.numero_credito_sifco}</span>
                        <span className="text-[11px] text-gray-500">{credito.nombre_usuario}</span>
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
                        <span><b className="text-gray-800">{formatQ(credito.monto_aportado)}</b> aportado</span>
                        <span>Cuota: {formatQ(credito.cuota_inversionista)}</span>
                        <span>{credito.porcentaje_participacion_inversionista}% part.</span>
                        <span className="hidden sm:inline">Cash In: {formatQ(credito.monto_cash_in)} ({credito.porcentaje_cash_in}%)</span>
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
                        className="text-[11px] text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1 px-1.5 py-1 rounded hover:bg-red-50 shrink-0"
                      >
                        <X className="w-3 h-3" />Quitar
                      </button>
                    ) : null}
                  </div>

                  {/* Panel de reasignación */}
                  {isCreditEditing && (
                    <div className="border-t border-amber-200 bg-amber-50/30 px-3 py-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-amber-800">
                          <ArrowRight className="w-3 h-3 inline mr-1" aria-hidden="true" />
                          Reasignar <b className="tabular-nums">{formatQ(montoAportado)}</b>
                        </p>
                        {restante > 0.01 && (
                          <span className="text-[11px] text-amber-600 font-semibold tabular-nums">
                            Pendiente: {formatQ(restante)}
                          </span>
                        )}
                        {isBalanced && (
                          <span className="text-[11px] text-green-600 font-semibold flex items-center gap-0.5">
                            <Check className="w-3 h-3" aria-hidden="true" />Completo
                          </span>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        {isLoadingCandidates ? (
                          <div className="flex items-center gap-2 py-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" aria-hidden="true" />
                            <p className="text-[11px] text-gray-500">Cargando créditos disponibles&hellip;</p>
                          </div>
                        ) : destinos.length === 0 ? (
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
                                    +{formatQ(asignado)}
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
                            disabled={reemplazar.isPending || !isBalanced}
                            className={`gap-1 text-[11px] h-7 text-white ${
                              isBalanced ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"
                            }`}
                          >
                            {reemplazar.isPending
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



          {/* Acciones de sesión - solo visible cuando NO hay reasignación activa */}
          {!isEditing && (
            <div className="pt-2 border-t border-gray-100">
              {confirmingCancel ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50/70 px-3 py-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-red-800">
                        ¿{cancelLabel}?
                      </p>
                      <p className="text-[10px] text-red-700/80 leading-tight">
                        Se devolverán {investor.creditosPendientes.length} crédito(s) a cube y se removerán los inversionistas pendientes. Esta acción no se puede deshacer.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmingCancel(false)}
                      disabled={devolverPendientes.isPending}
                      className="gap-1 text-[11px] h-7 border-gray-300"
                    >
                      <Undo2 className="w-3 h-3" aria-hidden="true" />
                      No
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCancelSesion}
                      disabled={devolverPendientes.isPending}
                      className="gap-1 text-[11px] h-7 bg-red-600 text-white hover:bg-red-700"
                    >
                      {devolverPendientes.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        : <Check className="w-3 h-3" aria-hidden="true" />
                      }
                      Sí, cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmingCancel(true)}
                    disabled={completarEspejo.isPending || devolverPendientes.isPending}
                    className="gap-1 text-[11px] h-7 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    <Ban className="w-3 h-3" aria-hidden="true" />
                    {cancelLabel}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirm}
                    disabled={completarEspejo.isPending || devolverPendientes.isPending}
                    className="gap-1 text-[11px] h-7 bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {completarEspejo.isPending
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
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { useDevolucionListado } from "../hooks/useDevolucionListado";
import {
  aceptarDevolucion,
  rechazarDevolucion,
  type DevolucionCreditoItem,
} from "../services/services";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RefreshCw, Search, X, TriangleAlert } from "lucide-react";

// Etiqueta + tono del badge de alerta cuando un crédito VERIFICADO todavía
// no cerró. `pendiente_cierre` viene del backend (listPendingDevolucion con
// status=HISTORIAL) y ya trae la razón real, calculada con el mismo
// predicado que decide el cierre — nunca hay que adivinarla acá.
function alertaPendienteCierre(item: DevolucionCreditoItem): string | null {
  const p = item.pendiente_cierre;
  if (!p) return null;
  if (p.motivo === "inversionistas_en_padre") {
    return p.restantes === 1
      ? "Falta liquidar a 1 inversionista"
      : `Faltan liquidar ${p.restantes} inversionistas`;
  }
  return "Inversionista con saldo pendiente en el espejo";
}

type TabDevolucion = "bandeja" | "historial";

export function DevolucionCube() {
  // Bandeja y Historial son consultas independientes (distinto `status` al
  // backend), así que cada una lleva su propia paginación/búsqueda — mezclar
  // page/search entre las dos haría que cambiar de tab reseteara filtros que
  // el operador no tocó.
  const [tab, setTab] = usePersistedState<TabDevolucion>("cartera/devolucionCube/tab", "bandeja");

  const [actingId, setActingId] = useState<number | null>(null);

  const bandeja = useDevolucionListado(
    "BANDEJA_DEVOLUCION",
    "cartera/devolucionCube",
    tab === "bandeja"
  );
  const historial = useDevolucionListado(
    "HISTORIAL",
    "cartera/devolucionCube/historial",
    tab === "historial"
  );
  const {
    items,
    loading,
    error,
    page,
    setPage,
    totalPages,
    total,
    search,
    searchInput,
    setSearchInput,
    hasActiveFilters,
    load,
    onBuscar,
    clearFilters,
  } = bandeja;
  const {
    items: historialItems,
    loading: historialLoading,
    error: historialError,
    page: historialPage,
    setPage: setHistorialPage,
    totalPages: historialTotalPages,
    total: historialTotal,
    searchInput: historialSearchInput,
    setSearchInput: setHistorialSearchInput,
    hasActiveFilters: hasActiveHistorialFilters,
    load: loadHistorial,
    onBuscar: onBuscarHistorial,
    clearFilters: clearHistorialFilters,
  } = historial;

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCredit, setRejectCredit] = useState<DevolucionCreditoItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonCredit, setReasonCredit] = useState<DevolucionCreditoItem | null>(null);

  useEffect(() => {
    if (tab === "bandeja") void load();
  }, [tab, load]);

  useEffect(() => {
    if (tab === "historial") void loadHistorial();
  }, [tab, loadHistorial]);

  const onAceptar = async (creditoId: number) => {
    try {
      setActingId(creditoId);
      const res = await aceptarDevolucion(creditoId);
      toast.success(res.message || "Devolución aceptada");
      await load();
    } catch (e: unknown) {
      const candidate =
        typeof e === "object" &&
        e !== null &&
        "response" in e
          ? (e as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(
        typeof candidate === "string" && candidate.trim() !== ""
          ? candidate
          : "No se pudo aceptar la devolución"
      );
    } finally {
      setActingId(null);
    }
  };

  const onRechazar = async (creditoId: number, motivo: string) => {
    if (!motivo || !motivo.trim()) {
      toast.error("El motivo es obligatorio para rechazar");
      return;
    }

    try {
      setActingId(creditoId);
      const res = await rechazarDevolucion(creditoId, motivo.trim());
      toast.success(res.message || "Devolución rechazada");
      await load();
    } catch (e: unknown) {
      const candidate =
        typeof e === "object" &&
        e !== null &&
        "response" in e
          ? (e as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(
        typeof candidate === "string" && candidate.trim() !== ""
          ? candidate
          : "No se pudo rechazar la devolución"
      );
    } finally {
      setActingId(null);
    }
  };

  const subtitle = useMemo(() => {
    if (search) return `Créditos pendientes filtrados por "${search}"`;
    return "Créditos pendientes y rechazados para devolución a Cube";
  }, [search]);

  const estadoLabel = (estado: string) => {
    switch (estado) {
      case "PENDIENTE_AUTORIZACION":
        return "Pendiente de autorización";
      case "VERIFICADO":
        return "Verificado";
      case "RECHAZADO":
        return "Rechazado";
      case "COMPLETADO":
        return "Completado";
      case "NO_APLICA":
        return "No aplica";
      default:
        return estado;
    }
  };

  const estadoBadgeClass = (estado: string) => {
    switch (estado) {
      case "RECHAZADO":
        return "bg-red-100 text-red-800 border-red-300";
      case "COMPLETADO":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "VERIFICADO":
        return "bg-blue-100 text-blue-800 border-blue-300";
      default:
        return "bg-amber-100 text-amber-800 border-amber-300";
    }
  };

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-6 pb-20">
      <div className="w-full max-w-[1400px] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Devolución Cube</h1>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void (tab === "bandeja" ? load() : loadHistorial())}
            disabled={tab === "bandeja" ? loading : historialLoading}
            className="gap-1.5 text-xs bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(tab === "bandeja" ? loading : historialLoading) ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        {/*
          El componente Tabs de shadcn depende de tokens CSS (--muted,
          --background, etc.) definidos en src/styles/globals.css, que este
          proyecto nunca importa (usa Tailwind v3 vía src/index.css; ese
          archivo está en sintaxis v4 y no es compatible sin migrar). Sin esos
          tokens, bg-muted/text-muted-foreground quedan transparentes. Se
          sobreescriben acá con clases estándar en vez de tocar el componente
          base compartido o el CSS global.
        */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabDevolucion)}>
          <TabsList className="bg-slate-100 text-slate-600">
            <TabsTrigger
              value="bandeja"
              className="text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
            >
              Bandeja
            </TabsTrigger>
            <TabsTrigger
              value="historial"
              className="text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
            >
              Historial
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bandeja" className="space-y-4">
        {/* Search + Stats inline */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              placeholder="Buscar por nombre o SIFCO"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onBuscar();
              }}
              className="pl-9 h-8 text-xs text-gray-900"
            />
          </div>
          <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={onBuscar}>
            Buscar
          </Button>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={clearFilters} className="h-8 text-xs text-gray-600 border-gray-300 hover:bg-gray-100 gap-1">
              <X className="w-3.5 h-3.5" /> Limpiar
              <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-xs">1</Badge>
            </Button>
          )}
          <Badge variant="outline" className="text-[11px] border-blue-200 text-blue-700 bg-blue-50 tabular-nums">
            {total} créditos
          </Badge>
          <span className="text-xs text-gray-500">
            Página {page} de {Math.max(totalPages, 1)}
          </span>
        </div>

        <Card className="border border-slate-200 bg-white/95 shadow-sm">
          <CardContent className="p-0">
            {loading && <p className="text-sm text-slate-500 p-4">Cargando...</p>}
            {error && <p className="text-sm text-red-600 p-4">{error}</p>}

            {!loading && !error && items.length === 0 && (
              <p className="text-sm text-slate-500 p-4">No hay créditos pendientes de autorización.</p>
            )}

            {!loading && !error && items.length > 0 && (
              <div className="overflow-x-auto rounded-lg">
                <table className="w-full text-sm text-slate-900">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 font-semibold text-slate-700">No. Crédito SIFCO</th>
                      <th className="text-left py-2 px-3 font-semibold text-slate-700">Cliente</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-700">Capital</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-700">Cuota</th>
                      <th className="text-left py-2 px-3 font-semibold text-slate-700">Motivo</th>
                      <th className="text-left py-2 px-3 font-semibold text-slate-700">Estado</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-700">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.credito_id} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-2 px-3 font-medium text-slate-900">{row.numero_credito_sifco}</td>
                        <td className="py-2 px-3 text-slate-800">{row.usuario_nombre || "Sin nombre"}</td>
                        <td className="py-2 px-3 text-right text-slate-900">
                          Q {Number(row.capital).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-900">
                          Q {Number(row.cuota).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-slate-700 max-w-[360px]">
                          <p className="line-clamp-2 text-sm leading-5">
                            {row.motivo_contextual || "Sin motivo registrado"}
                          </p>
                          {!!row.motivo_contextual && row.motivo_contextual.length > 80 && (
                            <button
                              type="button"
                              className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                              onClick={() => {
                                setReasonCredit(row);
                                setReasonOpen(true);
                              }}
                            >
                              Ver motivo completo
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {row.estado_devolucion === "RECHAZADO" ? (
                            <Badge className="bg-red-100 text-red-800 border-red-300">
                              Rechazado
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                              {estadoLabel(row.estado_devolucion)}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center justify-end gap-2">
                            {row.estado_devolucion !== "RECHAZADO" && (
                              <>
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700"
                                  disabled={actingId === row.credito_id}
                                  onClick={() => void onAceptar(row.credito_id)}
                                >
                                  Aceptar
                                </Button>
                                <Button
                                  size="sm"
                                  className="bg-red-600 text-white hover:bg-red-700 border-none"
                                  disabled={actingId === row.credito_id}
                                  onClick={() => {
                                    setRejectCredit(row);
                                    setRejectReason("");
                                    setRejectOpen(true);
                                  }}
                                >
                                  Rechazar
                                </Button>
                              </>
                            )}
                            {row.estado_devolucion === "RECHAZADO" && (
                              <Badge className="bg-red-50 text-red-700 border-red-200">
                                Rechazado
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="historial" className="space-y-4">
            {/* Search + Stats inline */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  placeholder="Buscar por nombre o SIFCO"
                  value={historialSearchInput}
                  onChange={(e) => setHistorialSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onBuscarHistorial();
                  }}
                  className="pl-9 h-8 text-xs text-gray-900"
                />
              </div>
              <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={onBuscarHistorial}>
                Buscar
              </Button>
              {hasActiveHistorialFilters && (
                <Button variant="outline" size="sm" onClick={clearHistorialFilters} className="h-8 text-xs text-gray-600 border-gray-300 hover:bg-gray-100 gap-1">
                  <X className="w-3.5 h-3.5" /> Limpiar
                  <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-xs">1</Badge>
                </Button>
              )}
              <Badge variant="outline" className="text-[11px] border-blue-200 text-blue-700 bg-blue-50 tabular-nums">
                {historialTotal} créditos
              </Badge>
              <span className="text-xs text-gray-500">
                Página {historialPage} de {Math.max(historialTotalPages, 1)}
              </span>
            </div>

            <Card className="border border-slate-200 bg-white/95 shadow-sm">
              <CardContent className="p-0">
                {historialLoading && <p className="text-sm text-slate-500 p-4">Cargando...</p>}
                {historialError && <p className="text-sm text-red-600 p-4">{historialError}</p>}

                {!historialLoading && !historialError && historialItems.length === 0 && (
                  <p className="text-sm text-slate-500 p-4">No hay créditos en el historial de devolución.</p>
                )}

                {!historialLoading && !historialError && historialItems.length > 0 && (
                  <div className="overflow-x-auto rounded-lg">
                    <table className="w-full text-sm text-slate-900">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-semibold text-slate-700">No. Crédito SIFCO</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-700">Cliente</th>
                          <th className="text-right py-2 px-3 font-semibold text-slate-700">Capital</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-700">Estado</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-700">Seguimiento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historialItems.map((row) => {
                          const alerta = alertaPendienteCierre(row);
                          return (
                            <tr key={row.credito_id} className="border-b border-slate-100 last:border-b-0">
                              <td className="py-2 px-3 font-medium text-slate-900">{row.numero_credito_sifco}</td>
                              <td className="py-2 px-3 text-slate-800">{row.usuario_nombre || "Sin nombre"}</td>
                              <td className="py-2 px-3 text-right text-slate-900">
                                Q {Number(row.capital).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 px-3">
                                <Badge className={estadoBadgeClass(row.estado_devolucion)}>
                                  {estadoLabel(row.estado_devolucion)}
                                </Badge>
                              </td>
                              <td className="py-2 px-3">
                                {alerta ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                                    <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                                    {alerta}
                                  </span>
                                ) : row.estado_devolucion === "VERIFICADO" ? (
                                  <span className="text-xs text-slate-400">En curso</span>
                                ) : (
                                  <span className="text-xs text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/*
        Pagination fixed bottom. `variant="outline"` del Button compartido usa
        bg-background/border-input (tokens de globals.css, no importado — ver
        el comentario junto a <Tabs> más arriba), así que sin className quedan
        transparentes. Se sobreescriben acá con clases estándar.
      */}
      {tab === "bandeja" && totalPages > 1 && (
        <div className="border-t border-gray-200 bg-white px-6 py-3 flex items-center justify-center gap-2 fixed bottom-0 inset-x-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <Button
            variant="outline"
            size="sm"
            className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-gray-600 tabular-nums">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Siguiente
          </Button>
        </div>
      )}

      {tab === "historial" && historialTotalPages > 1 && (
        <div className="border-t border-gray-200 bg-white px-6 py-3 flex items-center justify-center gap-2 fixed bottom-0 inset-x-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <Button
            variant="outline"
            size="sm"
            className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            disabled={historialPage <= 1 || historialLoading}
            onClick={() => setHistorialPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-gray-600 tabular-nums">
            Página {historialPage} de {historialTotalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            disabled={historialPage >= historialTotalPages || historialLoading}
            onClick={() => setHistorialPage((p) => Math.min(historialTotalPages, p + 1))}
          >
            Siguiente
          </Button>
        </div>
      )}

      <Dialog open={reasonOpen} onOpenChange={setReasonOpen}>
        <DialogContent className="max-w-2xl bg-white border border-slate-200 shadow-2xl text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Motivo de solicitud</DialogTitle>
            <DialogDescription className="text-slate-600">
              Crédito {reasonCredit?.numero_credito_sifco} · Cliente {reasonCredit?.usuario_nombre || "Sin nombre"}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800 leading-6 max-h-[55vh] overflow-auto whitespace-pre-wrap">
            {reasonCredit?.motivo_contextual || "Sin motivo registrado"}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50" onClick={() => setReasonOpen(false)}>
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-lg bg-white border border-slate-200 shadow-2xl text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Rechazar devolución</DialogTitle>
            <DialogDescription className="text-slate-600">
              Ingresa el motivo del rechazo para el crédito {rejectCredit?.numero_credito_sifco}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-xs text-slate-500">Cliente: {rejectCredit?.usuario_nombre || "Sin nombre"}</p>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Escribe el motivo del rechazo"
              className="min-h-28 text-sm text-slate-900 placeholder:text-slate-400 bg-white"
            />
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50" onClick={() => setRejectOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700 border-none"
              disabled={!rejectCredit || actingId === rejectCredit.credito_id}
              onClick={async () => {
                if (!rejectCredit) return;
                await onRechazar(rejectCredit.credito_id, rejectReason);
                setRejectOpen(false);
              }}
            >
              Confirmar rechazo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

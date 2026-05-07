import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPendingDevolucion,
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
import { toast } from "sonner";
import { RefreshCw, Search } from "lucide-react";

const PAGE_SIZE = 10;

export function DevolucionCube() {
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DevolucionCreditoItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCredit, setRejectCredit] = useState<DevolucionCreditoItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonCredit, setReasonCredit] = useState<DevolucionCreditoItem | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Acepta alias typo: PENDIENTE_VERFICACION / PENDIENTE_VERIFICACION
      const res = await getPendingDevolucion(page, PAGE_SIZE, "PENDIENTE_VERFICACION", search);

      const credits = res?.data?.credits ?? [];
      const pagination = res?.data?.pagination;

      setItems(Array.isArray(credits) ? credits : []);
      setTotal(pagination?.total ?? 0);
      setTotalPages(pagination?.totalPages ?? 1);
    } catch (e: unknown) {
      const candidate =
        typeof e === "object" &&
        e !== null &&
        "response" in e
          ? (e as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      const msg =
        typeof candidate === "string" && candidate.trim() !== ""
          ? candidate
          : "Error cargando devoluciones pendientes";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const onBuscar = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };

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
    return "Créditos pendientes de autorización para devolución a Cube";
  }, [search]);

  const estadoLabel = (estado: string) => {
    switch (estado) {
      case "PENDIENTE_AUTORIZACION":
        return "Pendiente de autorización";
      case "VERIFICADO":
        return "Verificado";
      case "RECHAZADO":
        return "Rechazado";
      case "NO_APLICA":
        return "No aplica";
      default:
        return estado;
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
            onClick={() => void load()}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

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
          <Button size="sm" className="h-8 text-xs" onClick={onBuscar}>
            Buscar
          </Button>
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
                      <th className="text-left py-2 px-3 font-semibold text-slate-700">Motivo de solicitud</th>
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
                            {row.motivo_solicitud || "Sin motivo registrado"}
                          </p>
                          {!!row.motivo_solicitud && row.motivo_solicitud.length > 80 && (
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
                          <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                            {estadoLabel(row.estado_devolucion)}
                          </Badge>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center justify-end gap-2">
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
      </div>

      {/* Pagination fixed bottom */}
      {totalPages > 1 && (
        <div className="border-t border-gray-200 bg-white px-6 py-3 flex items-center justify-center gap-2 fixed bottom-0 inset-x-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <Button
            variant="outline"
            size="sm"
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
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
            {reasonCredit?.motivo_solicitud || "Sin motivo registrado"}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setReasonOpen(false)}>
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
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
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

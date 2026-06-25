import { useCallback, useEffect, useState } from "react";
import {
  getResumenAseguradoras,
  descargarResumenExcel,
  crearAseguradora,
  cambiarAseguradoraCredito,
  type ResumenAseguradora,
} from "../services/aseguradoras.services";
import {
  getAseguradoras,
  getCreditosPaginados,
  type Aseguradora,
  type CreditoUsuarioPago,
} from "../services/services";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, Plus, RefreshCw, Search, Shield, X } from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtQ(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "Q 0.00";
  return `Q ${n.toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "response" in e) {
    const msg = (e as { response?: { data?: { message?: string } } }).response
      ?.data?.message;
    if (typeof msg === "string" && msg.trim() !== "") return msg;
  }
  return fallback;
}

const PAGE_SIZE = 10;

// ─── ResumenPanel ────────────────────────────────────────────────────────────

function ResumenPanel({
  resumen,
  loading,
  onDescargar,
  onNueva,
  onRecargar,
}: {
  resumen: ResumenAseguradora[];
  loading: boolean;
  onDescargar: () => void;
  onNueva: () => void;
  onRecargar: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Resumen por aseguradora
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Totales de créditos y montos de seguro agrupados por aseguradora
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onRecargar}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDescargar}
            className="gap-1.5 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar Excel
          </Button>
          <Button size="sm" onClick={onNueva} className="gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />
            Nueva aseguradora
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-slate-500">Cargando resumen...</p>
      )}

      {!loading && resumen.length === 0 && (
        <p className="text-sm text-slate-500">
          No hay aseguradoras registradas.
        </p>
      )}

      {!loading && resumen.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {resumen.map((a) => (
            <Card
              key={a.id}
              className="border border-slate-200 bg-white shadow-sm"
            >
              <CardContent className="p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">
                    {a.nombre}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Créditos</span>
                  <Badge
                    variant="secondary"
                    className="tabular-nums bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {a.cantidad_creditos}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Monto seguro</span>
                  <span className="font-medium text-slate-800 tabular-nums">
                    {fmtQ(a.monto_seguro)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CreditosTable ────────────────────────────────────────────────────────────

function CreditosTable({
  aseguradoras,
  onCambiarAseguradora,
}: {
  aseguradoras: Aseguradora[];
  onCambiarAseguradora: (creditoId: number, aseguradoraId: number, nombre: string) => Promise<void>;
}) {
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [anio, setAnio] = useState(now.getFullYear());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CreditoUsuarioPago[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Modal cambiar aseguradora
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCredito, setModalCredito] = useState<CreditoUsuarioPago | null>(null);
  const [selectedAseg, setSelectedAseg] = useState<number | "">("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getCreditosPaginados({
        mes,
        anio,
        page,
        perPage: PAGE_SIZE,
        excel: false,
        numero_credito_sifco: search.trim() !== "" ? search.trim() : undefined,
      });
      setRows(res.data ?? []);
      setTotal(res.totalCount ?? 0);
      setTotalPages(res.totalPages ?? 1);
    } catch (e: unknown) {
      setError(errMsg(e, "Error cargando créditos"));
    } finally {
      setLoading(false);
    }
  }, [mes, anio, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const onBuscar = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const abrirModal = (row: CreditoUsuarioPago) => {
    setModalCredito(row);
    setSelectedAseg("");
    setModalOpen(true);
  };

  const confirmarCambio = async () => {
    if (!modalCredito || selectedAseg === "") return;
    const aseg = aseguradoras.find((a) => a.id === selectedAseg);
    try {
      setActing(true);
      await onCambiarAseguradora(
        modalCredito.creditos.credito_id,
        selectedAseg as number,
        aseg?.nombre ?? ""
      );
      setModalOpen(false);
      void load();
    } finally {
      setActing(false);
    }
  };

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const years = Array.from({ length: 8 }, (_, i) => 2022 + i);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Créditos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {total} crédito{total !== 1 ? "s" : ""} · Página {page} de{" "}
            {Math.max(totalPages, 1)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mes */}
          <select
            value={mes}
            onChange={(e) => { setMes(Number(e.target.value)); setPage(1); }}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value={0}>Todos los meses</option>
            {meses.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          {/* Año */}
          <select
            value={anio}
            onChange={(e) => { setAnio(Number(e.target.value)); setPage(1); }}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input
            placeholder="Buscar por No. SIFCO"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onBuscar(); }}
            className="pl-9 h-8 text-xs text-slate-900"
          />
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={onBuscar}>
          Buscar
        </Button>
        {(searchInput !== "" || search !== "") && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearSearch}
            className="h-8 text-xs gap-1"
          >
            <X className="w-3.5 h-3.5" />
            Limpiar
          </Button>
        )}
      </div>

      <Card className="border border-slate-200 bg-white/95 shadow-sm">
        <CardContent className="p-0">
          {loading && (
            <p className="text-sm text-slate-500 p-4">Cargando...</p>
          )}
          {error && (
            <p className="text-sm text-red-600 p-4">{error}</p>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-500 p-4">
              No se encontraron créditos.
            </p>
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg">
              <table className="w-full text-sm text-slate-900">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 font-semibold text-slate-700">
                      No. SIFCO
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-700">
                      Cliente
                    </th>
                    <th className="text-right py-2 px-3 font-semibold text-slate-700">
                      Capital
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-700">
                      Estado
                    </th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-700">
                      Aseguradora
                    </th>
                    <th className="text-right py-2 px-3 font-semibold text-slate-700">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.creditos.credito_id}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {row.creditos.numero_credito_sifco}
                      </td>
                      <td className="py-2 px-3 text-slate-800">
                        {row.usuarios.nombre}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-900 tabular-nums">
                        {fmtQ(row.creditos.capital)}
                      </td>
                      <td className="py-2 px-3">
                        <Badge
                          className={
                            row.creditos.statusCredit === "ACTIVO"
                              ? "bg-green-100 text-green-800 border-green-300"
                              : row.creditos.statusCredit === "CANCELADO"
                              ? "bg-slate-100 text-slate-700 border-slate-300"
                              : "bg-amber-100 text-amber-800 border-amber-300"
                          }
                        >
                          {row.creditos.statusCredit}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-slate-700">
                        {row.aseguradora ?? (
                          <span className="text-slate-400 italic text-xs">Sin asignar</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={() => abrirModal(row)}
                        >
                          Cambiar aseguradora
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-slate-600 tabular-nums">
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

      {/* Modal cambiar aseguradora */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-sm bg-white border border-slate-200 shadow-2xl text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-900">
              Cambiar aseguradora
            </DialogTitle>
            <DialogDescription className="text-slate-600">
              Crédito {modalCredito?.creditos.numero_credito_sifco} ·{" "}
              {modalCredito?.usuarios.nombre}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Selecciona aseguradora
            </label>
            <select
              value={selectedAseg}
              onChange={(e) =>
                setSelectedAseg(
                  e.target.value === "" ? "" : Number(e.target.value)
                )
              }
              className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">— Elige una aseguradora —</option>
              {aseguradoras.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={selectedAseg === "" || acting}
              onClick={() => void confirmarCambio()}
            >
              {acting ? "Guardando..." : "Confirmar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Seguros() {
  const [resumen, setResumen] = useState<ResumenAseguradora[]>([]);
  const [resumenLoading, setResumenLoading] = useState(true);
  const [aseguradoras, setAseguradoras] = useState<Aseguradora[]>([]);

  // Modal nueva aseguradora
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [nuevaNombre, setNuevaNombre] = useState("");
  const [creando, setCreando] = useState(false);

  const cargarResumen = useCallback(async () => {
    try {
      setResumenLoading(true);
      const res = await getResumenAseguradoras();
      setResumen(res.data ?? []);
    } catch (e: unknown) {
      toast.error(errMsg(e, "Error cargando resumen de aseguradoras"));
    } finally {
      setResumenLoading(false);
    }
  }, []);

  const cargarAseguradoras = useCallback(async () => {
    try {
      const data = await getAseguradoras();
      setAseguradoras(data ?? []);
    } catch {
      // silencioso — la lista es secundaria
    }
  }, []);

  useEffect(() => {
    void cargarResumen();
    void cargarAseguradoras();
  }, [cargarResumen, cargarAseguradoras]);

  const onDescargar = async () => {
    try {
      const blob = await descargarResumenExcel();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resumen-aseguradoras.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast.error(errMsg(e, "Error descargando Excel"));
    }
  };

  const onCrearAseguradora = async () => {
    if (!nuevaNombre.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    try {
      setCreando(true);
      await crearAseguradora(nuevaNombre.trim());
      toast.success("Aseguradora creada");
      setNuevaOpen(false);
      setNuevaNombre("");
      await cargarResumen();
      await cargarAseguradoras();
    } catch (e: unknown) {
      toast.error(errMsg(e, "Error creando aseguradora"));
    } finally {
      setCreando(false);
    }
  };

  const onCambiarAseguradora = async (
    credito_id: number,
    aseguradora_id: number,
    nombre: string
  ) => {
    try {
      await cambiarAseguradoraCredito(credito_id, aseguradora_id);
      toast.success(`Aseguradora cambiada a "${nombre}"`);
      void cargarResumen();
    } catch (e: unknown) {
      toast.error(errMsg(e, "Error cambiando aseguradora"));
      throw e; // re-throw so CreditosTable can react
    }
  };

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-6 pb-20">
      <div className="w-full max-w-[1400px] space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">Seguros</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Gestión de aseguradoras y asignación a créditos
          </p>
        </div>

        {/* Resumen cards */}
        <ResumenPanel
          resumen={resumen}
          loading={resumenLoading}
          onDescargar={() => void onDescargar()}
          onNueva={() => setNuevaOpen(true)}
          onRecargar={() => void cargarResumen()}
        />

        {/* Credits list */}
        <CreditosTable
          aseguradoras={aseguradoras}
          onCambiarAseguradora={onCambiarAseguradora}
        />
      </div>

      {/* Modal nueva aseguradora */}
      <Dialog open={nuevaOpen} onOpenChange={setNuevaOpen}>
        <DialogContent className="max-w-sm bg-white border border-slate-200 shadow-2xl text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-900">
              Nueva aseguradora
            </DialogTitle>
            <DialogDescription className="text-slate-600">
              Ingresa el nombre de la nueva aseguradora.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700">
              Nombre
            </label>
            <Input
              value={nuevaNombre}
              onChange={(e) => setNuevaNombre(e.target.value)}
              placeholder="Ej. Seguros Alianza"
              className="text-sm text-slate-900"
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCrearAseguradora();
              }}
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setNuevaOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!nuevaNombre.trim() || creando}
              onClick={() => void onCrearAseguradora()}
            >
              {creando ? "Creando..." : "Crear"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

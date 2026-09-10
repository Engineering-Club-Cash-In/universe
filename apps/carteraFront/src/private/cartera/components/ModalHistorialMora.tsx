"use client";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  FileDown,
  History,
  Info,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMoraHistorialCredito } from "../hooks/useLateFee";
import { descargarMoraHistorialCreditoExcel } from "../services/services";
import type { MoraEvento } from "../services/services";
import { getApiErrorMessage } from "@/lib/apiError";
import { fmtQ } from "@/lib/moneda";
// `moras_historial.fecha` es timestamp SIN zona y guarda UTC: se muestra
// (`fmtFechaHoraGT`) y se filtra (`diaISOGT`) en hora de Guatemala. Los dos
// salen del mismo helper a propósito — si el día del filtro no se calculara en
// la misma zona que la fecha que se pinta, el filtro dejaría fuera eventos
// visibles en pantalla.
import { diaISOGT, fmtFechaHoraGT } from "@/lib/fechaGT";

/**
 * Los seis tipo_evento del backend agrupados en lenguaje de negocio.
 * El usuario piensa en "se creó / se modificó / se condonó", no en el enum.
 */
const GRUPOS_EVENTO = [
  { key: "CREACION", label: "Creación", tipos: ["CREACION"] },
  {
    key: "MODIFICACION",
    label: "Modificación",
    tipos: ["RECALCULO", "INCREMENTO", "DECREMENTO"],
  },
  { key: "CONDONACION", label: "Condonación", tipos: ["CONDONACION"] },
  { key: "DESACTIVACION", label: "Desactivación", tipos: ["DESACTIVACION"] },
] as const;

type GrupoKey = (typeof GRUPOS_EVENTO)[number]["key"];

const TIPO_A_GRUPO: Record<string, GrupoKey> = GRUPOS_EVENTO.reduce(
  (acc, g) => {
    g.tipos.forEach((t) => (acc[t] = g.key));
    return acc;
  },
  {} as Record<string, GrupoKey>
);

const esCondonacion = (ev: MoraEvento) =>
  String(ev.tipo_evento ?? "").toUpperCase().includes("CONDONACION");

const origenLabel = (origen?: string | null) => {
  const o = String(origen ?? "").toUpperCase();
  if (o.includes("MASIV")) return "masiva";
  if (o.includes("INDIVIDUAL")) return "individual";
  return origen || "";
};

interface Props {
  open: boolean;
  onClose: () => void;
  creditoId?: number;
  numeroCreditoSifco?: string;
  /** Solo ADMIN puede entrar a /mora; para el resto el historial es de lectura. */
  isAdmin?: boolean;
}

export function ModalHistorialMora({
  open,
  onClose,
  creditoId,
  numeroCreditoSifco,
  isAdmin = false,
}: Props) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useMoraHistorialCredito(
    creditoId,
    open
  );

  const [exportando, setExportando] = useState(false);

  // Filtros de cliente: el endpoint devuelve TODOS los eventos del crédito.
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [grupos, setGrupos] = useState<GrupoKey[]>([]);

  // El backend puede responder 200 con success:false; lo tratamos como error.
  const fallo = isError || (!!data && data.success === false);
  const eventos: MoraEvento[] = useMemo(() => data?.data ?? [], [data]);

  // Cada vez que se abre el modal (o cambia el crédito) arrancamos sin filtros.
  useEffect(() => {
    setDesde("");
    setHasta("");
    setGrupos([]);
  }, [open, creditoId]);

  const eventosFiltrados = useMemo(() => {
    return eventos.filter((ev) => {
      const dia = diaISOGT(ev.fecha);
      if (desde && dia && dia < desde) return false;
      if (hasta && dia && dia > hasta) return false;
      if (grupos.length) {
        const grupo = TIPO_A_GRUPO[String(ev.tipo_evento ?? "").toUpperCase()];
        if (!grupo || !grupos.includes(grupo)) return false;
      }
      return true;
    });
  }, [eventos, desde, hasta, grupos]);

  const filtrosActivos =
    (desde ? 1 : 0) + (hasta ? 1 : 0) + (grupos.length ? 1 : 0);

  const limpiarFiltros = () => {
    setDesde("");
    setHasta("");
    setGrupos([]);
  };

  const toggleGrupo = (key: GrupoKey) =>
    setGrupos((prev) =>
      prev.includes(key) ? prev.filter((g) => g !== key) : [...prev, key]
    );

  // Este endpoint devuelve el archivo directamente (blob), no un excelUrl.
  const descargarExcel = async () => {
    if (!creditoId) return;
    setExportando(true);
    try {
      const blob = await descargarMoraHistorialCreditoExcel(creditoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `historial-mora-credito-${
        numeroCreditoSifco ?? creditoId
      }.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revocar en el mismo tick que el click aborta la descarga en Safari y
      // Firefox (sin error visible): el navegador todavía no terminó de leer
      // el blob. Se difiere para que la descarga alcance a arrancar.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error("No se pudo descargar el historial de mora", {
        description: getApiErrorMessage(err, "Error desconocido"),
      });
    } finally {
      setExportando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white sm:max-w-5xl max-h-[88vh] flex flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex items-center gap-2 text-blue-700">
            <History className="w-5 h-5" />
            Historial de mora
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            Crédito SIFCO <b>{numeroCreditoSifco ?? "--"}</b>. Incluye los
            ajustes de mora y las condonaciones.
          </DialogDescription>
        </DialogHeader>

        {/* Filtros + acciones (siempre visibles, no scrollean con la lista) */}
        <div className="shrink-0 rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[150px]">
                <label className="text-xs font-semibold text-blue-800 mb-1 block">
                  Desde
                </label>
                <Input
                  type="date"
                  value={desde}
                  max={hasta || undefined}
                  onChange={(e) => setDesde(e.target.value)}
                  className="h-9 text-gray-900 border-blue-200 bg-white [color-scheme:light]"
                />
              </div>
              <div className="min-w-[150px]">
                <label className="text-xs font-semibold text-blue-800 mb-1 block">
                  Hasta
                </label>
                <Input
                  type="date"
                  value={hasta}
                  min={desde || undefined}
                  onChange={(e) => setHasta(e.target.value)}
                  className="h-9 text-gray-900 border-blue-200 bg-white [color-scheme:light]"
                />
              </div>
              {filtrosActivos > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={limpiarFiltros}
                  className="h-9 border-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  <X className="w-4 h-4 mr-1" />
                  Limpiar
                  <span className="ml-1 rounded-full bg-gray-200 px-1.5 text-[10px] font-bold text-gray-700">
                    {filtrosActivos}
                  </span>
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="h-9 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
              >
                Cerrar
              </Button>
              {!fallo && eventos.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  title="El Excel siempre trae el historial completo del crédito, sin aplicar estos filtros."
                  className="h-9 text-green-700 border-green-300 hover:bg-green-50"
                  onClick={descargarExcel}
                  disabled={exportando || isLoading}
                >
                  {exportando ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4 mr-2" />
                  )}
                  {exportando ? "Generando..." : "Excel (completo)"}
                </Button>
              )}
              {isAdmin && numeroCreditoSifco && (
                <Button
                  size="sm"
                  className="h-9 bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    onClose();
                    navigate(`/mora?sifco=${numeroCreditoSifco}`);
                  }}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Ir a gestión de mora
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-blue-800">
              Tipo de evento:
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGrupos([])}
              className={`h-8 ${
                grupos.length === 0
                  ? "border-blue-500 bg-blue-100 text-blue-800"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              Todos
            </Button>
            {GRUPOS_EVENTO.map((g) => {
              const activo = grupos.includes(g.key);
              return (
                <Button
                  key={g.key}
                  variant="outline"
                  size="sm"
                  aria-pressed={activo}
                  onClick={() => toggleGrupo(g.key)}
                  className={`h-8 ${
                    activo
                      ? "border-blue-500 bg-blue-100 text-blue-800"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {g.label}
                </Button>
              );
            })}
          </div>

          {!fallo && eventos.length > 0 && (
            <p className="flex items-center gap-1 text-[11px] text-gray-500">
              <Info className="w-3 h-3 shrink-0" />
              Fechas y filtros en hora de Guatemala (GMT-6). Los filtros solo
              afectan lo que ves aquí: el Excel siempre baja el historial
              completo del crédito.
            </p>
          )}
        </div>

        {/* Lista de eventos: único bloque que scrollea */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-blue-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Cargando historial...
          </div>
        ) : fallo ? (
          <div className="flex flex-col items-center gap-2 py-12 text-red-600">
            <AlertCircle className="h-6 w-6" />
            <p className="text-sm font-semibold">
              No se pudo cargar el historial de mora
            </p>
          </div>
        ) : eventos.length === 0 ? (
          <div className="py-12 text-center text-gray-400 font-semibold">
            Este crédito no tiene eventos de mora registrados.
          </div>
        ) : eventosFiltrados.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-gray-400 font-semibold">
              No hay eventos con esos filtros.
            </p>
            <p className="text-xs text-gray-500">
              El crédito tiene {eventos.length}{" "}
              {eventos.length === 1 ? "evento" : "eventos"} en total.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={limpiarFiltros}
              className="border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              <X className="w-4 h-4 mr-1" /> Limpiar filtros
            </Button>
          </div>
        ) : (
          <ol className="relative border-l border-blue-100 ml-3 space-y-4 py-2">
            {eventosFiltrados.map((ev) => {
              const cond = esCondonacion(ev);
              return (
                <li key={ev.historial_id} className="ml-5">
                  <span
                    className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-white ${
                      cond ? "bg-green-500" : "bg-blue-400"
                    }`}
                  />
                  <div
                    className={`rounded-xl border p-3 ${
                      cond
                        ? "border-green-200 bg-green-50"
                        : "border-blue-100 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-bold text-gray-800">
                        {cond && (
                          <ShieldCheck className="w-4 h-4 text-green-600" />
                        )}
                        {ev.tipo_evento}
                        {ev.origen && (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              cond
                                ? "bg-green-100 text-green-700"
                                : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {origenLabel(ev.origen)}
                          </span>
                        )}
                      </span>
                      <span
                        className="text-xs text-gray-500"
                        title="Hora de Guatemala (GMT-6)"
                      >
                        {fmtFechaHoraGT(ev.fecha)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="flex items-center gap-1 tabular-nums text-gray-700">
                        {fmtQ(ev.monto_anterior)}
                        <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                        <b
                          className={
                            cond ? "text-green-700" : "text-blue-700"
                          }
                        >
                          {fmtQ(ev.monto_nuevo)}
                        </b>
                      </span>
                      <span className="text-xs text-gray-600 tabular-nums">
                        Cuotas atrasadas: {ev.cuotas_atrasadas_anterior} →{" "}
                        <b>{ev.cuotas_atrasadas_nuevas}</b>
                      </span>
                      <span className="text-xs text-gray-500">
                        {ev.usuario || "sistema"}
                      </span>
                    </div>

                    {ev.motivo && (
                      <p className="mt-2 text-xs text-gray-600">
                        <span className="font-semibold">Motivo:</span>{" "}
                        {ev.motivo}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        </div>

        {/* Pie fijo: cuántos eventos se están viendo de cuántos hay */}
        {!fallo && !isLoading && eventos.length > 0 && (
          <div className="shrink-0 border-t border-gray-100 pt-2 text-xs text-gray-600">
            {filtrosActivos > 0 ? (
              <>
                Mostrando <b>{eventosFiltrados.length}</b> de{" "}
                <b>{eventos.length}</b> eventos
              </>
            ) : (
              <>
                <b>{eventos.length}</b>{" "}
                {eventos.length === 1 ? "evento" : "eventos"} en total
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ModalHistorialMora;

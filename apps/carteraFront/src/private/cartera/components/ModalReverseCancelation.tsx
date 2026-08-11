/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useReverseCancelation } from "../hooks/cancelCredit";
import type { ReverseCancelationResponse } from "../services/services";
import { getApiErrorMessage } from "@/lib/apiError";
import {
  RotateCcw,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { toast } from "sonner";

const GATE_LABELS: Record<string, string> = {
  SNAPSHOT: "Snapshot de reversa",
  STATUS: "Estado del crédito",
  ARTEFACTOS: "Artefactos del cierre",
  PAGO_CIERRE: "Pago de cierre íntegro",
  LIQUIDACION_INVERSIONISTAS: "Liquidación a inversionistas",
  ESPEJO_LIQUIDACION: "Fotos de liquidación (espejo)",
  ABONOS_CAPITAL: "Abonos de capital",
  PAGOS_POSTERIORES: "Pagos posteriores",
  FACTURAS: "Facturas electrónicas",
};

export function ModalReverseCancelation({
  open,
  onClose,
  creditId,
  numeroSifco,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  creditId: number;
  numeroSifco?: string;
  onSuccess?: () => void;
}) {
  const reverse = useReverseCancelation();
  const [dryRunResult, setDryRunResult] =
    useState<ReverseCancelationResponse | null>(null);
  const [motivo, setMotivo] = useState("");
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (open && creditId) {
      setDryRunResult(null);
      setMotivo("");
      reverse.mutate(
        { creditId, dryRun: true },
        {
          onSuccess: (data) => setDryRunResult(data),
          onError: (err: any) =>
            toast.error(getApiErrorMessage(err, "Error evaluando la reversa")),
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, creditId]);

  const handleClose = () => {
    setDryRunResult(null);
    setMotivo("");
    onClose();
  };

  const handleExecute = () => {
    if (motivo.trim().length < 5) {
      toast.warning("El motivo es requerido (mínimo 5 caracteres).");
      return;
    }
    setExecuting(true);
    reverse.mutate(
      { creditId, dryRun: false, motivo: motivo.trim() },
      {
        onSuccess: (data) => {
          setExecuting(false);
          if (data.ok) {
            toast.success(data.message);
            handleClose();
            onSuccess?.();
          } else {
            setDryRunResult(data);
            toast.error(data.message);
          }
        },
        onError: (err: any) => {
          setExecuting(false);
          // 409: la ejecución fue bloqueada por gates — mostrar el detalle
          const data = err?.response?.data;
          if (data?.gates) setDryRunResult(data);
          toast.error(getApiErrorMessage(err, "No se pudo reversar la cancelación"));
        },
      }
    );
  };

  const loadingDryRun = reverse.isPending && !executing && !dryRunResult;
  const gatesOk = dryRunResult?.ok === true;
  const plan = dryRunResult?.plan;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-white shadow-xl border border-gray-200 rounded-2xl max-w-lg w-[98vw] mx-auto p-0">
        <div className="max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-gray-200 px-6 py-4 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <RotateCcw className="text-amber-600 w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Reversar cancelación
                </h2>
                <p className="text-xs text-gray-500">
                  {numeroSifco ? `Crédito ${numeroSifco}` : `Crédito #${creditId}`}
                  {" — "}se valida antes de tocar nada
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 space-y-4">
            {loadingDryRun && (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Evaluando si la reversa es posible...
              </div>
            )}

            {/* Checklist de gates */}
            {dryRunResult && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Validaciones
                </h3>
                <div className="space-y-2">
                  {dryRunResult.gates.map((g) => (
                    <div key={g.gate} className="flex items-start gap-2">
                      {g.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <span
                          className={`text-sm font-medium ${g.ok ? "text-gray-700" : "text-red-700"}`}
                        >
                          {GATE_LABELS[g.gate] ?? g.gate}
                        </span>
                        <p className="text-xs text-gray-500 break-words">
                          {g.detalle}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plan (solo si pasa) */}
            {gatesOk && plan && (
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                <h3 className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-2">
                  Qué hará la reversa
                </h3>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>
                    • Restaurar el crédito a{" "}
                    <b>{plan.status_destino.replace("_", " ")}</b>
                  </li>
                  <li>
                    • Restaurar {plan.inversionistas_a_restaurar} inversionista(s)
                    y des-anular {plan.pagos_a_desanular} pago(s)
                  </li>
                  <li>
                    • Borrar el pago de cierre, {plan.cuotas_a_borrar.length}{" "}
                    cuota(s), {plan.abonos_capital_a_borrar} abono(s),{" "}
                    {plan.pci_a_borrar} liquidación(es) y{" "}
                    {plan.boletas_a_borrar} boleta(s)
                  </li>
                  {plan.mora_a_restaurar && <li>• Reactivar la mora</li>}
                  {plan.facturas_a_anular > 0 && (
                    <li className="text-amber-700">
                      • Anular {plan.facturas_a_anular} factura(s) electrónica(s)
                      en COFIDI/SAT
                    </li>
                  )}
                  {plan.facturacion_desglose_borrado_por_cascade > 0 && (
                    <li className="text-amber-700">
                      • Se borrarán{" "}
                      {plan.facturacion_desglose_borrado_por_cascade} fila(s) del
                      desglose de facturación (avisar a conta)
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Motivo + advertencia */}
            {gatesOk && (
              <>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Motivo de la reversa *
                  </h3>
                  <Input
                    placeholder="Ej: pago de cierre registrado por error"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="bg-white border-gray-200 text-sm h-9 text-gray-900"
                  />
                </div>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">
                    El crédito quedará en <b>pendiente de cancelación</b> (usa
                    "Reactivar Crédito" si quieres volverlo a activo). El destino
                    del dinero de la boleta de cierre debe resolverse con
                    finanzas.
                  </p>
                </div>
              </>
            )}

            {dryRunResult && !gatesOk && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <Info className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700">{dryRunResult.message}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-white border-t border-gray-200 px-6 py-4 rounded-b-2xl">
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                className="h-10 px-5 text-sm font-medium border-gray-300 text-gray-600 hover:bg-gray-50"
                onClick={handleClose}
              >
                Cerrar
              </Button>
              {gatesOk && (
                <Button
                  className="h-10 px-5 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                  onClick={handleExecute}
                  disabled={executing || motivo.trim().length < 5}
                  title={
                    motivo.trim().length < 5
                      ? "Escribe el motivo (mínimo 5 caracteres)"
                      : ""
                  }
                >
                  {executing ? "Reversando..." : "Confirmar Reversa"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

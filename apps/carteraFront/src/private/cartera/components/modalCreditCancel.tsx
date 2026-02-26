/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  usePendingCancelCredit,
  useInfoCancelCredit,
} from "../hooks/cancelCredit";
import {
  AlertCircle,
  Banknote,
  PercentCircle,
  BadgeDollarSign,
  ShieldCheck,
  ReceiptText,
  FileText,
  X,
  AlertTriangle,
  Hash,
  Calculator,
  Plus,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";

interface MotivoExtra {
  motivo: string;
  monto: number;
}

const fmt = (n: number) =>
  n.toLocaleString("es-GT", { minimumFractionDigits: 2 });

export function ModalCancelCredit({
  open,
  onClose,
  creditId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  creditId: number;
  onSuccess?: () => void;
}) {
  const cancelCredit = useInfoCancelCredit();
  const creditActionMutation = usePendingCancelCredit();

  const [motivos, setMotivos] = useState<MotivoExtra[]>([]);
  const [motivo, setMotivo] = useState("");
  const [monto, setMonto] = useState("");
  const [motivoCancel, setMotivoCancel] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [traspaso, setTraspaso] = useState("");
  const [garantiaMobiliaria, setGarantiaMobiliaria] = useState("");
  const [otros, setOtros] = useState("");
  const [cuotasRestantes, setCuotasRestantes] = useState("");

  useEffect(() => {
    if (open && creditId) {
      cancelCredit.mutate(creditId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, creditId]);

  const agregarMotivo = () => {
    const montoNum = Number(monto);
    if (!motivo.trim()) return;
    if (Number.isNaN(montoNum)) return;
    setMotivos((prev) => [...prev, { motivo: motivo.trim(), monto: montoNum }]);
    setMotivo("");
    setMonto("");
  };

  const removeMotivo = (idx: number) =>
    setMotivos((prev) => prev.filter((_, i) => i !== idx));

  const credit = cancelCredit.data?.credito;

  // Valores base del crédito
  const capital = Number(credit?.capital ?? 0);
  const interes = Number(credit?.interes ?? 0);
  const membresias = Number(credit?.membresias ?? 0);
  const seguro = Number(credit?.seguro ?? 0);
  const iva = Number(credit?.iva ?? 0);
  const gps = Number(credit?.gps ?? 0);
  const mora = Number(credit?.mora ?? 0);

  // Cuotas restantes - multiplica interes, membresias, seguro, iva
  const numCuotas = Math.max(0, Math.floor(Number(cuotasRestantes || 0)));
  const totalInteres = interes * numCuotas;
  const totalMembresias = membresias * numCuotas;
  const totalSeguro = seguro * numCuotas;
  const totalIva = iva * numCuotas;
  const totalCuotas = totalInteres + totalMembresias + totalSeguro + totalIva;

  const totalMotivos = motivos.reduce((acc, curr) => acc + curr.monto, 0);
  const totalCamposExtra =
    Number(traspaso || 0) +
    Number(garantiaMobiliaria || 0) +
    Number(otros || 0);
  const total = capital + totalCuotas + gps + mora + totalMotivos + totalCamposExtra;

  const handleClose = () => {
    setMotivos([]);
    setMotivo("");
    setMonto("");
    setMotivoCancel("");
    setObservaciones("");
    setTraspaso("");
    setGarantiaMobiliaria("");
    setOtros("");
    setCuotasRestantes("");
    onClose();
  };

  const handleCancelCredit = () => {
    if (!motivoCancel.trim()) {
      toast.warning("Debes escribir el motivo principal de la cancelación.");
      return;
    }
    const payload = {
      creditId,
      accion: "PENDIENTE_CANCELACION" as const,
      motivo: motivoCancel.trim(),
      observaciones: observaciones?.trim() || undefined,
      monto_cancelacion: total,
      traspaso: Number(traspaso || 0),
      garantia_mobiliaria: Number(garantiaMobiliaria || 0),
      otros: Number(otros || 0),
      cuotas_atrasadas: numCuotas > 0 ? numCuotas : undefined,
      montosAdicionales: motivos.map((m) => ({
        concepto: m.motivo,
        monto: m.monto,
      })),
    };

    creditActionMutation.mutate(payload, {
      onSuccess: (data: any) => {
        toast.success(data?.message || "Crédito marcado como pendiente de cancelación");
        handleClose();
        onSuccess?.();
      },
      onError: (err: any) => {
        toast.error(err?.message || "No se pudo procesar la solicitud");
      },
    });
  };

  const InfoRow = ({
    icon: Icon,
    iconColor,
    label,
    value,
    valueColor,
  }: {
    icon: any;
    iconColor: string;
    label: string;
    value: string;
    valueColor: string;
  }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <span className={`text-sm font-semibold ${valueColor}`}>{value}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="
          bg-white
          shadow-xl
          border border-gray-200
          rounded-2xl
          max-w-lg
          w-[98vw]
          mx-auto
          p-0
        "
      >
        <div className="max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-red-50 to-orange-50 border-b border-gray-200 px-6 py-4 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <AlertCircle className="text-red-600 w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Cancelar crédito
                </h2>
                <p className="text-xs text-gray-500">
                  Revisa los montos antes de continuar
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 space-y-4">
            {cancelCredit.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">
                  {cancelCredit.error.message}
                </p>
              </div>
            )}

            {/* Valores por cuota del crédito */}
            {credit && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Valores del crédito
                </h3>
                <InfoRow
                  icon={Banknote}
                  iconColor="text-emerald-600"
                  label="Capital"
                  value={`Q${fmt(capital)}`}
                  valueColor="text-emerald-700"
                />
                <InfoRow
                  icon={PercentCircle}
                  iconColor="text-blue-600"
                  label="Interés"
                  value={`Q${fmt(interes)}`}
                  valueColor="text-blue-700"
                />
                <InfoRow
                  icon={BadgeDollarSign}
                  iconColor="text-amber-600"
                  label="Membresías"
                  value={`Q${fmt(membresias)}`}
                  valueColor="text-amber-700"
                />
                <InfoRow
                  icon={ShieldCheck}
                  iconColor="text-indigo-600"
                  label="Seguro"
                  value={`Q${fmt(seguro)}`}
                  valueColor="text-indigo-700"
                />
                <InfoRow
                  icon={ReceiptText}
                  iconColor="text-pink-600"
                  label="IVA"
                  value={`Q${fmt(iva)}`}
                  valueColor="text-pink-700"
                />
                {gps > 0 && (
                  <InfoRow
                    icon={MapPin}
                    iconColor="text-cyan-600"
                    label="GPS"
                    value={`Q${fmt(gps)}`}
                    valueColor="text-cyan-700"
                  />
                )}
                {mora > 0 && (
                  <InfoRow
                    icon={AlertTriangle}
                    iconColor="text-orange-600"
                    label="Mora"
                    value={`Q${fmt(mora)}`}
                    valueColor="text-orange-700"
                  />
                )}
              </div>
            )}

            {/* Cuotas restantes input */}
            {credit && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Hash className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-blue-800">
                      Cuotas restantes
                    </h3>
                    <p className="text-xs text-blue-500">
                      Multiplica interés, membresía, seguro e IVA
                    </p>
                  </div>
                </div>
                <Input
                  type="number"
                  placeholder="0"
                  value={cuotasRestantes}
                  min={0}
                  step={1}
                  onChange={(e) => setCuotasRestantes(e.target.value)}
                  onKeyDown={(e) => {
                    if (["e", "E", "+", "-", "."].includes(e.key))
                      e.preventDefault();
                  }}
                  className="bg-white border-blue-200 text-center text-lg font-bold text-blue-800 h-12 rounded-lg focus:border-blue-400 focus:ring-blue-400"
                />

                {numCuotas > 0 && (
                  <div className="mt-3 bg-white/70 rounded-lg p-3 border border-blue-100">
                    <div className="flex items-center gap-2 mb-2">
                      <Calculator className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                        Proyección &times; {numCuotas}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Intereses</span>
                        <span className="font-medium text-blue-700">
                          Q{fmt(totalInteres)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Membresías</span>
                        <span className="font-medium text-amber-700">
                          Q{fmt(totalMembresias)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Seguro</span>
                        <span className="font-medium text-indigo-700">
                          Q{fmt(totalSeguro)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">IVA</span>
                        <span className="font-medium text-pink-700">
                          Q{fmt(totalIva)}
                        </span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-blue-100">
                        <span className="font-semibold text-gray-700">
                          Subtotal cuotas
                        </span>
                        <span className="font-bold text-blue-800">
                          Q{fmt(totalCuotas)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Costos adicionales */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Costos adicionales
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Traspaso
                  </Label>
                  <Input
                    placeholder="0.00"
                    type="number"
                    value={traspaso}
                    step="0.01"
                    onChange={(e) => setTraspaso(e.target.value)}
                    onKeyDown={(e) => {
                      if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                    }}
                    className="bg-white border-gray-200 text-sm h-9 text-gray-900"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Garantía mob.
                  </Label>
                  <Input
                    placeholder="0.00"
                    type="number"
                    value={garantiaMobiliaria}
                    step="0.01"
                    onChange={(e) => setGarantiaMobiliaria(e.target.value)}
                    onKeyDown={(e) => {
                      if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                    }}
                    className="bg-white border-gray-200 text-sm h-9 text-gray-900"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Otros
                  </Label>
                  <Input
                    placeholder="0.00"
                    type="number"
                    value={otros}
                    step="0.01"
                    onChange={(e) => setOtros(e.target.value)}
                    onKeyDown={(e) => {
                      if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                    }}
                    className="bg-white border-gray-200 text-sm h-9 text-gray-900"
                  />
                </div>
              </div>
            </div>

            {/* Montos adicionales */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Montos adicionales
              </h3>
              <div className="flex gap-2">
                <Input
                  placeholder="Motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") agregarMotivo();
                  }}
                  className="bg-white border-gray-200 text-sm h-9 flex-1 text-gray-900"
                />
                <Input
                  placeholder="Monto"
                  type="number"
                  value={monto}
                  step="0.01"
                  onChange={(e) => setMonto(e.target.value)}
                  onKeyDown={(e) => {
                    if (["e", "E", "+"].includes(e.key)) e.preventDefault();
                  }}
                  className="bg-white border-gray-200 text-sm h-9 w-28 text-gray-900"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 border-gray-300 hover:bg-gray-100"
                  onClick={agregarMotivo}
                  disabled={
                    !motivo ||
                    monto.trim() === "" ||
                    Number.isNaN(Number(monto))
                  }
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {motivos.length > 0 && (
                <div className="mt-2 max-h-24 overflow-y-auto space-y-1">
                  {motivos.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm bg-white rounded-lg px-3 py-1.5 border border-gray-100"
                    >
                      <FileText className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-gray-600 flex-1 truncate">
                        {m.motivo}
                      </span>
                      <span className="font-semibold text-gray-800">
                        Q{fmt(m.monto)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMotivo(i)}
                        className="text-gray-400 hover:text-red-500 transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Motivo + observaciones */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Motivo de cancelación
              </h3>
              <Input
                placeholder="Motivo de la cancelación *"
                value={motivoCancel}
                onChange={(e) => setMotivoCancel(e.target.value)}
                className="bg-white border-gray-200 text-sm h-9 mb-2 text-gray-900"
                required
              />
              <Input
                placeholder="Observaciones (opcional)"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="bg-white border-gray-200 text-sm h-9 text-gray-900"
              />
            </div>

            {/* Total */}
            <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl p-4 border border-emerald-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-600">
                  Total de cancelación
                </span>
                <span className="text-2xl font-extrabold text-emerald-700">
                  Q{fmt(total)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="bg-white border-t border-gray-200 px-6 py-4 rounded-b-2xl">
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                className="h-10 px-5 text-sm font-medium border-gray-300 text-gray-600 hover:bg-gray-50"
                onClick={handleClose}
              >
                Cerrar
              </Button>
              <Button
                className="h-10 px-5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white shadow-sm"
                onClick={handleCancelCredit}
                disabled={
                  creditActionMutation.status === "pending" ||
                  !motivoCancel.trim()
                }
                title={
                  !motivoCancel.trim()
                    ? "Escribe el motivo de cancelación"
                    : ""
                }
              >
                {creditActionMutation.status === "pending"
                  ? "Cancelando..."
                  : "Cancelar Crédito"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useCreditAction } from "../hooks/cancelCredit";
import {
  AlertCircle,
  FileText,
} from "lucide-react";

export function ModalBadDebtCredit({
  open,
  onClose,
  creditId,
  onSuccess,
  montoBase,
}: {
  open: boolean;
  onClose: () => void;
  creditId: number;
  onSuccess?: () => void;
  montoBase: number; // Monto base de lo incobrable (por si lo quieres mostrar)
}) {
  const [motivo, setMotivo] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [monto, setMonto] = useState(montoBase.toString()); // Puedes inicializar con el monto base
  const creditActionMutation = useCreditAction();
  useEffect(() => {
    if (open) {
      setMonto(montoBase.toString());
      // Esto sincroniza el monto al abrir el modal o si cambia el montoBase
    }
  }, [open, montoBase]);
  const handleBadDebt = () => {
    if (!motivo.trim()) {
      alert("Debes escribir el motivo para marcar como incobrable.");
      return;
    }
    if (!monto || isNaN(Number(monto)) || Number(monto) <= 0) {
      alert("El monto incobrable debe ser mayor a cero.");
      return;
    }
    creditActionMutation.mutate(
      {
        creditId: creditId,
        accion: "INCOBRABLE",
        motivo,
        observaciones,
        monto_cancelacion: Number(monto),
      },
      {
        onSuccess: (data) => {
          alert(data.message || "Crédito marcado como incobrable correctamente");
          handleClose();
          if (onSuccess) onSuccess();
        },
        onError: (error) => {
          alert(error.message || "No se pudo marcar como incobrable");
        },
      }
    );
  };

  const handleClose = () => {
    setMotivo("");
    setObservaciones("");
    setMonto(montoBase.toString());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="backdrop-blur bg-white/80 shadow-2xl border-blue-200 rounded-2xl max-w-md mx-auto"
        style={{ border: "2px solid #facc15" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="text-yellow-600 w-7 h-7" />
          <span className="text-xl font-bold text-yellow-700">
            Marcar crédito como incobrable
          </span>
        </div>
        <div className="grid gap-2 mb-2 bg-yellow-50 border border-yellow-200 rounded-xl p-3 shadow">
          <Label className="font-bold text-yellow-700 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            Motivo
          </Label>
          <Input
            placeholder="Motivo de incobrabilidad"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="bg-white/90 border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500 text-slate-800"
            required
          />
          <Label className="font-bold text-yellow-700 flex items-center gap-1 mt-1">
            <FileText className="w-4 h-4" />
            Observaciones (opcional)
          </Label>
          <Input
            placeholder="Observaciones"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className="bg-white/90 border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500 text-slate-800"
          />
          <Label className="font-bold text-yellow-700 flex items-center gap-1 mt-1">
            <FileText className="w-4 h-4" />
            Monto incobrable
          </Label>
          <Input
            type="number"
            min={0}
            placeholder="Monto incobrable"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="bg-white/90 border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500 text-slate-800"
            required
          />
        </div>
        {/* Total */}
        <div className="font-extrabold text-xl text-right mt-3 mb-3 text-yellow-700 drop-shadow">
          TOTAL INCOBRABLE:{" "}
          <span className="text-yellow-700">
            Q{Number(monto).toLocaleString("es-GT", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex gap-2 mt-2 justify-end">
          <Button
            variant="outline"
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold border-gray-300 shadow"
            onClick={handleClose}
          >
            Cerrar
          </Button>
          <Button
            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold shadow-lg"
            onClick={handleBadDebt}
            disabled={creditActionMutation.status === "pending"}
          >
            {creditActionMutation.status === "pending"
              ? "Guardando..."
              : "Marcar como Incobrable"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

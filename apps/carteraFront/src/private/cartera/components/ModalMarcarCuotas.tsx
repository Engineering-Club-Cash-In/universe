import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { marcarCuotasService } from "../services/services";
import { toast } from "sonner";
import { CheckCircle2, Hash } from "lucide-react";

export function ModalMarcarCuotas({
  open,
  onClose,
  numeroCreditoSifco,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  numeroCreditoSifco: string;
  onSuccess?: () => void;
}) {
  const [hastaCuota, setHastaCuota] = useState("");

  const mutation = useMutation({
    mutationFn: marcarCuotasService,
  });

  const handleSubmit = () => {
    const cuotaNum = Number(hastaCuota);
    if (!hastaCuota || isNaN(cuotaNum) || cuotaNum < 1) {
      toast.error("Ingresa un numero de cuota valido (mayor a 0)");
      return;
    }

    mutation.mutate(
      {
        numero_credito_sifco: numeroCreditoSifco,
        hasta_cuota: cuotaNum,
      },
      {
        onSuccess: (data) => {
          toast.success(data.message || "Cuotas marcadas correctamente");
          handleClose();
          onSuccess?.();
        },
        onError: (error: any) => {
          toast.error(
            error?.response?.data?.message || "Error al marcar cuotas"
          );
        },
      }
    );
  };

  const handleClose = () => {
    setHastaCuota("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="backdrop-blur bg-white/90 shadow-2xl border-emerald-200 rounded-2xl max-w-md mx-auto"
        style={{ border: "2px solid #10b981" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 className="text-emerald-600 w-7 h-7" />
          <span className="text-xl font-bold text-emerald-700">
            Marcar Cuotas Pagadas
          </span>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3">
          <p className="text-sm text-emerald-700 font-medium">
            Credito SIFCO:{" "}
            <span className="font-bold">{numeroCreditoSifco}</span>
          </p>
        </div>

        <div className="grid gap-4">
          <div>
            <Label className="font-bold text-emerald-700 flex items-center gap-1 mb-1">
              <Hash className="w-4 h-4" />
              Hasta cuota #
            </Label>
            <Input
              type="number"
              min={1}
              placeholder="Ej: 30"
              value={hastaCuota}
              onChange={(e) => setHastaCuota(e.target.value)}
              className="bg-white/90 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500 text-slate-800"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4 justify-end">
          <Button
            variant="outline"
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold border-gray-300 shadow"
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-lg"
            onClick={handleSubmit}
            disabled={mutation.status === "pending"}
          >
            {mutation.status === "pending"
              ? "Procesando..."
              : "Marcar Cuotas"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

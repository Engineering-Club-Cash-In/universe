import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { marcarCreditoCaido } from "../services/services";
import { AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";

export function ModalCaidoCredit({
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
  const [motivo, setMotivo] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: marcarCreditoCaido,
    onSuccess: (data) => {
      toast.success(data.message || "Crédito marcado como CAIDO exitosamente.");
      queryClient.invalidateQueries({ queryKey: ["creditos-paginados"] });
      handleClose();
      onSuccess?.();
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "No se pudo marcar como caído"
      );
    },
  });

  const handleSubmit = () => {
    if (!motivo.trim()) {
      toast.error("Debes escribir el motivo para marcar como caído.");
      return;
    }
    mutation.mutate({
      credito_id: creditId,
      motivo,
      observaciones: observaciones.trim() || undefined,
    });
  };

  const handleClose = () => {
    setMotivo("");
    setObservaciones("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="backdrop-blur bg-white/80 shadow-2xl border-gray-300 rounded-2xl max-w-md mx-auto"
        style={{ border: "2px solid #6b7280" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="text-gray-600 w-7 h-7" />
          <span className="text-xl font-bold text-gray-700">
            Marcar crédito como Caído
          </span>
        </div>
        <div className="grid gap-2 mb-2 bg-gray-50 border border-gray-200 rounded-xl p-3 shadow">
          <Label className="font-bold text-gray-700 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            Motivo
          </Label>
          <Input
            placeholder="Razón por la que se cayó el crédito"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="bg-white/90 border-gray-300 focus:border-gray-500 focus:ring-gray-500 text-slate-800"
            required
          />
          <Label className="font-bold text-gray-700 flex items-center gap-1 mt-1">
            <FileText className="w-4 h-4" />
            Observaciones (opcional)
          </Label>
          <Input
            placeholder="Observaciones adicionales"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className="bg-white/90 border-gray-300 focus:border-gray-500 focus:ring-gray-500 text-slate-800"
          />
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
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold shadow-lg"
            onClick={handleSubmit}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Guardando..." : "Marcar como Caído"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

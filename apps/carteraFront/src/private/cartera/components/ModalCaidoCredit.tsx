import { useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { marcarCreditoCaido } from "../services/services";
import { AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { useConsultarPagosNexa } from "../hooks/useNexaDashboard";
import { resolverPreflightCaido } from "../lib/guardaCaidoNexa";
import type { PagosNexaCredito } from "../services/nexaDashboard.services";
import { AdvertenciaPagosNexaDialog } from "./AdvertenciaPagosNexaDialog";

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
  const consultarPagosNexa = useConsultarPagosNexa();
  const [verificando, setVerificando] = useState(false);
  // Cuenta los intentos de marcar; cerrar el modal lo invalida y el resultado tardío se descarta.
  const intentoRef = useRef(0);
  // undefined = sin advertencia abierta; null = la consulta falló (advertencia genérica).
  const [advertencia, setAdvertencia] = useState<PagosNexaCredito | null | undefined>(undefined);

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

  const marcar = () =>
    mutation.mutate({
      credito_id: creditId,
      motivo,
      observaciones: observaciones.trim() || undefined,
    });

  const handleSubmit = async () => {
    if (!motivo.trim()) {
      toast.error("Debes escribir el motivo para marcar como caído.");
      return;
    }
    if (verificando) return;
    // Marcar caído borra todos los pagos del crédito, también los que entraron por Nexa.
    const intento = ++intentoRef.current;
    setVerificando(true);
    const pagosNexa = await consultarPagosNexa(creditId);
    // Si el operador cerró mientras la consulta corría, no se marca ni se advierte.
    const resultado = resolverPreflightCaido(pagosNexa, () => intento === intentoRef.current);
    if (resultado === "cancelado") return;
    setVerificando(false);
    if (resultado === "advertir") {
      setAdvertencia(pagosNexa);
      return;
    }
    marcar();
  };

  const handleClose = () => {
    intentoRef.current++;
    setVerificando(false);
    setAdvertencia(undefined);
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
            disabled={mutation.isPending || verificando}
          >
            {mutation.isPending || verificando ? "Guardando..." : "Marcar como Caído"}
          </Button>
        </div>
      </DialogContent>
      <AdvertenciaPagosNexaDialog
        open={advertencia !== undefined}
        pagos={advertencia ?? null}
        accion="borrar"
        onCancel={() => setAdvertencia(undefined)}
        onConfirm={() => {
          setAdvertencia(undefined);
          marcar();
        }}
      />
    </Dialog>
  );
}

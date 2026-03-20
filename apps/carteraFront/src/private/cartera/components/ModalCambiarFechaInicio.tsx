import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMutation } from "@tanstack/react-query";
import { cambiarFechaInicioService } from "../services/services";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { DatePickerMUI } from "./calendar";

export function ModalCambiarFechaInicio({
  open,
  onClose,
  numeroCreditoSifco,
  fechaActual,
  changedBy,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  numeroCreditoSifco: string;
  fechaActual: string | null;
  changedBy: string;
  onSuccess?: () => void;
}) {
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [razon, setRazon] = useState("");

  const mutation = useMutation({
    mutationFn: cambiarFechaInicioService,
  });

  const handleSubmit = () => {
    if (!nuevaFecha) {
      toast.error("Selecciona una nueva fecha");
      return;
    }
    if (!razon.trim()) {
      toast.error("Ingresa una razón para el cambio");
      return;
    }

    mutation.mutate(
      {
        numero_credito_sifco: numeroCreditoSifco,
        nueva_fecha_inicio: nuevaFecha,
        changed_by: changedBy,
        razon: razon.trim(),
      },
      {
        onSuccess: (data) => {
          toast.success(data.message || "Fecha actualizada correctamente");
          handleClose();
          onSuccess?.();
        },
        onError: (error: any) => {
          toast.error(
            error?.response?.data?.message || "Error al cambiar la fecha"
          );
        },
      }
    );
  };

  const handleClose = () => {
    setNuevaFecha("");
    setRazon("");
    onClose();
  };

  const fechaFormateada = fechaActual
    ? new Date(fechaActual + "T12:00:00").toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "No definida";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="backdrop-blur bg-white/90 shadow-2xl border-blue-200 rounded-2xl max-w-md mx-auto"
        style={{ border: "2px solid #3b82f6" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <CalendarClock className="w-7 h-7" style={{ color: '#2563eb' }} />
          <span className="text-xl font-bold text-blue-700">
            Cambiar Fecha de Inicio
          </span>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
          <p className="text-sm text-blue-700 font-medium">
            Crédito SIFCO:{" "}
            <span className="font-bold">{numeroCreditoSifco}</span>
          </p>
          <p className="text-sm text-blue-700 mt-1">
            Fecha actual de cuota 1:{" "}
            <span className="font-bold">{fechaFormateada}</span>
          </p>
        </div>

        <div className="grid gap-4">
          <div>
            <Label className="text-gray-800 font-semibold mb-1">
              Nueva fecha de inicio
            </Label>
            <div className="[&_.MuiInputBase-root]:h-10 [&_.MuiInputBase-root]:text-sm [&_.MuiInputBase-root]:bg-white [&_.MuiOutlinedInput-notchedOutline]:border-gray-200 [&_.MuiOutlinedInput-notchedOutline]:rounded-md">
              <DatePickerMUI
                disableFuture={false}
                value={nuevaFecha}
                onChange={(val) => setNuevaFecha(val)}
              />
            </div>
          </div>

          <div>
            <Label className="text-gray-800 font-semibold mb-1">
              Razón del cambio
            </Label>
            <textarea
              value={razon}
              onChange={(e) => setRazon(e.target.value)}
              placeholder="Describe por qué se necesita cambiar la fecha..."
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none resize-none"
              style={{ color: '#111827', backgroundColor: '#ffffff', border: '1px solid #d1d5db' }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-4">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={mutation.isPending}
            className="text-gray-700"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
          >
            {mutation.isPending ? "Guardando..." : "Guardar cambio"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

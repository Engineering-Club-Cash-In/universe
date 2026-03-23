import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMutation } from "@tanstack/react-query";
import { cambiarFechaInicioService } from "../services/services";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";

const MESES = [
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

function getDiasPermitidos(mes: number, anio: number): number[] {
  if (mes === 2) {
    // Febrero: 15 y último día (28 o 29)
    const ultimoDia = new Date(anio, 2, 0).getDate();
    return [15, ultimoDia];
  }
  return [15, 30];
}

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
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [anio, setAnio] = useState(now.getFullYear());
  const [dia, setDia] = useState<number | "">(15);
  const [razon, setRazon] = useState("");

  const diasPermitidos = getDiasPermitidos(mes, anio);

  const mutation = useMutation({
    mutationFn: cambiarFechaInicioService,
  });

  const handleSubmit = () => {
    if (!dia) {
      toast.error("Selecciona un día");
      return;
    }
    if (!razon.trim()) {
      toast.error("Ingresa una razón para el cambio");
      return;
    }

    const nuevaFecha = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

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
    setMes(now.getMonth() + 1);
    setAnio(now.getFullYear());
    setDia(15);
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

  // Años disponibles: actual -1 hasta actual +2
  const aniosDisponibles = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 1 + i);

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
            <Label className="text-gray-800 font-semibold mb-2 block">
              Nueva fecha de inicio
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Día</label>
                <select
                  value={dia}
                  onChange={(e) => setDia(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:ring-2 focus:ring-blue-400"
                >
                  {diasPermitidos.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Mes</label>
                <select
                  value={mes}
                  onChange={(e) => {
                    const nuevoMes = Number(e.target.value);
                    setMes(nuevoMes);
                    // Si el día actual no es válido para el nuevo mes, resetear a 15
                    const nuevosDias = getDiasPermitidos(nuevoMes, anio);
                    if (!nuevosDias.includes(dia as number)) {
                      setDia(15);
                    }
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:ring-2 focus:ring-blue-400"
                >
                  {MESES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Año</label>
                <select
                  value={anio}
                  onChange={(e) => {
                    const nuevoAnio = Number(e.target.value);
                    setAnio(nuevoAnio);
                    const nuevosDias = getDiasPermitidos(mes, nuevoAnio);
                    if (!nuevosDias.includes(dia as number)) {
                      setDia(15);
                    }
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:ring-2 focus:ring-blue-400"
                >
                  {aniosDisponibles.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Solo días 15 o 30 (28/29 en febrero)</p>
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

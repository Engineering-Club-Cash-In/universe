/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"; 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/apiError";
import { useMoras } from "../hooks/useLateFee";

interface ModalCreateMoraProps {
  open: boolean;
  onClose: () => void;
  creditoId: number;
  numeroCreditoSifco?: string;
  onSuccess?: () => void; // 👈 para recargar la tabla al terminar
}
// eslint-disable-next-line react-hooks/rules-of-hooks
import { useState, useRef, useEffect } from "react";

export function ModalCreateMora({
  open,
  onClose,
  creditoId,
  numeroCreditoSifco,
  onSuccess,
}: ModalCreateMoraProps) {
  const [montoMora, setMontoMora] = useState<number | undefined>();
  const [cuotas, setCuotas] = useState<number | undefined>();
  const [override, setOverride] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { createMora } = useMoras({});
  
  // 🔥 Ref para prevenir ejecución doble       
  const mutationIdRef = useRef<string | null>(null);

  // Reset del ref cuando el modal se cierra
  useEffect(() => {
    if (!open) {
      mutationIdRef.current = null;
      setOverride(false);
      setMotivo("");
    }
  }, [open]);

  if (!open) return null;

// En createMoraModal.tsx
const handleGuardar = () => {
  if (createMora.isPending || mutationIdRef.current) return;
  
  if (!montoMora || !cuotas) {
    alert("[ERROR] Debes ingresar monto y cuotas.");
    return;
  }
  if (override && !motivo.trim()) {
    alert("[ERROR] El override requiere un motivo (justificación).");
    return;
  }

  mutationIdRef.current = "processing";

  createMora.mutate(
    {
      credito_id: creditoId,
      monto_mora: montoMora,
      cuotas_atrasadas: cuotas,
      ...(override ? { override: true, motivo: motivo.trim() } : {}),
    },
    {
      onSuccess: (res: any) => {
        alert(`[SUCCESS] Mora creada\n\n${JSON.stringify(res, null, 2)}`);

        // 🔥 Primero limpiar estados y cerrar
        setMontoMora(undefined);
        setCuotas(undefined);
        setOverride(false);
        setMotivo("");
        mutationIdRef.current = null;
        onClose(); // 👈 cerrar ANTES de invalidar

        // 🔥 Luego ejecutar callback
        setTimeout(() => {
          onSuccess?.();
        }, 50);
      },
      onError: (err: any) => {
        // El back devuelve { success:false, message } con el motivo claro del rechazo
        // (monto fuera de rango, status excluido, etc.). getApiErrorMessage centraliza la extracción.
        const msg = getApiErrorMessage(err, "No se pudo crear mora");
        alert(`[ERROR] No se pudo crear mora\n\n${msg}`);
        mutationIdRef.current = null;
      }
    }
  );
};
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white rounded-lg p-6 w-96 shadow-lg">
        <h3 className="text-lg font-bold text-blue-600 mb-4">
          Crear Mora {numeroCreditoSifco && `(Crédito ${numeroCreditoSifco})`}
        </h3>
        <div className="flex flex-col gap-3 text-black">
          <div>
            <Label htmlFor="monto">Monto Mora</Label>
            <Input
              id="monto"
              type="number"
              value={montoMora ?? ""}
              onChange={(e) => setMontoMora(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="cuotas">Cuotas Atrasadas</Label>
            <Input
              id="cuotas"
              type="number"
              value={cuotas ?? ""}
              onChange={(e) => setCuotas(Number(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <input
              id="override"
              type="checkbox"
              className="h-4 w-4"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            <Label htmlFor="override" className="cursor-pointer text-sm">
              Forzar (monto fuera de fórmula o crédito en estado excluido)
            </Label>
          </div>
          {override && (
            <div>
              <Label htmlFor="motivo">Motivo (requerido)</Label>
              <Input
                id="motivo"
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Justificación del override"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button 
              onClick={handleGuardar} 
              disabled={createMora.isPending}
            >
              {createMora.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

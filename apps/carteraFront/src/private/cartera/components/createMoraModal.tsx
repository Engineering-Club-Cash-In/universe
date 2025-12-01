/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"; 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const { createMora } = useMoras({});
  
  // 🔥 Ref para prevenir ejecución doble       
  const mutationIdRef = useRef<string | null>(null);

  // Reset del ref cuando el modal se cierra
  useEffect(() => {
    if (!open) {
      mutationIdRef.current = null;
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

  mutationIdRef.current = "processing";
  
  createMora.mutate(
    {
      credito_id: creditoId,
      monto_mora: montoMora,
      cuotas_atrasadas: cuotas,
    },
    {
      onSuccess: (res: any) => {
        alert(`[SUCCESS] Mora creada\n\n${JSON.stringify(res, null, 2)}`);
        
        // 🔥 Primero limpiar estados y cerrar
        setMontoMora(undefined);
        setCuotas(undefined);
        mutationIdRef.current = null;
        onClose(); // 👈 cerrar ANTES de invalidar
        
        // 🔥 Luego ejecutar callback
        setTimeout(() => {
          onSuccess?.();
        }, 50);
      },
      onError: (err: any) => {
        alert(`[ERROR] No se pudo crear mora\n\n${JSON.stringify(err, null, 2)}`);
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

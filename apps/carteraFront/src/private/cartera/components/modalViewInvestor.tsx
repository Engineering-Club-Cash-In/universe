import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
 
import { BadgeDollarSign, Info, Percent } from "lucide-react";
import type { InversionistaPago } from "../services/services";

interface ModalInversionistasProps {
  open: boolean;
  onClose: () => void;
  inversionistas: InversionistaPago[];
}

export function ModalInversionistas({ open, onClose, inversionistas }: ModalInversionistasProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl bg-white rounded-xl shadow-lg">
        <DialogHeader>
          <DialogTitle className="text-blue-900 font-bold text-xl">Inversionistas del pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {inversionistas.map((inv) => (
            <div key={inv.inversionistaId} className="border border-blue-200 rounded-lg p-4 shadow-sm bg-blue-50">
              <div className="font-bold text-blue-800 text-lg">{inv.nombreInversionista}</div>
              <div className="grid grid-cols-2 gap-3 mt-2 text-sm text-blue-900">
                <div className="flex items-center gap-2">
                  <BadgeDollarSign className="w-4 h-4 text-green-700" /> Abono Capital:{" "}
                  <span className="font-semibold">{inv.abonoCapital.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BadgeDollarSign className="w-4 h-4 text-indigo-700" /> Abono Interés:{" "}
                  <span className="font-semibold">{inv.abonoInteres.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BadgeDollarSign className="w-4 h-4 text-yellow-700" /> Abono IVA:{" "}
                  <span className="font-semibold">{inv.abonoIva.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-700" /> ISR (5%):{" "}
                  <span className="font-semibold">{inv.isr.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BadgeDollarSign className="w-4 h-4 text-blue-800" /> Monto Aportado:{" "}
                  <span className="font-semibold">{inv.montoAportado.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Percent className="w-4 h-4 text-blue-600" /> % Participación:{" "}
                  <span className="font-semibold">{inv.porcentajeParticipacion}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-gray-600" /> Cuota Pago:{" "}
                  <span className="font-semibold">{inv.cuotaPago ?? "--"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

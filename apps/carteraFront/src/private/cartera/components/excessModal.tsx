import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BadgeCheck, AlertTriangle } from "lucide-react";

type OpcionesExcesoModalProps = {
  open: boolean;
  mode: "excedente" | "pagada";
  onClose: () => void;
  onAbonoCapital?: () => void;
  onAbonoSiguienteCuota?: () => void; 
  onAbonoOtros?: () => void;
  excedente?: number;
  cuotaNumero?: number;
};

export function OpcionesExcesoModal({
  open,
  mode,
  onClose,
  onAbonoCapital,
  onAbonoSiguienteCuota, 
  onAbonoOtros,
  excedente,
  cuotaNumero,
}: OpcionesExcesoModalProps) {
  // Modal para "La cuota ya fue cancelada"
  if (mode === "pagada") {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="bg-white rounded-2xl shadow-2xl p-8 border-blue-200">
          <div className="flex flex-col items-center gap-3">
            <BadgeCheck className="w-14 h-14 text-green-500 mb-2 drop-shadow" />
            <DialogTitle className="text-2xl font-bold text-green-700">
              ¡Cuota Cancelada!
            </DialogTitle>
            <p className="text-lg text-gray-800 mb-4">
              La cuota #{cuotaNumero} ya fue pagada.<br />
              Si deseas, puedes abonar a capital o adelantar a la siguiente cuota.
            </p>
            <div className="flex flex-col w-full gap-2">
              {onAbonoCapital && (
                <Button onClick={onAbonoCapital} className="w-full bg-green-600 hover:bg-green-700 text-lg font-bold shadow">
                  Abonar a capital
                </Button>
              )}
              {onAbonoSiguienteCuota && (
                <Button onClick={onAbonoSiguienteCuota} className="w-full bg-indigo-600 hover:bg-indigo-700 text-lg font-bold shadow">
                  Abonar a siguiente cuota
                </Button>
              )}
              <Button onClick={onClose} className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold shadow">
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Modal para monto excedente
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-white rounded-2xl shadow-2xl p-8 border-blue-200">
        <div className="flex flex-col items-center gap-3">
          <AlertTriangle className="w-14 h-14 text-orange-500 mb-2 drop-shadow" />
          <DialogTitle className="text-2xl font-bold text-orange-700">
            El monto de la boleta es mayor a la cuota
          </DialogTitle>
          <div className="text-lg my-2 text-gray-800">
            Excedente:{" "}
            <span className="font-bold text-blue-700">
              Q{Number(excedente ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col w-full gap-2 mt-2">
            {onAbonoCapital && (
              <Button onClick={onAbonoCapital} className="w-full bg-green-600 hover:bg-green-700 text-lg font-bold shadow">
                Abonar a capital
              </Button>
            )}
            {onAbonoSiguienteCuota && (
              <Button onClick={onAbonoSiguienteCuota} className="w-full bg-indigo-600 hover:bg-indigo-700 text-lg font-bold shadow">
                Abonar a siguiente cuota
              </Button>
            )}
         
            {onAbonoOtros && (
              <Button onClick={onAbonoOtros} className="w-full bg-orange-600 hover:bg-orange-700 text-lg font-bold shadow">
            Mandar a otros
              </Button>
            )}
            <Button onClick={onClose} className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold shadow">
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

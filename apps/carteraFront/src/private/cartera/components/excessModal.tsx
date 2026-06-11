import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BadgeCheck, AlertTriangle } from "lucide-react";

type OpcionesExcesoModalProps = {
  open: boolean;
  mode: "excedente" | "pagada";
  onClose: () => void;
  onAbonoCapital?: () => void;
  abonoCapitalLabel?: string;
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
  abonoCapitalLabel = "Abonar a capital",
  onAbonoSiguienteCuota,
  onAbonoOtros,
  excedente = 0,
  cuotaNumero,
}: OpcionesExcesoModalProps) {
  // 💡 Rango lógico
  const soloOtros = excedente < 25;
  const rangoMedio = excedente >= 25 && excedente <= 100;
  const rangoAlto = excedente > 100;

  // 🧠 Mensaje dinámico
  const getMensaje = () => {
    if (soloOtros)
      return {
        texto: "El excedente es muy bajo. Se recomienda enviarlo a 'Otros' para mantener los registros claros.",
        color: "text-orange-600",
        icon: "⚠️",
      };
    if (rangoMedio)
      return {
        texto:
          "El excedente es moderado. Podrías adelantar la siguiente cuota o enviarlo a 'Otros' según la situación.",
        color: "text-blue-600",
        icon: "ℹ️",
      };
    return {
      texto:
        "El excedente es alto. Se recomienda abonar a capital para reducir el saldo pendiente más rápido.",
      color: "text-green-600",
      icon: "💰",
    };
  };

  const mensaje = getMensaje();

  // 🔹 Modal de "cuota pagada"
  if (mode === "pagada") {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="bg-white rounded-2xl shadow-2xl p-8 border-blue-200">
          <div className="flex flex-col items-center gap-3">
            <BadgeCheck className="w-14 h-14 text-green-500 mb-2 drop-shadow" />
            <DialogTitle className="text-2xl font-bold text-green-700 text-center">
              ¡Cuota Cancelada!
            </DialogTitle>
            <p className="text-lg text-gray-800 mb-4 text-center">
              La cuota #{cuotaNumero} ya fue pagada.
              <br />
              Puedes usar el excedente como mejor te convenga:
            </p>

            <p className={`text-sm font-medium text-center ${mensaje.color}`}>
              {mensaje.icon} {mensaje.texto}
            </p>

            <div className="flex flex-col w-full gap-2 mt-3">
              {rangoAlto && onAbonoCapital && (
                <Button
                  onClick={onAbonoCapital}
                  className="w-full bg-green-600 hover:bg-green-700 text-lg font-bold shadow"
                >
                  {abonoCapitalLabel}
                </Button>
              )}
              {(rangoMedio || rangoAlto) && onAbonoSiguienteCuota && (
                <Button
                  onClick={onAbonoSiguienteCuota}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-lg font-bold shadow"
                >
                  Abonar a siguiente cuota
                </Button>
              )}
              {(soloOtros || rangoMedio || rangoAlto) && onAbonoOtros && (
                <Button
                  onClick={onAbonoOtros}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-lg font-bold shadow"
                >
                  Mandar a otros
                </Button>
              )}
              <Button
                onClick={onClose}
                className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold shadow"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // 🔹 Modal de "excedente"
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-white rounded-2xl shadow-2xl p-8 border-blue-200">
        <div className="flex flex-col items-center gap-3">
          <AlertTriangle className="w-14 h-14 text-orange-500 mb-2 drop-shadow" />
          <DialogTitle className="text-2xl font-bold text-orange-700 text-center">
            El monto de la boleta es mayor a la cuota
          </DialogTitle>

          <div className="text-lg my-2 text-gray-800">
            Excedente:{" "}
            <span className="font-bold text-blue-700">
              Q{Number(excedente).toLocaleString()}
            </span>
          </div>

          {/* 🧠 Mensaje contextual */}
          <div
            className={`text-sm text-center font-medium px-4 py-2 rounded-lg bg-gray-50 ${mensaje.color}`}
          >
            {mensaje.icon} {mensaje.texto}
          </div>

          <div className="flex flex-col w-full gap-2 mt-4">
            {/* 🟢 Mayor a 100 → las tres opciones */}
            {rangoAlto && (
              <>
                {onAbonoCapital && (
                  <Button
                    onClick={onAbonoCapital}
                    className="w-full bg-green-600 hover:bg-green-700 text-lg font-bold shadow"
                  >
                    {abonoCapitalLabel}
                  </Button>
                )}
                {onAbonoSiguienteCuota && (
                  <Button
                    onClick={onAbonoSiguienteCuota}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-lg font-bold shadow"
                  >
                    Abonar a siguiente cuota
                  </Button>
                )}
                {onAbonoOtros && (
                  <Button
                    onClick={onAbonoOtros}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-lg font-bold shadow"
                  >
                    Mandar a otros
                  </Button>
                )}
              </>
            )}

            {/* 🔵 25 - 100 → siguiente cuota + otros */}
            {rangoMedio && (
              <>
                {onAbonoSiguienteCuota && (
                  <Button
                    onClick={onAbonoSiguienteCuota}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-lg font-bold shadow"
                  >
                    Abonar a siguiente cuota
                  </Button>
                )}
                {onAbonoOtros && (
                  <Button
                    onClick={onAbonoOtros}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-lg font-bold shadow"
                  >
                    Mandar a otros
                  </Button>
                )}
              </>
            )}

            {/* 🟠 Menor a 25 → solo otros */}
            {soloOtros && onAbonoOtros && (
              <Button
                onClick={onAbonoOtros}
                className="w-full bg-orange-600 hover:bg-orange-700 text-lg font-bold shadow"
              >
                Mandar a otros
              </Button>
            )}

            <Button
              onClick={onClose}
              className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold shadow"
            >
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

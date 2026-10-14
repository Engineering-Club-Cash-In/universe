import { Clock } from "lucide-react";
import {
  textoCasillaBoletaTardia,
  textoFechasBoletaTardia,
  textoMoraDelRetraso,
  type EstadoRecuadro,
} from "./boletaTardia";

type Props = {
  estado: EstadoRecuadro;
  aceptada: boolean;
  onCambiarAceptada: (aceptada: boolean) => void;
};

/** Recuadro del modal de pago: boleta pagada a tiempo pero registrada tarde. Solo pinta; la lógica vive en boletaTardia.ts. */
export function BoletaTardiaRecuadro({ estado, aceptada, onCambiarAceptada }: Props) {
  if (estado.tipo === "oculto") return null;
  const fechas = textoFechasBoletaTardia(estado.vista);
  const conCasilla = estado.tipo === "casilla";
  return (
    <div
      className={`rounded-xl p-4 border-2 ${conCasilla ? "bg-purple-50 border-purple-300" : "bg-gray-50 border-gray-300"}`}
    >
      <h3 className={`font-bold flex items-center gap-2 ${conCasilla ? "text-purple-900" : "text-gray-700"}`}>
        <Clock className="w-5 h-5" />
        Boleta pagada a tiempo, registrada tarde
      </h3>
      {fechas && <p className="text-sm text-gray-700 mt-2">{fechas}</p>}
      {estado.tipo === "gris" && <p className="text-sm text-gray-600 mt-2">{estado.motivo}</p>}
      {estado.tipo === "casilla" && (
        <>
          <p className="text-sm font-semibold text-purple-800 mt-1">{textoMoraDelRetraso(estado.vista)}</p>
          <label className="flex items-start gap-2 mt-3 text-sm text-gray-800 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={aceptada}
              onChange={(e) => onCambiarAceptada(e.target.checked)}
            />
            <span>{textoCasillaBoletaTardia(estado.vista)}</span>
          </label>
        </>
      )}
    </div>
  );
}

import { XCircle, AlertCircle } from "lucide-react";
import type { BadDebt, CreditCancelation } from "../services/services";
 ; // Ajusta el import según tus tipos

interface InfoCreditoEstadoProps {
  cancelacion?: CreditCancelation | null;
  incobrable?: BadDebt | null;
}

export function InfoCreditoEstado({ cancelacion, incobrable }: InfoCreditoEstadoProps) {
    console.log("InfoCreditoEstado props:", { cancelacion, incobrable });

  if (cancelacion) {
        console.log("Renderizando CANCELACION", cancelacion);
    return (
      <div className="mt-2 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-800 shadow">
        <XCircle className="w-8 h-8 text-red-400" />
        <div>
          <div className="font-bold text-red-700 mb-1">Crédito Cancelado</div>
          <div className="font-medium">Motivo: <span className="font-normal">{cancelacion.motivo}</span></div>
          <div className="font-medium">Monto cancelación: <span className="font-normal">Q{Number(cancelacion.monto_cancelacion).toLocaleString("es-GT", { minimumFractionDigits: 2 })}</span></div>
          <div className="text-xs text-red-500">Fecha: {cancelacion.fecha_cancelacion && new Date(cancelacion.fecha_cancelacion).toLocaleDateString("es-GT")}</div>
          {cancelacion.observaciones && (
            <div className="text-xs text-gray-500">Obs: {cancelacion.observaciones}</div>
          )}
        </div>
      </div>
    );
  }

  if (incobrable) {
        console.log("Renderizando INCOBRABLE", incobrable);
    return (
      <div className="mt-2 p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-center gap-3 text-yellow-800 shadow">
        <AlertCircle className="w-8 h-8 text-yellow-500" />
        <div>
          <div className="font-bold text-yellow-800 mb-1">Crédito Incobrable</div>
          <div className="font-medium">Motivo: <span className="font-normal">{incobrable.motivo}</span></div>
          <div className="font-medium">Monto incobrable: <span className="font-normal">Q{Number(incobrable.monto_incobrable).toLocaleString("es-GT", { minimumFractionDigits: 2 })}</span></div>
          <div className="text-xs text-yellow-600">Fecha: {incobrable.fecha_registro && new Date(incobrable.fecha_registro).toLocaleDateString("es-GT")}</div>
          {incobrable.observaciones && (
            <div className="text-xs text-gray-500">Obs: {incobrable.observaciones}</div>
          )}
        </div>
      </div>
    );
  } else{
     return (
    <div className="p-2 text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl mt-2">
      Sin info de cancelación/incobrable<br />
      <pre>{JSON.stringify({ cancelacion, incobrable }, null, 2)}</pre>
    </div>)
  }

  // Si no hay ni cancelacion ni incobrable, no muestra nada
  return null;
}

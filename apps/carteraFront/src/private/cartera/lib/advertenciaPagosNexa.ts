import type { PagosNexaCredito } from "../services/nexaDashboard.services";

const fmtQuetzales = (monto: string) => {
  const n = Number(monto);
  return `Q${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// null = la consulta falló: se avisa de más, con el texto genérico.
export const debeAdvertirPagosNexa = (pagos: PagosNexaCredito | null) => pagos === null || pagos.cantidad > 0;

// accion: lo que la operación hace con los pagos, en infinitivo ("borrar", "rehacer").
export const textoAdvertenciaPagosNexa = (pagos: PagosNexaCredito | null, accion: string) => {
  const cierre = `Nexa ya aprobó esas transferencias y no se pueden deshacer allá. ¿Continuar?`;
  if (pagos === null) {
    return `No se pudo verificar si este crédito tiene pagos que entraron por Nexa. Esta operación va a ${accion} los pagos del crédito, y si hay pagos de Nexa también se van. ${cierre}`;
  }
  const plural = pagos.cantidad === 1 ? "" : "s";
  const entraron = pagos.cantidad === 1 ? "entró" : "entraron";
  return `Este crédito tiene ${pagos.cantidad} pago${plural} que ${entraron} por Nexa (${fmtQuetzales(pagos.montoTotal)}). Esta operación los va a ${accion}. ${cierre}`;
};

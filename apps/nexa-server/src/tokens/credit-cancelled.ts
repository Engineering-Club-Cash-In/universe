import type { CarteraRegisterTokenResult } from "../payments/cartera-client";
import type { CarteraEventTokenUsers } from "../routes/cartera-events";

/**
 * Cartera solo responde `credit_cancelled` cuando el binding del crédito quedó
 * inactivo por una cancelación. Si el token user local nació después (o el
 * evento de cancelación no lo alcanzó), queda activo y podría seguir recibiendo
 * transferencias: se desactiva aquí. Un fallo no cambia el resultado del
 * registro; el siguiente tokens:sync-cartera lo vuelve a intentar.
 */
export async function deactivateIfCreditCancelled(
  result: CarteraRegisterTokenResult,
  creditoId: number,
  tokenUsers: CarteraEventTokenUsers,
) {
  if (result.status !== "REJECTED" || result.reason !== "credit_cancelled") return;
  try {
    await tokenUsers.deactivateByCreditoId(creditoId);
  } catch {
    console.error(`No se pudo desactivar el token user local del credito ${creditoId} tras credit_cancelled`);
  }
}

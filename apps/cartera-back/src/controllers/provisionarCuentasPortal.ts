import { asc } from "drizzle-orm";
import { db } from "../database/index";
import { inversionistas } from "../database/db/schema";
import {
  provisionarInversionista,
  type ResultadoProvisionamientoCartera,
} from "../services/portalProvisioning";
import { decidirProvisionamiento } from "../utils/functions/provisionamientoPortal";
import { buscarRepresentanteEnCartera } from "../utils/functions/buscarRepresentante";
import {
  construirCorreoResumen,
  resumirProvisionamiento,
  type ResumenProvisionamiento,
} from "../utils/functions/resumenProvisionamiento";
import { INVESTOR_STATUS_CHANGE_RECIPIENTS } from "../utils/functions/investorStatusRecipients";
import { sendPlainEmail } from "@cci/email";

/**
 * Reconciliación diaria del acceso al portal.
 *
 * No hay tabla de intentos y no hace falta: lo pendiente es DERIVABLE. Un
 * inversionista con correo y sin usuario correspondiente ES un pendiente, y
 * volver a pasarlo por el mismo endpoint lo resuelve. Como el endpoint es
 * idempotente (la existencia del usuario es la llave), correr esto todos los
 * días no crea cuentas de más ni repite correos.
 *
 * Esto es lo que cierra el agujero del alta: el inversionista al que hoy no se
 * le pudo crear la cuenta —porque auth-google estaba caído, o porque el
 * reintento del operador murió en el guard de duplicados— queda con acceso
 * mañana a las 07:00 sin que nadie haga nada.
 */

export interface OpcionesJob {
  /** Recorre y reporta, pero no llama a auth-google ni manda nada. */
  dryRun?: boolean;
  enviarResumen?: (params: {
    to: string[];
    subject: string;
    html: string;
  }) => Promise<unknown>;
}

/** Envío por defecto del resumen: el mismo canal de los avisos de inversionista. */
export const enviarResumenProvisionamiento = async ({
  to,
  subject,
  html,
}: {
  to: string[];
  subject: string;
  html: string;
}) => sendPlainEmail(to, subject, html);

export const provisionarCuentasPortal = async (
  opciones: OpcionesJob = {},
): Promise<ResumenProvisionamiento> => {
  const filas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      email: inversionistas.email,
      dpi: inversionistas.dpi,
      dpi_rep_legal: inversionistas.dpi_rep_legal,
    })
    .from(inversionistas)
    .orderBy(asc(inversionistas.inversionista_id));

  const nombres = new Map(
    filas.map((f) => [f.inversionista_id, f.nombre ?? `#${f.inversionista_id}`]),
  );

  const resultados: ResultadoProvisionamientoCartera[] = [];

  for (const fila of filas) {
    if (opciones.dryRun) {
      // En seco no se sale a la red: se clasifica y ya. Sirve para ver el
      // universo antes del backfill sin mandarle un correo a nadie.
      const d = decidirProvisionamiento(fila);
      resultados.push({
        inversionistaId: fila.inversionista_id,
        estado: d.accion === "omitir" ? "omitida" : "ya_tenia",
        usuarioEmail: null,
        resueltoPor: null,
        correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
        advertencias: [],
        motivo: d.accion === "omitir" ? d.motivo : null,
      });
      continue;
    }

    // Secuencial a propósito: son ~200 filas una vez al día, y en paralelo
    // podríamos disparar 200 signUp simultáneos contra Better Auth.
    //
    // El aviso de empresa agregada NO se manda desde aquí: la reconciliación no
    // distingue una empresa nueva de una de hace un año, así que mandarlo sería
    // repetirle el mismo aviso a los diez representantes todos los días. Ese
    // correo es del camino de alta, que pasa una sola vez.
    const decision = await provisionarInversionista(fila, {
      buscarRepresentante: buscarRepresentanteEnCartera,
      soloAsegurarCuenta: true,
    });
    resultados.push(decision);
  }

  const resumen = resumirProvisionamiento(resultados, nombres);

  if (resumen.hayQueReportar && !opciones.dryRun && opciones.enviarResumen) {
    const { subject, html } = construirCorreoResumen(resumen);
    await opciones.enviarResumen({
      to: INVESTOR_STATUS_CHANGE_RECIPIENTS,
      subject,
      html,
    });
  }

  return resumen;
};

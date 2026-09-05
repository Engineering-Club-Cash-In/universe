import { asc } from "drizzle-orm";
import { db } from "../database/index";
import { inversionistas } from "../database/db/schema";
import {
  consultarAccesoInversionista,
  type ResultadoProvisionamientoCartera,
} from "../services/portalProvisioning";
import { decidirProvisionamiento } from "../utils/functions/provisionamientoPortal";
import {
  construirCorreoResumen,
  resumirProvisionamiento,
  type ResumenProvisionamiento,
} from "../utils/functions/resumenProvisionamiento";
import { INVESTOR_STATUS_CHANGE_RECIPIENTS } from "../utils/functions/investorStatusRecipients";
import { sendPlainEmail } from "@cci/email";

/**
 * Reconciliación diaria del acceso al portal: DETECTA, no ejecuta.
 *
 * No hay tabla de intentos y no hace falta: lo pendiente es DERIVABLE. Un
 * inversionista con correo y sin usuario correspondiente ES un pendiente. Este
 * job lo encuentra todos los días y lo pone en el resumen; abrir la cuenta lo
 * dispara una persona desde `POST /investor/portal-access`.
 *
 * POR QUÉ NO LO ABRE ÉL SOLO
 * --------------------------
 * Su universo es la tabla ENTERA y no mira —ni puede mirar— quién escribió cada
 * fila. `cartera.inversionistas` se escribe desde caminos que no prueban
 * identidad: el registro del portal, y `POST /api/cartera/investor`, cuyo
 * `requireAuth` no mira el rol sobre un Better Auth de sign-up abierto y sin
 * verificación de correo. Cuando el job creaba cuentas, eso significaba dos
 * cosas, las dos automáticas y con 24h de retraso:
 *
 *   1. Fila nueva con un DPI libre → el anónimo se lleva una cuenta INVESTOR
 *      con la contraseña en su buzón, y quema ese DPI (`users.dpi` es UNIQUE)
 *      para su dueño real.
 *   2. Peor: manda el DPI de un inversionista REAL sin cuenta. El upsert legacy
 *      resuelve por DPI y le REESCRIBE el correo a la fila de la víctima
 *      (investor.ts:672-678); el job lee el correo de la fila y le crea LA
 *      CUENTA DE LA VÍCTIMA al atacante.
 *
 * La (2) es la que descarta cualquier arreglo basado en la fila —una columna de
 * procedencia, exigir participaciones—: ahí la fila es legítima y estaría
 * marcada como legítima. Lo único envenenado es el correo, y de correos no hay
 * histórico contra el cual comparar. Por eso el corte va en el VERBO, no en el
 * filtro: el job pregunta y reporta, y la decisión la toma quien puede ver que
 * "cuenta para VICTIMA S.A. → atacante@evil.com" no cuadra, ANTES de que salga
 * la contraseña.
 *
 * QUÉ NO SE PIERDE
 * ----------------
 * El propósito original sigue en pie: que nadie se quede sin acceso porque
 * auth-google estaba caído en el alta —el operador no puede reintentar, su
 * segundo POST muere en el guard de duplicados—. Ese pendiente se sigue
 * detectando solo y se sigue reportando solo; lo único que se agrega es el
 * click. Son 0-2 filas al día.
 */

export interface OpcionesJob {
  /**
   * Ni siquiera pregunta a auth-google: clasifica con lo que hay en cartera.
   *
   * Sirve para ver el universo sin tocar la red. NO es lo que separa "crea" de
   * "no crea" —eso ya no depende de ninguna opción— así que dejarla en `false`
   * por descuido no puede provisionarle a nadie.
   */
  dryRun?: boolean;
  /**
   * Devuelve el resultado del proveedor, no `void`: `sendPlainEmail` NO tira
   * cuando Resend rechaza, resuelve `{ success:false, error }`. Solo un
   * `success === false` explícito cuenta como fallo, para que un doble de
   * prueba que resuelva `undefined` no se lea como envío caído.
   */
  enviarResumen?: (params: {
    to: string[];
    subject: string;
    html: string;
  }) => Promise<{ success?: boolean; error?: unknown } | void>;
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
        estado:
          d.accion === "omitir" || d.accion === "notificar_representante"
            ? "omitida"
            : "candidata",
        usuarioEmail: null,
        resueltoPor: null,
        correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
        advertencias: [],
        motivo:
          d.accion === "omitir"
            ? d.motivo
            : d.accion === "notificar_representante"
              ? "es_empresa"
              : null,
      });
      continue;
    }

    // Secuencial a propósito: son ~200 filas una vez al día, y en paralelo
    // podríamos disparar 200 consultas simultáneas contra Better Auth.
    //
    // `consultarAccesoInversionista` es SOLO LECTURA y es la única puerta que
    // este job tiene hacia auth-google: `provisionarInversionista` ni se
    // importa aquí. No es una bandera que se pueda olvidar — es que la función
    // que crea no está en este archivo.
    const decision = await consultarAccesoInversionista(fila);
    resultados.push(decision);
  }

  const resumen = resumirProvisionamiento(resultados, nombres);

  // Lo irrecuperable se escribe ANTES de intentar el correo, y a propósito.
  //
  // Tirar más abajo solo cambia una línea de log de `completed` a `failed` con
  // `error_code:"unknown"` (structuredLogger.ts:704-722): el CONTENIDO del
  // resumen no queda en ningún lado. `audit_logs` tampoco lo cubre — solo
  // registra el alta por HTTP, y este job no pasa por ninguna ruta. Con estos
  // ids en los logs del contenedor el incidente es reconstruible; sin ellos, la
  // única salida es cruzar `user.created_at` de auth-google contra la ventana
  // del cron y resetear a todos en bloque.
  if (resumen.accesosPerdidos.length || resumen.cuentasSinIdentidad.length) {
    console.error(
      "[provisionarCuentasPortal] IRRECUPERABLE:",
      JSON.stringify({
        accesosPerdidos: resumen.accesosPerdidos.map((e) => e.inversionistaId),
        cuentasSinIdentidad: resumen.cuentasSinIdentidad.map(
          (e) => e.inversionistaId,
        ),
      }),
    );
  }

  if (resumen.hayQueReportar && !opciones.dryRun && opciones.enviarResumen) {
    const { subject, html } = construirCorreoResumen(resumen);
    const envio = await opciones.enviarResumen({
      to: INVESTOR_STATUS_CHANGE_RECIPIENTS,
      subject,
      html,
    });

    // `sendPlainEmail` NO tira si Resend falla: resuelve `{ success:false }`
    // (packages/email/src/index.ts:1113). Descartarlo dejaba la corrida
    // registrada como `completed` con el resumen perdido, y el modo de fallo
    // correlaciona: la misma caída de Resend que tumba los correos de
    // bienvenida tumba este aviso, o sea justo la corrida con más cuentas sin
    // contraseña entregada es la que no reporta nada. Es el mismo patrón que
    // ya usan verificarFacturasSat.ts:403-420 y
    // verificarCuadreLiquidaciones.ts:824-838.
    if (envio && envio.success === false) {
      console.error(
        "❌ [provisionarCuentasPortal] El resumen NO se pudo enviar:",
        envio.error,
      );
      throw new Error(
        `Falló el envío del resumen de provisionamiento: ${JSON.stringify(envio.error)}`,
      );
    }
  }

  return resumen;
};

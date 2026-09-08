/**
 * A qué buzón va el correo de liquidación de una fila de `inversionistas`.
 *
 * Hasta ahora iba siempre al `email` de la fila. Cuando la fila es una
 * sociedad ese buzón puede no ser el de quien la representa: medido contra
 * producción, en 10 de las 11 filas con `dpi_rep_legal` el correo de la
 * sociedad NO es el del representante. El caso extremo es un representante de
 * 4 sociedades repartidas en 3 buzones distintos, más su propia inversión:
 * hoy recibe 5 correos en 5 lugares y no ve ninguno junto.
 *
 * La decisión vive aquí, separada del envío, porque el envío está dentro de
 * una función de mil líneas dentro de una transacción de liquidación y no se
 * puede ejercitar en una prueba. Aquí sí.
 */

import { normalizarDpiParaComparar } from "./provisionamientoPortal";

export type ViaDeEnvioLiquidacion = "fila" | "representante";

export interface FilaLiquidacion {
  nombre: string | null;
  email: string | null;
  /**
   * DPI de la fila que se liquida (`dpi`, bigint: nunca trae ceros a la
   * izquierda). Solo sirve para reconocer al que se representa a sí mismo.
   */
  dpi: number | string | null;
}

export interface RepresentanteLiquidacion {
  nombre: string;
  email: string | null;
  /** DPI de la fila del representante, para compararlo con el de la entidad. */
  dpi: number | string | null;
}

export interface DestinatarioLiquidacion {
  /** Buzón final, ya recortado. `null` = no hay a dónde mandar. */
  email: string | null;
  via: ViaDeEnvioLiquidacion;
  /**
   * Nombre del representante SOLO cuando el correo cae en su buzón. Es lo que
   * el cuerpo usa para saludar a quien abre el correo sin dejar de decir de
   * qué entidad es la liquidación.
   */
  nombreRepresentante: string | null;
  /** Para el log: por qué salió por esa vía. */
  motivo:
    | "representante_con_correo"
    | "autorrepresentado"
    | "representante_sin_correo"
    | "representante_con_correo_invalido"
    | "sin_representante";
}

/**
 * Recorta los espacios. `emailSchema.parse` de `@cci/email` tira con un correo
 * con espacios, y esa excepción se lleva el envío de esa iteración.
 */
const limpiar = (valor: string | null | undefined): string | null => {
  const texto = (valor ?? "").trim();
  return texto === "" ? null : texto;
};

/**
 * ¿Este correo lo va a aceptar el envío?
 *
 * Recortar no alcanza. `sendLiquidationEmail` valida con
 * `emailSchema.parse(to)` (packages/email/src/index.ts:60,96) y TIRA si el
 * formato no le gusta; el llamador solo registra la excepción y sigue
 * (investor.ts:4808), no reintenta con el correo de la entidad. Así que elegir
 * un correo malformado no degrada el envío: lo PIERDE, justo lo contrario de
 * la política declarada de caer al comportamiento de siempre. Por eso la
 * dirección del representante se valida ANTES de elegirla.
 *
 * SON DOS DEFINICIONES, a propósito y no por gusto: `emailSchema` es un `const`
 * privado del módulo (`packages/email/src/index.ts:60`, no exportado), y ese
 * módulo TIRA al importarse si faltan `RESEND_API_KEY`/`EMAIL_DOMAIN` — o sea
 * que ni exportándolo podría importarlo un módulo de decisión puro sin
 * arrastrar el cliente de Resend a una prueba unitaria.
 *
 * La regla que mantiene sanas a las dos: esta comprobación tiene que ser a lo
 * sumo TAN permisiva como la de zod, nunca más. Todo lo que aceptemos acá lo
 * acepta `emailSchema`, así que nunca elegimos una dirección que el envío vaya
 * a rechazar. La asimetría que queda apunta al lado seguro: si algún día zod
 * acepta algo que esta expresión no, ese representante se queda sin la mejora
 * y su liquidación sale al buzón de la entidad — el comportamiento de hoy, que
 * es exactamente lo que la política promete.
 *
 * Frente a `z.string().email()` de zod 3
 * (`/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i`):
 * mismo dominio, y en la parte local se exige además que cada tramo entre
 * puntos termine en carácter "normal". Nada de espacios, ni cero arrobas, ni
 * dos.
 */
const SEGMENTO_LOCAL = "[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]";
const CORREO_ACEPTADO_POR_EL_ENVIO = new RegExp(
  `^${SEGMENTO_LOCAL}(\\.${SEGMENTO_LOCAL})*@([A-Za-z0-9][A-Za-z0-9-]*\\.)+[A-Za-z]{2,}$`,
);

const esCorreoEnviable = (correo: string): boolean =>
  CORREO_ACEPTADO_POR_EL_ENVIO.test(correo);

/**
 * Regla: si hay representante Y tiene correo, el correo es suyo. En cualquier
 * otro caso se cae al correo de la fila, exactamente como antes.
 *
 * El fallback no es cortesía, es la política: perder un correo de liquidación
 * es peor que mandarlo al buzón de siempre. Por eso "representante sin correo"
 * (INVERSIONES DELFINA, id 34: su representante no tiene correo en cartera),
 * "representante con un correo que el envío no acepta" y "representante que no
 * aparece en cartera" terminan en el mismo sitio de hoy en vez de quedar sin
 * enviar.
 *
 * El correo de la FILA no se valida: si viene malformado, el envío tira y se
 * registra, igual que antes de este cambio. Esta función decide a QUIÉN se
 * elige, no reescribe el camino de siempre.
 *
 * El que se representa a sí mismo (id 187, `dpi=4036613` vs
 * `dpi_rep_legal='04036613'`) resuelve a su propia fila y termina en su propio
 * buzón: la vía dice "representante" pero el buzón no cambia. El CUERPO sí
 * cambiaba, y ese era el error: con `nombreRepresentante` la plantilla pasa al
 * texto de empresa y le dice que la liquidación es de "una entidad que usted
 * representa" (LiquidationTemplate.tsx:99), siendo que la entidad es él. Por
 * eso el autorrepresentado va sin `nombreRepresentante` y conserva el texto
 * personal de siempre.
 */
export const destinatarioDeLiquidacion = (
  fila: FilaLiquidacion,
  representante: RepresentanteLiquidacion | null,
): DestinatarioLiquidacion => {
  const emailRepresentante = limpiar(representante?.email);
  // Misma normalización que usa el resto del código para cruzar `dpi` (bigint,
  // sin ceros a la izquierda) contra `dpi_rep_legal` (varchar, con ellos): sin
  // ella, Kafie deja de reconocerse a sí mismo por un cero. Dos DPI ausentes
  // NO son el mismo DPI, de ahí el `!== null`.
  const dpiFila = normalizarDpiParaComparar(fila.dpi);
  const dpiRepresentante = normalizarDpiParaComparar(representante?.dpi);
  const seRepresentaASiMismo = dpiFila !== null && dpiFila === dpiRepresentante;
  const representanteEsAlcanzable =
    emailRepresentante !== null && esCorreoEnviable(emailRepresentante);

  if (representante && emailRepresentante && representanteEsAlcanzable) {
    return {
      email: emailRepresentante,
      via: "representante",
      nombreRepresentante: seRepresentaASiMismo
        ? null
        : limpiar(representante.nombre),
      motivo: seRepresentaASiMismo
        ? "autorrepresentado"
        : "representante_con_correo",
    };
  }

  return {
    email: limpiar(fila.email),
    via: "fila",
    nombreRepresentante: null,
    motivo: !representante
      ? "sin_representante"
      : emailRepresentante
        ? "representante_con_correo_invalido"
        : "representante_sin_correo",
  };
};

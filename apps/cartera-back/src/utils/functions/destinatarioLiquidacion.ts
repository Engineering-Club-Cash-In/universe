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

export type ViaDeEnvioLiquidacion = "fila" | "representante";

export interface FilaLiquidacion {
  nombre: string | null;
  email: string | null;
}

export interface RepresentanteLiquidacion {
  nombre: string;
  email: string | null;
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
    | "representante_sin_correo"
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
 * Regla: si hay representante Y tiene correo, el correo es suyo. En cualquier
 * otro caso se cae al correo de la fila, exactamente como antes.
 *
 * El fallback no es cortesía, es la política: perder un correo de liquidación
 * es peor que mandarlo al buzón de siempre. Por eso "representante sin correo"
 * (INVERSIONES DELFINA, id 34: su representante no tiene correo en cartera) y
 * "representante que no aparece en cartera" terminan en el mismo sitio de hoy
 * en vez de quedar sin enviar.
 *
 * El que se representa a sí mismo (id 187, `dpi=4036613` vs
 * `dpi_rep_legal='04036613'`) resuelve a su propia fila y termina en su propio
 * buzón: la vía dice "representante" pero el buzón no cambia.
 */
export const destinatarioDeLiquidacion = (
  fila: FilaLiquidacion,
  representante: RepresentanteLiquidacion | null,
): DestinatarioLiquidacion => {
  const emailRepresentante = limpiar(representante?.email);

  if (representante && emailRepresentante) {
    return {
      email: emailRepresentante,
      via: "representante",
      nombreRepresentante: limpiar(representante.nombre),
      motivo: "representante_con_correo",
    };
  }

  return {
    email: limpiar(fila.email),
    via: "fila",
    nombreRepresentante: null,
    motivo: representante ? "representante_sin_correo" : "sin_representante",
  };
};

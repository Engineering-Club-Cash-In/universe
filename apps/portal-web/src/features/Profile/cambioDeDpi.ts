/**
 * Cambiar el DPI son DOS escrituras, en dos servicios distintos: la CUENTA
 * (auth-google, `POST /api/profile/me/dpi`) y el LEAD del CRM
 * (`POST /api/crm/profile/update`). No hay transacción que abarque a las dos.
 *
 * 🔴 El orden no es libre. `/api/crm/profile/update` toma el DPI de la CUENTA y
 * nunca el del cuerpo —es deliberado: un DPI arbitrario escrito en un lead
 * envenena la resolución de identidad del portal, que casa leads por DPI—, así
 * que si la cuenta todavía tuviera el viejo, el CRM escribiría el viejo o
 * contestaría 409. La cuenta va primero por contrato.
 *
 * 🔴 Y por eso hacía falta esto. El CRM valida el DPI nuevo contra la mora de
 * cartera y puede RECHAZARLO (mora activa, o el propio cartera caído). Cuando
 * eso pasaba, la cuenta ya tenía el DPI nuevo y el lead seguía con el viejo: la
 * misma persona con dos identidades, una por servicio, sin nada que las
 * volviera a juntar — y el usuario veía un error que le decía que no había
 * cambiado nada. Si el CRM no acompaña, la escritura de la cuenta se deshace.
 *
 * La reversa es best-effort y jamás tapa el motivo original: el error que se
 * relanza es SIEMPRE el del CRM, que es el que el usuario tiene que leer.
 */
export interface CambioDeDpi<T> {
  /** El DPI que se está fijando. */
  dpiNuevo: string;
  /**
   * El que la CUENTA tenía antes (no el del lead: es la escritura que hay que
   * poder deshacer). Vacío cuando la cuenta todavía no tenía DPI.
   */
  dpiPrevioEnLaCuenta: string;
  /** `updateOwnDpi`. */
  fijarDpiDeLaCuenta: (dpi: string) => Promise<unknown>;
  /** `updateLead` con el payload ya armado. */
  actualizarElLead: () => Promise<T>;
  /** Para dejar rastro de lo que no se pudo deshacer. Por defecto, la consola. */
  avisar?: (mensaje: string, detalle: unknown) => void;
}

export async function aplicarCambioDeDpi<T>(cambio: CambioDeDpi<T>): Promise<T> {
  const avisar =
    cambio.avisar ??
    ((mensaje: string, detalle: unknown) => console.error(mensaje, detalle));

  await cambio.fijarDpiDeLaCuenta(cambio.dpiNuevo);

  try {
    return await cambio.actualizarElLead();
  } catch (error) {
    // Sin DPI previo no hay a qué volver: la ruta de la cuenta exige un DPI
    // válido y no admite borrarlo. Queda anotado para que se vea en el log en
    // lugar de desaparecer.
    if (!cambio.dpiPrevioEnLaCuenta) {
      avisar(
        "El CRM rechazó el DPI y la cuenta no tenía uno previo al que volver:",
        error
      );
      throw error;
    }

    if (cambio.dpiPrevioEnLaCuenta !== cambio.dpiNuevo) {
      try {
        await cambio.fijarDpiDeLaCuenta(cambio.dpiPrevioEnLaCuenta);
      } catch (errorDeReversa) {
        avisar(
          "No se pudo devolver el DPI de la cuenta a su valor anterior:",
          errorDeReversa
        );
      }
    }

    throw error;
  }
}

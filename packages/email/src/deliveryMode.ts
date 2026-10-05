/**
 * Modo de entrega de correo del paquete, expuesto para que quien manda un
 * correo pueda SABER si de verdad llegó a su destinatario.
 *
 * El paquete redirige todos los correos a una sola bandeja cuando `SERVER` no
 * es "PROD" (ver `index.ts`). Eso es una red de seguridad para desarrollo, pero
 * en un alta de cuenta del portal es una trampa: las cuentas se crean, las
 * contraseñas se van todas a la misma bandeja, y como el único registro de que
 * el correo se mandó es la propia cuenta, nadie se entera. Exportar el modo
 * convierte ese fallo silencioso en un dato que viaja en la respuesta.
 */

export interface EmailDeliveryMode {
  /** Valor efectivo de la env `SERVER`, en mayúsculas. */
  server: string;
  /** `true` si el correo NO llega a su destinatario original. */
  redirige: boolean;
  /**
   * Las bandejas a las que se desvía todo, separadas por coma, o `null` si no
   * hay desvío. Es texto para mostrar ("se desvió a …"); para mandar, usar
   * `destinatarios`. Conserva el nombre de cuando era una sola.
   */
  destinatarioUnico: string | null;
  /** Las mismas bandejas, una por una. Vacío si no hay desvío. */
  destinatarios: string[];
}

/** Default histórico del paquete: sin `SERVER` NO se manda a destinatarios reales. */
export const DEFAULT_SERVER = "DEV";
/**
 * Quiénes reciben las pruebas si nadie dice otra cosa. Son los que prueban los
 * flujos que mandan correo: con una sola bandeja, el otro no veía lo que salía.
 */
export const DEFAULT_DEV_RECIPIENTS = [
  "jalvarado@clubcashin.com",
  "daniel.r@clubcashin.com",
];

/**
 * Versión pura: recibe el entorno en vez de leerlo. Es la que se testea.
 */
export const resolveEmailDeliveryMode = (
  environment: Record<string, string | undefined>,
): EmailDeliveryMode => {
  const server = (environment.SERVER ?? DEFAULT_SERVER).toUpperCase();
  const redirige = server !== "PROD";
  // EMAIL_DEV_RECIPIENT acepta varias, separadas por coma.
  const deLaEnv = (environment.EMAIL_DEV_RECIPIENT ?? "")
    .split(",")
    .map((correo) => correo.trim())
    .filter(Boolean);
  const destinatarios = redirige
    ? deLaEnv.length > 0
      ? deLaEnv
      : DEFAULT_DEV_RECIPIENTS
    : [];
  return {
    server,
    redirige,
    destinatarioUnico: redirige ? destinatarios.join(", ") : null,
    destinatarios,
  };
};

/**
 * Foto tomada UNA vez, al cargar el módulo, a propósito.
 *
 * El interceptor que redirige los correos se instala también al cargar
 * `index.ts`: si aquí releyéramos `process.env` en cada llamada, podríamos
 * reportar un modo que ya no es el que está aplicando el interceptor. Una sola
 * lectura para los dos usos es lo que hace que el reporte no mienta.
 */
export const EMAIL_DELIVERY_MODE: EmailDeliveryMode = resolveEmailDeliveryMode(
  process.env as Record<string, string | undefined>,
);

/** El modo con el que este proceso está mandando correo. */
export const getEmailDeliveryMode = (): EmailDeliveryMode => EMAIL_DELIVERY_MODE;

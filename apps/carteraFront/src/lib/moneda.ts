/**
 * Formato de quetzales de la app: `Q 1,234.56`.
 *
 * Definición única — vivía copiada en Latefee.tsx, ModalHistorialMora.tsx y
 * MoraHistorial.tsx, con el riesgo de que una copia cambiara de decimales y las
 * otras no.
 */
export const fmtQ = (v: unknown): string =>
  `Q ${Number(v ?? 0).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

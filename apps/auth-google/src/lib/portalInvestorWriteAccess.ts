/**
 * Quién puede escribir los datos de cobro de un inversionista desde el portal.
 *
 * EL PROBLEMA DE FONDO, sin resolver aquí: `requireEmailVerification` está en
 * `false` (lib/auth.ts), así que una sesión NO prueba que el correo sea de
 * quien lo usa. Resolver el inversionista por el correo de la sesión —que es
 * lo que hace esta ruta— apoya la identidad entera en un dato que nadie
 * verificó. Si el correo de un inversionista todavía no estaba registrado en
 * Better Auth, cualquiera creaba una cuenta con él y su escritura aterrizaba
 * sobre la fila de la víctima: cuenta bancaria incluida, sin acertar el DPI ni
 * el nombre.
 *
 * Cerrar eso de raíz es activar la verificación de correo, y eso cambia el
 * acceso de todos los usuarios que ya existen: es una decisión de producto y
 * está escalada.
 *
 * MIENTRAS TANTO, esta es la barrera que sí se puede poner sin tocar el acceso
 * de nadie: exigir que la cuenta sea, para el sistema, el inversionista que
 * dice ser. Sirve porque la cuenta recién creada del ataque nace como CLIENT y
 * NO puede ascender: para llegar a INVESTOR hay que completar el registro
 * externo, que crea la fila en modo estricto —y choca con la fila de la
 * víctima, que ya tiene ese correo— o reconocerla por la marca de procedencia,
 * que en una fila que el portal no creó es NULL.
 *
 * NO es un sustituto de la verificación de correo. Solo cierra este camino.
 */

export type SesionDelPortal = {
  id: string;
  role?: string | null;
};

/**
 * `true` si la sesión puede escribir sobre esa fila de inversionista.
 *
 * Dos formas de probarlo, ambas del lado del servidor:
 *
 * 1. La fila lleva la marca de procedencia de ESTA cuenta: la creó su propio
 *    registro del portal (ver migración 0033). Es la prueba más fuerte, y vale
 *    aunque el rol se haya quedado atrás porque el ascenso no llegó a
 *    escribirse.
 * 2. El sistema ya reconoce a la cuenta como INVESTOR. Ese rol solo lo escribe
 *    el servidor tras un registro externo que salió bien.
 *
 * Todo lo demás se rechaza, incluidos los roles administrativos: esta ruta es
 * "editar MIS datos de cobro", no una herramienta de back office.
 */
export const puedeEditarInversionista = (params: {
  sesion: SesionDelPortal;
  creadoPorUsuarioPortal: string | null | undefined;
}): boolean => {
  const { sesion, creadoPorUsuarioPortal } = params;

  if (
    typeof creadoPorUsuarioPortal === "string" &&
    creadoPorUsuarioPortal !== "" &&
    creadoPorUsuarioPortal === sesion.id
  ) {
    return true;
  }

  return sesion.role === "INVESTOR";
};

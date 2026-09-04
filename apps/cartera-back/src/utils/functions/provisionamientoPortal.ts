// Quién debe tener cuenta en el Portal del Inversionista.
//
// Esta decisión vive en cartera porque los tres datos que la determinan
// (`email`, `dpi`, `dpi_rep_legal`) viven en `cartera.inversionistas`. El
// reparto es a propósito: CARTERA sabe quién DEBE tener cuenta; AUTH-GOOGLE
// sabe quién YA la tiene. Ninguno de los dos consulta la tabla del otro.
//
// Es una función pura sin acceso a base: los tres caminos de alta (CRM,
// carteraFront y el registro del portal) desembocan en el mismo POST /investor,
// así que instrumentar este único punto cubre a los tres — y a la próxima
// integración que aparezca.

export interface FilaInversionista {
  inversionista_id: number;
  nombre: string | null;
  email: string | null;
  /** bigint en la base: nunca trae ceros a la izquierda. */
  dpi: number | string | null;
  /** varchar(20): SÍ los conserva ("04036613"). */
  dpi_rep_legal: string | null;
}

export type MotivoOmision = "sin_correo" | "sin_nombre";

export type DecisionProvisionamiento =
  | { accion: "omitir"; motivo: MotivoOmision }
  /**
   * La fila es una empresa: no recibe cuenta propia, pero su REPRESENTANTE sí
   * tiene que enterarse de que ahora la representa en el portal. Quién es ese
   * representante lo resuelve el llamador contra cartera (`dpi` = este valor):
   * esta función es pura y no consulta la base.
   */
  | {
      accion: "notificar_representante";
      inversionistaId: number;
      inversionistaNombre: string;
      /** Dígitos sin ceros a la izquierda, listo para comparar contra `dpi`. */
      dpiRepresentante: string;
    }
  | {
      accion: "provisionar";
      inversionistaId: number;
      /** Razón social de la fila: es el `companyName` del correo de empresa agregada. */
      inversionistaNombre: string;
      /** Nombre para la cuenta. Para una persona, el mismo. */
      nombre: string;
      /** Ya normalizado a minúsculas: el login del portal no distingue caja. */
      email: string;
      /** Solo dígitos y sin ceros a la izquierda, o `null`. NUNCA cadena vacía. */
      dpi: string | null;
    };

/**
 * Deja un DPI en forma comparable entre `dpi` (bigint) y `dpi_rep_legal`
 * (varchar con ceros a la izquierda).
 *
 * Compara como TEXTO sin ceros a la izquierda a propósito, en vez de convertir
 * a número: `dpi_rep_legal` admite 20 dígitos y un bigint topa en 19, así que
 * un `BigInt(...)` podría desbordar con un valor mal capturado. Quitar los
 * ceros y comparar strings da el mismo resultado para dígitos y no revienta.
 *
 * NOTA DE MERGE: `feat/portal-lista-inversionistas` (Fase A) tiene esta misma
 * función en `grupoInversionistas.ts`. Va duplicada aquí porque esta rama no
 * sale de aquella; al mergear las dos, dejar UNA sola y que este archivo la
 * importe. Son idénticas: el criterio no puede divergir entre "a qué grupo
 * pertenezco" y "quién recibe cuenta".
 */
export const normalizarDpiParaComparar = (valor: unknown): string | null => {
  const texto = String(valor ?? "").trim();
  if (!/^\d+$/.test(texto)) return null;
  const sinCeros = texto.replace(/^0+/, "");
  return sinCeros === "" ? null : sinCeros;
};

/**
 * Una empresa es una fila con representante legal DISTINTO de ella misma.
 *
 * La excepción no es teórica: el inversionista 187 (Javier Kafie) se representa
 * a sí mismo (`dpi=4036613`, `dpi_rep_legal='04036613'`). La regla literal
 * "tiene dpi_rep_legal ⇒ es empresa" lo dejaría sin cuenta por un cero a la
 * izquierda. La regla correcta es "no recibe cuenta propia SALVO que el
 * representante sea él mismo".
 */
export const esEmpresaRepresentada = (inv: FilaInversionista): boolean => {
  const rep = normalizarDpiParaComparar(inv.dpi_rep_legal);
  if (rep === null) return false;
  return rep !== normalizarDpiParaComparar(inv.dpi);
};

/**
 * Sociedades detectables por el NOMBRE. Se usa SOLO para reportar, jamás para
 * decidir.
 *
 * Hay filas que son sociedades por el nombre y no tienen `dpi_rep_legal`
 * (Central de Carga, RDBE, CREACION E IMAGEN, PLT LOPEZ SANCHEZ). La regla las
 * trata como persona y a una de ellas le daría cuenta propia. No se corrige por
 * heurística de nombre: es dato faltante, no bug de código, y adivinar sobre
 * datos de identidad es peor que ponerlo en el reporte diario para que alguien
 * capture el representante que falta.
 */
export const pareceSociedad = (nombre: string | null | undefined): boolean => {
  const texto = (nombre ?? "").toUpperCase();
  return /(\bS\.?\s?A\.?(\s|,|$)|SOCIEDAD\s+ANONIMA|SOCIEDAD\s+AN[ÓO]NIMA)/.test(texto);
};

/**
 * El DPI tal como debe viajar al provisionamiento: dígitos sin ceros a la
 * izquierda, o `null`.
 *
 * Nunca cadena vacía. `"auth-google".users.dpi` es UNIQUE y la cadena vacía YA
 * ocupa ese slot en producción (`direccion@grupowad.com`): un segundo `''`
 * reventaría con 23505.
 */
const dpiParaCuenta = (dpi: FilaInversionista["dpi"]): string | null =>
  normalizarDpiParaComparar(dpi);

export const decidirProvisionamiento = (
  inv: FilaInversionista,
): DecisionProvisionamiento => {
  const nombre = (inv.nombre ?? "").trim();
  if (!nombre) {
    return { accion: "omitir", motivo: "sin_nombre" };
  }

  // La rama de empresa va PRIMERO y no es un "omitir".
  //
  // Que la empresa no reciba cuenta propia no significa que no pase nada: es
  // justo el caso en que su representante —que ya tiene usuario— debe recibir
  // el aviso de "ahora también representas a X". Tratarlo como omisión dejaba
  // ese correo sin ninguna forma de dispararse.
  //
  // Va antes que la validación de correo a propósito: MENFER (66) no tiene
  // correo propio, y aun así su representante sí tiene a dónde recibir el
  // aviso. Pedirle correo a la empresa mandaría a operaciones a conseguir uno
  // que no hace falta.
  const dpiRepresentante = normalizarDpiParaComparar(inv.dpi_rep_legal);
  if (dpiRepresentante !== null && dpiRepresentante !== normalizarDpiParaComparar(inv.dpi)) {
    return {
      accion: "notificar_representante",
      inversionistaId: inv.inversionista_id,
      inversionistaNombre: nombre,
      dpiRepresentante,
    };
  }

  const email = (inv.email ?? "").trim().toLowerCase();
  if (!email) {
    // Sin correo no hay identidad en Better Auth: `users.email` es NOT NULL y
    // es la llave del login. Se omite EXPLÍCITAMENTE y se reporta; nunca en
    // silencio.
    return { accion: "omitir", motivo: "sin_correo" };
  }

  return {
    accion: "provisionar",
    inversionistaId: inv.inversionista_id,
    inversionistaNombre: nombre,
    nombre,
    email,
    dpi: dpiParaCuenta(inv.dpi),
  };
};

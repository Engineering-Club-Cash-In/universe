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
  //
  // La condición NO se reescribe aquí: la decide `esEmpresaRepresentada`, que
  // es donde está documentada la excepción del autorrepresentado. Tenerla dos
  // veces era tenerla en un sitio que nadie ejecutaba y en otro que sí, y la
  // que se lee no era la que corría.
  const dpiRepresentante = normalizarDpiParaComparar(inv.dpi_rep_legal);
  if (dpiRepresentante !== null && esEmpresaRepresentada(inv)) {
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

/**
 * ¿El alta PIDIÓ que se le abra cuenta en el portal?
 *
 * Guard de la ruta pública. `POST /investor` no es solo el formulario de back
 * office: `auth-google` lo alcanza desde `/api/unified/register-external`, que
 * NO lleva `requireAuth`, y desde `/api/cartera/investor`, que sí lo lleva pero
 * no mira el rol y cualquiera se fabrica esa sesión (el sign-up de Better Auth
 * está abierto y sin verificación de correo). Como las dos llegan a cartera con
 * el MISMO token de servicio ADMIN, dentro de cartera el alta anónima y la de
 * back office son indistinguibles por identidad: contra ESE camino el permiso
 * tiene que venir del PAYLOAD, porque mirar quién firma no distingue nada.
 *
 * Es la MITAD del permiso, no todo. La otra mitad —quién firma sí importa
 * cuando el token NO viene de auth-google— la pone `origenPuedeProvisionar`
 * más abajo; `permisoParaProvisionar` es el que hay que llamar.
 *
 * Funciona porque el registro público arma un objeto FIJO con
 * `{nombre, dpi, email}` y no reenvía llaves del cuerpo original: nadie de
 * afuera puede colar `provisionar_portal`. Sin ella no se crea cuenta, no sale
 * correo con contraseña y no se ocupa un DPI en `users`.
 *
 * Se acepta el string "true" porque hay clientes que serializan el booleano al
 * mandar formularios; el modo de fallo de NO aceptarlo es un alta legítima que
 * queda sin cuenta hasta la reconciliación del día siguiente.
 */
export const solicitaProvisionamiento = (cuerpo: unknown): boolean => {
  if (!cuerpo || typeof cuerpo !== "object") return false;
  const valor = (cuerpo as Record<string, unknown>).provisionar_portal;
  return valor === true || valor === "true";
};

/**
 * ¿Quién llamó puede hacer que salga un correo con contraseña?
 *
 * La llave `provisionar_portal` dice que el alta lo PIDIÓ; esto dice si quien
 * la mandó tenía con qué pedirlo. Son dos preguntas distintas y por eso son dos
 * motivos distintos en la respuesta: `no_solicitado` manda a revisar el
 * payload, `origen_no_autorizado` manda a revisar el token.
 *
 * POR QUÉ ADMIN
 * -------------
 * `POST /investor` corre bajo `authMiddleware`, que solo verifica la firma del
 * JWT: no mira el rol. O sea que hasta aquí CUALQUIER token vivo de cartera
 * —el de un ASESOR, el de CONTA, uno robado de una laptop— podía provocar que
 * se creara una cuenta del portal y se mandara su contraseña al correo que
 * viniera en el payload. La API era más ancha que su propia UI: la pantalla de
 * inversionistas de carteraFront ya es solo-ADMIN (App.tsx:121), y la ruta
 * hermana que abre accesos a mano exige ADMIN explícitamente
 * (otorgarAccesoPortal.ts:50). Esto empareja las tres.
 *
 * LO QUE ESTO **NO** HACE
 * -----------------------
 * NO defiende contra un ADMIN falso. `POST /auth/admin` no tiene guard y
 * cualquiera se fabrica un ADMIN real en la base (auth.ts:12 y
 * controllers/auth.ts:22-41); contra eso ningún chequeo de rol sirve, porque
 * el atacante ES ADMIN. Ese agujero es PREEXISTENTE, vive fuera de este módulo
 * y se cierra en `routers/auth.ts`, no aquí.
 *
 * Tampoco sirve un secreto compartido en su lugar: el otro llamador legítimo
 * es carteraFront, una SPA de Vite (`import.meta.env.VITE_BACK_URL`,
 * interceptor.ts:4-5), y todo lo que ella lleve viaja en un bundle público.
 */
export const origenPuedeProvisionar = (
  usuario: { role?: unknown } | null | undefined,
): boolean => usuario?.role === "ADMIN";

export type PermisoProvisionamiento =
  | "provisionar"
  | "no_solicitado"
  | "origen_no_autorizado";

/**
 * Las dos preguntas juntas, en el orden en que importan.
 *
 * El "no lo pidió" gana sobre el "no puede": un alta que ni siquiera mandó la
 * llave no es un intento de saltarse un permiso, y reportarla como problema de
 * rol mandaría a operaciones a pedir accesos que no le faltan.
 */
export const permisoParaProvisionar = (
  cuerpo: unknown,
  usuario: { role?: unknown } | null | undefined,
): PermisoProvisionamiento => {
  if (!solicitaProvisionamiento(cuerpo)) return "no_solicitado";
  if (!origenPuedeProvisionar(usuario)) return "origen_no_autorizado";
  return "provisionar";
};

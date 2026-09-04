import {
  generarPasswordPortal,
  normalizarDpiParaBuscar,
  normalizarDpiParaGuardar,
  resolveRoleAfterRegistration,
  type PortalUserType,
} from "../../lib/provisioning";

/**
 * Provisionamiento de cuentas del portal: la mitad que EJECUTA.
 *
 * Cartera ya decidió quién debe tener cuenta (tiene `dpi_rep_legal` y el
 * correo); aquí solo se resuelve quién YA la tiene y se manda el correo que
 * corresponda. Este módulo no sabe qué es un representante legal y no debe
 * saberlo.
 *
 * Todo lo que toca base, Better Auth o Resend entra por `deps`, para que la
 * lógica —que es donde están las trampas— se pueda probar sin ninguno de los
 * tres.
 */

export interface UsuarioPortal {
  id: string;
  email: string;
  nombre: string;
  role: string;
  dpi: string | null;
}

export interface ModoEnvio {
  server: string;
  redirige: boolean;
  destinatarioUnico: string | null;
}

export interface ResultadoEnvio {
  success: boolean;
  error?: unknown;
}

export interface DependenciasProvisionamiento {
  portalUrl: string;
  modoEnvio: () => ModoEnvio;
  generarPassword?: () => string;
  /** Recibe el DPI YA normalizado para búsqueda (dígitos, sin ceros a la izquierda). */
  buscarPorDpi: (dpiNormalizado: string) => Promise<UsuarioPortal | null>;
  /** Recibe el correo YA en minúsculas. */
  buscarPorEmail: (email: string) => Promise<UsuarioPortal | null>;
  crearUsuario: (input: {
    nombre: string;
    email: string;
    password: string;
  }) => Promise<{ id: string }>;
  actualizarUsuario: (
    id: string,
    cambios: { role?: PortalUserType; dpi?: string | null },
  ) => Promise<void>;
  enviarBienvenida: (params: {
    to: string;
    investorName: string;
    password: string;
    portalUrl: string;
    companyNames?: string[];
  }) => Promise<ResultadoEnvio>;
  enviarEmpresaAgregada: (params: {
    to: string;
    investorName: string;
    companyName: string;
    portalUrl: string;
  }) => Promise<ResultadoEnvio>;
}

export interface EntradaCuenta {
  email: string;
  dpi: string | null;
  nombre: string;
  inversionistaId: number;
  inversionistaNombre: string;
}

export interface EntradaEmpresa {
  representanteEmail: string | null;
  representanteDpi: string | null;
  representanteNombre: string;
  inversionistaId: number;
  inversionistaNombre: string;
}

export type EstadoProvisionamiento =
  | "creada"
  | "ya_tenia"
  | "avisada"
  | "fallo";

export interface ResultadoProvisionamiento {
  estado: EstadoProvisionamiento;
  /** El correo REAL de login. Puede diferir del que tiene cartera. */
  usuarioEmail: string | null;
  resueltoPor: "dpi" | "email" | null;
  correo: {
    enviado: boolean;
    plantilla: "bienvenida" | "empresa_agregada" | null;
    /** `true` si el paquete de correo lo desvió a una sola bandeja. */
    redirigido: boolean;
    destinatarioReal: string | null;
  };
  advertencias: string[];
  motivo: string | null;
}

/**
 * Busca al usuario POR DPI PRIMERO y por correo después.
 *
 * El orden no es cosmético: hoy hay tres personas con dos correos cada una
 * (esdras@ vs esdrasgamboa8@, etc.). Buscando por correo primero, las tres se
 * estrellarían contra `users_dpi_key` al intentar crear una cuenta que ya
 * existe; buscando por DPI, las tres son "ya tenía". La colisión no es un
 * obstáculo, es la señal.
 */
const resolverUsuario = async (
  dpi: string | null,
  email: string,
  deps: DependenciasProvisionamiento,
): Promise<{ usuario: UsuarioPortal; resueltoPor: "dpi" | "email" } | null> => {
  const dpiBusqueda = normalizarDpiParaBuscar(dpi);
  if (dpiBusqueda) {
    const porDpi = await deps.buscarPorDpi(dpiBusqueda);
    if (porDpi) return { usuario: porDpi, resueltoPor: "dpi" };
  }

  if (email) {
    const porEmail = await deps.buscarPorEmail(email.trim().toLowerCase());
    if (porEmail) return { usuario: porEmail, resueltoPor: "email" };
  }

  return null;
};

/** Sube CLIENT→INVESTOR y nada más. Nunca degrada ni toca un rol administrativo. */
const promoverRol = async (
  usuario: UsuarioPortal,
  deps: DependenciasProvisionamiento,
): Promise<void> => {
  const nuevoRol = resolveRoleAfterRegistration(usuario.role, "INVESTOR");
  if (nuevoRol) {
    await deps.actualizarUsuario(usuario.id, { role: nuevoRol });
  }
};

const correoVacio = (modo: ModoEnvio): ResultadoProvisionamiento["correo"] => ({
  enviado: false,
  plantilla: null,
  redirigido: modo.redirige,
  destinatarioReal: modo.destinatarioUnico,
});

/**
 * Anota en las advertencias cuando el correo no llegó a su dueño.
 *
 * Las dos formas de no llegar se reportan distinto a propósito: un fallo de
 * Resend es un fallo; una redirección por `SERVER != PROD` es una cuenta creada
 * cuya contraseña se fue a la bandeja de otra persona, y es justo el fallo que
 * de otro modo sería invisible.
 */
const anotarEnvio = (
  advertencias: string[],
  enviado: boolean,
  modo: ModoEnvio,
): void => {
  if (!enviado) advertencias.push("correo_no_enviado");
  else if (modo.redirige) advertencias.push("correo_redirigido_por_modo_no_prod");
};

/**
 * Deja existiendo la cuenta del portal de este inversionista.
 *
 * Solo manda correo cuando de verdad CREA la cuenta. A quien ya la tenía no se
 * le manda nada: el registro del portal crea la cuenta primero y el
 * inversionista después, así que "ya_tenia" es el caso normal de ese camino y
 * un correo ahí sería ruido. El aviso de empresa agregada es de la otra rama.
 */
export const asegurarCuentaInversionista = async (
  entrada: EntradaCuenta,
  deps: DependenciasProvisionamiento,
): Promise<ResultadoProvisionamiento> => {
  const modo = deps.modoEnvio();
  const advertencias: string[] = [];
  const email = entrada.email.trim().toLowerCase();

  const existente = await resolverUsuario(entrada.dpi, email, deps);

  if (existente) {
    return reconocerExistente(existente, email, advertencias, modo, deps);
  }

  const password = (deps.generarPassword ?? generarPasswordPortal)();

  let creado: { id: string };
  try {
    creado = await deps.crearUsuario({ nombre: entrada.nombre, email, password });
  } catch (error) {
    // Carrera: entre la búsqueda y el insert, otro proceso creó la cuenta.
    // Se vuelve a buscar UNA vez y se reconoce como existente.
    //
    // A diferencia del bulk-import, aquí NO se pisa la contraseña de la cuenta
    // que se encontró: hacerlo le sacaría a alguien su acceso para meterle un
    // inversionista.
    const reintento = await resolverUsuario(entrada.dpi, email, deps);
    if (reintento) {
      return reconocerExistente(reintento, email, advertencias, modo, deps);
    }
    return {
      estado: "fallo",
      usuarioEmail: null,
      resueltoPor: null,
      correo: correoVacio(modo),
      advertencias,
      motivo: error instanceof Error ? error.message : String(error),
    };
  }

  // El rol y el DPI van en un UPDATE posterior porque Better Auth no los acepta
  // en el signUp. El DPI solo si son 13 dígitos: lo demás sería basura en una
  // columna de identidad UNIQUE.
  await deps.actualizarUsuario(creado.id, {
    role: "INVESTOR",
    dpi: normalizarDpiParaGuardar(entrada.dpi),
  });

  const envio = await deps.enviarBienvenida({
    to: email,
    investorName: entrada.nombre,
    password,
    portalUrl: deps.portalUrl,
  });
  anotarEnvio(advertencias, envio.success, modo);

  return {
    estado: "creada",
    usuarioEmail: email,
    resueltoPor: null,
    correo: {
      enviado: envio.success,
      plantilla: "bienvenida",
      redirigido: modo.redirige,
      destinatarioReal: modo.destinatarioUnico,
    },
    advertencias,
    // La contraseña NUNCA sale de aquí: la respuesta termina en cartera.audit_logs.
    motivo: null,
  };
};

const reconocerExistente = async (
  encontrado: { usuario: UsuarioPortal; resueltoPor: "dpi" | "email" },
  emailDeCartera: string,
  advertencias: string[],
  modo: ModoEnvio,
  deps: DependenciasProvisionamiento,
): Promise<ResultadoProvisionamiento> => {
  const { usuario, resueltoPor } = encontrado;

  if (usuario.email.toLowerCase() !== emailDeCartera) {
    // Se reporta y NO se corrige. Reescribir `users.email` le rompería el login
    // a esa persona; cuál de los dos correos es el bueno lo decide un humano.
    advertencias.push("correo_de_cartera_distinto_al_de_la_cuenta");
  }

  await promoverRol(usuario, deps);

  return {
    estado: "ya_tenia",
    usuarioEmail: usuario.email,
    resueltoPor,
    correo: correoVacio(modo),
    advertencias,
    motivo: null,
  };
};

/**
 * Avisa al representante legal de que ahora representa a una empresa más.
 *
 * NUNCA crea una cuenta. Si el representante no tiene, se reporta: darle una
 * cuenta a alguien que no la pidió, a partir de un correo que quizá ni es suyo,
 * es una decisión de identidad que no le toca a un provisionamiento automático.
 */
export const avisarEmpresaAgregada = async (
  entrada: EntradaEmpresa,
  deps: DependenciasProvisionamiento,
): Promise<ResultadoProvisionamiento> => {
  const modo = deps.modoEnvio();
  const advertencias: string[] = [];
  const email = (entrada.representanteEmail ?? "").trim().toLowerCase();

  const existente = await resolverUsuario(entrada.representanteDpi, email, deps);

  if (!existente) {
    return {
      estado: "fallo",
      usuarioEmail: null,
      resueltoPor: null,
      correo: correoVacio(modo),
      advertencias,
      motivo: "representante_sin_cuenta",
    };
  }

  await promoverRol(existente.usuario, deps);

  const envio = await deps.enviarEmpresaAgregada({
    // Al correo de la CUENTA, no al que tenga cartera: es donde esa persona lee.
    to: existente.usuario.email,
    investorName: entrada.representanteNombre,
    companyName: entrada.inversionistaNombre,
    portalUrl: deps.portalUrl,
  });
  anotarEnvio(advertencias, envio.success, modo);

  return {
    estado: "avisada",
    usuarioEmail: existente.usuario.email,
    resueltoPor: existente.resueltoPor,
    correo: {
      enviado: envio.success,
      plantilla: "empresa_agregada",
      redirigido: modo.redirige,
      destinatarioReal: modo.destinatarioUnico,
    },
    advertencias,
    motivo: null,
  };
};

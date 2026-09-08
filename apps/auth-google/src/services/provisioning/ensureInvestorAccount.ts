import {
  generarPasswordPortal,
  normalizarDpiPortal,
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
    cambios: {
      role?: PortalUserType;
      dpi?: string | null;
      /**
       * Marca de "esta contraseña la generamos nosotros". Solo la pone el alta
       * que CREA la cuenta; el cambio de contraseña la limpia.
       */
      passwordProvisionadaAt?: Date | null;
    },
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

/**
 * Solo las dependencias de LECTURA. El tipo es el guard: con esto en la firma,
 * quien lo reciba no tiene con qué crear un usuario, promover un rol ni mandar
 * un correo, aunque alguien lo intente más adelante.
 */
export type DependenciasConsulta = Pick<
  DependenciasProvisionamiento,
  "buscarPorDpi" | "buscarPorEmail"
>;

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
  /** Solo la consulta: DEBERÍA tener cuenta y no la tiene. No se creó nada. */
  | "candidata"
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
  deps: DependenciasConsulta,
): Promise<{ usuario: UsuarioPortal; resueltoPor: "dpi" | "email" } | null> => {
  const dpiBusqueda = normalizarDpiPortal(dpi);
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

/**
 * Sube CLIENT→INVESTOR y nada más. Nunca degrada ni toca un rol administrativo.
 *
 * No propaga el fallo: cuando se llama, la cuenta ya existe. Un throw aquí
 * convertiría "esta persona ya tenía acceso, no pude subirle el rol" en un 500
 * que cartera lee como "no se pudo dar acceso" — falso, y encima pierde el
 * dato de qué fue lo que falló.
 */
const promoverRol = async (
  usuario: UsuarioPortal,
  advertencias: string[],
  deps: DependenciasProvisionamiento,
): Promise<boolean> => {
  const nuevoRol = resolveRoleAfterRegistration(usuario.role, "INVESTOR");
  // Sin nada que promover, el acceso depende de lo que ya era. Un rol ajeno al
  // portal (ADMIN, SELLER) se respeta —no se degrada a nadie— pero tampoco ve
  // inversiones: `useEntidades` solo carga con INVESTOR.
  if (!nuevoRol) return usuario.role === "INVESTOR";

  try {
    await deps.actualizarUsuario(usuario.id, { role: nuevoRol });
    return true;
  } catch {
    advertencias.push("rol_no_promovido");
    return false;
  }
};

/**
 * Envía sin dejar que el envío tire.
 *
 * `enviarBienvenida` promete devolver `{success}`, pero el paquete de correo
 * valida el destinatario con `emailSchema.parse(to)` FUERA de su propio
 * try/catch: un correo que Better Auth aceptó y Zod rechaza tira. Si eso sube,
 * se lleva por delante una cuenta que ya está creada.
 */
const enviarSinTirar = async (
  enviar: () => Promise<ResultadoEnvio>,
): Promise<ResultadoEnvio> => {
  try {
    return await enviar();
  } catch (error) {
    return { success: false, error };
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
    return reconocerExistente(
      existente,
      email,
      entrada.dpi,
      advertencias,
      modo,
      deps,
    );
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
      return reconocerExistente(
        reintento,
        email,
        entrada.dpi,
        advertencias,
        modo,
        deps,
      );
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

  // DE AQUÍ EN ADELANTE LA CUENTA YA EXISTE, y la contraseña solo vive en la
  // variable `password`: no se persiste, no se devuelve y no hay ninguna ruta
  // de reenvío. Cualquier throw a partir de este punto dejaría a una persona
  // con una cuenta que no sabe que tiene y a la que no puede entrar, así que
  // nada de lo que sigue puede tirar: se degrada a una advertencia o se reporta
  // como `fallo`, nunca se propaga.
  //
  // "No tirar" NO quiere decir "seguir siempre": la marca de contraseña
  // provisionada es la única escritura que, si falla, PARA el envío. El porqué
  // está justo abajo.

  // LA MARCA VA SOLA, VA PRIMERO Y NO SE DEGRADA. Es la única de las tres
  // escrituras que no es best-effort, y por eso no puede compartir UPDATE con
  // las otras dos: el de rol/DPI se cae de verdad —23505 sobre `users_dpi_key`,
  // que la prueba de más abajo reproduce— y al caerse arrastraría la marca con
  // él mientras el correo con la contraseña sale igual.
  //
  // Sin marca, `sigueConLaPasswordQueLeDimos` (auth-google) y
  // `debeElegirPassword` (portal-web) leen NULL como "esta contraseña es suya":
  // nadie le pide cambiarla, ni al entrar, ni al completar el registro, ni
  // cuando un humano le repare el rol. La contraseña que mandamos por correo
  // queda de credencial permanente en una bandeja.
  //
  // Va PRIMERO porque desde `crearUsuario` la cuenta ya se puede usar y la
  // marca es el control de seguridad; el rol y el DPI son comodidad. Primero lo
  // que protege, después lo que sirve.
  try {
    await deps.actualizarUsuario(creado.id, { passwordProvisionadaAt: new Date() });
  } catch {
    // FAIL-CLOSED: sin la marca, la contraseña NO sale. Es el único punto donde
    // se elige dejar a alguien sin correo, y se elige porque los dos daños no
    // son comparables: quedarse sin correo lo reporta esta misma respuesta y un
    // humano la vuelve a dar de alta; una contraseña que ya llegó a una bandeja
    // y que nadie va a pedir que se cambie no la recupera nadie. La contraseña
    // muere aquí con la variable local: la cuenta queda sin dueño que pueda
    // entrar, no con un dueño de más.
    advertencias.push("cuenta_creada_sin_marca_de_password");

    return {
      estado: "fallo",
      usuarioEmail: email,
      resueltoPor: null,
      correo: correoVacio(modo),
      advertencias,
      motivo: "no_se_pudo_marcar_password_provisionada",
    };
  }

  // El rol y el DPI van en un UPDATE aparte porque Better Auth no los acepta en
  // el signUp. El DPI se guarda en la MISMA forma canónica con la que se busca:
  // si se guardara distinto, la corrida siguiente no encontraría esta cuenta y
  // le crearía otra a la misma persona.
  try {
    await deps.actualizarUsuario(creado.id, {
      role: "INVESTOR",
      dpi: normalizarDpiPortal(entrada.dpi),
    });
  } catch {
    // Esto SÍ se degrada: la cuenta sirve sin rol ni DPI —se entra igual— y la
    // contraseña todavía se puede entregar, que es lo irrecuperable. El rol lo
    // repara un humano, y la marca de arriba ya quedó puesta.
    advertencias.push("cuenta_creada_sin_rol_ni_dpi");
  }

  const envio = await enviarSinTirar(() =>
    deps.enviarBienvenida({
      to: email,
      investorName: entrada.nombre,
      password,
      portalUrl: deps.portalUrl,
    }),
  );
  anotarEnvio(advertencias, envio.success, modo);

  if (!envio.success) {
    // El caso que de otro modo se vuelve invisible: la cuenta quedó creada y su
    // dueño no tiene cómo entrar ni sabe que existe. Se nombra aparte de
    // `correo_no_enviado` porque en el aviso de empresa ese mismo fallo solo
    // pierde un aviso; aquí pierde el ACCESO, y la corrida de mañana ya lo verá
    // como un "ya tenía cuenta" indistinguible de una cuenta sana.
    advertencias.push("cuenta_creada_sin_contrasena_entregada");
  }

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

/**
 * Las dos advertencias de IDENTIDAD de una cuenta que ya existe.
 *
 * Vive aparte porque la consulta (solo lectura) y el provisionamiento (que
 * además promueve el rol) tienen que reportar exactamente lo mismo: si
 * divergieran, el resumen diario diría una cosa y el alta otra sobre la misma
 * persona.
 */
/**
 * ¿El correo de la cuenta es el mismo con el que cartera la va a encontrar?
 *
 * No es cosmético: el portal resuelve QUÉ inversionistas puede ver una sesión
 * anclando por el correo (`getEntidadesPorCorreo` en cartera corta con
 * `if (ancla.length === 0) return []`). El DPI de la cuenta NO entra en esa
 * resolución. Así que una cuenta cuyo correo no está en ninguna fila de cartera
 * entra al portal y no ve NADA, por más que exista y tenga el rol.
 */
export const correoDeCarteraCoincide = (
  correoDeLaCuenta: string | null | undefined,
  correoDeCartera: string | null | undefined,
): boolean => {
  const cuenta = (correoDeLaCuenta ?? "").trim().toLowerCase();
  const cartera = (correoDeCartera ?? "").trim().toLowerCase();

  return cuenta !== "" && cuenta === cartera;
};

/**
 * ¿Hay algo MÁS que el correo atando esta cuenta a la persona de cartera?
 *
 * `correoDeCarteraCoincide` no sirve para esto cuando la cuenta se resolvió POR
 * correo: se llegó a ella BUSCANDO ese correo, así que la comprobación es
 * tautológica y siempre da `true`. Y el correo es la evidencia más débil que
 * hay aquí — `lib/auth.ts` fija `requireEmailVerification: false`, así que el
 * de la cuenta lo eligió quien se registró y nadie lo comprobó nunca. El de
 * cartera, en cambio, lo escribió el staff. Esa asimetría es todo el problema.
 *
 * Respaldar significa que el DPI de la CUENTA existe y es el de cartera. Los
 * dos en `null` NO respaldan nada: comparados con `===` "coinciden", pero es la
 * ausencia de evidencia, no evidencia. La normalización es la misma de todo el
 * módulo (`normalizarDpiPortal`), la misma que usa el SQL de `dpiLookup.ts`.
 *
 * Sigue sin ser un DPI verificado —también lo teclea quien se registra— pero es
 * el segundo dato independiente que el staff sí tiene en cartera, y es
 * exactamente el mismo listón que el camino por DPI (que además exige el
 * correo). Aquí no se puede pedir más sin verificar el correo.
 */
export const dpiRespaldaLaCuenta = (
  dpiDeLaCuenta: string | null | undefined,
  dpiDeCartera: string | null | undefined,
): boolean => {
  const cuenta = normalizarDpiPortal(dpiDeLaCuenta);

  return cuenta !== null && cuenta === normalizarDpiPortal(dpiDeCartera);
};

/**
 * ¿Promover a esta cuenta implicaría un UPDATE?
 *
 * Es lo que separa "concederle el acceso a alguien" de "reconocer el que ya
 * tenía". A quien ya es INVESTOR esta corrida no le da nada, así que ahí no hay
 * privilegio que proteger; bloquearlo solo llenaría el resumen diario de falsos
 * pendientes (producción tiene cuentas legítimas con `users.dpi` NULL, herencia
 * del normalizador viejo) y dejaría sin avisar a representantes reales.
 */
const promoverEscribiria = (usuario: UsuarioPortal): boolean =>
  resolveRoleAfterRegistration(usuario.role, "INVESTOR") !== null;

const anotarIdentidad = (
  encontrado: { usuario: UsuarioPortal; resueltoPor: "dpi" | "email" },
  emailDeCartera: string,
  dpiDeCartera: string | null,
  advertencias: string[],
): void => {
  const { usuario, resueltoPor } = encontrado;

  if (!correoDeCarteraCoincide(usuario.email, emailDeCartera)) {
    // Se reporta y NO se corrige. Reescribir `users.email` le rompería el login
    // a esa persona; cuál de los dos correos es el bueno lo decide un humano.
    advertencias.push("correo_de_cartera_distinto_al_de_la_cuenta");
  }

  // Vínculo frágil: a esta cuenta se llegó SOLO por el correo, y su `dpi` no es
  // el que tiene cartera (o no tiene ninguno). El día que operaciones corrija
  // ese correo —que es justo lo que pide
  // `correo_de_cartera_distinto_al_de_la_cuenta`— la corrida siguiente no
  // encuentra a esta persona ni por DPI ni por el correo nuevo, y le crea una
  // SEGUNDA cuenta con una segunda contraseña.
  //
  // Se REPORTA y NO se escribe el DPI, misma política que el correo de arriba.
  // Escribirlo cerraría el duplicado y abriría algo peor: `resolverUsuario`
  // busca por DPI PRIMERO, así que la cuenta equivocada ganaría PARA SIEMPRE y
  // corregir el correo dejaría de servir — se cambiaría un síntoma ruidoso y
  // autocorregible por uno silencioso y permanente. Y `users.dpi` no es
  // cosmético: es llave de ESCRITURA contra cartera (POST /api/cartera/investor
  // resuelve la fila objetivo por DPI y le aplica `numero_cuenta`), y es UNIQUE,
  // así que el slot quedaría quemado para la cuenta legítima. Afirmar la
  // identidad MÁS fuerte a partir de la evidencia MÁS débil del módulo —un
  // correo que Better Auth no verifica— no le toca a un provisionamiento
  // automático. Que lo confirme un humano con esta lista en la mano.
  if (resueltoPor === "email" && !dpiRespaldaLaCuenta(usuario.dpi, dpiDeCartera)) {
    advertencias.push("cuenta_anclada_solo_por_correo");
  }
};

const reconocerExistente = async (
  encontrado: { usuario: UsuarioPortal; resueltoPor: "dpi" | "email" },
  emailDeCartera: string,
  dpiDeCartera: string | null,
  advertencias: string[],
  modo: ModoEnvio,
  deps: DependenciasProvisionamiento,
): Promise<ResultadoProvisionamiento> => {
  const { usuario, resueltoPor } = encontrado;

  anotarIdentidad(encontrado, emailDeCartera, dpiDeCartera, advertencias);

  // ESTE ORDEN ES LA SEGURIDAD, no una preferencia de estilo.
  //
  // A esta cuenta se puede haber llegado POR DPI, y un DPI ajeno no cuesta
  // nada: el registro de Better Auth es abierto y no verifica el correo, así
  // que cualquiera se hace una cuenta con SU correo y el DPI de otra persona.
  // El día que el staff provisione a esa otra persona, la búsqueda por DPI
  // —que va primero— aterriza justo en la cuenta del impostor.
  //
  // `promoverRol` ESCRIBE. Y el rol INVESTOR es exactamente la llave que abre
  // la carga de entidades del portal (`useEntidades`). Promover primero y
  // devolver "fallo" después no deshace nada: el UPDATE ya está en la base y
  // el acceso queda concedido con el aviso de que no se concedió.
  //
  // El correo es lo único que ata la cuenta a lo que cartera reconoce
  // (`getEntidadesPorCorreo`), así que mientras no coincida, esta cuenta no
  // gana NADA aquí: se reporta y se sale sin escribir.
  if (!correoDeCarteraCoincide(usuario.email, emailDeCartera)) {
    return {
      estado: "fallo",
      usuarioEmail: usuario.email,
      resueltoPor,
      correo: correoVacio(modo),
      advertencias,
      motivo: "correo_de_cartera_distinto_al_de_la_cuenta",
    };
  }

  // La otra mitad del mismo cierre. Arriba se comprueba el correo, que es lo
  // que ata la cuenta a lo que cartera reconoce; pero si a la cuenta se llegó
  // POR ese correo, la comprobación no dice nada: se buscó justo ese valor.
  //
  // Lo único que queda entonces es un correo que nadie verificó. Cualquiera
  // registra el correo de un inversionista conocido con la contraseña que él
  // elige, y esta llamada le entrega INVESTOR — el rol que habilita la carga de
  // entidades del portal, que ancla por correo. Sin un segundo dato que lo
  // respalde, ese ascenso no lo puede decidir un provisionamiento automático:
  // es la misma política que el módulo ya aplica al DPI unas líneas más abajo.
  //
  // Se corta solo lo que ESCRIBE. A quien ya es INVESTOR se le reconoce igual:
  // esta corrida no le concede nada.
  if (
    resueltoPor === "email" &&
    promoverEscribiria(usuario) &&
    !dpiRespaldaLaCuenta(usuario.dpi, dpiDeCartera)
  ) {
    return {
      estado: "fallo",
      usuarioEmail: usuario.email,
      resueltoPor,
      correo: correoVacio(modo),
      advertencias,
      motivo: "cuenta_anclada_solo_por_correo",
    };
  }

  const tieneAccesoDeInversionista = await promoverRol(
    usuario,
    advertencias,
    deps,
  );

  // Sin el rol, la cuenta entra al portal y no carga ninguna inversión. Es el
  // mismo "existe pero no sirve" del correo: se reporta, no se celebra.
  if (!tieneAccesoDeInversionista) {
    return {
      estado: "fallo",
      usuarioEmail: usuario.email,
      resueltoPor,
      correo: correoVacio(modo),
      advertencias,
      motivo: "sin_rol_de_inversionista",
    };
  }

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
 * ¿Esta persona YA tiene cuenta en el portal? No escribe nada.
 *
 * Es lo único que la reconciliación diaria puede permitirse hacer sobre la
 * tabla entera. `cartera.inversionistas` es escribible por caminos que no
 * prueban identidad (el registro público del portal, y `POST /api/cartera/investor`
 * con cualquier sesión de Better Auth, que es de sign-up abierto), así que una
 * fila —o el CORREO de una fila legítima— puede venir de cualquiera. Mientras
 * eso siga así, "hay una fila que debería tener cuenta" no puede significar
 * "creale la cuenta y mandale la contraseña": significa "que alguien lo mire".
 *
 * El rol NO se promueve aquí aunque la cuenta exista: promover es escribir, y
 * esta función corre sin que nadie haya revisado la fila. Esa promoción es del
 * camino que sí pasa por un humano.
 */
export const consultarCuentaInversionista = async (
  entrada: EntradaCuenta,
  deps: DependenciasConsulta,
): Promise<ResultadoProvisionamiento> => {
  const advertencias: string[] = [];
  const email = entrada.email.trim().toLowerCase();
  const correo = {
    enviado: false,
    plantilla: null,
    redirigido: false,
    destinatarioReal: null,
  } as ResultadoProvisionamiento["correo"];

  const existente = await resolverUsuario(entrada.dpi, email, deps);

  if (!existente) {
    return {
      estado: "candidata",
      usuarioEmail: null,
      resueltoPor: null,
      correo,
      advertencias,
      motivo: null,
    };
  }

  anotarIdentidad(existente, email, entrada.dpi, advertencias);

  // Tener cuenta no es tener acceso. El portal solo carga entidades cuando el
  // rol es INVESTOR (`useEntidades` en portal-web), así que un CLIENT entra y
  // no ve sus inversiones. Contarlo como "ya tenía" además hacía desaparecer de
  // la revisión diaria un ascenso de rol que falló en un alta anterior: el
  // síntoma se tapaba solo.
  if (existente.usuario.role !== "INVESTOR") {
    advertencias.push("cuenta_sin_rol_de_inversionista");
  }

  // Mismo motivo que en el alta: con un correo que cartera no tiene, esta
  // cuenta entra y no ve nada. No es acceso.
  if (!correoDeCarteraCoincide(existente.usuario.email, email)) {
    return {
      estado: "candidata",
      usuarioEmail: existente.usuario.email,
      resueltoPor: existente.resueltoPor,
      correo,
      advertencias,
      motivo: "correo_de_cartera_distinto_al_de_la_cuenta",
    };
  }

  return {
    estado: "ya_tenia",
    usuarioEmail: existente.usuario.email,
    resueltoPor: existente.resueltoPor,
    correo,
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

  // Mismo orden y misma razón que en `reconocerExistente`: la búsqueda por DPI
  // va primero, un DPI ajeno lo pone cualquiera en una cuenta de sign-up
  // abierto, y `promoverRol` escribe el rol que habilita el portal. Se
  // comprueba el correo ANTES de tocar la cuenta.
  if (!correoDeCarteraCoincide(existente.usuario.email, email)) {
    // Este camino ni siquiera lo anotaba: `anotarIdentidad` es del alta.
    advertencias.push("correo_de_cartera_distinto_al_de_la_cuenta");

    return {
      estado: "fallo",
      usuarioEmail: existente.usuario.email,
      resueltoPor: existente.resueltoPor,
      correo: correoVacio(modo),
      advertencias,
      motivo: "correo_de_cartera_distinto_al_de_la_cuenta",
    };
  }

  // Mismo cierre que en `reconocerExistente`: si a la cuenta se llegó por el
  // correo, el correo no prueba nada, y sin un DPI que lo respalde no se
  // escribe el rol. Este camino no pasa por `anotarIdentidad`, así que la
  // advertencia se anota aquí.
  if (
    existente.resueltoPor === "email" &&
    promoverEscribiria(existente.usuario) &&
    !dpiRespaldaLaCuenta(existente.usuario.dpi, entrada.representanteDpi)
  ) {
    advertencias.push("cuenta_anclada_solo_por_correo");

    return {
      estado: "fallo",
      usuarioEmail: existente.usuario.email,
      resueltoPor: existente.resueltoPor,
      correo: correoVacio(modo),
      advertencias,
      motivo: "cuenta_anclada_solo_por_correo",
    };
  }

  const tieneAccesoDeInversionista = await promoverRol(
    existente.usuario,
    advertencias,
    deps,
  );

  // El aviso promete que la empresa aparece al entrar. Sin el rol de
  // inversionista no aparece nada: mandarlo igual es citar a alguien a mirar
  // una pantalla vacía, así que NO se manda y el pendiente queda reportado
  // para que un humano lo cuadre.
  if (!tieneAccesoDeInversionista) {
    return {
      estado: "fallo",
      usuarioEmail: existente.usuario.email,
      resueltoPor: existente.resueltoPor,
      correo: correoVacio(modo),
      advertencias,
      motivo: "sin_rol_de_inversionista",
    };
  }

  const envio = await enviarSinTirar(() =>
    deps.enviarEmpresaAgregada({
      // Al correo de la CUENTA, no al que tenga cartera: ahí lee esa persona.
      to: existente.usuario.email,
      investorName: entrada.representanteNombre,
      companyName: entrada.inversionistaNombre,
      portalUrl: deps.portalUrl,
    }),
  );
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

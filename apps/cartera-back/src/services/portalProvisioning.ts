import {
  decidirProvisionamiento,
  type FilaInversionista,
} from "../utils/functions/provisionamientoPortal";

/**
 * Cliente del provisionamiento de cuentas del portal (cartera-back → auth-google).
 *
 * REGLA DE ORO: esta función NUNCA tira.
 *
 * Cuando se la llama, la fila del inversionista YA está escrita: `insertInvestor`
 * inserta con `db.insert(...).returning()` fuera de transacción, así que no hay
 * rollback que valga. Un throw acá solo puede convertirse en un 500 con el
 * inversionista creado — el peor resultado posible, porque el operador cree que
 * falló y reintenta, y el reintento muere en el guard de duplicados (409) sin
 * volver a pasar nunca por el provisionamiento. Bloquear el alta no arregla el
 * hueco: lo garantiza.
 *
 * Por eso el resultado VIAJA en la respuesta del alta en vez de cambiar su
 * código de estado. Ahí lo levanta `audit_logs` solo, y el job diario lo
 * reintenta si quedó pendiente.
 */

export type EstadoProvisionamientoCartera =
  | "creada"
  | "ya_tenia"
  | "avisada"
  | "omitida"
  /** Solo el dry-run: sería provisionada, pero no se preguntó si ya tiene cuenta. */
  | "candidata"
  | "fallo";

export interface ResultadoProvisionamientoCartera {
  inversionistaId: number;
  estado: EstadoProvisionamientoCartera;
  usuarioEmail: string | null;
  resueltoPor: "dpi" | "email" | null;
  correo: {
    enviado: boolean;
    plantilla: "bienvenida" | "empresa_agregada" | null;
    redirigido: boolean;
    destinatarioReal: string | null;
  };
  advertencias: string[];
  motivo: string | null;
}

export interface OpcionesProvisionamiento {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  secreto?: string;
  timeoutMs?: number;
  /**
   * Solo asegura la CUENTA; no manda el aviso de empresa agregada.
   *
   * Lo usa la reconciliación diaria: no puede distinguir una empresa nueva de
   * una de hace un año, así que avisar desde ahí sería repetirle el mismo
   * correo a los diez representantes todos los días. Ese aviso pertenece al
   * camino de alta, que pasa una sola vez.
   */
  soloAsegurarCuenta?: boolean;
  /** Resuelve al representante legal contra cartera. Recibe el DPI normalizado. */
  buscarRepresentante?: (
    dpiNormalizado: string,
  ) => Promise<{ nombre: string; email: string | null } | null>;
}

/**
 * 8 segundos. Es tiempo de sobra para un insert y un Resend (~300ms) y sigue
 * siendo poco para alguien esperando el alta en un formulario.
 */
const TIMEOUT_POR_DEFECTO_MS = 8_000;

const SIN_CORREO = {
  enviado: false,
  plantilla: null,
  redirigido: false,
  destinatarioReal: null,
} as const;

const resultado = (
  inversionistaId: number,
  estado: EstadoProvisionamientoCartera,
  motivo: string | null = null,
): ResultadoProvisionamientoCartera => ({
  inversionistaId,
  estado,
  usuarioEmail: null,
  resueltoPor: null,
  correo: { ...SIN_CORREO },
  advertencias: [],
  motivo,
});

const llamar = async (
  ruta: string,
  cuerpo: Record<string, unknown>,
  inversionistaId: number,
  opciones: OpcionesProvisionamiento,
): Promise<ResultadoProvisionamientoCartera> => {
  const baseUrl = (opciones.baseUrl ?? process.env.AUTH_GOOGLE_URL ?? "").replace(/\/+$/, "");
  const secreto = opciones.secreto ?? process.env.PORTAL_PROVISIONING_SECRET ?? "";

  // Se comprueba ANTES de salir a la red: un deploy al que le falta la
  // configuración tiene que decirlo, no gastar 8 segundos en un 401.
  if (!baseUrl || !secreto) {
    return resultado(inversionistaId, "fallo", "provisionamiento_no_configurado");
  }

  const fetchImpl = opciones.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS,
  );

  try {
    const respuesta = await fetchImpl(`${baseUrl}${ruta}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Provisioning-Secret": secreto,
      },
      body: JSON.stringify(cuerpo),
      signal: controller.signal,
    });

    if (!respuesta.ok) {
      return resultado(
        inversionistaId,
        "fallo",
        `http_${respuesta.status}`,
      );
    }

    const datos: any = await respuesta.json();

    return {
      inversionistaId,
      estado: datos?.estado ?? "fallo",
      usuarioEmail: datos?.usuarioEmail ?? null,
      resueltoPor: datos?.resueltoPor ?? null,
      correo: { ...SIN_CORREO, ...(datos?.correo ?? {}) },
      advertencias: Array.isArray(datos?.advertencias) ? datos.advertencias : [],
      motivo: datos?.motivo ?? null,
    };
  } catch (error: any) {
    // Incluye el AbortError del timeout. Nada de esto sube: el alta ya ocurrió.
    const motivo = error?.name === "AbortError" ? "timeout" : String(error?.message ?? error);
    return resultado(inversionistaId, "fallo", motivo);
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Deja al inversionista con acceso al portal, o explica por qué no.
 * Nunca tira: el peor resultado que devuelve es `estado: "fallo"` con motivo.
 */
export const provisionarInversionista = async (
  fila: FilaInversionista,
  opciones: OpcionesProvisionamiento = {},
): Promise<ResultadoProvisionamientoCartera> => {
  try {
    const decision = decidirProvisionamiento(fila);

    if (decision.accion === "omitir") {
      // Omitir es un desenlace legítimo y se nombra. Nunca un silencio.
      return resultado(fila.inversionista_id, "omitida", decision.motivo);
    }

    if (decision.accion === "notificar_representante") {
      if (opciones.soloAsegurarCuenta) {
        return resultado(decision.inversionistaId, "omitida", "es_empresa");
      }

      const buscar = opciones.buscarRepresentante;
      const representante = buscar
        ? await buscar(decision.dpiRepresentante)
        : null;

      if (!representante) {
        // No se inventa un destinatario. Que una empresa quede sin avisar es
        // reportable; mandarle el aviso a quien no es, no tiene arreglo.
        return resultado(
          decision.inversionistaId,
          "fallo",
          "representante_no_encontrado_en_cartera",
        );
      }

      // DEPENDE DE QUE EL SELECTOR MULTIENTIDAD YA ESTÉ VIVO.
      //
      // El correo que dispara esta llamada no es vago: promete la función.
      // `PortalCompanyAddedTemplate.tsx` dice "vas a ver esta empresa junto con
      // lo que ya tenías, y puedes cambiar entre una y otra desde el selector
      // del portal". Ese selector lo da `getEntidadesPorCorreo`, que NO está en
      // esta rama: llega con la de multientidad. Sin ella, el representante
      // recibe el aviso, entra, y ve únicamente su propia ficha.
      //
      // Si por lo que sea este camino llega a producción antes que esa
      // expansión: AJUSTAR LA COPIA del correo, NO suprimir el envío. El aviso
      // existe solo en el alta: los otros dos llamadores (`soloAsegurarCuenta`
      // de la reconciliación diaria y `consultarAccesoInversionista`) devuelven
      // "omitida"/"es_empresa" a propósito, así que no hay reenvío. Retenerlo no
      // lo aplaza, lo pierde para siempre en toda empresa creada mientras dure
      // la ventana, y sin backfill posible. Cambiar un ticket de soporte
      // temporal por un silencio irreversible es mal negocio.
      return llamar(
        "/internal/provisioning/notify-company-added",
        {
          representanteEmail: representante.email,
          representanteDpi: decision.dpiRepresentante,
          representanteNombre: representante.nombre,
          inversionistaId: decision.inversionistaId,
          inversionistaNombre: decision.inversionistaNombre,
        },
        decision.inversionistaId,
        opciones,
      );
    }

    return llamar(
      "/internal/provisioning/ensure-investor-account",
      {
        email: decision.email,
        dpi: decision.dpi,
        nombre: decision.nombre,
        inversionistaId: decision.inversionistaId,
        inversionistaNombre: decision.inversionistaNombre,
      },
      decision.inversionistaId,
      opciones,
    );
  } catch (error: any) {
    return resultado(
      fila.inversionista_id,
      "fallo",
      String(error?.message ?? error),
    );
  }
};

/**
 * ¿Este inversionista ya tiene acceso al portal? SOLO LECTURA.
 *
 * Es la mitad del provisionamiento que puede correr sola, todos los días,
 * sobre la tabla entera: pregunta y no escribe. La reconciliación diaria usa
 * ESTA y nunca `provisionarInversionista`.
 *
 * Por qué es una función aparte y no una bandera de `provisionarInversionista`:
 * una bandera se olvida, y el modo de fallo de olvidarla es exactamente el
 * agujero que esto cierra —el job creando cuentas y mandando contraseñas sin
 * que nadie las haya pedido—. Separadas, el job no tiene forma de crear ni por
 * accidente: la ruta que crea no está en su código.
 *
 * NO existe un "degradarse al camino viejo" si el endpoint de consulta no
 * responde: un 404 (auth-google todavía sin desplegar) o un timeout se
 * reportan como `fallo` y la corrida no crea nada. Fallar cerrado aquí cuesta
 * un día de espera; fallar abierto cuesta una cuenta entregada a quien no era.
 */
export const consultarAccesoInversionista = async (
  fila: FilaInversionista,
  opciones: OpcionesProvisionamiento = {},
): Promise<ResultadoProvisionamientoCartera> => {
  try {
    const decision = decidirProvisionamiento(fila);

    if (decision.accion === "omitir") {
      return resultado(fila.inversionista_id, "omitida", decision.motivo);
    }

    // La empresa no recibe cuenta propia: entra con su representante. Aquí ni
    // se pregunta ni se avisa —el aviso es del camino de alta, que pasa una
    // sola vez— así que se omite sin salir a la red.
    if (decision.accion === "notificar_representante") {
      return resultado(decision.inversionistaId, "omitida", "es_empresa");
    }

    return llamar(
      "/internal/provisioning/check-investor-account",
      {
        email: decision.email,
        dpi: decision.dpi,
        nombre: decision.nombre,
        inversionistaId: decision.inversionistaId,
        inversionistaNombre: decision.inversionistaNombre,
      },
      decision.inversionistaId,
      opciones,
    );
  } catch (error: any) {
    return resultado(
      fila.inversionista_id,
      "fallo",
      String(error?.message ?? error),
    );
  }
};

/**
 * El alta creó la fila pero NO pidió acceso al portal.
 *
 * Se nombra en vez de omitirse en silencio: el modo de fallo del guard es un
 * alta legítima a la que se le olvidó mandar `provisionar_portal`, y sin este
 * motivo explícito operaciones vería un alta "correcta" sin acceso y creería
 * que el módulo no sirve. La red de seguridad sigue siendo el job diario, que
 * recoge cualquier fila con nombre y correo sin cuenta.
 */
export const resultadoNoSolicitado = (
  inversionistaId: number,
): ResultadoProvisionamientoCartera =>
  resultado(inversionistaId, "omitida", "no_solicitado");

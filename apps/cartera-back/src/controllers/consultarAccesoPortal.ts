import { eq } from "drizzle-orm";
import { db } from "../database/index";
import { inversionistas } from "../database/db/schema";
import { consultarAccesoInversionista } from "../services/portalProvisioning";

/**
 * ¿Este inversionista ya tiene cuenta en el Portal del Inversionista?
 * SOLO LECTURA. No crea cuentas, no manda correos, no escribe nada.
 *
 * POR QUÉ EXISTE
 * --------------
 * El CRM necesita saberlo para deshabilitar el botón de "Dar acceso al portal"
 * sobre quien ya lo tiene. Hasta ahora la única forma de averiguarlo era
 * APRETAR el botón, que es el camino que crea la cuenta y manda la contraseña:
 * preguntar costaba exactamente lo mismo que actuar.
 *
 * Toda la lógica ya existía —`consultarAccesoInversionista` es la misma puerta
 * de solo lectura que usa la reconciliación diaria— y aquí solo se le pone la
 * tubería HTTP. No se reimplementa nada: en particular, la decisión
 * empresa-vs-persona sigue viviendo en `decidirProvisionamiento`, que para una
 * sociedad contesta `omitida/es_empresa` porque al portal entra su
 * REPRESENTANTE LEGAL y no ella.
 *
 * POR QUÉ PIDE ADMIN
 * ------------------
 * La respuesta revela `usuarioEmail`: el correo de la cuenta del portal, o sea
 * a qué buzón caería la contraseña si alguien apretara el botón. Dejar la
 * consulta más abierta que la escritura (`otorgarAccesoPortal.ts:50`) convertiría
 * este endpoint en el reconocimiento previo del mismo ataque que aquel candado
 * frena. Mismo rol, misma línea.
 *
 * POR QUÉ SE LLAMA `portal-access-status`
 * ---------------------------------------
 * El nombre contiene la subcadena `portal-access` A PROPÓSITO.
 * `carteraProxySuperficie.test.ts` prohíbe esa subcadena en el fuente del proxy
 * de auth-google (`cartera.routes.ts`), así que bautizarla así la deja cubierta
 * por esa misma prueba: NO agregar esta ruta a ese proxy. Ahí quedaría
 * alcanzable con cualquier sesión del portal, y el sign-up de Better Auth está
 * abierto y sin verificar el correo.
 */

const respuestaDeError = (motivo: string, mensaje: string) => ({
  message: mensaje,
  error: motivo,
});

/**
 * Los únicos códigos de `motivo` que salen de acá: los que produce cartera MÁS
 * los que produce el camino de CONSULTA de auth-google.
 *
 * POR QUÉ NO SE DEVUELVE EL `motivo` TAL CUAL
 * -------------------------------------------
 * `consultarAccesoInversionista` y `llamar` embudan cualquier excepción
 * inesperada en `motivo: String(error?.message ?? error)`
 * (portalProvisioning.ts:370-374 y 158-161), y además dejan pasar el `motivo`
 * que venga en el cuerpo de auth-google. O sea: dos fuentes de texto sin
 * vocabulario acotado. Con auth-google inalcanzable, esta consulta contestaba
 * HTTP 200 con `motivo: "getaddrinfo ENOTFOUND auth-google.internal"` — una
 * cadena interna servida en CADA carga de la pantalla del inversionista del
 * CRM, o sea a las once familias de rol que pasan su guard.
 *
 * La regla es "solo lo que cartera nombra", y es una LISTA BLANCA por la misma
 * razón que `tieneCuentaSana` del CRM lo es: enumerar lo peligroso deja pasar
 * lo que todavía no existe, y lo que todavía no existe es justo lo que va a
 * llegar.
 *
 * De dónde sale cada uno:
 *  - `sin_nombre` (utils/functions/provisionamientoPortal.ts, `decidirProvisionamiento`)
 *  - `sin_correo` (idem)
 *  - `es_empresa` (services/portalProvisioning.ts, rama del representante legal)
 *  - `provisionamiento_no_configurado` (idem, antes de salir a la red)
 *  - `timeout` (idem, el AbortError de los 15 s)
 *  - `correo_de_cartera_distinto_al_de_la_cuenta` — este NO es de cartera: lo
 *    devuelve auth-google en `consultarCuentaInversionista`
 *    (services/provisioning/ensureInvestorAccount.ts:657-704), y es el ÚNICO
 *    motivo no nulo que puede salir de `check-investor-account`. Es además el
 *    que más falta hace en esta pantalla: dice que la persona SÍ tiene cuenta,
 *    pero bajo un correo que cartera no reconoce, que es justo por qué el botón
 *    sigue encendido sobre alguien que ya entró. Colapsarlo en `no_reconocido`
 *    borraba el único diagnóstico del camino de lectura.
 *    (El otro motivo de esa ruta, `payload_incompleto`, no llega nunca hasta
 *    acá: viaja con HTTP 400 y `llamar` lo convierte antes en `http_400`
 *    —portalProvisioning.ts:139-145—.)
 * Y `http_<status>` por patrón, porque el status es del propio `llamar` y son
 * tres dígitos: dice que auth-google contestó y con qué, sin nombrar nada de
 * adentro.
 *
 * El camino de ESCRITURA (otorgarAccesoPortal.ts) NO pasa por acá a propósito:
 * el front traduce su `motivo` a castellano con su propia tabla de causas, y
 * ahí el vocabulario completo —incluido el de auth-google— es el insumo.
 */
const MOTIVOS_PUBLICABLES: readonly string[] = [
  "sin_nombre",
  "sin_correo",
  "es_empresa",
  "provisionamiento_no_configurado",
  "timeout",
  "correo_de_cartera_distinto_al_de_la_cuenta",
];

const MOTIVO_HTTP = /^http_\d{3}$/;

/**
 * Lo que no reconocemos se COLAPSA en vez de callarse: `null` diría "no hubo
 * motivo", que sobre un `fallo` es mentira. Esto dice "hubo uno y no es de los
 * nuestros", que es la verdad y además se puede buscar en los logs.
 */
const MOTIVO_NO_RECONOCIDO = "no_reconocido";

/**
 * Las `advertencias` pasan por la MISMA lista blanca que el `motivo`, y por la
 * misma razón: ese arreglo también viene del cuerpo de auth-google y `llamar`
 * solo comprueba `Array.isArray` (portalProvisioning.ts:155), nunca los
 * valores. O sea que hoy lo que venga ahí sale verbatim en CADA carga de la
 * pantalla del inversionista del CRM, que es exactamente lo que el embudo de
 * arriba dejó de hacer con el `motivo`. Media regla no es la regla.
 *
 * Son las tres que produce el camino de LECTURA
 * (`consultarCuentaInversionista` y `anotarIdentidad`,
 * ensureInvestorAccount.ts:509-544 y 691):
 *  - `cuenta_sin_rol_de_inversionista`
 *  - `correo_de_cartera_distinto_al_de_la_cuenta`
 *  - `cuenta_anclada_solo_por_correo`
 *
 * Las demás advertencias del módulo (`rol_no_promovido`, `correo_no_enviado`,
 * `correo_redirigido_por_modo_no_prod`, `cuenta_creada_sin_*`,
 * `parece_sociedad_con_cuenta_propia`) son del camino que CREA, y ese no pasa
 * por acá: `consultarAccesoInversionista` nunca devuelve `creada`. Si alguna
 * apareciera igual, sale nombrada como desconocida en vez de en silencio.
 */
const ADVERTENCIAS_PUBLICABLES: readonly string[] = [
  "cuenta_sin_rol_de_inversionista",
  "correo_de_cartera_distinto_al_de_la_cuenta",
  "cuenta_anclada_solo_por_correo",
];

const ADVERTENCIA_NO_RECONOCIDA = "advertencia_no_reconocida";

/**
 * Se COLAPSA, igual que el motivo, en vez de descartarse: un arreglo vacío
 * diría "esta cuenta no tiene nada raro", y sobre una que sí tiene algo que
 * todavía no sabemos nombrar eso es mentira.
 *
 * Y se deduplica porque el colapso genera repeticiones: veinte advertencias
 * desconocidas son veinte veces el mismo `advertencia_no_reconocida`, y
 * repetirlo no agrega información.
 */
const advertenciasPublicables = (
  // Que SEA un arreglo ya lo garantiza `llamar`
  // (`Array.isArray(datos?.advertencias) ? … : []`, portalProvisioning.ts:155);
  // lo que no mira son los VALORES, y eso es lo de acá.
  advertencias: readonly unknown[],
): string[] => {
  const salida: string[] = [];
  for (const advertencia of advertencias) {
    const codigo =
      typeof advertencia === "string" &&
      ADVERTENCIAS_PUBLICABLES.includes(advertencia)
        ? advertencia
        : ADVERTENCIA_NO_RECONOCIDA;
    if (!salida.includes(codigo)) salida.push(codigo);
  }
  return salida;
};

const motivoPublicable = (motivo: unknown): string | null => {
  if (motivo === null || motivo === undefined) return null;
  if (typeof motivo !== "string") return MOTIVO_NO_RECONOCIDO;
  if (MOTIVOS_PUBLICABLES.includes(motivo)) return motivo;
  if (MOTIVO_HTTP.test(motivo)) return motivo;
  return MOTIVO_NO_RECONOCIDO;
};

export const consultarAccesoPortal = async ({
  query,
  user,
  set,
}: {
  query: Record<string, unknown>;
  user?: { role?: string };
  set: { status?: number };
}) => {
  if (user?.role !== "ADMIN") {
    set.status = 403;
    return respuestaDeError(
      "forbidden",
      "Solo un ADMIN puede consultar accesos al portal",
    );
  }

  const id = Number(query?.inversionista_id);

  if (!Number.isInteger(id) || id <= 0) {
    set.status = 400;
    return respuestaDeError(
      "inversionista_id_invalido",
      "Hay que indicar un inversionista_id válido",
    );
  }

  // Las MISMAS cinco columnas que lee la reconciliación diaria
  // (provisionarCuentasPortal.ts) y el botón de acceso
  // (otorgarAccesoPortal.ts). `dpi_rep_legal` no es opcional: es lo que
  // distingue a una empresa de una persona, y sin él toda sociedad se
  // consultaría como si tuviera cuenta propia.
  const filas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      email: inversionistas.email,
      dpi: inversionistas.dpi,
      dpi_rep_legal: inversionistas.dpi_rep_legal,
    })
    .from(inversionistas)
    .where(eq(inversionistas.inversionista_id, id))
    .limit(1);

  const fila = filas[0];

  if (!fila) {
    // Un id que no existe se NOMBRA. Contestar "no tiene cuenta" dejaría al CRM
    // ofreciendo un botón sobre una fila que no está.
    set.status = 404;
    return respuestaDeError(
      "inversionista_no_encontrado",
      "No existe ese inversionista",
    );
  }

  const resultado = await consultarAccesoInversionista(fila);

  // `correo` no viaja: esta consulta nunca manda ninguno, así que devolver el
  // bloque vacío solo invitaría a leerlo como si dijera algo.
  return {
    estado: resultado.estado,
    usuarioEmail: resultado.usuarioEmail,
    resueltoPor: resultado.resueltoPor,
    // Por la lista blanca de advertencias: tampoco por acá sale texto que
    // cartera no nombre.
    advertencias: advertenciasPublicables(resultado.advertencias),
    // Por la lista blanca de arriba: nunca un mensaje de excepción crudo.
    motivo: motivoPublicable(resultado.motivo),
  };
};

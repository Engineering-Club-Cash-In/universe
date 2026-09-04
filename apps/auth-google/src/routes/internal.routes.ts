import { Hono } from "hono";
import { provisioningSecretGuard } from "../middleware/provisioningSecret";
import { dependenciasReales } from "../services/provisioning/deps";
import {
  asegurarCuentaInversionista,
  avisarEmpresaAgregada,
  consultarCuentaInversionista,
} from "../services/provisioning/ensureInvestorAccount";

/**
 * Endpoint interno de provisionamiento. Servicio a servicio: cartera-back es el
 * único que lo llama, y entra con un secreto compartido, no con sesión.
 *
 * Va montado FUERA de `/api/*` a propósito: ahí se aplica `apiLimiter`, que
 * cortaría a 100 req / 15 min por IP. cartera-back sale por una sola IP, así
 * que el backfill o un import masivo se estrellarían contra su propio límite.
 */
const internalRoutes = new Hono();

internalRoutes.use("*", provisioningSecretGuard);

const numero = (valor: unknown): number | null => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const texto = (valor: unknown): string =>
  typeof valor === "string" ? valor.trim() : "";

/**
 * Asegura que exista la cuenta del portal de un inversionista.
 *
 * Responde 200 SIEMPRE que el secreto sea válido: el resultado va en el cuerpo.
 * Un 500 aquí haría que cartera creyera que el alta falló, cuando el
 * inversionista ya quedó escrito y lo único pendiente es el acceso.
 */
internalRoutes.post("/provisioning/ensure-investor-account", async (c) => {
  const body = await c.req.json().catch(() => null);

  const email = texto(body?.email).toLowerCase();
  const nombre = texto(body?.nombre);
  const inversionistaId = numero(body?.inversionistaId);

  if (!email || !nombre || inversionistaId === null) {
    return c.json(
      {
        estado: "fallo",
        usuarioEmail: null,
        resueltoPor: null,
        correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
        advertencias: [],
        motivo: "payload_incompleto",
      },
      400,
    );
  }

  const resultado = await asegurarCuentaInversionista(
    {
      email,
      nombre,
      dpi: body?.dpi != null ? String(body.dpi) : null,
      inversionistaId,
      inversionistaNombre: texto(body?.inversionistaNombre) || nombre,
    },
    dependenciasReales(),
  );

  return c.json(resultado);
});

/**
 * ¿Este inversionista ya tiene cuenta del portal? SOLO LECTURA.
 *
 * Es la ruta por la que pasa la reconciliación diaria. Está separada de
 * `ensure-investor-account` a propósito y no es una bandera de aquella: el job
 * recorre la tabla ENTERA todos los días, y `cartera.inversionistas` se puede
 * escribir desde caminos que no prueban identidad. Con una bandera, un olvido
 * o un default mal puesto vuelve a convertir ese recorrido en un reparto
 * automático de contraseñas; con dos rutas, el job no tiene forma de crear.
 */
internalRoutes.post("/provisioning/check-investor-account", async (c) => {
  const body = await c.req.json().catch(() => null);

  const email = texto(body?.email).toLowerCase();
  const nombre = texto(body?.nombre);
  const inversionistaId = numero(body?.inversionistaId);

  if (!email || !nombre || inversionistaId === null) {
    return c.json(
      {
        estado: "fallo",
        usuarioEmail: null,
        resueltoPor: null,
        correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
        advertencias: [],
        motivo: "payload_incompleto",
      },
      400,
    );
  }

  // Se le pasan SOLO las dependencias de lectura. Las de escritura ni entran.
  const { buscarPorDpi, buscarPorEmail } = dependenciasReales();

  const resultado = await consultarCuentaInversionista(
    {
      email,
      nombre,
      dpi: body?.dpi != null ? String(body.dpi) : null,
      inversionistaId,
      inversionistaNombre: texto(body?.inversionistaNombre) || nombre,
    },
    { buscarPorDpi, buscarPorEmail },
  );

  return c.json(resultado);
});

/**
 * Avisa al representante legal de que ahora representa una empresa más.
 * Nunca crea cuentas: si el representante no tiene, lo dice en el cuerpo.
 */
internalRoutes.post("/provisioning/notify-company-added", async (c) => {
  const body = await c.req.json().catch(() => null);

  const inversionistaId = numero(body?.inversionistaId);
  const inversionistaNombre = texto(body?.inversionistaNombre);

  if (!inversionistaNombre || inversionistaId === null) {
    return c.json(
      {
        estado: "fallo",
        usuarioEmail: null,
        resueltoPor: null,
        correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
        advertencias: [],
        motivo: "payload_incompleto",
      },
      400,
    );
  }

  const resultado = await avisarEmpresaAgregada(
    {
      representanteEmail: texto(body?.representanteEmail).toLowerCase() || null,
      representanteDpi:
        body?.representanteDpi != null ? String(body.representanteDpi) : null,
      representanteNombre: texto(body?.representanteNombre) || "Inversionista",
      inversionistaId,
      inversionistaNombre,
    },
    dependenciasReales(),
  );

  return c.json(resultado);
});

export default internalRoutes;

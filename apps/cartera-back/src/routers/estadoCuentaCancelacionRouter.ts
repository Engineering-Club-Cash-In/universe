import { Elysia } from "elysia";
import { z } from "zod";
import { authMiddleware } from "./midleware";
import { PreviewEstadoCuentaBodySchema } from "../controllers/estadoCuentaCancelacionCalculo";
import {
  abrirEnlaceEstadoCuenta,
  enviarEstadoCuenta,
  generarPreviewEstadoCuenta,
  obtenerContactosEstadoCuenta,
  obtenerPdfEstadoCuenta,
  type EstadoCuentaCancelacionDeps,
} from "../controllers/estadoCuentaCancelacionService";

// ================================================================
// Rutas del estado de cuenta al solicitar la cancelación de un crédito.
//
// Permisos (sección 3 del plan): ADMIN y ASESOR; CONTA y cualquier otro rol,
// 403. `authMiddleware` solo autentica (401 sin sesión); el rol se exige aquí,
// en el servidor, con el `role` del JWT. El actor (`id`) también sale del JWT,
// nunca del body. No hay restricción por asesor asignado: hoy la acción solo
// mira rol y estado.
//
// La única ruta SIN sesión es el enlace público `/ec/:codigo` (router aparte,
// `createEnlacePublicoEstadoCuentaRouter`): la abre el cliente desde WhatsApp y
// solo entrega el PDF de ese enlace mientras no venza.
//
// Fábrica con dependencias inyectadas: los tests montan el router con BD, R2 y
// CRM simulados. La instancia real vive en `estadoCuentaCancelacion.ts`.
// ================================================================

export const ROLES_ESTADO_CUENTA_CANCELACION = ["ADMIN", "ASESOR"];

const BASE = "/credit/:creditId/cancelacion/estado-cuenta";

const ParamsCredito = z.object({ creditId: z.coerce.number().int().positive() });
const ParamsDocumento = ParamsCredito.extend({ documentoId: z.string().uuid() });
const EnviarBodySchema = z
  .object({
    destinatarioTelefono: z.string().trim().min(8, "Teléfono inválido").max(20),
    intentoId: z.string().uuid("intentoId debe ser un UUID"),
  })
  .strict();

/** Devuelve el id del actor, o null tras dejar 403 en `set`. */
const exigirRol = (user: any, set: any): number | null => {
  if (!user || !ROLES_ESTADO_CUENTA_CANCELACION.includes(user.role)) {
    set.status = 403;
    return null;
  }
  const id = Number(user.id);
  if (!Number.isInteger(id) || id <= 0) {
    set.status = 403;
    return null;
  }
  return id;
};

const NO_AUTORIZADO = { message: "No autorizado (requiere ADMIN o ASESOR)." };

const invalido = (set: any, error: z.ZodError) => {
  set.status = 400;
  return { message: "[ERROR] Parámetros inválidos", issues: error.flatten() };
};

export const createEstadoCuentaCancelacionRouter = (deps: EstadoCuentaCancelacionDeps) =>
  new Elysia()
    .use(authMiddleware)

    // Genera un documento NUEVO por clic. No cambia el estado del crédito, no
    // crea pagos ni `credit_cancelations`.
    .post(`${BASE}/preview`, async ({ params, body, set, user }: any) => {
      const usuarioId = exigirRol(user, set);
      if (usuarioId === null) return NO_AUTORIZADO;

      const p = ParamsCredito.safeParse(params);
      if (!p.success) return invalido(set, p.error);
      const b = PreviewEstadoCuentaBodySchema.safeParse(body);
      if (!b.success) return invalido(set, b.error);

      try {
        const r = await generarPreviewEstadoCuenta(deps, {
          creditoId: p.data.creditId,
          usuarioId,
          body: b.data,
        });
        if (!r.ok) {
          set.status = r.status;
          return { message: r.message };
        }
        return r.data;
      } catch (error) {
        console.error("[estadoCuentaCancelacion/preview] Error:", error);
        set.status = 500;
        return { message: "Error generando el estado de cuenta." };
      }
    })

    // Sirve los bytes del PDF guardado (verificado por SHA-256). Accesible
    // aunque el crédito ya esté PENDIENTE_CANCELACION o CANCELADO.
    .get(`${BASE}/:documentoId/pdf`, async ({ params, set, user }: any) => {
      if (exigirRol(user, set) === null) return NO_AUTORIZADO;

      const p = ParamsDocumento.safeParse(params);
      if (!p.success) return invalido(set, p.error);

      try {
        const r = await obtenerPdfEstadoCuenta(deps, {
          creditoId: p.data.creditId,
          documentoId: p.data.documentoId,
        });
        if (!r.ok) {
          set.status = r.status;
          return { message: r.message };
        }
        return new Response(new Uint8Array(r.data.bytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${r.data.filename}"`,
            "Cache-Control": "private, no-store",
          },
        });
      } catch (error) {
        console.error("[estadoCuentaCancelacion/pdf] Error:", error);
        set.status = 500;
        return { message: "Error recuperando el estado de cuenta." };
      }
    })

    // Celulares del cliente según el CRM, en el orden de Cobros.
    .get(`${BASE}/contactos`, async ({ params, set, user }: any) => {
      if (exigirRol(user, set) === null) return NO_AUTORIZADO;

      const p = ParamsCredito.safeParse(params);
      if (!p.success) return invalido(set, p.error);

      try {
        const r = await obtenerContactosEstadoCuenta(deps, { creditoId: p.data.creditId });
        if (!r.ok) {
          set.status = r.status;
          return { message: r.message };
        }
        return r.data;
      } catch (error) {
        console.error("[estadoCuentaCancelacion/contactos] Error:", error);
        set.status = 500;
        return { message: "Error consultando los teléfonos del cliente." };
      }
    })

    // Envía por WhatsApp (vía CRM) un enlace al PDF guardado. Solo a un número
    // registrado del cliente. Idempotente por `intentoId`. El resultado del
    // envío va separado: este endpoint no toca la cancelación.
    .post(`${BASE}/:documentoId/enviar`, async ({ params, body, set, user }: any) => {
      const usuarioId = exigirRol(user, set);
      if (usuarioId === null) return NO_AUTORIZADO;

      const p = ParamsDocumento.safeParse(params);
      if (!p.success) return invalido(set, p.error);
      const b = EnviarBodySchema.safeParse(body);
      if (!b.success) return invalido(set, b.error);

      try {
        const r = await enviarEstadoCuenta(deps, {
          creditoId: p.data.creditId,
          documentoId: p.data.documentoId,
          usuarioId,
          destinatarioTelefono: b.data.destinatarioTelefono,
          intentoId: b.data.intentoId,
        });
        if (!r.ok) {
          set.status = r.status;
          return { message: r.message };
        }
        return { envio: r.data };
      } catch (error) {
        console.error("[estadoCuentaCancelacion/enviar] Error:", error);
        set.status = 500;
        return { message: "Error enviando el estado de cuenta. Revisa manualmente antes de reintentar." };
      }
    });

// ================================================================
// Enlace público `/ec/:codigo` — SIN sesión.
//
// Lo abre el cliente desde WhatsApp. Responde el PDF (inline) o una página
// corta si el enlace no existe, venció o fue anulado.
//
// La protección es el código: 128 bits, guardado solo como hash y con
// vencimiento; no se puede adivinar. El límite por IP es una capa extra contra
// quien pruebe códigos al azar, y SOLO afecta a códigos inexistentes: se cuentan
// solo esos, y una IP bloqueada recibe 429 únicamente cuando el código no
// existe. Un enlace válido, vencido o anulado responde siempre igual, aunque
// otra persona detrás de la misma IP haya agotado el cupo.
// El contador vive en memoria de cada proceso.
// ================================================================

export const LIMITE_ENLACE = { intentos: 30, ventanaMs: 10 * 60 * 1000 };

export interface LimitadorEnlace {
  /** true si la IP agotó sus intentos fallidos en la ventana actual. */
  bloqueado(clave: string): boolean;
  /** Anota un código inexistente probado desde esa IP. */
  registrarFallo(clave: string): void;
}

/** Límite en memoria por IP (ventana fija), solo sobre intentos fallidos. */
export function crearLimitador(limite = LIMITE_ENLACE, ahora: () => number = Date.now): LimitadorEnlace {
  const registros = new Map<string, { desde: number; n: number }>();
  const vigente = (clave: string) => {
    const t = ahora();
    if (registros.size > 10_000) {
      for (const [k, r] of registros) if (t - r.desde > limite.ventanaMs) registros.delete(k);
    }
    const r = registros.get(clave);
    return r && t - r.desde <= limite.ventanaMs ? r : null;
  };
  return {
    bloqueado: (clave) => (vigente(clave)?.n ?? 0) >= limite.intentos,
    registrarFallo: (clave) => {
      const r = vigente(clave);
      if (r) r.n += 1;
      else registros.set(clave, { desde: ahora(), n: 1 });
    },
  };
}

const paginaEnlace = (titulo: string, texto: string) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${titulo} · Club Cash-In</title>
<style>body{margin:0;font-family:Arial,sans-serif;background:#f4f6f9;color:#333;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{background:#fff;border-radius:12px;padding:28px 24px;max-width:420px;margin:16px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.08)}
h1{font-size:20px;color:#1F4E79;margin:0 0 12px}p{font-size:15px;line-height:1.5;margin:0}</style></head>
<body><div class="c"><h1>${titulo}</h1><p>${texto}</p></div></body></html>`;

const PAGINAS = {
  NO_EXISTE: ["Enlace no disponible", "Este enlace no es válido. Comunícate con tu asesor de Club Cash-In."],
  VENCIDO: ["Enlace vencido", "Este enlace ya no está disponible. Comunícate con tu asesor de Club Cash-In para recibir uno nuevo."],
  ANULADO: ["Enlace no disponible", "Este enlace ya no está disponible. Comunícate con tu asesor de Club Cash-In."],
  ERROR: ["No pudimos abrir el documento", "Intenta de nuevo en unos minutos. Si el problema continúa, comunícate con tu asesor de Club Cash-In."],
  LIMITE: ["Demasiados intentos", "Espera unos minutos e intenta de nuevo."],
} as const;

const CABECERAS_PUBLICAS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const respuestaPagina = (status: number, clave: keyof typeof PAGINAS) =>
  new Response(paginaEnlace(PAGINAS[clave][0], PAGINAS[clave][1]), {
    status,
    headers: { ...CABECERAS_PUBLICAS, "Content-Type": "text/html; charset=utf-8" },
  });

/**
 * IP del cliente: la ÚLTIMA de `X-Forwarded-For`, que es la que agrega nuestro
 * proxy. Las anteriores las puede escribir cualquiera, así que no se usan.
 * Sin proxy, la IP de la conexión.
 */
export const ipDe = (request: Request, server: any): string => {
  const reenviadas = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  return (
    reenviadas[reenviadas.length - 1] ||
    server?.requestIP?.(request)?.address ||
    "desconocida"
  );
};

export const createEnlacePublicoEstadoCuentaRouter = (
  deps: EstadoCuentaCancelacionDeps,
  limitador: LimitadorEnlace = crearLimitador()
) =>
  new Elysia().get("/ec/:codigo", async ({ params, request, server }: any) => {
    const ip = ipDe(request, server);
    try {
      // Primero el código: un enlace real nunca se bloquea por la IP.
      const r = await abrirEnlaceEstadoCuenta(deps, { codigo: String(params.codigo ?? "") });
      if (!r.ok) {
        if (r.motivo === "NO_EXISTE") {
          if (limitador.bloqueado(ip)) return respuestaPagina(429, "LIMITE");
          limitador.registrarFallo(ip);
        }
        return respuestaPagina(r.status, r.motivo);
      }
      return new Response(new Uint8Array(r.bytes), {
        headers: {
          ...CABECERAS_PUBLICAS,
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${r.filename}"`,
        },
      });
    } catch (error) {
      console.error("[estadoCuentaCancelacion/enlace] Error:", error);
      return respuestaPagina(500, "ERROR");
    }
  });

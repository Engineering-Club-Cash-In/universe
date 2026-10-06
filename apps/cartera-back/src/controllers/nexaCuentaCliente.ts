/**
 * Cuenta Nexa del cliente: el token de pago de Banco Nexa ligado a un crédito.
 *
 * El CRM la pide al cerrar el crédito al 90% (`POST /creditos/cuenta-nexa`)
 * para incluirla en la bienvenida. Cartera es la dueña del dato: lo guarda en
 * `nexa_credit_bindings` junto con el permiso para recibir pagos de Nexa, y el
 * CRM no guarda copia (la pide acá cada vez que la necesita).
 *
 * Flujo, siempre bajo el candado de la fila del binding del crédito:
 *   1. Se marca la fila como manejada por la automatización
 *      (`cuenta_solicitada_at`) y se guarda el DPI para poder reintentar.
 *   2. Si ya hay token, se devuelve tal cual (idempotente).
 *   3. Si no, se le pide a nexa-server (también idempotente por crédito) y se
 *      guarda. Si falla, se anota el intento y queda pendiente: el barrido de
 *      reintentos la vuelve a pedir y le avisa al cliente por separado.
 *
 * Un binding nuevo nace activo y sin monto máximo ni vencimiento: es solo el
 * permiso para que cartera acepte pagos de Nexa en ese crédito. Uno que ya
 * existía conserva su `activo` y sus límites (si alguien lo apagó, sigue así).
 */

import { and, eq, sql } from "drizzle-orm";
import config from "../config";
import { db } from "../database";
import { creditos, nexa_credit_bindings, usuarios } from "../database/db";
import { crearTokenUserNexa, type TokenUserNexa } from "../services/nexaServerClient";

export type CuentaNexa = {
  token: string;
  identifier: string;
  nexaUserId: number;
};

export type ResultadoCuentaNexa =
  | { estado: "deshabilitada" }
  | { estado: "credito_no_encontrado" }
  | { estado: "dpi_invalido" }
  | { estado: "lista"; creditoId: number; cuenta: CuentaNexa; nueva: boolean; notificada: boolean }
  | { estado: "pendiente"; creditoId: number; error: string };

type BindingCuenta = {
  nexa_token: string | null;
  nexa_identifier: string | null;
  nexa_user_id: number | null;
  nexa_national_id: string | null;
  cuenta_notificada_at: Date | null;
};

/** Lo que el servicio necesita de afuera; las pruebas lo reemplazan. */
export type CuentaNexaDeps = {
  habilitada: boolean;
  buscarCredito: (numeroSifco: string) => Promise<{ creditoId: number; nombre: string } | null>;
  /** Corre `work` con la fila del binding bloqueada (la crea si no existe). */
  conBindingBloqueado: <T>(
    creditoId: number,
    dpi: string | null,
    work: (binding: BindingCuenta, ops: OperacionesBinding) => Promise<T>,
  ) => Promise<T>;
  crearTokenUser: (params: { creditoId: number; description: string; nationalId: string }) => Promise<TokenUserNexa>;
};

export type OperacionesBinding = {
  guardarToken: (user: TokenUserNexa) => Promise<void>;
  anotarError: (mensaje: string) => Promise<void>;
};

/** CUI guatemalteco: 13 dígitos. Se aceptan espacios y guiones al escribirlo. */
export function normalizarDpi(dpi: string | null | undefined): string | null {
  const limpio = (dpi ?? "").replace(/[\s-]/g, "");
  return /^\d{13}$/.test(limpio) ? limpio : null;
}

export function descripcionCuentaNexa(numeroSifco: string, nombre: string): string {
  return `Crédito ${numeroSifco} · ${nombre}`.replace(/\s+/g, " ").trim().slice(0, 80);
}

function cuentaDe(binding: BindingCuenta): CuentaNexa | null {
  if (!binding.nexa_token || !binding.nexa_identifier || binding.nexa_user_id == null) return null;
  return {
    token: binding.nexa_token,
    identifier: binding.nexa_identifier,
    nexaUserId: binding.nexa_user_id,
  };
}

/**
 * Devuelve la cuenta Nexa del crédito, creándola si hace falta. `dpi` puede
 * venir vacío en un reintento: se usa el que quedó guardado.
 */
export async function solicitarCuentaNexa(
  params: { numeroSifco: string; dpi?: string | null },
  deps: CuentaNexaDeps,
): Promise<ResultadoCuentaNexa> {
  if (!deps.habilitada) return { estado: "deshabilitada" };

  const credito = await deps.buscarCredito(params.numeroSifco);
  if (!credito) return { estado: "credito_no_encontrado" };

  const dpiNuevo = params.dpi == null || params.dpi === "" ? null : normalizarDpi(params.dpi);
  if (params.dpi && !dpiNuevo) return { estado: "dpi_invalido" };

  return deps.conBindingBloqueado(credito.creditoId, dpiNuevo, async (binding, ops) => {
    const existente = cuentaDe(binding);
    if (existente) {
      return {
        estado: "lista" as const,
        creditoId: credito.creditoId,
        cuenta: existente,
        nueva: false,
        notificada: binding.cuenta_notificada_at !== null,
      };
    }

    const dpi = dpiNuevo ?? binding.nexa_national_id;
    if (!dpi) {
      const error = "Falta el DPI del cliente para crear la cuenta Nexa.";
      await ops.anotarError(error);
      return { estado: "pendiente" as const, creditoId: credito.creditoId, error };
    }

    try {
      const user = await deps.crearTokenUser({
        creditoId: credito.creditoId,
        description: descripcionCuentaNexa(params.numeroSifco, credito.nombre),
        nationalId: dpi,
      });
      await ops.guardarToken(user);
      return {
        estado: "lista" as const,
        creditoId: credito.creditoId,
        cuenta: { token: user.token, identifier: user.identifier, nexaUserId: user.nexaUserId },
        nueva: true,
        notificada: false,
      };
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await ops.anotarError(error);
      return { estado: "pendiente" as const, creditoId: credito.creditoId, error };
    }
  });
}

/** Marca que el cliente ya recibió su cuenta (en la bienvenida o aparte). */
export async function marcarCuentaNexaNotificada(numeroSifco: string): Promise<boolean> {
  const [credito] = await db
    .select({ creditoId: creditos.credito_id })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numeroSifco))
    .limit(1);
  if (!credito) return false;
  const marcadas = await db
    .update(nexa_credit_bindings)
    .set({ cuenta_notificada_at: sql`COALESCE(${nexa_credit_bindings.cuenta_notificada_at}, now())`, updated_at: new Date() })
    .where(and(
      eq(nexa_credit_bindings.credito_id, credito.creditoId),
      sql`${nexa_credit_bindings.nexa_token} IS NOT NULL`,
    ))
    .returning({ creditoId: nexa_credit_bindings.credito_id });
  return marcadas.length > 0;
}

export const cuentaNexaDeps: CuentaNexaDeps = {
  get habilitada() {
    return config.nexaCuentaAutomaticaEnabled;
  },
  buscarCredito: async (numeroSifco) => {
    const [row] = await db
      .select({ creditoId: creditos.credito_id, nombre: usuarios.nombre })
      .from(creditos)
      .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .where(eq(creditos.numero_credito_sifco, numeroSifco))
      .limit(1);
    return row ?? null;
  },
  conBindingBloqueado: (creditoId, dpi, work) =>
    db.transaction(async (tx) => {
      // Crea la fila si no existe y la marca como de la automatización. No toca
      // `activo`, `expires_at` ni `max_payment_amount` de un binding que ya
      // existía (los del piloto se configuraron a mano).
      await tx
        .insert(nexa_credit_bindings)
        .values({
          credito_id: creditoId,
          nexa_national_id: dpi,
          cuenta_solicitada_at: new Date(),
        })
        .onConflictDoUpdate({
          target: nexa_credit_bindings.credito_id,
          set: {
            nexa_national_id: dpi ?? sql`${nexa_credit_bindings.nexa_national_id}`,
            cuenta_solicitada_at: sql`COALESCE(${nexa_credit_bindings.cuenta_solicitada_at}, now())`,
            updated_at: new Date(),
          },
        });
      const [binding] = await tx
        .select({
          nexa_token: nexa_credit_bindings.nexa_token,
          nexa_identifier: nexa_credit_bindings.nexa_identifier,
          nexa_user_id: nexa_credit_bindings.nexa_user_id,
          nexa_national_id: nexa_credit_bindings.nexa_national_id,
          cuenta_notificada_at: nexa_credit_bindings.cuenta_notificada_at,
        })
        .from(nexa_credit_bindings)
        .where(eq(nexa_credit_bindings.credito_id, creditoId))
        .for("update");
      if (!binding) throw new Error(`binding Nexa del crédito ${creditoId} no encontrado tras crearlo`);
      return work(binding, {
        guardarToken: async (user) => {
          await tx
            .update(nexa_credit_bindings)
            .set({
              nexa_user_id: user.nexaUserId,
              nexa_identifier: user.identifier,
              nexa_token: user.token,
              // `activo` no se toca: un binding nuevo nace activo (default) y
              // uno existente que alguien apagó a mano tiene que seguir apagado.
              cuenta_error: null,
              cuenta_intentos: sql`${nexa_credit_bindings.cuenta_intentos} + 1`,
              updated_at: new Date(),
            })
            .where(eq(nexa_credit_bindings.credito_id, creditoId));
        },
        anotarError: async (mensaje) => {
          await tx
            .update(nexa_credit_bindings)
            .set({
              cuenta_error: mensaje,
              cuenta_intentos: sql`${nexa_credit_bindings.cuenta_intentos} + 1`,
              updated_at: new Date(),
            })
            .where(eq(nexa_credit_bindings.credito_id, creditoId));
        },
      });
    }),
  crearTokenUser: (params) =>
    crearTokenUserNexa(params, { baseUrl: config.nexaServerUrl, apiKey: config.nexaAdminApiKey }),
};

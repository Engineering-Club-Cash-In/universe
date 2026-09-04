import { describe, expect, it, mock } from "bun:test";

/**
 * El job del portal es el único de los tres jobs de correo del repo que no
 * inspeccionaba el resultado del envío. `sendPlainEmail` NO tira cuando Resend
 * rechaza: resuelve `{ success:false, error }` (packages/email/src/index.ts:1113).
 * Descartar ese valor hacía que la corrida se registrara como `completed` y que
 * el resumen —con las cuentas creadas sin contraseña entregada— se perdiera para
 * siempre: desde la corrida siguiente esas cuentas responden "ya_tenia" y solo
 * suman a un contador, indistinguibles de una cuenta sana.
 */

let filas: any[] = [];

mock.module("../database/index", () => ({
  client: {},
  lockPool: {},
  db: {
    select: () => ({
      from: () => ({ orderBy: () => Promise.resolve(filas) }),
    }),
  },
}));

mock.module("@cci/email", () => ({
  sendPlainEmail: mock(() => Promise.resolve({ success: true })),
}));

let resultadoDoble: any;
mock.module("../services/portalProvisioning", () => ({
  provisionarInversionista: mock(async () => resultadoDoble),
}));

const { provisionarCuentasPortal } = await import("./provisionarCuentasPortal");

const CREADA = {
  inversionistaId: 7,
  estado: "creada",
  usuarioEmail: "ana@example.com",
  resueltoPor: null,
  correo: {
    enviado: false,
    plantilla: "bienvenida",
    redirigido: false,
    destinatarioReal: null,
  },
  advertencias: ["correo_no_enviado", "cuenta_creada_sin_contrasena_entregada"],
  motivo: null,
};

const preparar = (over: any = {}) => {
  filas = [
    {
      inversionista_id: 7,
      nombre: "Ana Pérez",
      email: "ana@example.com",
      dpi: 1234567890101,
      dpi_rep_legal: null,
    },
  ];
  resultadoDoble = { ...CREADA, ...over };
};

describe("provisionarCuentasPortal: el resumen que no sale", () => {
  it("tira cuando Resend rechaza el resumen, para que la corrida no diga 'completed'", async () => {
    preparar();
    const enviarResumen = mock(async () => ({
      success: false,
      error: { name: "rate_limit_exceeded" },
    }));

    await expect(provisionarCuentasPortal({ enviarResumen })).rejects.toThrow(
      /resumen de provisionamiento/i,
    );
    expect(enviarResumen).toHaveBeenCalledTimes(1);
  });

  it("un envío bueno no tira", async () => {
    preparar();
    const enviarResumen = mock(async () => ({ success: true }));

    const resumen = await provisionarCuentasPortal({ enviarResumen });
    expect(resumen.accesosPerdidos.length).toBe(1);
  });

  it("un doble que no devuelve nada tampoco tira", async () => {
    // `OpcionesJob.enviarResumen` estaba tipado `Promise<unknown>`: hay dobles
    // que resuelven undefined. Solo `success === false` es un fallo declarado.
    preparar();
    const resumen = await provisionarCuentasPortal({
      enviarResumen: (async () => undefined) as any,
    });
    expect(resumen.accesosPerdidos.length).toBe(1);
  });

  it("deja lo irrecuperable en los logs ANTES de intentar el correo", async () => {
    // Tirar solo cambia el evento del job a `failed` con `error_code:"unknown"`
    // (structuredLogger.ts:704-722): el CONTENIDO del resumen no queda en
    // ningún lado. Sin esto, el incidente no es reconstruible ni sabiendo que
    // ocurrió.
    preparar();
    const orden: string[] = [];
    const original = console.error;
    const capturado: string[] = [];
    console.error = (...args: unknown[]) => {
      orden.push("log");
      capturado.push(args.map(String).join(" "));
    };

    try {
      await provisionarCuentasPortal({
        enviarResumen: async () => {
          orden.push("envio");
          return { success: false, error: "boom" };
        },
      }).catch(() => {});
    } finally {
      console.error = original;
    }

    expect(orden[0]).toBe("log");
    expect(capturado.join("\n")).toContain("IRRECUPERABLE");
    expect(capturado.join("\n")).toContain("7");
  });
});

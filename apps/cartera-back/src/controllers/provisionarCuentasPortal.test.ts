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
const provisionarSpy = mock(async () => resultadoDoble);
const consultarSpy = mock(async () => resultadoDoble);
mock.module("../services/portalProvisioning", () => ({
  provisionarInversionista: provisionarSpy,
  consultarAccesoInversionista: consultarSpy,
}));

const { provisionarCuentasPortal } = await import("./provisionarCuentasPortal");

/**
 * OJO: desde que el job es de solo lectura, ÉL no puede producir este estado —
 * `consultarAccesoInversionista` solo devuelve `candidata`, `ya_tenia`,
 * `omitida` o `fallo`. Se sigue alimentando a propósito: estas cuatro pruebas
 * cubren el cableado resumen→log→correo, y con este resultado siguen siendo el
 * guard de regresión que se dispara si alguien vuelve a meter creación en la
 * corrida diaria. Las pruebas del contrato nuevo están más abajo.
 */
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

const CANDIDATA = {
  inversionistaId: 7,
  estado: "candidata",
  usuarioEmail: null,
  resueltoPor: null,
  correo: {
    enviado: false,
    plantilla: null,
    redirigido: false,
    destinatarioReal: null,
  },
  advertencias: [],
  motivo: null,
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

describe("provisionarCuentasPortal: el cron NO puede crear cuentas", () => {
  /**
   * El agujero: el universo del job es la tabla ENTERA y no mira procedencia,
   * así que una fila sembrada por un anónimo (POST /api/unified/register-external
   * o POST /api/cartera/investor con una sesión auto-servida) se recogía a las
   * 07:00 y salía de ahí una cuenta INVESTOR con la contraseña al correo del
   * atacante. Y en la variante peor —DPI de un inversionista REAL sin cuenta—
   * el upsert legacy le reescribe el correo a la fila de la víctima
   * (investor.ts:678) y el cron le crea LA CUENTA DE LA VÍCTIMA al buzón del
   * atacante.
   *
   * Ninguna marca en la FILA cierra esa segunda variante: la fila es legítima.
   * Lo único que la cierra es que el cron deje de crear.
   */
  it("con la fila que siembra un anónimo, clasifica pero NUNCA provisiona", async () => {
    filas = [
      {
        inversionista_id: 7,
        nombre: "VICTIMA S.A.",
        email: "atacante@evil.com",
        dpi: 1234567890101,
        dpi_rep_legal: null,
      },
    ];
    resultadoDoble = { ...CANDIDATA };
    provisionarSpy.mockClear();
    consultarSpy.mockClear();

    const resumen = await provisionarCuentasPortal({
      enviarResumen: async () => ({ success: true }),
    });

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(consultarSpy).toHaveBeenCalledTimes(1);
    expect(resumen.creadas.length).toBe(0);
    expect(resumen.candidatas.map((c) => c.inversionistaId)).toEqual([7]);
  });

  it("una pendiente SÍ hace sonar la campana: sin eso el rescate no existe", async () => {
    // Detectar sin avisar es no detectar. El job dejó de crear, así que la
    // única forma de que alguien se entere del pendiente es este correo.
    filas = [
      {
        inversionista_id: 7,
        nombre: "Ana Pérez",
        email: "ana@example.com",
        dpi: 1234567890101,
        dpi_rep_legal: null,
      },
    ];
    resultadoDoble = { ...CANDIDATA };
    const enviarResumen = mock(async () => ({ success: true }));

    const resumen = await provisionarCuentasPortal({ enviarResumen });

    expect(resumen.hayQueReportar).toBe(true);
    expect(enviarResumen).toHaveBeenCalledTimes(1);
  });
});

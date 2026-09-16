import { describe, expect, it, mock } from "bun:test";

/**
 * El acto humano que la reconciliación diaria dejó de hacer sola.
 *
 * El cron detecta y reporta; abrir la cuenta —crear el usuario y mandar la
 * contraseña— pasa por aquí, que exige ADMIN de back office y no está en el
 * proxy que `auth-google` expone al portal. Ese es todo el arreglo: el sistema
 * perdió la información de quién escribió la fila, así que la decisión la toma
 * quien SÍ puede ver que "cuenta para VICTIMA S.A. → atacante@evil.com" no
 * cuadra, antes de que salga la contraseña.
 */

let filas: any[] = [];
let filtro: unknown = null;

mock.module("../database/index", () => ({
  client: {},
  lockPool: {},
  db: {
    select: () => ({
      from: () => ({
        where: (cond: any) => {
          filtro = cond;
          return Promise.resolve(filas);
        },
      }),
    }),
  },
}));

const provisionarSpy = mock(async (fila: any, _op: any) => ({
  inversionistaId: fila.inversionista_id,
  estado: "creada",
  usuarioEmail: fila.email,
  resueltoPor: null,
  correo: { enviado: true, plantilla: "bienvenida", redirigido: false, destinatarioReal: null },
  advertencias: [],
  motivo: null,
}));

mock.module("../services/portalProvisioning", () => ({
  provisionarInversionista: provisionarSpy,
}));

const { otorgarAccesoPortal } = await import("./otorgarAccesoPortal");

const ADMIN = { role: "ADMIN" };

const ctx = (over: any = {}) => ({
  body: { inversionista_ids: [7] },
  user: ADMIN,
  set: {} as { status?: number },
  ...over,
});

describe("otorgarAccesoPortal", () => {
  it("provisiona al inversionista pedido y devuelve qué pasó con su correo", async () => {
    filas = [
      {
        inversionista_id: 7,
        nombre: "Ana Pérez",
        email: "ana@example.com",
        dpi: 1234567890101,
        dpi_rep_legal: null,
      },
    ];
    provisionarSpy.mockClear();

    const c = ctx();
    const r: any = await otorgarAccesoPortal(c as any);

    // La consulta va ACOTADA a los ids pedidos: nunca se recorre la tabla.
    expect(filtro).not.toBeNull();
    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    // `soloAsegurarCuenta` para no repetirle a un representante el aviso de
    // "ahora representas a X" cada vez que alguien toca este botón.
    expect(provisionarSpy.mock.calls[0][1]).toMatchObject({ soloAsegurarCuenta: true });
    expect(r.resultados[0]).toMatchObject({ inversionistaId: 7, estado: "creada" });
  });

  it("a quien no sea ADMIN le responde 403 y NO provisiona a nadie", async () => {
    // Un asesor no reparte accesos al portal. Es la misma línea que ya trazan
    // aseguradoras.ts:16 y facturacionSnapshot.ts:137.
    filas = [];
    provisionarSpy.mockClear();

    const c = ctx({ user: { role: "ASESOR" } });
    await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBe(403);
    expect(provisionarSpy).toHaveBeenCalledTimes(0);
  });

  it("un id que no existe se reporta, no se inventa", async () => {
    filas = [];
    provisionarSpy.mockClear();

    const c = ctx({ body: { inversionista_ids: [999] } });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({
      inversionistaId: 999,
      estado: "fallo",
      motivo: "inversionista_no_encontrado",
    });
  });

  it("sin ids no hace nada y lo dice", async () => {
    filas = [];
    provisionarSpy.mockClear();

    const c = ctx({ body: { inversionista_ids: [] } });
    await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBe(400);
    expect(provisionarSpy).toHaveBeenCalledTimes(0);
  });
});

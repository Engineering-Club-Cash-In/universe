import { beforeAll, describe, expect, it, mock } from "bun:test";

/**
 * `/api/unified/register-external` no lleva `requireAuth`: es la puerta por la
 * que un anónimo escribía filas en `cartera.inversionistas` con el nombre, el
 * DPI y el correo que quisiera. Esas filas caen en el upsert legacy de
 * `insertInvestor`, que o INSERTA, o —si el DPI ya existe— UPDATEA y le
 * REESCRIBE el correo a la fila de un inversionista real.
 *
 * Que hoy ya no se convierta en una cuenta del portal (el cron dejó de crear)
 * no vuelve inofensiva la escritura: pisar el correo de un inversionista real
 * en cartera rompe su liquidación y sus avisos aunque nadie apriete un botón.
 * Esta puerta se cierra aparte, y aparte se prueba.
 */

const creados: any[] = [];
mock.module("../cartera/investor.service", () => ({
  createInvestor: mock(async (p: any) => {
    creados.push(p);
    return { data: p };
  }),
}));

const leads: any[] = [];
mock.module("../crm/profile.service", () => ({
  sendLead: mock(async (p: any) => {
    leads.push(p);
    return { data: p };
  }),
}));

// El import va diferido dentro de `beforeAll` y no arriba: `mock.module` tiene
// que correr ANTES de que el módulo bajo prueba resuelva sus dependencias, y un
// import estático se hoistea por encima de los mocks.
let registerExternalUser: typeof import("./registerExternal.service").registerExternalUser;

beforeAll(async () => {
  ({ registerExternalUser } = await import("./registerExternal.service"));
});

describe("registerExternalUser", () => {
  it("un registro INVESTOR ya no escribe en cartera", async () => {
    creados.length = 0;

    await expect(
      registerExternalUser({
        userType: "INVESTOR",
        fullName: "VICTIMA S.A.",
        email: "atacante@evil.com",
        dpi: "1234567890101",
      }),
    ).rejects.toThrow(/inversionista/i);

    expect(creados).toEqual([]);
  });

  it("el registro de CLIENTE sigue funcionando igual", async () => {
    leads.length = 0;

    const r = await registerExternalUser({
      userType: "CLIENT",
      fullName: "Ana Pérez",
      email: "ana@example.com",
      dpi: "1234567890101",
      phone: "50212345678",
    });

    expect(r.success).toBe(true);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ correo: "ana@example.com", isRegister: true });
  });
});

/**
 * Contrato entre las dos capas del camino del portal.
 *
 * `buildPortalInvestorUpdate` (auth-google) arma el payload y `insertInvestor`
 * (cartera) lo ejecuta. Cada lado tenía sus pruebas en aislamiento y aun así el
 * payload real acabó siendo rechazado: el constructor omite DPI y nombre a
 * propósito, y cartera los exigía antes de mirar el `inversionista_id`. Nada
 * ataba las dos capas, así que todas las ediciones del portal fallaban con las
 * dos baterías en verde.
 *
 * Por eso se importa el constructor DE VERDAD desde auth-google (es un módulo
 * sin dependencias) en vez de recrear aquí la forma del payload: una copia
 * local volvería a dejar las capas sueltas.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

import { buildPortalInvestorUpdate } from "../../../auth-google/src/lib/portalInvestorPayload";
import { lockPoolMock } from "../utils/testMocks";

const inversionistaDelPortal = {
  inversionista_id: 89,
  nombre: "Autocash",
  dpi: 1573661970101,
  email: "richardkachler@sepresta.com",
  banco_id: 3,
  tipo_cuenta: "MONETARIA",
  numero_cuenta: "1111111111",
};

let selectResponses: unknown[][] = [];
let updateWasCalled = false;
let insertWasCalled = false;
let lastUpdateData: Record<string, unknown> | undefined;
let lastUpdateWhere: unknown;

mock.module("../database/index", () => ({
  client: {},
  lockPool: lockPoolMock,
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResponses.shift() ?? []),
        }),
      }),
    }),
    update: () => {
      updateWasCalled = true;
      return {
        set: (data: Record<string, unknown>) => {
          lastUpdateData = data;
          return {
            where: (condicion: unknown) => {
              lastUpdateWhere = condicion;
              return {
                returning: () =>
                  Promise.resolve([{ ...inversionistaDelPortal, ...data }]),
              };
            },
          };
        },
      };
    },
    insert: () => {
      insertWasCalled = true;
      return {
        values: () => ({ returning: () => Promise.resolve([]) }),
      };
    },
  },
}));

mock.module("@cci/email", () => ({
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
  sendNewCreditNotification: mock(() => Promise.resolve()),
}));

mock.module("./addInvestorToCredit", () => ({
  addInvestorToCredit: mock(() => Promise.resolve()),
}));

const { insertInvestor } = await import("./investor");

describe("contrato portal → cartera", () => {
  beforeEach(() => {
    selectResponses = [];
    updateWasCalled = false;
    insertWasCalled = false;
    lastUpdateData = undefined;
    lastUpdateWhere = undefined;
  });

  it("cartera acepta el payload que arma el portal para el número de cuenta", async () => {
    const payload = buildPortalInvestorUpdate(
      inversionistaDelPortal.inversionista_id,
      { numero_cuenta: "5520029868" },
    );

    // La forma exacta que viaja entre las dos capas: ni DPI, ni nombre, ni
    // correo. Si cartera vuelve a exigir alguno, esta prueba se cae.
    expect(payload).toEqual({
      inversionista_id: 89,
      numero_cuenta: "5520029868",
    });

    selectResponses = [[inversionistaDelPortal]];
    const set = { status: 200 };

    const result = await insertInvestor({ body: payload, set });

    expect(set.status).toBe(201);
    expect(result.errores).toBeUndefined();
    expect(updateWasCalled).toBeTrue();
    expect(insertWasCalled).toBeFalse();
    expect(lastUpdateWhere).toBeDefined();
    expect(lastUpdateData).toEqual({ numero_cuenta: "5520029868" });
  });

  it("cartera acepta el payload del portal para banco y tipo de cuenta", async () => {
    const payload = buildPortalInvestorUpdate(
      inversionistaDelPortal.inversionista_id,
      { banco_id: "7", tipo_cuenta: "ahorro" },
    );

    // El banco se valida contra el catálogo antes del upsert: la primera
    // consulta resuelve el banco y la segunda el inversionista.
    selectResponses = [[{ banco_id: 7 }], [inversionistaDelPortal]];
    const set = { status: 200 };

    const result = await insertInvestor({ body: payload, set });

    expect(set.status).toBe(201);
    expect(result.errores).toBeUndefined();
    expect(lastUpdateData).toEqual({ banco_id: 7, tipo_cuenta: "AHORRO" });
  });

  it("el payload del portal no lleva con qué reescribir la identidad de la fila", async () => {
    // Aunque el cliente mande DPI, correo y nombre, el constructor los descarta
    // y a cartera no le llega nada con qué tocar la identidad del destino.
    const payload = buildPortalInvestorUpdate(
      inversionistaDelPortal.inversionista_id,
      {
        dpi: 9999999990101,
        email: "atacante@example.com",
        nombre: "Otro",
        numero_cuenta: "5520029868",
      },
    );

    selectResponses = [[inversionistaDelPortal]];
    const set = { status: 200 };

    await insertInvestor({ body: payload, set });

    expect(lastUpdateData).toBeDefined();
    expect("email" in lastUpdateData!).toBeFalse();
    expect("dpi" in lastUpdateData!).toBeFalse();
    expect("nombre" in lastUpdateData!).toBeFalse();
  });
});

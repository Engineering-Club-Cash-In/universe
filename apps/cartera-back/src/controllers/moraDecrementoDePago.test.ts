/**
 * El criterio con el que los dos caminos que invalidan un pago —anular la
 * boleta y revertir el pago— averiguan si el cron YA repuso la mora que ese
 * pago había bajado. Si la respuesta es que sí, restituir encima le cobra al
 * cliente el doble.
 *
 * Se ejerce contra un ejecutor falso: la consulta no toca la base y lo que se
 * verifica es QUÉ filtra (los `where` de drizzle son árboles con los valores
 * adentro) y cómo traduce las filas a la decisión.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { moras_historial } from "../database/db/schema";
import { elCronYaRepusoLaMora } from "./moraDecrementoDePago";

const CREDITO_ID = 980;
const CREADO = new Date("2026-08-05T20:09:00.000Z");

const estado: { filas: any[]; tablas: any[]; wheres: any[] } = {
  filas: [],
  tablas: [],
  wheres: [],
};

const textoDeCondicion = (cond: any) =>
  JSON.stringify(cond, (_k, v) =>
    typeof v === "object" && v !== null && "table" in v ? "<col>" : v,
  );

const executorFalso: any = {
  select: () => {
    const b: any = {
      from: (t: any) => (estado.tablas.push(t), b),
      where: (cond: any) => (estado.wheres.push(cond), b),
      limit: () => Promise.resolve(estado.filas),
    };
    return b;
  },
};

beforeEach(() => {
  estado.filas = [];
  estado.tablas = [];
  estado.wheres = [];
});

describe("elCronYaRepusoLaMora", () => {
  it("con un evento automático posterior al pago, responde que SÍ", async () => {
    estado.filas = [{ historial_id: 9001 }];

    expect(
      await elCronYaRepusoLaMora(executorFalso, {
        credito_id: CREDITO_ID,
        desde: CREADO,
      }),
    ).toBe(true);
    expect(estado.tablas).toEqual([moras_historial]);
  });

  it("sin eventos posteriores, responde que NO", async () => {
    expect(
      await elCronYaRepusoLaMora(executorFalso, {
        credito_id: CREDITO_ID,
        desde: CREADO,
      }),
    ).toBe(false);
  });

  it("sin ancla no se reconcilia: responde que NO y ni consulta", async () => {
    // El comportamiento seguro: el caller restituye como antes. Un sobrecobro
    // lo corrige el cron en su próxima corrida; perderle la mora al crédito no
    // lo corrige nadie.
    estado.filas = [{ historial_id: 9001 }];

    expect(
      await elCronYaRepusoLaMora(executorFalso, {
        credito_id: CREDITO_ID,
        desde: null,
      }),
    ).toBe(false);
    expect(estado.tablas).toEqual([]);
  });

  it("filtra por el crédito, por el cron y por los eventos que FIJAN el monto", async () => {
    await elCronYaRepusoLaMora(executorFalso, {
      credito_id: CREDITO_ID,
      desde: CREADO,
    });

    const condicion = textoDeCondicion(estado.wheres[0]);
    expect(condicion).toContain(String(CREDITO_ID));
    expect(condicion).toContain("PROCESO_AUTO");
    // CREACION y RECALCULO son los dos con los que el cron REEMPLAZA el monto
    // desde la fórmula: los que deshacen la bajada del pago.
    expect(condicion).toContain("CREACION");
    expect(condicion).toContain("RECALCULO");
    // Una DESACTIVACION es lo contrario —apagó la mora— y no repone nada.
    expect(condicion).not.toContain("DESACTIVACION");
    // Y un ajuste manual no es el cron.
    expect(condicion).not.toContain("API_MANUAL");
    // El ancla es el `createdat` del pago, no `fecha_pago` (retrofechable).
    expect(condicion).toContain(CREADO.toISOString());
  });
});

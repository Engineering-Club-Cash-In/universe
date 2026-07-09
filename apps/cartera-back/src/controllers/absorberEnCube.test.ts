import { describe, expect, it } from "bun:test";
import Big from "big.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { creditos_inversionistas, creditos_inversionistas_espejo } from "../database/db";
import { calcDerivadosCubePuro, absorberInversionistaEnCube } from "./absorberEnCube";

describe("calcDerivadosCubePuro", () => {
  it("CUBE-puro: todo va a cash_in, participacion en 0", () => {
    // monto 10000, tasa 2% => cuota = 200.00
    const d = calcDerivadosCubePuro(new Big("10000"), "2");
    expect(d.cuota_inversionista).toBe("200.00");
    expect(d.monto_cash_in).toBe("200.00");
    expect(d.monto_inversionista).toBe("0.00");
    expect(d.iva_cash_in).toBe("24.00");        // 200 * 0.12
    expect(d.iva_inversionista).toBe("0.00");
  });
});

const SB = process.env.SANDBOX_DB_URL;
const d = SB ? describe : describe.skip;

d("absorberInversionistaEnCube (integración sandbox)", () => {
  it("MERGE: crédito 838 con CUBE presente → CUBE queda 100%, saliente borrado", async () => {
    const sql = postgres(SB!);
    const db = drizzle(sql);
    try {
      await db.transaction(async (tx) => {
        const r = await absorberInversionistaEnCube(tx, 838, 1); // Adriana Bahaia
        expect(r.ok).toBe(true);
        if (r.ok) { expect(r.accion).toBe("merge"); }

        const rows = await tx.select().from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, 838));
        expect(rows.length).toBe(1);
        expect(rows[0].inversionista_id).toBe(86);
        expect(rows[0].porcentaje_cash_in).toBe("100");

        const saliente = await tx.select().from(creditos_inversionistas)
          .where(and(eq(creditos_inversionistas.credito_id, 838),
                     eq(creditos_inversionistas.inversionista_id, 1)));
        expect(saliente.length).toBe(0);
        throw new Error("ROLLBACK");   // no persistir: deja el sandbox intacto
      }).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
    } finally { await sql.end(); }
  });

  it("SWAP: crédito 466 sin CUBE → el row del saliente pasa a CUBE (100%)", async () => {
    const sql = postgres(SB!);
    const db = drizzle(sql);
    try {
      await db.transaction(async (tx) => {
        const r = await absorberInversionistaEnCube(tx, 466, 47); // Jose Massis
        expect(r.ok).toBe(true);
        if (r.ok) { expect(r.accion).toBe("swap"); }
        const rows = await tx.select().from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, 466));
        expect(rows.length).toBe(1);
        expect(rows[0].inversionista_id).toBe(86);
        throw new Error("ROLLBACK");
      }).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
    } finally { await sql.end(); }
  });

  it("saliente ausente → ok:false con razón", async () => {
    const sql = postgres(SB!);
    const db = drizzle(sql);
    try {
      await db.transaction(async (tx) => {
        const r = await absorberInversionistaEnCube(tx, 838, 999999);
        expect(r.ok).toBe(false);
        throw new Error("ROLLBACK");
      }).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
    } finally { await sql.end(); }
  });
});

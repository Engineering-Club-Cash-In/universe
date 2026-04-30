/**
 * One-shot: pone membresias_pago=0 y membresias_mes=0 en los pagos_credito
 * (cuotas) NO pagadas de los creditos cuyos numero_credito_sifco se listan abajo.
 *
 * Editar SIFCO_NUMBERS y correr con: bun run src/migration/resetear_membresias_cuotas_no_pagadas.ts
 */
import { db, client } from "../database/index";
import { creditos, pagos_credito } from "../database/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const SIFCO_NUMBERS: string[] = [
  "CRM-036226c5-01d3-4f92-9ec9-d9f2a941594d",
  "CRM-bcc49909-6243-4473-97c4-02bfbe1c9c91",
];

async function main() {
  try {
    if (SIFCO_NUMBERS.length === 0) {
      console.log("⚠️ SIFCO_NUMBERS está vacío. Agregá los números sifco y volvé a correr.");
      return;
    }

    const creditosEncontrados = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
      })
      .from(creditos)
      .where(inArray(creditos.numero_credito_sifco, SIFCO_NUMBERS));

    const encontradosSet = new Set(creditosEncontrados.map((c) => c.numero_credito_sifco));
    const noEncontrados = SIFCO_NUMBERS.filter((s) => !encontradosSet.has(s));

    if (noEncontrados.length > 0) {
      console.log(`❌ No encontrados (${noEncontrados.length}): ${noEncontrados.join(", ")}`);
    }

    if (creditosEncontrados.length === 0) {
      console.log("Sin créditos para procesar. Saliendo.");
      return;
    }

    await db.transaction(async (tx) => {
      for (const c of creditosEncontrados) {
        const actualizados = await tx
          .update(pagos_credito)
          .set({
            membresias_pago: "0",
            membresias_mes: "0",
          })
          .where(
            and(
              eq(pagos_credito.credito_id, c.credito_id),
              eq(pagos_credito.pagado, false),
            ),
          )
          .returning({ pago_id: pagos_credito.pago_id });

        console.log(
          `✅ sifco=${c.numero_credito_sifco} (credito_id=${c.credito_id}) → ${actualizados.length} cuotas no pagadas reseteadas`,
        );
      }
    });

    console.log("🏁 Listo.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

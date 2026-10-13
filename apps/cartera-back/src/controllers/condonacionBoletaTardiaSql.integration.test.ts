import { afterAll, expect } from "bun:test";
import {
  EMAIL_ASESOR, cerrarEsquemaBoletaTardia, condonarBT, integrationTest, levantarEsquemaBoletaTardia, uuidIntento,
} from "./boletaTardiaTestDb";
import { CONDONACION_BOLETA_TARDIA_SELECT_SQL } from "./condonacionBoletaTardiaSql";

afterAll(cerrarEsquemaBoletaTardia);

integrationTest("el fragmento devuelve la condonación del intento del pago (viva o anulada, con su estado); null si no hay", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await condonarBT(latefee, 1, uuidIntento(401));
  await condonarBT(latefee, 2, uuidIntento(402));
  await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(402), credito_id: 2, motivo: "pago anulado" });
  await condonarBT(latefee, 4, uuidIntento(404));
  const [conCond] = await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id)
    VALUES (1, 'pending', 500, ${uuidIntento(401)}) RETURNING pago_id`;
  const [anulada] = await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id)
    VALUES (2, 'pending', 500, ${uuidIntento(402)}) RETURNING pago_id`;
  const [normal] = await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado) VALUES (3, 'pending', 500) RETURNING pago_id`;
  // mismo intento pero OTRO crédito (E-12): no debe ver la condonación del crédito 4
  const [otroCredito] = await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id)
    VALUES (5, 'pending', 500, ${uuidIntento(404)}) RETURNING pago_id`;
  // F5: viva Y anulada con el mismo intento y crédito -> gana la viva
  await condonarBT(latefee, 6, uuidIntento(406));
  await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(406), credito_id: 6, motivo: "x" });
  await condonarBT(latefee, 6, uuidIntento(406));
  const [conAmbas] = await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id)
    VALUES (6, 'pending', 500, ${uuidIntento(406)}) RETURNING pago_id`;
  const filas = await sql.unsafe(`SELECT p.pago_id, ${CONDONACION_BOLETA_TARDIA_SELECT_SQL} FROM cartera.pagos_credito p ORDER BY p.pago_id`);
  const porPago = new Map(filas.map((f) => [f.pago_id as number, f.condonacionBoletaTardia]));
  expect(porPago.get(conCond!.pago_id)).toMatchObject({ monto: "7.47", asesor: EMAIL_ASESOR, anulada: false });
  expect(typeof (porPago.get(conCond!.pago_id) as { condonacionId: number }).condonacionId).toBe("number");
  expect(porPago.get(anulada!.pago_id)).toMatchObject({ monto: "7.47", asesor: EMAIL_ASESOR, anulada: true });
  expect(porPago.get(conAmbas!.pago_id)).toMatchObject({ anulada: false });
  expect(porPago.get(normal!.pago_id)).toBeNull();
  expect(porPago.get(otroCredito!.pago_id)).toBeNull();
});

integrationTest("la subconsulta usa el índice moras_condonaciones_idx_intento (sin Seq Scan sobre moras_condonaciones)", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await sql`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, monto_condonacion, usuario_id, intento_id)
    SELECT 1, (SELECT min(mora_id) FROM cartera.moras_credito), 'x', 1, (SELECT min(id) FROM cartera.platform_users),
      ('00000000-0000-4000-8000-' || lpad((5000 + g)::text, 12, '0'))::uuid FROM generate_series(1, 3000) g`;
  await sql`ANALYZE cartera.moras_condonaciones`;
  const plan = await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL enable_seqscan = off"); // la tabla de pruebas es chica: se pregunta si el índice ES UTILIZABLE
    return tx.unsafe(`EXPLAIN SELECT p.pago_id, ${CONDONACION_BOLETA_TARDIA_SELECT_SQL} FROM cartera.pagos_credito p`);
  });
  const texto = plan.map((r) => r["QUERY PLAN"]).join("\n");
  expect(texto).toContain("moras_condonaciones_idx_intento");
  expect(texto).not.toMatch(/Seq Scan on moras_condonaciones/);
});

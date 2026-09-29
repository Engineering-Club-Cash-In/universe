import { abrirBaseSegura, verificar } from "./00-guard";
const sql = await abrirBaseSegura();
const CRED = 5;

const [r] = await sql`SELECT * FROM cartera.rubros WHERE credito_id=${CRED} AND anulado=false`;
const [rec] = await sql`SELECT * FROM cartera.rubros_pagos WHERE rubro_id=${r.rubro_id}`;
const PAGO = rec.pago_id;
console.log(`\n  rubro ${r.rubro_id} (saldo ${r.saldo_pendiente}) — reclamo de ${rec.monto} en el pago ${PAGO}`);

console.log(`\n═══ PASO 3: contabilidad APLICA la boleta ═══`);
const { aplicarPagoAlCredito } = await import(
  "../../controllers/registerPayment"
);
const ap: any = await aplicarPagoAlCredito(PAGO).catch((e: any) => ({ error: String(e) }));
console.log(`  ${JSON.stringify(ap).slice(0, 220)}`);

const [r2] = await sql`SELECT * FROM cartera.rubros WHERE rubro_id=${r.rubro_id}`;
const [rec2] = await sql`SELECT * FROM cartera.rubros_pagos WHERE rubro_id=${r.rubro_id}`;
const ok3 = verificar("al aplicar, el saldo del rubro BAJA", [
  { que: "saldo_pendiente", esperado: 0, obtenido: r2?.saldo_pendiente },
  { que: "completado", esperado: true, obtenido: r2?.completado },
  { que: "el reclamo quedó aplicado", esperado: true, obtenido: rec2?.aplicado },
  { que: "monto_aplicado del reclamo", esperado: 300, obtenido: rec2?.monto_aplicado },
]);

console.log(`\n═══ PASO 4: se REVIERTE la boleta ═══`);
const { reversePayment } = await import(
  "../../controllers/reversePayment"
);
const set2: any = { status: 200 };
const rv: any = await reversePayment({ body: { pago_id: PAGO, credito_id: CRED }, set: set2 }).catch((e: any) => ({ error: String(e) }));
console.log(`  status=${set2.status}  ${JSON.stringify(rv).slice(0, 220)}`);

const [r3] = await sql`SELECT * FROM cartera.rubros WHERE rubro_id=${r.rubro_id}`;
const rec3 = await sql`SELECT * FROM cartera.rubros_pagos WHERE rubro_id=${r.rubro_id}`;
const hist = await sql`SELECT tipo_evento FROM cartera.rubros_historial WHERE rubro_id=${r.rubro_id} ORDER BY historial_id`;
const ok4 = verificar("al revertir, el rubro VUELVE a deberse", [
  { que: "saldo_pendiente restituido", esperado: 300, obtenido: r3?.saldo_pendiente },
  { que: "completado vuelve a false", esperado: false, obtenido: r3?.completado },
  { que: "el reclamo desapareció", esperado: 0, obtenido: rec3.length },
  { que: "historial: creacion→cobro→reversa", esperado: "creacion,abono,reversa", obtenido: hist.map((h: any) => h.tipo_evento).join(",") },
]);

console.log(`\n${ok3 && ok4 ? "✅ PASOS 3 y 4 OK" : "🔴 ALGO FALLÓ"}`);
await sql.end();

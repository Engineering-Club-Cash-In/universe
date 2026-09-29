import { abrirBaseSegura, verificar } from "./00-guard";
const sql = await abrirBaseSegura();
const CRED = 5;

const [r] = await sql`SELECT * FROM cartera.rubros WHERE credito_id=${CRED} AND anulado=false`;
const [c] = await sql`SELECT cuota FROM cartera.creditos WHERE credito_id=${CRED}`;
const [q] = await sql`SELECT cuota_id, numero_cuota FROM cartera.cuotas_credito
  WHERE credito_id=${CRED} AND pagado=false AND numero_cuota>0 ORDER BY numero_cuota LIMIT 1`;

console.log(`\n  rubro ${r.rubro_id}: saldo ${r.saldo_pendiente}`);
console.log(`  cuota del crédito: ${c.cuota}  |  próxima cuota abierta: #${q.numero_cuota}`);

const BOLETA = Number(c.cuota) + 300;
console.log(`\n═══ PASO 2: boleta de Q${BOLETA.toFixed(2)} (cuota + los Q300 del rubro) ═══`);

const { insertPayment } = await import(
  "../../controllers/registerPayment"
);

const hoy = new Date().toISOString().slice(0, 10);
const set: any = { status: 200 };
const res: any = await insertPayment({
  body: {
    credito_id: CRED,
    usuario_id: 1,
    monto_boleta: BOLETA,
    fecha_pago: hoy,
    fecha_boleta: hoy,
    cuotaApagar: q.numero_cuota,
    otros: 0,
    abono_directo_capital: 0,
    url_boletas: [],
    banco_id: 1,
    numeroAutorizacion: `HUMO-${Date.now()}`,
    registerBy: "smoke",
    observaciones: "prueba de humo",
  },
  set,
});
console.log(`  status=${set.status}`);
console.log(`  ${JSON.stringify(res?.detalle ?? res).slice(0, 220)}`);

const [rd] = await sql`SELECT * FROM cartera.rubros WHERE rubro_id=${r.rubro_id}`;
const reclamos = await sql`SELECT * FROM cartera.rubros_pagos WHERE rubro_id=${r.rubro_id}`;

// Se sigue el RECLAMO hasta su pago: es el vínculo real, no el id más alto.
const pagos = await sql`SELECT p.pago_id, p.otros, p.monto_boleta, p.monto_aplicado,
         p.validation_status, p.cuota_id
  FROM cartera.pagos_credito p
  WHERE p.pago_id IN (SELECT pago_id FROM cartera.rubros_pagos WHERE rubro_id=${r.rubro_id})`;

const ultimas = await sql`SELECT pago_id, otros, monto_boleta, monto_aplicado, cuota_id
  FROM cartera.pagos_credito WHERE credito_id=${CRED} ORDER BY pago_id DESC LIMIT 4`;

console.log("\n  últimas filas del crédito:");
for (const p of ultimas) {
  console.log(`    pago ${p.pago_id} cuota_id=${p.cuota_id}: boleta=${p.monto_boleta} otros=${p.otros} aplicado=${p.monto_aplicado}`);
}
console.log("\n  la fila que carga el reclamo:");
for (const p of pagos) {
  console.log(`    pago ${p.pago_id} cuota_id=${p.cuota_id}: boleta=${p.monto_boleta} otros=${p.otros} estado=${p.validation_status}`);
}

const conRubro: any = pagos[0];
const ok = verificar("el cobro del rubro quedó registrado", [
  { que: "hay reclamo en rubros_pagos", esperado: 1, obtenido: reclamos.length },
  { que: "monto del reclamo", esperado: "300.00", obtenido: reclamos[0]?.monto },
  { que: "el reclamo NO está aplicado todavía", esperado: false, obtenido: reclamos[0]?.aplicado },
  { que: "el cargo se sumó a `otros` del pago", esperado: "300.00", obtenido: conRubro?.otros },
  { que: "saldo del rubro (aún sin descontar)", esperado: "300.00", obtenido: rd?.saldo_pendiente },
]);
console.log(`\n${ok ? "✅ PASO 2 OK" : "🔴 PASO 2 FALLÓ"}`);
await sql.end();

import { abrirBaseSegura, verificar } from "./00-guard";
const sql = await abrirBaseSegura();

/**
 * Revertir DOS VECES la misma fila no le puede restar dos veces al cliente.
 *
 * La reversa resetea la fila y el endpoint la acepta otra vez —no hay guard de
 * "ya revertido"—, así que si el reset no limpia `saldo_a_favor_acreditado` la
 * segunda pasada relee el mismo crédito y lo vuelve a descontar.
 *
 * Medido acá antes del arreglo: un pago que acreditó Q4,635,531.32 se revertía
 * bien la primera vez, y la segunda se llevaba los Q5,000 que el cliente ya
 * tenía de antes. El piso en cero evita el saldo negativo, no el robo del saldo
 * legítimo.
 *
 * El caso necesita un pago que acredite un sobrante POSITIVO. No sirve el abono
 * a capital "puro" (boleta == otros + capital), porque ahí el efectivo arranca en
 * cero y no sobra nada. Sirve un crédito EN_CONVENIO con una boleta que los
 * pagos del convenio no alcanzan a consumir: el bloque que acredita vive bajo
 * `(estaAlDia || permiteAbonoCapital) && abonoCapital.gt(0)`, que es más ancho
 * que la clasificación de solo-capital.
 */
// EN_CONVENIO: el comentario del bloque que escribe la columna nombra justo este
// caso como el que deja sobrante ("sin cuotas abiertas que consuman el
// disponible"). Se le habilita el abono a capital, que es lo único que se toca.
await sql`UPDATE cartera.creditos SET permite_abono_capital = true WHERE credito_id = 63`;
const [c] = await sql`SELECT credito_id, usuario_id, capital, "statusCredit"
  FROM cartera.creditos WHERE credito_id = 63`;
const CRED = Number(c.credito_id);
const [q] = await sql`SELECT numero_cuota FROM cartera.cuotas_credito
  WHERE credito_id=${CRED} AND pagado=false AND numero_cuota>0 ORDER BY numero_cuota LIMIT 1`;

await sql`UPDATE cartera.usuarios SET saldo_a_favor='5000.00' WHERE usuario_id=${c.usuario_id}`;
const s = async () => Number((await sql`SELECT saldo_a_favor FROM cartera.usuarios WHERE usuario_id=${c.usuario_id}`)[0].saldo_a_favor);

// Una boleta enorme contra el capital, para que sobre y se acredite saldo.
const { insertPayment } = await import("../../controllers/registerPayment");
const { reversePayment } = await import("../../controllers/reversePayment");
const hoy = new Date().toISOString().slice(0, 10);
const s0 = await s();
console.log(`\n  crédito ${CRED} (${c.statusCredit}, capital ${c.capital}), usuario ${c.usuario_id}`);
console.log(`  saldo a favor inicial: ${s0}`);

const set: any = { status: 200 };
await insertPayment({ body: {
  credito_id: CRED, usuario_id: 1, monto_boleta: 5000000, fecha_pago: hoy, fecha_boleta: hoy,
  cuotaApagar: q.numero_cuota, otros: 0, abono_directo_capital: 1000,
  url_boletas: [], banco_id: 1, numeroAutorizacion: `DOBLE-${Date.now()}`, registerBy: "smoke",
}, set });

const [p] = await sql`SELECT pago_id, monto_boleta, abono_capital, saldo_a_favor_acreditado
  FROM cartera.pagos_credito WHERE credito_id=${CRED} ORDER BY pago_id DESC LIMIT 1`;
const s1 = await s();
console.log(`\n  pago ${p.pago_id}: boleta=${p.monto_boleta} capital=${p.abono_capital}`);
console.log(`  la columna registró acreditado = ${p.saldo_a_favor_acreditado}`);
console.log(`  saldo tras registrar: ${s1}   (acreditó ${s1 - s0})`);

if (Number(p.saldo_a_favor_acreditado ?? 0) <= 0) {
  console.log(`\n  ⚠️ este pago no acreditó nada positivo; el hallazgo pide un sobrante > 0.`);
  await sql.end(); process.exit(0);
}

console.log(`\n  ── PRIMERA reversa ──`);
const r1: any = { status: 200 };
await reversePayment({ body: { pago_id: p.pago_id, credito_id: CRED }, set: r1 }).catch((e: any) => console.log(`     error: ${String(e).slice(0,110)}`));
const s2 = await s();
const [p1] = await sql`SELECT saldo_a_favor_acreditado, pagado, monto_boleta FROM cartera.pagos_credito WHERE pago_id=${p.pago_id}`;
console.log(`     status=${r1.status}  saldo: ${s1} → ${s2}   (quitó ${s1 - s2})`);
console.log(`     la columna QUEDÓ en: ${p1.saldo_a_favor_acreditado}   (boleta reseteada a ${p1.monto_boleta})`);

console.log(`\n  ── SEGUNDA reversa sobre la MISMA fila ──`);
const r2: any = { status: 200 };
await reversePayment({ body: { pago_id: p.pago_id, credito_id: CRED }, set: r2 }).catch((e: any) => console.log(`     error: ${String(e).slice(0,110)}`));
const s3 = await s();
console.log(`     status=${r2.status}  saldo: ${s2} → ${s3}   (quitó ${s2 - s3})`);

const ok = verificar("revertir dos veces no cobra dos veces", [
  { que: "la primera reversa devolvió exactamente lo acreditado", esperado: Number(p.saldo_a_favor_acreditado), obtenido: s1 - s2 },
  { que: "el reset dejó la columna en cero", esperado: 0, obtenido: p1.saldo_a_favor_acreditado },
  { que: "la SEGUNDA reversa no restó nada", esperado: 0, obtenido: s2 - s3 },
  { que: "al cliente le quedó su saldo de antes", esperado: s0, obtenido: s3 },
]);
console.log(`\n${ok ? "✅ PASO 8 OK" : "🔴 PASO 8 FALLÓ"}`);
await sql.end();

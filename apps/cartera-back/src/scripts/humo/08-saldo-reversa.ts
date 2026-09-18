import { abrirBaseSegura } from "./00-guard";
const sql = await abrirBaseSegura();

/**
 * ¿Revertir una fila de ABONO DIRECTO A CAPITAL toca de verdad el
 * `saldo_a_favor` del usuario, y por cuánto?
 *
 * Es la pregunta que decide el arreglo: si la resta no se alcanza para estas
 * filas, subir el `monto_boleta` al valor real es seguro por sí solo y no hace
 * falta persistir lo acreditado.
 */
const [c] = await sql`SELECT credito_id, usuario_id FROM cartera.creditos
  WHERE permite_abono_capital = true
    AND "statusCredit" NOT IN ('CANCELADO','INCOBRABLE','CAIDO','PENDIENTE_CANCELACION')
  ORDER BY credito_id LIMIT 1`;
const CRED = Number(c.credito_id);
const [q] = await sql`SELECT numero_cuota FROM cartera.cuotas_credito
  WHERE credito_id=${CRED} AND pagado=false AND numero_cuota>0 ORDER BY numero_cuota LIMIT 1`;

// Se le pone un saldo a favor conocido para poder medir el efecto.
await sql`UPDATE cartera.usuarios SET saldo_a_favor = '5000.00' WHERE usuario_id = ${c.usuario_id}`;
const [u0] = await sql`SELECT saldo_a_favor FROM cartera.usuarios WHERE usuario_id=${c.usuario_id}`;
console.log(`\n  crédito ${CRED}, usuario ${c.usuario_id}`);
console.log(`  saldo a favor ANTES: ${u0.saldo_a_favor}`);

const BOLETA = 1100, OTROS = 100, A_CAPITAL = 1000;
const { insertPayment } = await import("../../controllers/registerPayment");
const hoy = new Date().toISOString().slice(0, 10);
const set: any = { status: 200 };
await insertPayment({
  body: {
    credito_id: CRED, usuario_id: 1, monto_boleta: BOLETA, fecha_pago: hoy, fecha_boleta: hoy,
    cuotaApagar: q.numero_cuota, otros: OTROS, abono_directo_capital: A_CAPITAL,
    url_boletas: [], banco_id: 1, numeroAutorizacion: `HUMO-SF-${Date.now()}`, registerBy: "smoke",
  },
  set,
});

const [p] = await sql`SELECT pago_id, monto_boleta, abono_capital, otros, validation_status
  FROM cartera.pagos_credito WHERE credito_id=${CRED} ORDER BY pago_id DESC LIMIT 1`;
const [u1] = await sql`SELECT saldo_a_favor FROM cartera.usuarios WHERE usuario_id=${c.usuario_id}`;
console.log(`\n  fila escrita: pago ${p.pago_id} boleta=${p.monto_boleta} capital=${p.abono_capital} otros=${p.otros} estado=${p.validation_status}`);
console.log(`  saldo a favor DESPUÉS de registrar: ${u1.saldo_a_favor}  (acreditó ${Number(u1.saldo_a_favor) - Number(u0.saldo_a_favor)})`);

console.log(`\n  ── ahora se REVIERTE ──`);
const { reversePayment } = await import("../../controllers/reversePayment");
const set2: any = { status: 200 };
const rv: any = await reversePayment({ body: { pago_id: p.pago_id, credito_id: CRED }, set: set2 })
  .catch((e: any) => ({ error: String(e).slice(0, 120) }));
console.log(`  status=${set2.status}  ${JSON.stringify(rv).slice(0, 140)}`);

const [u2] = await sql`SELECT saldo_a_favor FROM cartera.usuarios WHERE usuario_id=${c.usuario_id}`;
const quito = Number(u1.saldo_a_favor) - Number(u2.saldo_a_favor);
console.log(`\n  saldo a favor DESPUÉS de revertir: ${u2.saldo_a_favor}`);
console.log(`  ⇒ la reversa QUITÓ: ${quito}`);
const acredito = Number(u1.saldo_a_favor) - Number(u0.saldo_a_favor);
console.log(`\n  VEREDICTO caso A (la boleta se reparte entera, acredita 0):`);
console.log(
  quito === acredito
    ? `    ✅ devolvió exactamente lo acreditado (${acredito})`
    : `    🔴 acreditó ${acredito} pero la reversa quitó ${quito} — le sacó saldo ajeno al cliente`
);

// ── Caso B: un abono a capital que SÍ deja sobrante ─────────────────────────
// Es el que objetaba la revisión al primer intento: si el disponible se consume
// después, reconstruirlo desde las columnas da de más. Acá tiene que devolver
// exactamente lo que dejó, ni más ni menos.
console.log(`\n  ── caso B: boleta Q1,100, sólo Q400 a capital → sobran Q600 ──`);
await sql`UPDATE cartera.usuarios SET saldo_a_favor = '5000.00' WHERE usuario_id = ${c.usuario_id}`;
const [q2] = await sql`SELECT numero_cuota FROM cartera.cuotas_credito
  WHERE credito_id=${CRED} AND pagado=false AND numero_cuota>0 ORDER BY numero_cuota LIMIT 1`;
const setB: any = { status: 200 };
await insertPayment({
  body: {
    credito_id: CRED, usuario_id: 1, monto_boleta: 1100, fecha_pago: hoy, fecha_boleta: hoy,
    cuotaApagar: q2.numero_cuota, otros: 100, abono_directo_capital: 400,
    url_boletas: [], banco_id: 1, numeroAutorizacion: `HUMO-SF-B-${Date.now()}`, registerBy: "smoke",
  },
  set: setB,
});
const [pB] = await sql`SELECT pago_id, saldo_a_favor_acreditado FROM cartera.pagos_credito
  WHERE credito_id=${CRED} ORDER BY pago_id DESC LIMIT 1`;
const [uB1] = await sql`SELECT saldo_a_favor FROM cartera.usuarios WHERE usuario_id=${c.usuario_id}`;
const acreditoB = Number(uB1.saldo_a_favor) - 5000;
console.log(`    acreditó ${acreditoB}  |  la fila lo registró como: ${pB.saldo_a_favor_acreditado}`);

const setB2: any = { status: 200 };
await reversePayment({ body: { pago_id: pB.pago_id, credito_id: CRED }, set: setB2 }).catch(() => {});
const [uB2] = await sql`SELECT saldo_a_favor FROM cartera.usuarios WHERE usuario_id=${c.usuario_id}`;
const quitoB = Number(uB1.saldo_a_favor) - Number(uB2.saldo_a_favor);
console.log(`    la reversa quitó: ${quitoB}`);
// ⚠️ Este caso NO pasa por la rama de capital: con sobrante > 0 el motor toma el
// camino normal (`esPagoSoloCapital` da false), así que la fila queda con
// `saldo_a_favor_acreditado` en NULL y la reversa cae en la conducta vieja.
//
// Y ahí queda a la vista un defecto MÁS GRANDE, descubierto por este mismo
// script: el camino normal también acredita sólo el sobrante, y la reversa
// descuenta el `monto_boleta` completo. O sea que revertir CUALQUIER pago puede
// quitarle al cliente saldo a favor que ese pago nunca le dio.
//
// No se asierta como arreglado —esta capa sólo cubre la rama de capital, que es
// donde se midió y se probó— pero se avisa, que es mejor que callarlo.
const esDeCapital = pB.saldo_a_favor_acreditado !== null;
if (!esDeCapital) {
  console.log(`    ⚠️ esta fila NO es de la rama de capital (tomó el camino normal)`);
  if (quitoB !== acreditoB) {
    console.log(`    🔴 DEFECTO ABIERTO del camino normal: acreditó ${acreditoB} y la reversa quitó ${quitoB}`);
  }
} else {
  console.log(
    quitoB === acreditoB
      ? `    ✅ devolvió exactamente lo acreditado (${acreditoB})`
      : `    🔴 acreditó ${acreditoB} pero quitó ${quitoB}`
  );
}

// El veredicto del paso es el caso A: es el que esta capa arregla.
console.log(`\n${quito === acredito ? "✅ PASO 7 OK (rama de capital)" : "🔴 PASO 7 FALLÓ"}`);
await sql.end();

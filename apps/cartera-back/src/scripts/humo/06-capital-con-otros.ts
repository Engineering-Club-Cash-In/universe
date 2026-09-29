import { abrirBaseSegura, verificar } from "./00-guard";
const sql = await abrirBaseSegura();

// Un crédito que PERMITE abono directo a capital.
const [c] = await sql`SELECT credito_id, numero_credito_sifco, cuota, capital, permite_abono_capital
  FROM cartera.creditos
  WHERE permite_abono_capital = true AND "statusCredit" NOT IN ('CANCELADO','INCOBRABLE','CAIDO','PENDIENTE_CANCELACION')
  ORDER BY credito_id LIMIT 1`;

if (!c) {
  console.log("  no hay crédito con permite_abono_capital — se marca uno para la prueba");
  await sql`UPDATE cartera.creditos SET permite_abono_capital = true WHERE credito_id = 6`;
}
const [cr] = c
  ? [c]
  : await sql`SELECT credito_id, numero_credito_sifco, cuota, capital, permite_abono_capital
      FROM cartera.creditos WHERE credito_id = 6`;

const CRED = Number(cr.credito_id);
const [q] = await sql`SELECT numero_cuota FROM cartera.cuotas_credito
  WHERE credito_id=${CRED} AND pagado=false AND numero_cuota>0 ORDER BY numero_cuota LIMIT 1`;

console.log(`\n  crédito ${CRED} (${cr.numero_credito_sifco})  capital=${cr.capital}`);

// El escenario del hallazgo: boleta 1100, Q100 de `otros`, todo lo demás a capital.
const BOLETA = 1100;
const OTROS = 100;
// Lo que el FRONT manda ahora: boleta − otros (antes mandaba la boleta entera).
const A_CAPITAL = BOLETA - OTROS;

console.log(`\n═══ PASO 5: boleta Q${BOLETA} con Q${OTROS} de otros, el resto a capital ═══`);
console.log(`  el front manda abono_directo_capital = Q${A_CAPITAL} (antes mandaba Q${BOLETA})`);

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
    otros: OTROS,
    abono_directo_capital: A_CAPITAL,
    url_boletas: [],
    banco_id: 1,
    numeroAutorizacion: `HUMO-CAP-${Date.now()}`,
    registerBy: "smoke",
  },
  set,
});
console.log(`  status=${set.status}  ${JSON.stringify(res?.detalle ?? res).slice(0, 200)}`);

const [p] = await sql`SELECT pago_id, monto_boleta, monto_boleta_cuota, abono_capital, otros,
       monto_aplicado, validation_status
  FROM cartera.pagos_credito WHERE credito_id=${CRED} ORDER BY pago_id DESC LIMIT 1`;

console.log(`\n  la fila escrita:`);
console.log(`    pago ${p.pago_id}: monto_boleta=${p.monto_boleta}  abono_capital=${p.abono_capital}  otros=${p.otros}  estado=${p.validation_status}`);

const asignado = Number(p.abono_capital) + Number(p.otros);
const ok = verificar("la boleta NO se sobreasigna", [
  { que: "abono_capital = boleta − otros", esperado: A_CAPITAL, obtenido: p.abono_capital },
  { que: "otros se cobra igual", esperado: OTROS, obtenido: p.otros },
  { que: "TOTAL asignado = la boleta (mandando la boleta entera daba 1200)", esperado: BOLETA, obtenido: asignado },
]);

// ⚠️ DEFECTO CONOCIDO, no se asierta como arreglado: la rama de capital guarda
// `monto_boleta = abono_capital`, así que el recibo impreso dice Q1,000 cuando el
// comprobante del banco dice Q1,100. Arreglarlo exige tocar también la resta de
// `saldo_a_favor` en la reversa —son un par acoplado— y el intento de cerrarlo
// suelto resultó peor que el defecto. Queda en el mapa de superficies (#1600).
const recibo = Number(p.monto_boleta);
if (recibo !== BOLETA) {
  console.log(`\n  ⚠️ conocido: monto_boleta=${recibo} pero la boleta fue ${BOLETA} — el recibo impreso dirá de menos`);
}
console.log(`\n${ok ? "✅ PASO 5 OK" : "🔴 PASO 5 FALLÓ"}`);
await sql.end();

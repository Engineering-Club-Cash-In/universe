import { abrirBaseSegura, verificar } from "./00-guard";
const sql = await abrirBaseSegura();

// Un pago vivo, con inversionistas detrás, sobre el que se pueda "declarar falsa".
const [p] = await sql`
  SELECT p.pago_id, p.credito_id, p.monto_boleta, p.validation_status
  FROM cartera.pagos_credito p
  WHERE p."paymentFalse" = false
    AND p.validation_status = 'validated'
    AND EXISTS (SELECT 1 FROM cartera.creditos_inversionistas ci WHERE ci.credito_id = p.credito_id)
  ORDER BY p.pago_id DESC
  LIMIT 1`;

console.log(`\n  pago ${p.pago_id} del crédito ${p.credito_id} (boleta ${p.monto_boleta}, ${p.validation_status})`);

const antes = await sql`SELECT count(*)::int AS n FROM cartera.pagos_credito_inversionistas_espejo WHERE pago_id=${p.pago_id}`;
console.log(`  filas de espejo ANTES: ${antes[0].n}`);

console.log(`\n═══ PASO 6: DOS clics simultáneos en "declarar falsa" ═══`);
console.log(`  (sin el candado, los dos pasaban el chequeo y los dos escribían el espejo)`);

const { falsePayment } = await import(
  "../../controllers/payments"
);

// Los dos a la vez, como dos clics del asesor.
const [a, b] = await Promise.allSettled([
  falsePayment(p.pago_id, p.credito_id),
  falsePayment(p.pago_id, p.credito_id),
]);

const resumen = (r: any) =>
  r.status === "fulfilled"
    ? `ok: ${JSON.stringify(r.value).slice(0, 90)}`
    : `rechazado: ${String(r.reason).slice(0, 90)}`;
console.log(`    llamada A → ${resumen(a)}`);
console.log(`    llamada B → ${resumen(b)}`);

const despues = await sql`SELECT count(*)::int AS n FROM cartera.pagos_credito_inversionistas_espejo WHERE pago_id=${p.pago_id}`;
const [pf] = await sql`SELECT "paymentFalse" FROM cartera.pagos_credito WHERE pago_id=${p.pago_id}`;

// Lo que importa: que las filas de espejo NO se hayan duplicado.
const nuevas = despues[0].n - antes[0].n;
console.log(`\n  filas de espejo DESPUÉS: ${despues[0].n}  (nuevas: ${nuevas})`);

const unaSolaGano = [a, b].filter((r: any) => r.status === "fulfilled" && r.value?.updatedCount > 0).length;

const ok = verificar("el doble clic no duplica el espejo", [
  { que: "el pago quedó marcado falso", esperado: true, obtenido: pf?.paymentFalse },
  { que: "una sola llamada aplicó el cambio", esperado: 1, obtenido: unaSolaGano },
]);
console.log(`\n  ⓘ filas de espejo nuevas: ${nuevas} — si el candado falla, se duplican`);
console.log(`\n${ok ? "✅ PASO 6 OK" : "🔴 PASO 6 FALLÓ"}`);
await sql.end();

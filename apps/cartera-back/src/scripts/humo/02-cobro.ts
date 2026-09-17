import { abrirBaseSegura, verificar } from "./00-guard";

const sql = await abrirBaseSegura();
const CRED = 5;
const TIPO = 191; // Gestión de placas (opcional, activo)

// Limpio cualquier rastro de corridas anteriores sobre este crédito.
await sql`DELETE FROM cartera.rubros_historial WHERE rubro_id IN (SELECT rubro_id FROM cartera.rubros WHERE credito_id=${CRED})`;
await sql`DELETE FROM cartera.rubros WHERE credito_id=${CRED}`;

const { crearRubro } = await import(
  "../../controllers/rubros"
);

console.log("\n═══ PASO 1: crear un cobro adicional de Q300 ═══");
const creado: any = await crearRubro({
  credito_id: CRED,
  tipo_id: TIPO,
  monto: 300,
  descripcion: "Placas 2026 (humo)",
  motivo: "prueba de humo contra dump de prod",
  role: "ADMIN",
  usuario_id: 1,
});
console.log("  respuesta:", JSON.stringify(creado).slice(0, 200));

const [r] = await sql`SELECT * FROM cartera.rubros WHERE credito_id=${CRED}`;
const ok1 = verificar("el rubro quedó en la base", [
  { que: "monto_original", esperado: "300.00", obtenido: r?.monto_original },
  { que: "saldo_pendiente", esperado: "300.00", obtenido: r?.saldo_pendiente },
  { que: "completado", esperado: false, obtenido: r?.completado },
  { que: "anulado", esperado: false, obtenido: r?.anulado },
]);

const hist = await sql`SELECT tipo_evento, motivo FROM cartera.rubros_historial WHERE rubro_id=${r.rubro_id}`;
const ok2 = verificar("dejó su evento de creación", [
  { que: "eventos", esperado: 1, obtenido: hist.length },
  { que: "tipo", esperado: "creacion", obtenido: hist[0]?.tipo_evento },
]);

console.log(`\n  rubro_id = ${r.rubro_id}`);
console.log(`\n${ok1 && ok2 ? "✅ PASO 1 OK" : "🔴 PASO 1 FALLÓ"}`);
await sql.end();

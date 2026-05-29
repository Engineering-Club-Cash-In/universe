/**
 * Test harness para condonarMora / updateMora contra DB local.
 *
 * Run: bun src/scripts/testMoraFlows.ts
 */
import { and, eq, desc } from "drizzle-orm";
import { db } from "../database";
import { creditos, moras_credito, moras_condonaciones, moras_historial } from "../database/db/schema";
import { condonarMora, updateMora } from "../controllers/latefee";

const EMAIL_OK = "jalvarado@clubcashin.com";
const EMAIL_BAD = "nonexistent_user_999@example.com";
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type Snapshot = {
  statusCredit: string | null;
  mora: { mora_id: number; activa: boolean; monto_mora: string; cuotas_atrasadas: number } | null;
};

async function snapshot(credito_id: number): Promise<Snapshot> {
  const [c] = await db.select({ statusCredit: creditos.statusCredit }).from(creditos).where(eq(creditos.credito_id, credito_id));
  const [m] = await db
    .select({
      mora_id: moras_credito.mora_id,
      activa: moras_credito.activa,
      monto_mora: moras_credito.monto_mora,
      cuotas_atrasadas: moras_credito.cuotas_atrasadas,
    })
    .from(moras_credito)
    .where(and(eq(moras_credito.credito_id, credito_id), eq(moras_credito.activa, true)))
    .orderBy(desc(moras_credito.created_at))
    .limit(1);
  return { statusCredit: c?.statusCredit ?? null, mora: m ?? null };
}

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else    { fail++; console.log(`  ❌ ${name}${extra ? "  → " + extra : ""}`); }
}

// Restaura las moras de los créditos de prueba a un estado conocido.
// Cada test asume que su crédito tiene una mora activa con el monto indicado.
const FIXTURES: Array<{ credito_id: number; monto: string; cuotas: number }> = [
  { credito_id: 1,  monto: "1345.11", cuotas: 3 },
  { credito_id: 3,  monto: "5346.07", cuotas: 3 },
  { credito_id: 5,  monto: "652.65",  cuotas: 1 },
  { credito_id: 7,  monto: "2171.82", cuotas: 4 },
  { credito_id: 11, monto: "720.53",  cuotas: 4 },
  { credito_id: 12, monto: "1570.34", cuotas: 1 },
  { credito_id: 16, monto: "24976.00", cuotas: 20 },
];

function assertLocalDatabase() {
  const connectionString = process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL environment variable not set");
  }

  const hostname = new URL(connectionString).hostname;

  if (!LOCAL_DB_HOSTS.has(hostname)) {
    throw new Error(
      `testMoraFlows mutates fixed fixture credit IDs and only runs against local databases. Refusing SUPABASE_DB_URL host: ${hostname}`,
    );
  }
}

async function resetFixtures() {
  assertLocalDatabase();

  for (const f of FIXTURES) {
    // Desactivar cualquier mora activa que ya exista para este crédito
    await db.update(moras_credito)
      .set({ activa: false })
      .where(and(eq(moras_credito.credito_id, f.credito_id), eq(moras_credito.activa, true)));
    // Insertar mora activa fresca con el monto conocido
    await db.insert(moras_credito).values({
      credito_id: f.credito_id,
      monto_mora: f.monto,
      cuotas_atrasadas: f.cuotas,
      activa: true,
      porcentaje_mora: "1.12",
    });
    await db.update(creditos)
      .set({ statusCredit: "MOROSO" })
      .where(eq(creditos.credito_id, f.credito_id));
  }
  // Borrar condonaciones previas de los créditos de test para que TEST 8 cuente desde 0
  for (const f of FIXTURES) {
    await db.delete(moras_condonaciones).where(eq(moras_condonaciones.credito_id, f.credito_id));
  }
  // Asegurar que crédito 4 NO tenga mora activa (para tests 6 y 9)
  await db.update(moras_credito)
    .set({ activa: false })
    .where(and(eq(moras_credito.credito_id, 4), eq(moras_credito.activa, true)));
  await db.update(creditos).set({ statusCredit: "ACTIVO" }).where(eq(creditos.credito_id, 4));
}

async function run() {
  console.log("=== Reset fixtures ===");
  await resetFixtures();
  console.log("  ✅ fixtures listas\n");

  console.log("\n=== TEST 1: INCREMENTO normal sobre crédito MOROSO ===");
  {
    const before = await snapshot(1);
    console.log("  before:", before);
    const res = await updateMora({ credito_id: 1, tipo: "INCREMENTO", monto_cambio: 500, usuario_email: EMAIL_OK });
    const after = await snapshot(1);
    console.log("  after:", after, "result.success=", res.success, "newStatus=", (res as any).newStatus);
    check("success", res.success === true);
    check("monto +500", Number(after.mora?.monto_mora).toFixed(2) === (Number(before.mora?.monto_mora) + 500).toFixed(2));
    check("statusCredit=MOROSO", after.statusCredit === "MOROSO");
    check("mora sigue activa", after.mora?.activa === true);
  }

  console.log("\n=== TEST 2: DECREMENTO parcial (sigue MOROSO) ===");
  {
    const before = await snapshot(3);
    console.log("  before:", before);
    const res = await updateMora({ credito_id: 3, tipo: "DECREMENTO", monto_cambio: 1000, usuario_email: EMAIL_OK });
    const after = await snapshot(3);
    console.log("  after:", after, "result.success=", res.success, "newStatus=", (res as any).newStatus);
    check("success", res.success === true);
    check("monto -1000", Number(after.mora?.monto_mora).toFixed(2) === (Number(before.mora?.monto_mora) - 1000).toFixed(2));
    check("statusCredit=MOROSO", after.statusCredit === "MOROSO");
    check("mora sigue activa", after.mora?.activa === true);
  }

  console.log("\n=== TEST 3: DECREMENTO total exacto → mora a 0, ACTIVO ===");
  {
    const before = await snapshot(5);
    console.log("  before:", before);
    const res = await updateMora({ credito_id: 5, tipo: "DECREMENTO", monto_cambio: Number(before.mora!.monto_mora), usuario_email: EMAIL_OK });
    const after = await snapshot(5);
    console.log("  after:", after, "result.success=", res.success, "newStatus=", (res as any).newStatus);
    check("success", res.success === true);
    check("statusCredit=ACTIVO", after.statusCredit === "ACTIVO");
    check("mora desactivada (no aparece en query activa=true)", after.mora === null);
  }

  console.log("\n=== TEST 4: DECREMENTO excesivo → clipea a 0, ACTIVO ===");
  {
    const before = await snapshot(7);
    console.log("  before:", before);
    const res = await updateMora({ credito_id: 7, tipo: "DECREMENTO", monto_cambio: 999999, usuario_email: EMAIL_OK });
    const after = await snapshot(7);
    console.log("  after:", after, "result.success=", res.success, "newStatus=", (res as any).newStatus);
    check("success", res.success === true);
    check("statusCredit=ACTIVO", after.statusCredit === "ACTIVO");
    check("mora desactivada", after.mora === null);
  }

  console.log("\n=== TEST 5: monto_cambio negativo → REJECT ===");
  {
    const res = await updateMora({ credito_id: 1, tipo: "INCREMENTO", monto_cambio: -100, usuario_email: EMAIL_OK });
    console.log("  result:", res);
    check("rechazado", res.success === false);
    check("mensaje menciona monto_cambio", String((res as any).message).includes("monto_cambio"));
  }

  console.log("\n=== TEST 6: updateMora sobre crédito SIN mora activa → not_found ===");
  {
    const res = await updateMora({ credito_id: 4, tipo: "INCREMENTO", monto_cambio: 100, usuario_email: EMAIL_OK });
    console.log("  result:", res);
    check("rechazado", res.success === false);
    check("mensaje menciona 'Mora activa no encontrada'", String((res as any).message).includes("Mora activa no encontrada"));
  }

  console.log("\n=== TEST 7: resolución por numero_credito_sifco (sin credito_id) ===");
  {
    const before = await snapshot(11);
    console.log("  before:", before);
    const res = await updateMora({ numero_credito_sifco: "01010214114530", tipo: "INCREMENTO", monto_cambio: 50, usuario_email: EMAIL_OK });
    const after = await snapshot(11);
    console.log("  after:", after, "result.success=", res.success);
    check("success", res.success === true);
    check("monto +50", Number(after.mora?.monto_mora).toFixed(2) === (Number(before.mora?.monto_mora) + 50).toFixed(2));
  }

  console.log("\n=== TEST 8: condonarMora normal ===");
  {
    const before = await snapshot(12);
    const condBefore = await db.select().from(moras_condonaciones).where(eq(moras_condonaciones.credito_id, 12));
    console.log("  before:", before, "condonaciones previas:", condBefore.length);
    const res = await condonarMora({ credito_id: 12, motivo: "TEST: condonación", usuario_email: EMAIL_OK });
    const after = await snapshot(12);
    const condAfter = await db.select().from(moras_condonaciones).where(eq(moras_condonaciones.credito_id, 12));
    console.log("  after:", after, "result.success=", res.success, "condonaciones:", condAfter.length);
    check("success", res.success === true);
    check("statusCredit=ACTIVO", after.statusCredit === "ACTIVO");
    check("mora desactivada", after.mora === null);
    check("moras_condonaciones +1", condAfter.length === condBefore.length + 1);
    check("monto registrado = monto previo", Number(condAfter[condAfter.length - 1]?.montoCondonacion).toFixed(2) === Number(before.mora!.monto_mora).toFixed(2));
  }

  console.log("\n=== TEST 9: condonarMora sin mora activa → reject ===");
  {
    const res = await condonarMora({ credito_id: 4, motivo: "no debería pasar", usuario_email: EMAIL_OK });
    console.log("  result:", res);
    check("rechazado", res.success === false);
    check("mensaje menciona 'No hay mora activa'", String((res as any).message).includes("No hay mora activa"));
  }

  console.log("\n=== TEST 10: condonarMora con email inexistente → reject ===");
  {
    const res = await condonarMora({ credito_id: 16, motivo: "test", usuario_email: EMAIL_BAD });
    console.log("  result:", res);
    check("rechazado", res.success === false);
    check("mensaje 'Usuario no encontrado'", String((res as any).message).includes("Usuario no encontrado"));
  }

  // Bonus: confirmar que se registró el usuario_id en moras_historial para test 1
  console.log("\n=== TEST 11 (bonus): updateMora registró usuario_id en historial ===");
  {
    const [hist] = await db
      .select({ usuario_id: moras_historial.usuario_id, tipo_evento: moras_historial.tipo_evento })
      .from(moras_historial)
      .where(eq(moras_historial.credito_id, 1))
      .orderBy(desc(moras_historial.fecha))
      .limit(1);
    console.log("  last historial:", hist);
    check("usuario_id no es null", hist?.usuario_id != null);
    check("tipo_evento = INCREMENTO", hist?.tipo_evento === "INCREMENTO");
  }

  console.log("\n=== TEST 12: condonaciones concurrentes sobre el mismo crédito → solo 1 éxito ===");
  {
    // Resetear fixture del crédito 16 a estado MOROSO con mora activa fresca
    await db.update(moras_credito)
      .set({ activa: false })
      .where(and(eq(moras_credito.credito_id, 16), eq(moras_credito.activa, true)));
    await db.insert(moras_credito).values({
      credito_id: 16,
      monto_mora: "24976.00",
      cuotas_atrasadas: 20,
      activa: true,
      porcentaje_mora: "1.12",
    });
    await db.update(creditos).set({ statusCredit: "MOROSO" }).where(eq(creditos.credito_id, 16));
    await db.delete(moras_condonaciones).where(eq(moras_condonaciones.credito_id, 16));

    const results = await Promise.allSettled([
      condonarMora({ credito_id: 16, motivo: "concurrent A", usuario_email: EMAIL_OK }),
      condonarMora({ credito_id: 16, motivo: "concurrent B", usuario_email: EMAIL_OK }),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled" && (r.value as any).success === true).length;
    const failures  = results.filter((r) => r.status === "fulfilled" && (r.value as any).success === false).length;
    const condAfter = await db.select().from(moras_condonaciones).where(eq(moras_condonaciones.credito_id, 16));

    console.log("  parallel results:", results.map((r) => r.status === "fulfilled" ? (r.value as any) : r.reason));
    console.log("  successes=", successes, "failures=", failures, "condonaciones en DB=", condAfter.length);

    check("exactamente 1 éxito", successes === 1);
    check("exactamente 1 fallo (no hay mora activa)", failures === 1);
    check("exactamente 1 fila en moras_condonaciones", condAfter.length === 1);
  }

  console.log(`\n=== TOTAL: ${pass} pass / ${fail} fail ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error("FATAL:", e); process.exit(1); });

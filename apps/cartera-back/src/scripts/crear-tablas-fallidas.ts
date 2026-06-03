// ============================================================
// Bootstrap idempotente de las tablas del monitoreo de facturas
// no certificadas en SAT (schema "cartera").
//   - cartera.facturas_fallidas_sat
//   - cartera.job_checkpoints
//
// Uso (una vez, contra la BD destino):
//   bun run src/scripts/crear-tablas-fallidas.ts
// (Nota: drizzle-kit push no aplica para estas tablas porque la
//  config apunta a un schema inexistente; por eso se crean con SQL.)
// ============================================================
import { client } from "../database";

async function main() {
  console.log("🛠️  Creando tablas (IF NOT EXISTS) en schema cartera...");

  await client.query(`
    CREATE TABLE IF NOT EXISTS cartera.facturas_fallidas_sat (
      id                  serial PRIMARY KEY,
      factura_id          integer NOT NULL UNIQUE REFERENCES cartera.facturas_electronicas(factura_id),
      uuid                varchar(255) NOT NULL,
      serie               varchar(50)  NOT NULL,
      numero              varchar(100) NOT NULL,
      emisor_nit          varchar(30),
      emisor_nombre       varchar(200),
      receptor_nit        varchar(30),
      receptor_nombre     varchar(200),
      monto_total         numeric(18,2),
      fecha_certificacion timestamp,
      mensaje_sat         text,
      intentos            integer NOT NULL DEFAULT 1,
      status              varchar(20) NOT NULL DEFAULT 'PENDIENTE',
      detectada_at        timestamp NOT NULL DEFAULT now(),
      resuelta_at         timestamp,
      updated_at          timestamp NOT NULL DEFAULT now()
    );
  `);
  console.log("   ✅ cartera.facturas_fallidas_sat");

  await client.query(`
    CREATE TABLE IF NOT EXISTS cartera.job_checkpoints (
      job_name        varchar(100) PRIMARY KEY,
      last_factura_id integer NOT NULL DEFAULT 0,
      updated_at      timestamp NOT NULL DEFAULT now()
    );
  `);
  console.log("   ✅ cartera.job_checkpoints");

  // Sembrar el cursor con el max(factura_id) actual para empezar a monitorear
  // SOLO las facturas nuevas (no reprocesar todo el histórico). No pisa si ya existe.
  const seed = await client.query(`
    INSERT INTO cartera.job_checkpoints (job_name, last_factura_id)
    SELECT 'verificar_facturas_sat', COALESCE(MAX(factura_id), 0)
    FROM cartera.facturas_electronicas
    ON CONFLICT (job_name) DO NOTHING
    RETURNING last_factura_id;
  `);
  if (seed.rows.length > 0) {
    console.log(`   ✅ cursor inicial sembrado en factura_id=${seed.rows[0].last_factura_id}`);
  } else {
    console.log("   ℹ️ cursor ya existía, no se modificó");
  }

  console.log("🎉 Listo");
  process.exit(0);
}

main().catch((e) => {
  console.error("💥 Error creando tablas:", e);
  process.exit(1);
});

import { db } from "../database/index";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`
    SELECT 
      p.pago_id,
      p.credito_id,
      c.numero_credito_sifco,
      p.cuota_id,
      q.numero_cuota,
      p.fecha_vencimiento AS p_fecha_vencimiento,
      q.fecha_vencimiento AS q_fecha_vencimiento,
      p.fecha_pago,
      p.pagado,
      p.monto_boleta
    FROM cartera.pagos_credito p
    INNER JOIN cartera.creditos c ON p.credito_id = c.credito_id
    LEFT JOIN cartera.cuotas_credito q ON p.cuota_id = q.cuota_id
    WHERE c.numero_credito_sifco = '01010214111380'
    ORDER BY q.fecha_vencimiento
    LIMIT 5;
  `);

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(console.error);

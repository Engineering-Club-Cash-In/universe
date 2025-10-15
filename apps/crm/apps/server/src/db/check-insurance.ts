import { db } from "./index";
import { insuranceCosts } from "./schema";
import { lte, sql } from "drizzle-orm";

async function checkInsurance() {
	// Buscar para 50000 (el ejemplo del Excel)
	const insuredAmount = 50000;

	console.log(`Buscando seguro para monto: ${insuredAmount}`);

	// Buscar el registro más cercano (VLOOKUP con aproximación)
	const [result] = await db
		.select()
		.from(insuranceCosts)
		.where(lte(insuranceCosts.price, insuredAmount))
		.orderBy(sql`${insuranceCosts.price} DESC`)
		.limit(1);

	console.log("\nResultado encontrado:");
	console.log(JSON.stringify(result, null, 2));

	// También buscar los primeros 10 registros alrededor de 50000
	const around = await db
		.select()
		.from(insuranceCosts)
		.where(lte(insuranceCosts.price, 52000))
		.orderBy(sql`${insuranceCosts.price} DESC`)
		.limit(10);

	console.log("\nRegistros cercanos a 50000:");
	around.forEach((r) => {
		console.log(
			`Price: ${r.price}, INREXSA: ${r.inrexsa}, Membership: ${r.membership}`
		);
	});

	process.exit(0);
}

checkInsurance();

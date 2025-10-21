import { db } from "./src/db";
import { opportunities } from "./src/db/schema/crm";

async function clearOpportunities() {
	console.log("Clearing opportunities...");
	await db.delete(opportunities);
	console.log("✅ Opportunities cleared");
	process.exit(0);
}

clearOpportunities();

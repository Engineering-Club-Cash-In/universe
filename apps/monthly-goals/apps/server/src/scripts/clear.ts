import { db } from "../db";
import { goalSubmissions } from "../db/schema/presentations";
import { presentations } from "../db/schema/presentations";
import { monthlyGoals } from "../db/schema/monthly-goals";
import { goalTemplates } from "../db/schema/goal-templates";
import { teamMembers } from "../db/schema/team-members";
import { areas } from "../db/schema/areas";
import { departments } from "../db/schema/departments";
import { session } from "../db/schema/auth";
import { account } from "../db/schema/auth";
import { verification } from "../db/schema/auth";
import { user } from "../db/schema/auth";

export async function clearDatabase() {
	console.log("🧹 Starting database clearing...");

	try {
		// Delete in order to respect foreign key constraints
		await db.delete(goalSubmissions);
		await db.delete(presentations);
		await db.delete(monthlyGoals);
		await db.delete(goalTemplates);
		await db.delete(teamMembers);
		await db.delete(areas);
		await db.delete(departments);
		await db.delete(session);
		await db.delete(account);
		await db.delete(verification);
		await db.delete(user);

		console.log("🎉 Database cleared successfully!");
		
	} catch (error) {
		console.error("❌ Error clearing database:", error);
		throw error;
	}
}

// Run clearing if this file is executed directly
if (import.meta.main) {
	await clearDatabase();
	process.exit(0);
}
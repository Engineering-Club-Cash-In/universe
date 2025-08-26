import { auth } from "../lib/auth";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { eq } from "drizzle-orm";

const seedUsers = [
	{
		email: "admin@company.com",
		password: "Admin123!",
		name: "Super Administrador",
		role: "super_admin",
	},
	{
		email: "manager.ventas@company.com",
		password: "Manager123!",
		name: "Gerente de Ventas",
		role: "manager",
	},
	{
		email: "manager.operaciones@company.com",
		password: "Manager123!",
		name: "Gerente de Operaciones",
		role: "manager",
	},
	{
		email: "empleado.ventas@company.com",
		password: "Employee123!",
		name: "Juan Pérez",
		role: "employee",
	},
	{
		email: "empleado.marketing@company.com",
		password: "Employee123!",
		name: "María García",
		role: "employee",
	},
	{
		email: "viewer@company.com",
		password: "Viewer123!",
		name: "Observador Externo",
		role: "viewer",
	},
];

export async function seedDatabase() {
	console.log("🌱 Starting database seeding...");

	try {
		for (const userData of seedUsers) {
			console.log(`Creating user: ${userData.email}`);
			
			// Check if user already exists
			const existingUser = await db
				.select()
				.from(user)
				.where(eq(user.email, userData.email))
				.limit(1);

			if (existingUser.length > 0) {
				console.log(`⚠️ User already exists: ${userData.email}`);
				continue;
			}

			// Create user using signup API
			const result = await auth.api.signUpEmail({
				body: {
					email: userData.email,
					password: userData.password,
					name: userData.name,
				},
			});

			if (result.user) {
				// Update role directly in database
				await db
					.update(user)
					.set({ role: userData.role as "super_admin" | "manager" | "employee" | "viewer" })
					.where(eq(user.id, result.user.id));
			}
			
			console.log(`✅ Created user: ${userData.name} (${userData.email}) with role: ${userData.role}`);
		}

		console.log("🎉 Database seeding completed successfully!");
		
	} catch (error) {
		console.error("❌ Error seeding database:", error);
		throw error;
	}
}

// Run seeding if this file is executed directly
if (import.meta.main) {
	await seedDatabase();
	process.exit(0);
}
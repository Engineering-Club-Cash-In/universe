import { auth } from "../lib/auth";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { departments } from "../db/schema/departments";
import { areas } from "../db/schema/areas";
import { teamMembers } from "../db/schema/team-members";
import { eq } from "drizzle-orm";

const seedUsers = [
	{
		email: "admin@company.com",
		password: "Admin123!",
		name: "Super Administrador",
		role: "super_admin",
	},
	{
		email: "gerente.ventas@company.com",
		password: "Manager123!",
		name: "Gerente de Ventas",
		role: "department_manager",
	},
	{
		email: "gerente.operaciones@company.com",
		password: "Manager123!",
		name: "Gerente de Operaciones",
		role: "department_manager",
	},
	{
		email: "lead.marketing@company.com",
		password: "Lead123!",
		name: "Lead de Marketing",
		role: "area_lead",
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
		// First create all users
		const createdUsers: any = {};
		
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
				createdUsers[userData.email] = existingUser[0];
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
					.set({ role: userData.role as "super_admin" | "department_manager" | "area_lead" | "employee" | "viewer" })
					.where(eq(user.id, result.user.id));
					
				createdUsers[userData.email] = result.user;
			}
			
			console.log(`✅ Created user: ${userData.name} (${userData.email}) with role: ${userData.role}`);
		}

		// Create organizational structure
		console.log("📊 Creating organizational structure...");

		// Create Ventas Department with department manager
		const [ventasDept] = await db.insert(departments).values({
			name: "Ventas",
			description: "Departamento de Ventas y Marketing",
			managerId: createdUsers["gerente.ventas@company.com"]?.id,
		}).returning();

		// Create Operaciones Department with department manager  
		const [operacionesDept] = await db.insert(departments).values({
			name: "Operaciones",
			description: "Departamento de Operaciones y Logística",
			managerId: createdUsers["gerente.operaciones@company.com"]?.id,
		}).returning();

		// Create areas within departments
		const [ventasArea] = await db.insert(areas).values({
			name: "Ventas Directas",
			description: "Área de ventas directas al cliente",
			departmentId: ventasDept.id,
			leadId: createdUsers["gerente.ventas@company.com"]?.id, // Department manager also leads this area
		}).returning();

		const [marketingArea] = await db.insert(areas).values({
			name: "Marketing Digital",
			description: "Área de marketing y comunicaciones",
			departmentId: ventasDept.id,
			leadId: createdUsers["lead.marketing@company.com"]?.id, // Specific area lead
		}).returning();

		// Assign employees to areas
		if (createdUsers["empleado.ventas@company.com"]) {
			await db.insert(teamMembers).values({
				userId: createdUsers["empleado.ventas@company.com"].id,
				areaId: ventasArea.id,
				position: "Ejecutivo de Ventas",
			});
		}

		if (createdUsers["empleado.marketing@company.com"]) {
			await db.insert(teamMembers).values({
				userId: createdUsers["empleado.marketing@company.com"].id,
				areaId: marketingArea.id,
				position: "Especialista en Marketing Digital",
			});
		}

		console.log("🎉 Database seeding completed successfully!");
		console.log("\n📋 Estructura creada:");
		console.log("- Departamento Ventas (Manager: Gerente de Ventas)");
		console.log("  - Área Ventas Directas (Lead: Gerente de Ventas)");
		console.log("  - Área Marketing Digital (Lead: Lead de Marketing)");
		console.log("- Departamento Operaciones (Manager: Gerente de Operaciones)");
		console.log("\n👥 Usuarios con roles específicos:");
		console.log("- super_admin: admin@company.com");
		console.log("- department_manager: gerente.ventas@company.com, gerente.operaciones@company.com");
		console.log("- area_lead: lead.marketing@company.com");
		console.log("- employee: empleado.ventas@company.com, empleado.marketing@company.com");
		console.log("- viewer: viewer@company.com");
		
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
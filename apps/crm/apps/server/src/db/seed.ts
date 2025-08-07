import { eq } from "drizzle-orm";
import { db } from "./index";
import { user } from "./schema/auth";
import {
	clients,
	companies,
	creditAnalysis,
	leads,
	opportunities,
	salesStages,
} from "./schema/crm";
import {
	vehicles,
	vehicleInspections,
	vehiclePhotos,
	inspectionChecklistItems,
} from "./schema/vehicles";

const salesStagesData = [
	{
		name: "Preparación",
		order: 1,
		closurePercentage: 1,
		color: "#ef4444", // red-500
		description: "Fase inicial de preparación del contacto",
	},
	{
		name: "Llamada de presentación e identificación de necesidades",
		order: 2,
		closurePercentage: 10,
		color: "#eab308", // yellow-500
		description:
			"Primera llamada para presentar la empresa e identificar necesidades del cliente",
	},
	{
		name: "Solución y propuesta",
		order: 3,
		closurePercentage: 20,
		color: "#eab308", // yellow-500
		description: "Desarrollo de la solución y elaboración de propuesta",
	},
	{
		name: "Recepción de documentación y traslado a análisis",
		order: 4,
		closurePercentage: 30,
		color: "#eab308", // yellow-500
		description: "Recopilación de documentos necesarios y análisis interno",
	},
	{
		name: "Cierre de propuesta",
		order: 5,
		closurePercentage: 40,
		color: "#eab308", // yellow-500
		description: "Finalización y presentación de la propuesta al cliente",
	},
	{
		name: "Formalización",
		order: 6,
		closurePercentage: 50,
		color: "#22c55e", // green-500
		description: "Inicio del proceso de formalización del acuerdo",
	},
	{
		name: "Cierre Final",
		order: 7,
		closurePercentage: 80,
		color: "#22c55e", // green-500
		description: "Cierre definitivo del negocio",
	},
	{
		name: "Formalización Final",
		order: 8,
		closurePercentage: 90,
		color: "#22c55e", // green-500
		description: "Formalización completa de todos los documentos",
	},
	{
		name: "Post Venta",
		order: 9,
		closurePercentage: 100,
		color: "#22c55e", // green-500
		description: "Seguimiento post-venta y gestión de la relación cliente",
	},
];

async function seedSalesStages() {
	console.log("Seeding sales stages...");

	try {
		// Check if stages already exist
		const existingStages = await db.select().from(salesStages);

		if (existingStages.length > 0) {
			console.log("Sales stages already exist, skipping seed...");
			return;
		}

		// Insert the sales stages
		await db.insert(salesStages).values(salesStagesData);

		console.log("✅ Sales stages seeded successfully!");
	} catch (error) {
		console.error("❌ Error seeding sales stages:", error);
	}
}

// Sample companies data
const companiesData = [
	{
		name: "TechCorp Solutions",
		industry: "technology",
		size: "large",
		website: "https://techcorp.com",
		address: "123 Tech Street, Madrid, Spain",
		phone: "+34 91 123 4567",
		email: "contact@techcorp.com",
		notes: "Leading technology solutions provider",
	},
	{
		name: "Global Finance SA",
		industry: "finance",
		size: "enterprise",
		website: "https://globalfinance.es",
		address: "456 Finance Ave, Barcelona, Spain",
		phone: "+34 93 987 6543",
		email: "info@globalfinance.es",
		notes: "Major financial services company",
	},
	{
		name: "HealthPlus Clinic",
		industry: "healthcare",
		size: "medium",
		website: "https://healthplus.es",
		address: "789 Health Blvd, Valencia, Spain",
		phone: "+34 96 555 0123",
		email: "contact@healthplus.es",
		notes: "Private healthcare clinic chain",
	},
	{
		name: "RetailMax",
		industry: "retail",
		size: "large",
		website: "https://retailmax.com",
		address: "321 Retail Plaza, Sevilla, Spain",
		phone: "+34 95 444 5678",
		email: "sales@retailmax.com",
		notes: "Multi-channel retail company",
	},
	{
		name: "StartupInnovate",
		industry: "technology",
		size: "startup",
		website: "https://startupinnovate.io",
		address: "654 Innovation Hub, Bilbao, Spain",
		phone: "+34 94 333 9876",
		email: "hello@startupinnovate.io",
		notes: "AI-focused startup company",
	},
	{
		name: "ManufacturingPro",
		industry: "manufacturing",
		size: "large",
		website: "https://manufacturingpro.es",
		address: "987 Industrial Zone, Zaragoza, Spain",
		phone: "+34 97 222 1234",
		email: "contact@manufacturingpro.es",
		notes: "Industrial manufacturing specialist",
	},
	{
		name: "EduConsulting",
		industry: "education",
		size: "small",
		website: "https://educonsulting.es",
		address: "147 Education Street, Granada, Spain",
		phone: "+34 95 888 7777",
		email: "info@educonsulting.es",
		notes: "Educational consulting services",
	},
	{
		name: "ConsultingExperts",
		industry: "consulting",
		size: "medium",
		website: "https://consultingexperts.com",
		address: "258 Business Center, Málaga, Spain",
		phone: "+34 95 111 2222",
		email: "experts@consultingexperts.com",
		notes: "Business strategy consulting firm",
	},
];

// Sample leads data
const leadsData = [
	{
		firstName: "Carlos",
		lastName: "Rodriguez",
		email: "carlos.rodriguez@techcorp.com",
		phone: "+502 5555 0101",
		age: 35,
		dpi: "2987654321001",
		maritalStatus: "married" as const,
		dependents: 2,
		monthlyIncome: "35000.00",
		loanAmount: "150000.00",
		occupation: "employee" as const,
		workTime: "5_to_10" as const,
		loanPurpose: "business" as const,
		ownsHome: true,
		ownsVehicle: true,
		hasCreditCard: true,
		jobTitle: "CTO",
		source: "website" as const,
		status: "new" as const,
		notes: "Interested in our enterprise solutions",
		score: "0.85",
		fit: true,
		scoredAt: new Date(),
	},
	{
		firstName: "Maria",
		lastName: "Garcia",
		email: "maria.garcia@globalfinance.es",
		phone: "+502 5555 0202",
		age: 42,
		dpi: "3876543210101",
		maritalStatus: "single" as const,
		dependents: 0,
		monthlyIncome: "45000.00",
		loanAmount: "200000.00",
		occupation: "owner" as const,
		workTime: "10_plus" as const,
		loanPurpose: "business" as const,
		ownsHome: true,
		ownsVehicle: true,
		hasCreditCard: true,
		jobTitle: "Finance Director",
		source: "referral" as const,
		status: "contacted" as const,
		notes: "Referred by existing client",
		score: "0.92",
		fit: true,
		scoredAt: new Date(),
	},
	{
		firstName: "Javier",
		lastName: "Martinez",
		email: "javier.martinez@healthplus.es",
		phone: "+502 5555 0303",
		age: 28,
		dpi: "4765432101201",
		maritalStatus: "single" as const,
		dependents: 0,
		monthlyIncome: "18000.00",
		loanAmount: "50000.00",
		occupation: "employee" as const,
		workTime: "1_to_5" as const,
		loanPurpose: "personal" as const,
		ownsHome: false,
		ownsVehicle: true,
		hasCreditCard: true,
		jobTitle: "Operations Manager",
		source: "cold_call" as const,
		status: "qualified" as const,
		notes: "Looking for workflow automation",
		score: "0.45",
		fit: false,
		scoredAt: new Date(),
	},
	{
		firstName: "Ana",
		lastName: "Lopez",
		email: "ana.lopez@retailmax.com",
		phone: "+502 5555 0404",
		age: 39,
		dpi: "5654321012301",
		maritalStatus: "divorced" as const,
		dependents: 1,
		monthlyIncome: "28000.00",
		loanAmount: "80000.00",
		occupation: "employee" as const,
		workTime: "5_to_10" as const,
		loanPurpose: "personal" as const,
		ownsHome: true,
		ownsVehicle: false,
		hasCreditCard: true,
		jobTitle: "IT Director",
		source: "email" as const,
		status: "new" as const,
		notes: "E-commerce integration needs",
		score: "0.68",
		fit: false,
		scoredAt: new Date(),
	},
	{
		firstName: "Pedro",
		lastName: "Sanchez",
		email: "pedro.sanchez@startupinnovate.io",
		phone: "+502 5555 0505",
		age: 31,
		dpi: "6543210123401",
		maritalStatus: "married" as const,
		dependents: 3,
		monthlyIncome: "22000.00",
		loanAmount: "60000.00",
		occupation: "owner" as const,
		workTime: "1_to_5" as const,
		loanPurpose: "business" as const,
		ownsHome: false,
		ownsVehicle: true,
		hasCreditCard: false,
		jobTitle: "CEO",
		source: "social_media" as const,
		status: "contacted" as const,
		notes: "Startup looking for scalable solutions",
		score: "0.33",
		fit: false,
		scoredAt: new Date(),
	},
	{
		firstName: "Laura",
		lastName: "Fernandez",
		email: "laura.fernandez@manufacturingpro.es",
		phone: "+502 5555 0606",
		age: 45,
		dpi: "7432101234501",
		maritalStatus: "widowed" as const,
		dependents: 2,
		monthlyIncome: "32000.00",
		loanAmount: "120000.00",
		occupation: "employee" as const,
		workTime: "10_plus" as const,
		loanPurpose: "personal" as const,
		ownsHome: true,
		ownsVehicle: true,
		hasCreditCard: true,
		jobTitle: "Production Manager",
		source: "event" as const,
		status: "qualified" as const,
		notes: "Met at industry conference",
		score: "0.77",
		fit: true,
		scoredAt: new Date(),
	},
	{
		firstName: "Miguel",
		lastName: "Torres",
		email: "miguel.torres@educonsulting.es",
		phone: "+502 5555 0707",
		age: 52,
		dpi: "8321012345601",
		maritalStatus: "married" as const,
		dependents: 4,
		monthlyIncome: "15000.00",
		loanAmount: "30000.00",
		occupation: "employee" as const,
		workTime: "10_plus" as const,
		loanPurpose: "personal" as const,
		ownsHome: true,
		ownsVehicle: false,
		hasCreditCard: false,
		jobTitle: "Director",
		source: "referral" as const,
		status: "unqualified" as const,
		notes: "Budget constraints identified",
		score: "0.25",
		fit: false,
		scoredAt: new Date(),
	},
	{
		firstName: "Isabel",
		lastName: "Ruiz",
		email: "isabel.ruiz@consultingexperts.com",
		phone: "+502 5555 0808",
		age: 36,
		dpi: "9210123456701",
		maritalStatus: "single" as const,
		dependents: 0,
		monthlyIncome: "40000.00",
		loanAmount: "100000.00",
		occupation: "owner" as const,
		workTime: "5_to_10" as const,
		loanPurpose: "business" as const,
		ownsHome: true,
		ownsVehicle: true,
		hasCreditCard: true,
		jobTitle: "Senior Consultant",
		source: "website" as const,
		status: "converted" as const,
		notes: "Successfully converted to opportunity",
		score: "0.88",
		fit: true,
		scoredAt: new Date(),
	},
];

// Sample opportunities data
const opportunitiesData = [
	{
		title: "TechCorp Enterprise License",
		value: "150000.00",
		probability: 80,
		expectedCloseDate: new Date("2024-02-15"),
		status: "open" as const,
		notes: "Large enterprise deal with high probability",
	},
	{
		title: "GlobalFinance Integration Project",
		value: "75000.00",
		probability: 60,
		expectedCloseDate: new Date("2024-03-01"),
		status: "open" as const,
		notes: "Financial system integration project",
	},
	{
		title: "HealthPlus Automation Suite",
		value: "95000.00",
		probability: 70,
		expectedCloseDate: new Date("2024-02-28"),
		status: "open" as const,
		notes: "Healthcare workflow automation",
	},
	{
		title: "RetailMax E-commerce Platform",
		value: "120000.00",
		probability: 45,
		expectedCloseDate: new Date("2024-04-15"),
		status: "open" as const,
		notes: "Multi-channel e-commerce solution",
	},
	{
		title: "StartupInnovate MVP Package",
		value: "25000.00",
		probability: 90,
		expectedCloseDate: new Date("2024-01-30"),
		status: "open" as const,
		notes: "Small but high-probability startup deal",
	},
	{
		title: "ManufacturingPro ERP System",
		value: "200000.00",
		probability: 50,
		expectedCloseDate: new Date("2024-05-01"),
		status: "open" as const,
		notes: "Large ERP implementation project",
	},
	{
		title: "ConsultingExperts CRM Setup",
		value: "40000.00",
		probability: 95,
		expectedCloseDate: new Date("2024-01-25"),
		status: "won" as const,
		notes: "Successfully closed CRM implementation",
	},
];

// Sample clients data
const clientsData = [
	{
		contactPerson: "Isabel Ruiz",
		contractValue: "40000.00",
		startDate: new Date("2024-01-15"),
		endDate: new Date("2024-12-31"),
		status: "active" as const,
		notes: "CRM implementation client, very satisfied",
	},
	{
		contactPerson: "Roberto Silva",
		contractValue: "85000.00",
		startDate: new Date("2023-06-01"),
		endDate: new Date("2024-05-31"),
		status: "active" as const,
		notes: "Long-term software licensing client",
	},
	{
		contactPerson: "Carmen Vega",
		contractValue: "60000.00",
		startDate: new Date("2023-09-15"),
		endDate: new Date("2024-09-14"),
		status: "active" as const,
		notes: "Digital transformation project",
	},
	{
		contactPerson: "Antonio Morales",
		contractValue: "25000.00",
		startDate: new Date("2023-03-01"),
		endDate: new Date("2023-12-31"),
		status: "inactive" as const,
		notes: "Contract expired, considering renewal",
	},
	{
		contactPerson: "Sofia Herrera",
		contractValue: "110000.00",
		startDate: new Date("2022-11-01"),
		endDate: new Date("2023-10-31"),
		status: "churned" as const,
		notes: "Switched to competitor due to pricing",
	},
];

// Credit Analysis sample data
const creditAnalysisData = [
	{
		// Carlos Rodriguez - High income, good capacity
		monthlyFixedIncome: "35000.00",
		monthlyVariableIncome: "5000.00",
		monthlyFixedExpenses: "15000.00",
		monthlyVariableExpenses: "8000.00",
		economicAvailability: "17000.00",
		minPayment: "3000.00",
		maxPayment: "8500.00",
		adjustedPayment: "5500.00",
		maxCreditAmount: "350000.00",
		fullAnalysis: JSON.stringify({
			datos_generales: {
				nombre_cuentahabiente: "Carlos Rodriguez",
				numero_cuenta: "****1234",
				tipo_cuenta: "Monetaria",
			},
			resumen_mensual: [
				{
					mes: "Enero 2024",
					saldo_inicial: 45000,
					total_debitos: 23000,
					total_creditos: 40000,
					saldo_final: 62000,
					ingresos: { fijos: 35000, variables: 5000 },
					gastos: { fijos: 15000, variables: 8000 },
				},
			],
			promedio_mensual: {
				promedio_ingresos_fijos: 35000,
				promedio_ingresos_variables: 5000,
				promedio_gastos_fijos: 15000,
				promedio_gastos_variables: 8000,
				disponibilidad_economica: 17000,
			},
		}),
	},
	{
		// Maria Garcia - Very high income, excellent capacity
		monthlyFixedIncome: "45000.00",
		monthlyVariableIncome: "10000.00",
		monthlyFixedExpenses: "18000.00",
		monthlyVariableExpenses: "12000.00",
		economicAvailability: "25000.00",
		minPayment: "5000.00",
		maxPayment: "12500.00",
		adjustedPayment: "8000.00",
		maxCreditAmount: "500000.00",
		fullAnalysis: JSON.stringify({
			datos_generales: {
				nombre_cuentahabiente: "Maria Garcia",
				numero_cuenta: "****5678",
				tipo_cuenta: "Monetaria",
			},
			resumen_mensual: [],
			promedio_mensual: {
				promedio_ingresos_fijos: 45000,
				promedio_ingresos_variables: 10000,
				promedio_gastos_fijos: 18000,
				promedio_gastos_variables: 12000,
				disponibilidad_economica: 25000,
			},
		}),
	},
	{
		// Laura Fernandez - Moderate income, decent capacity
		monthlyFixedIncome: "32000.00",
		monthlyVariableIncome: "3000.00",
		monthlyFixedExpenses: "20000.00",
		monthlyVariableExpenses: "5000.00",
		economicAvailability: "10000.00",
		minPayment: "2000.00",
		maxPayment: "5000.00",
		adjustedPayment: "3500.00",
		maxCreditAmount: "200000.00",
		fullAnalysis: JSON.stringify({
			datos_generales: {
				nombre_cuentahabiente: "Laura Fernandez",
				numero_cuenta: "****9012",
				tipo_cuenta: "Ahorro",
			},
		}),
	},
	{
		// Isabel Ruiz - Good income, strong capacity
		monthlyFixedIncome: "40000.00",
		monthlyVariableIncome: "8000.00",
		monthlyFixedExpenses: "22000.00",
		monthlyVariableExpenses: "8000.00",
		economicAvailability: "18000.00",
		minPayment: "3500.00",
		maxPayment: "9000.00",
		adjustedPayment: "6000.00",
		maxCreditAmount: "400000.00",
		fullAnalysis: JSON.stringify({
			datos_generales: {
				nombre_cuentahabiente: "Isabel Ruiz",
				numero_cuenta: "****3456",
				tipo_cuenta: "Monetaria",
			},
		}),
	},
];

async function seedCreditAnalysis(usersList: any[], leadsList: any[]) {
	console.log("Seeding credit analysis...");

	try {
		const existingAnalyses = await db.select().from(creditAnalysis);

		if (existingAnalyses.length > 0) {
			console.log("Credit analyses already exist, skipping seed...");
			return existingAnalyses;
		}

		// Only seed for leads that are qualified or converted
		const qualifiedLeads = leadsList.filter(
			(lead) => lead.score && Number(lead.score) >= 0.7 && lead.fit === true
		);

		const analysisWithRelations = creditAnalysisData
			.slice(0, qualifiedLeads.length)
			.map((analysis, index) => {
				const createdByUser = usersList[index % usersList.length];
				return {
					...analysis,
					leadId: qualifiedLeads[index].id,
					createdBy: createdByUser.id,
					analyzedAt: new Date(),
					updatedAt: new Date(),
				};
			});

		const insertedAnalyses = await db
			.insert(creditAnalysis)
			.values(analysisWithRelations)
			.returning();

		console.log("✅ Credit analyses seeded successfully!");
		return insertedAnalyses;
	} catch (error) {
		console.error("❌ Error seeding credit analyses:", error);
		return [];
	}
}

async function seedCompanies(usersList: any[]) {
	console.log("Seeding companies...");

	try {
		const existingCompanies = await db.select().from(companies);

		if (existingCompanies.length > 0) {
			console.log("Companies already exist, skipping seed...");
			return existingCompanies;
		}

		const companiesWithUser = companiesData.map((company, index) => {
			const createdByUser = usersList[index % usersList.length];
			return {
				...company,
				createdBy: createdByUser.id,
				updatedAt: new Date(),
			};
		});

		const insertedCompanies = await db
			.insert(companies)
			.values(companiesWithUser)
			.returning();

		console.log("✅ Companies seeded successfully!");
		return insertedCompanies;
	} catch (error) {
		console.error("❌ Error seeding companies:", error);
		return [];
	}
}

async function seedLeads(usersList: any[], companiesList: any[]) {
	console.log("Seeding leads...");

	try {
		const existingLeads = await db.select().from(leads);

		if (existingLeads.length > 0) {
			console.log("Leads already exist, skipping seed...");
			return existingLeads;
		}

		const leadsWithRelations = leadsData.map((lead, index) => {
			const assignedUser = usersList[index % usersList.length];
			return {
				...lead,
				companyId: companiesList[index % companiesList.length]?.id || null,
				assignedTo: assignedUser.id,
				createdBy: assignedUser.id,
				updatedAt: new Date(),
			};
		});

		const insertedLeads = await db
			.insert(leads)
			.values(leadsWithRelations)
			.returning();

		console.log("✅ Leads seeded successfully!");
		return insertedLeads;
	} catch (error) {
		console.error("❌ Error seeding leads:", error);
		return [];
	}
}

async function seedOpportunities(
	usersList: any[],
	companiesList: any[],
	stagesList: any[],
	leadsList: any[],
) {
	console.log("Seeding opportunities...");

	try {
		const existingOpportunities = await db.select().from(opportunities);

		if (existingOpportunities.length > 0) {
			console.log("Opportunities already exist, skipping seed...");
			return existingOpportunities;
		}

		// Find the analysis stage
		const analysisStage = stagesList.find(
			stage => stage.name === "Recepción de documentación y traslado a análisis"
		);

		const opportunitiesWithRelations = opportunitiesData.map((opp, index) => {
			const assignedUser = usersList[index % usersList.length];
			
			// Put first 3 opportunities in analysis stage
			let stageId;
			if (index < 3 && analysisStage) {
				stageId = analysisStage.id;
			} else {
				stageId = stagesList[Math.floor(Math.random() * stagesList.length)]?.id ||
					stagesList[0]?.id;
			}
			
			return {
				...opp,
				companyId: companiesList[index % companiesList.length]?.id || null,
				leadId: leadsList[index % leadsList.length]?.id || null,
				stageId,
				assignedTo: assignedUser.id,
				createdBy: assignedUser.id,
				updatedAt: new Date(),
			};
		});

		const insertedOpportunities = await db
			.insert(opportunities)
			.values(opportunitiesWithRelations)
			.returning();

		console.log("✅ Opportunities seeded successfully!");
		return insertedOpportunities;
	} catch (error) {
		console.error("❌ Error seeding opportunities:", error);
		return [];
	}
}

async function seedClients(usersList: any[], companiesList: any[]) {
	console.log("Seeding clients...");

	try {
		const existingClients = await db.select().from(clients);

		if (existingClients.length > 0) {
			console.log("Clients already exist, skipping seed...");
			return existingClients;
		}

		const clientsWithRelations = clientsData.map((client, index) => {
			const assignedUser = usersList[index % usersList.length];
			return {
				...client,
				companyId:
					companiesList[index % companiesList.length]?.id ||
					companiesList[0]?.id,
				assignedTo: assignedUser.id,
				createdBy: assignedUser.id,
				updatedAt: new Date(),
			};
		});

		const insertedClients = await db
			.insert(clients)
			.values(clientsWithRelations)
			.returning();

		console.log("✅ Clients seeded successfully!");
		return insertedClients;
	} catch (error) {
		console.error("❌ Error seeding clients:", error);
		return [];
	}
}

// Sample users data
const usersData = [
	{
		id: "admin-user-1",
		name: "Admin User",
		email: "admin@crm.com",
		emailVerified: true,
		image: null,
		role: "admin" as const,
		createdAt: new Date(),
		updatedAt: new Date(),
	},
	{
		id: "sales-user-1",
		name: "Carlos Rodriguez",
		email: "carlos@crm.com",
		emailVerified: true,
		image: null,
		role: "sales" as const,
		createdAt: new Date(),
		updatedAt: new Date(),
	},
	{
		id: "sales-user-2",
		name: "Maria Garcia",
		email: "maria@crm.com",
		emailVerified: true,
		image: null,
		role: "sales" as const,
		createdAt: new Date(),
		updatedAt: new Date(),
	},
	{
		id: "sales-user-3",
		name: "Javier Martinez",
		email: "javier@crm.com",
		emailVerified: true,
		image: null,
		role: "sales" as const,
		createdAt: new Date(),
		updatedAt: new Date(),
	},
	{
		id: "analyst-user-1",
		name: "Ana Morales",
		email: "ana@crm.com",
		emailVerified: true,
		image: null,
		role: "analyst" as const,
		createdAt: new Date(),
		updatedAt: new Date(),
	},
];

async function seedUsers() {
	console.log("Seeding users...");

	try {
		const existingUsers = await db.select().from(user);

		if (existingUsers.length > 0) {
			console.log("Users already exist, skipping seed...");
			return existingUsers;
		}

		const insertedUsers = await db.insert(user).values(usersData).returning();

		console.log("✅ Users seeded successfully!");
		return insertedUsers;
	} catch (error) {
		console.error("❌ Error seeding users:", error);
		return [];
	}
}

// Vehicles sample data
const vehiclesData = [
	{
		make: "Toyota",
		model: "Corolla",
		year: 2020,
		licensePlate: "P-789ABC",
		vinNumber: "1HGCM82633A123456",
		color: "Blanco",
		vehicleType: "Sedan",
		kmMileage: 45000,
		origin: "Agencia",
		cylinders: "4",
		engineCC: "1800",
		fuelType: "Gasolina",
		transmission: "Automático",
		status: "available",
	},
	{
		make: "Honda",
		model: "CR-V",
		year: 2018,
		licensePlate: "P-456DEF",
		vinNumber: "2HKRW7H8XJH234567",
		color: "Gris",
		vehicleType: "SUV",
		kmMileage: 72000,
		origin: "Rodado",
		cylinders: "4",
		engineCC: "2400",
		fuelType: "Gasolina",
		transmission: "Automático",
		status: "pending",
	},
	{
		make: "Nissan",
		model: "Sentra",
		year: 2017,
		licensePlate: "P-123GHI",
		vinNumber: "3N1AB7AP7HY345678",
		color: "Azul",
		vehicleType: "Sedan",
		kmMileage: 95000,
		origin: "Rodado",
		cylinders: "4",
		engineCC: "1600",
		fuelType: "Gasolina",
		transmission: "Manual",
		status: "available",
	},
	{
		make: "Ford",
		model: "Escape",
		year: 2019,
		licensePlate: "P-789JKL",
		vinNumber: "1FMCU0F73KUA456789",
		color: "Rojo",
		vehicleType: "SUV",
		kmMileage: 55000,
		origin: "Agencia",
		cylinders: "4",
		engineCC: "2000",
		fuelType: "Gasolina",
		transmission: "Automático",
		status: "available",
	},
	{
		make: "Mazda",
		model: "CX-5",
		year: 2020,
		licensePlate: "P-456MNO",
		vinNumber: "JM3KFBDL9L0567890",
		color: "Negro",
		vehicleType: "SUV",
		kmMileage: 32000,
		origin: "Agencia",
		cylinders: "4",
		engineCC: "2500",
		fuelType: "Gasolina",
		transmission: "Automático",
		status: "available",
	},
];

async function seedVehicles(companiesList: any[]) {
	console.log("🚗 Seeding vehicles...");

	const insertedVehicles = [];
	for (let i = 0; i < vehiclesData.length; i++) {
		const vehicleData = vehiclesData[i];
		const company = companiesList[i % companiesList.length];

		const [insertedVehicle] = await db
			.insert(vehicles)
			.values({
				...vehicleData,
				companyId: company?.id || null,
			})
			.returning();
		insertedVehicles.push(insertedVehicle);
	}

	console.log(`✅ ${insertedVehicles.length} vehicles seeded`);
	return insertedVehicles;
}

async function seedVehiclePhotos(vehiclesList: any[]) {
	console.log("📸 Seeding vehicle photos...");

	const photoData = [
		{ category: "exterior", photoType: "front-view", label: "Frontal" },
		{ category: "exterior", photoType: "rear-view", label: "Trasera" },
		{ category: "exterior", photoType: "side-view", label: "Lateral" },
		{ category: "interior", photoType: "dashboard", label: "Tablero" },
		{ category: "interior", photoType: "seats", label: "Asientos" },
		{ category: "engine", photoType: "engine-bay", label: "Motor" },
		{ category: "wheels", photoType: "front-wheels", label: "Ruedas delanteras" },
		{ category: "damage", photoType: "scratches", label: "Detalles" }
	];
	
	const baseGithubUrl = "https://raw.githubusercontent.com/EkdeepSLubana/raw_dataset/master/ISP_processed/";
	
	const insertedPhotos = [];
	let photoNumber = 1;
	
	for (const vehicle of vehiclesList) {
		// Cada vehículo tendrá entre 4 y 8 fotos
		const numberOfPhotos = Math.floor(Math.random() * 5) + 4;
		
		for (let i = 0; i < numberOfPhotos; i++) {
			const photo = photoData[i % photoData.length];
			const photoUrl = `${baseGithubUrl}${photoNumber}.jpg`;
			
			const [insertedPhoto] = await db
				.insert(vehiclePhotos)
				.values({
					vehicleId: vehicle.id,
					url: photoUrl,
					title: `${vehicle.make} ${vehicle.model} - ${photo.label}`,
					description: `Fotografía ${photo.label.toLowerCase()} del vehículo ${vehicle.make} ${vehicle.model} ${vehicle.year}`,
					category: photo.category,
					photoType: photo.photoType,
				})
				.returning();
			
			insertedPhotos.push(insertedPhoto);
			
			// Incrementar el número de foto, reiniciar si llegamos a 225
			photoNumber = (photoNumber % 225) + 1;
		}
	}
	
	console.log(`✅ ${insertedPhotos.length} vehicle photos seeded`);
	return insertedPhotos;
}

async function seedInspectionChecklists(inspectionsList: any[]) {
	console.log("📋 Seeding inspection checklists...");

	const checklistTemplates = [
		// Documentos
		{ category: "documentos", label: "Tarjeta de circulación", isRejectionCriteria: true },
		{ category: "documentos", label: "Título de propiedad", isRejectionCriteria: true },
		{ category: "documentos", label: "Seguro vigente", isRejectionCriteria: false },
		{ category: "documentos", label: "Historial de mantenimiento", isRejectionCriteria: false },
		
		// Carrocería
		{ category: "carroceria", label: "Sin daños estructurales", isRejectionCriteria: true },
		{ category: "carroceria", label: "Pintura en buen estado", isRejectionCriteria: false },
		{ category: "carroceria", label: "Sin óxido visible", isRejectionCriteria: false },
		{ category: "carroceria", label: "Puertas funcionan correctamente", isRejectionCriteria: false },
		
		// Interior
		{ category: "interior", label: "Asientos en buen estado", isRejectionCriteria: false },
		{ category: "interior", label: "Tablero sin daños", isRejectionCriteria: false },
		{ category: "interior", label: "Aire acondicionado funcional", isRejectionCriteria: false },
		{ category: "interior", label: "Sistema eléctrico operativo", isRejectionCriteria: true },
		
		// Motor
		{ category: "motor", label: "Motor sin fugas", isRejectionCriteria: true },
		{ category: "motor", label: "Niveles de fluidos correctos", isRejectionCriteria: false },
		{ category: "motor", label: "Sin ruidos anormales", isRejectionCriteria: true },
		{ category: "motor", label: "Sistema de enfriamiento funcional", isRejectionCriteria: false },
		
		// Transmisión
		{ category: "transmision", label: "Cambios suaves", isRejectionCriteria: true },
		{ category: "transmision", label: "Embrague funcional", isRejectionCriteria: true },
		{ category: "transmision", label: "Sin vibraciones", isRejectionCriteria: false },
		
		// Frenos
		{ category: "frenos", label: "Frenos responden bien", isRejectionCriteria: true },
		{ category: "frenos", label: "Discos/tambores en buen estado", isRejectionCriteria: true },
		{ category: "frenos", label: "Líquido de frenos al nivel", isRejectionCriteria: false },
	];

	const insertedChecklists = [];
	
	for (const inspection of inspectionsList) {
		// Para cada inspección, crear items del checklist con valores aleatorios
		for (const template of checklistTemplates) {
			// Generar valor basado en el estado de la inspección
			let value = 'yes';
			
			// Si la inspección fue rechazada, algunos criterios críticos deben ser 'no'
			if (inspection.status === 'rejected' && template.isRejectionCriteria && Math.random() > 0.5) {
				value = 'no';
			} else if (Math.random() > 0.85) {
				// 15% de probabilidad de que sea 'no' o 'n/a'
				value = Math.random() > 0.5 ? 'no' : 'n/a';
			}
			
			const [insertedItem] = await db
				.insert(inspectionChecklistItems)
				.values({
					inspectionId: inspection.id,
					category: template.category,
					item: template.label,
					checked: value === 'yes',
					severity: template.isRejectionCriteria ? 'critical' : 'warning',
				})
				.returning();
			
			insertedChecklists.push(insertedItem);
		}
	}

	console.log(`✅ ${insertedChecklists.length} checklist items seeded`);
	return insertedChecklists;
}

async function seedVehicleInspections(vehiclesList: any[]) {
	console.log("🔍 Seeding vehicle inspections...");

	const inspectionsData = [
		{
			technicianName: "Carlos Rodríguez",
			inspectionDate: new Date("2024-01-15"),
			inspectionResult: "Vehículo en excelentes condiciones. Motor en buen estado, carrocería sin daños relevantes.",
			vehicleRating: "Comercial",
			marketValue: "220000.00",
			suggestedCommercialValue: "205000.00",
			bankValue: "200000.00",
			currentConditionValue: "195000.00",
			vehicleEquipment: "Aire acondicionado, sistema de audio, bolsas de aire frontales y laterales",
			importantConsiderations: "Mantenimiento al día según bitácora",
			scannerUsed: true,
			airbagWarning: false,
			testDrive: true,
			status: "approved",
			alerts: [],
		},
		{
			technicianName: "Ana Martínez",
			inspectionDate: new Date("2024-01-18"),
			inspectionResult: "Vehículo en buenas condiciones. Presenta desgaste normal por uso. Requiere cambio de frenos próximamente.",
			vehicleRating: "Comercial",
			marketValue: "250000.00",
			suggestedCommercialValue: "230000.00",
			bankValue: "225000.00",
			currentConditionValue: "215000.00",
			vehicleEquipment: "Full equipo, navegación GPS, cámara de reversa",
			importantConsiderations: "Próximo cambio de frenos recomendado",
			scannerUsed: true,
			airbagWarning: false,
			testDrive: true,
			status: "pending",
			alerts: ["Frenos"],
		},
		{
			technicianName: "Roberto Sánchez",
			inspectionDate: new Date("2024-01-20"),
			inspectionResult: "Vehículo con múltiples problemas. Transmisión con fallos, sistema eléctrico requiere revisión.",
			vehicleRating: "No comercial",
			marketValue: "150000.00",
			suggestedCommercialValue: "135000.00",
			bankValue: "130000.00",
			currentConditionValue: "120000.00",
			vehicleEquipment: "Equipamiento básico",
			importantConsiderations: "Requiere reparaciones mayores",
			scannerUsed: true,
			airbagWarning: true,
			missingAirbag: "Airbag lateral izquierdo",
			testDrive: false,
			noTestDriveReason: "Falla en transmisión impide manejo seguro",
			status: "rejected",
			alerts: ["Airbag", "Transmisión", "Sistema eléctrico"],
		},
		{
			technicianName: "María López",
			inspectionDate: new Date("2024-01-22"),
			inspectionResult: "Vehículo en muy buenas condiciones. Mantenimiento al día según bitácora.",
			vehicleRating: "Comercial",
			marketValue: "270000.00",
			suggestedCommercialValue: "255000.00",
			bankValue: "250000.00",
			currentConditionValue: "245000.00",
			vehicleEquipment: "Full equipo, asientos de cuero, techo panorámico",
			importantConsiderations: "Excelente estado general",
			scannerUsed: true,
			airbagWarning: false,
			testDrive: true,
			status: "approved",
			alerts: [],
		},
		{
			technicianName: "Javier Mendoza",
			inspectionDate: new Date("2024-01-25"),
			inspectionResult: "Vehículo en excelentes condiciones. Sin problemas detectados.",
			vehicleRating: "Comercial",
			marketValue: "290000.00",
			suggestedCommercialValue: "280000.00",
			bankValue: "275000.00",
			currentConditionValue: "275000.00",
			vehicleEquipment: "Full equipo premium, sistema de sonido Bose",
			importantConsiderations: "Vehículo prácticamente nuevo",
			scannerUsed: true,
			airbagWarning: false,
			testDrive: true,
			status: "approved",
			alerts: [],
		},
	];

	const insertedInspections = [];
	for (let i = 0; i < vehiclesList.length && i < inspectionsData.length; i++) {
		const vehicle = vehiclesList[i];
		const inspectionData = inspectionsData[i];

		const [insertedInspection] = await db
			.insert(vehicleInspections)
			.values({
				...inspectionData,
				vehicleId: vehicle.id,
			})
			.returning();
		insertedInspections.push(insertedInspection);
	}

	console.log(`✅ ${insertedInspections.length} vehicle inspections seeded`);
	return insertedInspections;
}

async function getOrCreateAdminUser() {
	try {
		// Look for an admin user
		const adminUser = await db
			.select()
			.from(user)
			.where(eq(user.role, "admin"))
			.limit(1);

		if (adminUser.length > 0) {
			console.log("Found existing admin user:", adminUser[0].email);
			return adminUser[0].id;
		}

		// If no admin user found, look for any user to use as seeder
		const anyUser = await db.select().from(user).limit(1);

		if (anyUser.length > 0) {
			console.log("No admin found, using first user:", anyUser[0].email);
			return anyUser[0].id;
		}

		console.log(
			"❌ No users found in database. Please create a user first before seeding CRM data.",
		);
		return null;
	} catch (error) {
		console.error("❌ Error finding admin user:", error);
		return null;
	}
}

async function main() {
	console.log("🌱 Starting CRM database seeding...");

	// Seed users first
	const usersList = await seedUsers();

	// Get admin user (still needed for fallback)
	const adminUserId = await getOrCreateAdminUser();
	if (!adminUserId) {
		console.log("❌ Cannot seed without a user. Please sign up first.");
		process.exit(1);
	}

	// Seed in order due to dependencies
	await seedSalesStages();
	const stagesList = await db.select().from(salesStages);

	const companiesList = await seedCompanies(usersList);
	const leadsList = await seedLeads(usersList, companiesList);
	const opportunitiesList = await seedOpportunities(
		usersList,
		companiesList,
		stagesList,
		leadsList,
	);
	const clientsList = await seedClients(usersList, companiesList);
	const creditAnalysisList = await seedCreditAnalysis(usersList, leadsList);
	
	// Seed vehicles, inspections, checklists and photos
	const vehiclesList = await seedVehicles(companiesList);
	const inspectionsList = await seedVehicleInspections(vehiclesList);
	const checklistsList = await seedInspectionChecklists(inspectionsList);
	const photosList = await seedVehiclePhotos(vehiclesList);

	console.log("\n🎉 CRM database seeding completed!");
	console.log(`✅ ${usersList.length} users`);
	console.log(`✅ ${stagesList.length} sales stages`);
	console.log(`✅ ${companiesList.length} companies`);
	console.log(`✅ ${leadsList.length} leads`);
	console.log(`✅ ${opportunitiesList.length} opportunities`);
	console.log(`✅ ${clientsList.length} clients`);
	console.log(`✅ ${creditAnalysisList.length} credit analyses`);
	console.log(`✅ ${vehiclesList.length} vehicles`);
	console.log(`✅ ${inspectionsList.length} vehicle inspections`);
	console.log(`✅ ${checklistsList.length} checklist items`);
	console.log(`✅ ${photosList.length} vehicle photos`);

	process.exit(0);
}

if (require.main === module) {
	main();
}

export { seedSalesStages };

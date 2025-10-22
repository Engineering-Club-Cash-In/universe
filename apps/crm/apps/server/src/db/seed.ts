import { eq } from "drizzle-orm";
import { db } from "./index";
import { user } from "./schema/auth";
import {
	casosCobros,
	contactosCobros,
	contratosFinanciamiento,
	conveniosPago,
	cuotasPago,
	notificacionesCobros,
	recuperacionesVehiculo,
} from "./schema/cobros";
import {
	clients,
	companies,
	creditAnalysis,
	leads,
	opportunities,
	salesStages,
} from "./schema/crm";
import { documentRequirements } from "./schema/documents";
import {
	inspectionChecklistItems,
	vehicleInspections,
	vehiclePhotos,
	vehicles,
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

// Document requirements data
const documentRequirementsData = [
	// Autocompra - Documentos obligatorios
	{
		creditType: "autocompra" as const,
		documentType: "identification" as const,
		required: true,
		description: "DPI o pasaporte del solicitante",
	},
	{
		creditType: "autocompra" as const,
		documentType: "income_proof" as const,
		required: true,
		description: "Constancia laboral, recibos de pago o estados financieros",
	},
	{
		creditType: "autocompra" as const,
		documentType: "bank_statement" as const,
		required: true,
		description: "Estados de cuenta bancarios de los últimos 3 meses",
	},
	{
		creditType: "autocompra" as const,
		documentType: "credit_report" as const,
		required: true,
		description: "Reporte crediticio actualizado",
	},
	// Sobre Vehículo - Documentos obligatorios
	{
		creditType: "sobre_vehiculo" as const,
		documentType: "identification" as const,
		required: true,
		description: "DPI o pasaporte del propietario",
	},
	{
		creditType: "sobre_vehiculo" as const,
		documentType: "vehicle_title" as const,
		required: true,
		description:
			"Tarjeta de circulación que demuestre la propiedad del vehículo",
	},
	{
		creditType: "sobre_vehiculo" as const,
		documentType: "income_proof" as const,
		required: true,
		description: "Constancia laboral, recibos de pago o estados financieros",
	},
	{
		creditType: "sobre_vehiculo" as const,
		documentType: "bank_statement" as const,
		required: true,
		description: "Estados de cuenta bancarios de los últimos 3 meses",
	},
	{
		creditType: "sobre_vehiculo" as const,
		documentType: "credit_report" as const,
		required: true,
		description: "Reporte crediticio actualizado",
	},
];

async function seedDocumentRequirements() {
	console.log("Seeding document requirements...");

	try {
		// Check if requirements already exist
		const existingRequirements = await db.select().from(documentRequirements);

		if (existingRequirements.length > 0) {
			console.log("Document requirements already exist, skipping seed...");
			return;
		}

		// Insert the document requirements
		await db.insert(documentRequirements).values(documentRequirementsData);

		console.log("✅ Document requirements seeded successfully!");
	} catch (error) {
		console.error("❌ Error seeding document requirements:", error);
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
			(lead) => lead.score && Number(lead.score) >= 0.7 && lead.fit === true,
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
	vehiclesList: any[],
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
			(stage) =>
				stage.name === "Recepción de documentación y traslado a análisis",
		);

		const opportunitiesWithRelations = opportunitiesData.map((opp, index) => {
			const assignedUser = usersList[index % usersList.length];

			// Put first 3 opportunities in analysis stage
			let stageId;
			if (index < 3 && analysisStage) {
				stageId = analysisStage.id;
			} else {
				stageId =
					stagesList[Math.floor(Math.random() * stagesList.length)]?.id ||
					stagesList[0]?.id;
			}

			return {
				...opp,
				companyId: companiesList[index % companiesList.length]?.id || null,
				leadId: leadsList[index % leadsList.length]?.id || null,
				vehicleId: vehiclesList[index % vehiclesList.length]?.id || null,
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
	{
		id: "cobros-user-1",
		name: "Luis Hernandez",
		email: "luis@crm.com",
		emailVerified: true,
		image: null,
		role: "cobros" as const,
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
		status: "available" as const,
		// GPS Information
		gpsActivo: true,
		dispositivoGPS: "Teltonika FMB130",
		imeiGPS: "867648040123456",
		ubicacionActualGPS: JSON.stringify({
			lat: 14.6349,
			lng: -90.5069,
			precision: 10,
			timestamp: new Date().toISOString(),
			address: "Zona 1, Guatemala City",
		}),
		ultimaSeñalGPS: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 horas atrás
		// Insurance Information
		seguroVigente: true,
		numeroPoliza: "POL-789123456",
		companiaSeguro: "Seguros G&T",
		fechaInicioSeguro: new Date("2024-01-01"),
		fechaVencimientoSeguro: new Date("2024-12-31"),
		montoAsegurado: "500000.00",
		deducible: "15000.00",
		tipoCobertura: "amplia",
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
		status: "pending" as const,
		// GPS Information
		gpsActivo: true,
		dispositivoGPS: "Queclink GV75W",
		imeiGPS: "867648040234567",
		ubicacionActualGPS: JSON.stringify({
			lat: 14.5844,
			lng: -90.5164,
			precision: 15,
			timestamp: new Date().toISOString(),
			address: "Zona 4, Guatemala City",
		}),
		ultimaSeñalGPS: new Date(Date.now() - 30 * 60 * 1000), // 30 minutos atrás
		// Insurance Information
		seguroVigente: true,
		numeroPoliza: "POL-456789123",
		companiaSeguro: "Aseguradora Guatemalteca",
		fechaInicioSeguro: new Date("2024-03-15"),
		fechaVencimientoSeguro: new Date("2025-03-14"),
		montoAsegurado: "650000.00",
		deducible: "20000.00",
		tipoCobertura: "total",
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
		status: "available" as const,
		// GPS Information
		gpsActivo: false,
		dispositivoGPS: null,
		imeiGPS: null,
		ubicacionActualGPS: null,
		ultimaSeñalGPS: null,
		// Insurance Information
		seguroVigente: false,
		numeroPoliza: null,
		companiaSeguro: null,
		fechaInicioSeguro: null,
		fechaVencimientoSeguro: null,
		montoAsegurado: null,
		deducible: null,
		tipoCobertura: null,
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
		status: "available" as const,
		// GPS Information
		gpsActivo: true,
		dispositivoGPS: "Concox GT06N",
		imeiGPS: "867648040345678",
		ubicacionActualGPS: JSON.stringify({
			lat: 14.6118,
			lng: -90.5265,
			precision: 8,
			timestamp: new Date().toISOString(),
			address: "Zona 9, Guatemala City",
		}),
		ultimaSeñalGPS: new Date(Date.now() - 5 * 60 * 1000), // 5 minutos atrás
		// Insurance Information
		seguroVigente: true,
		numeroPoliza: "POL-789456123",
		companiaSeguro: "Mapfre Guatemala",
		fechaInicioSeguro: new Date("2023-11-01"),
		fechaVencimientoSeguro: new Date("2024-10-31"),
		montoAsegurado: "450000.00",
		deducible: "12000.00",
		tipoCobertura: "basica",
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
		status: "available" as const,
		// GPS Information
		gpsActivo: true,
		dispositivoGPS: "Meitrack T366L",
		imeiGPS: "867648040456789",
		ubicacionActualGPS: JSON.stringify({
			lat: 14.6211,
			lng: -90.5069,
			precision: 12,
			timestamp: new Date().toISOString(),
			address: "Zona 10, Guatemala City",
		}),
		ultimaSeñalGPS: new Date(Date.now() - 15 * 60 * 1000), // 15 minutos atrás
		// Insurance Information
		seguroVigente: true,
		numeroPoliza: "POL-456123789",
		companiaSeguro: "Seguros G&T",
		fechaInicioSeguro: new Date("2024-05-01"),
		fechaVencimientoSeguro: new Date("2025-04-30"),
		montoAsegurado: "580000.00",
		deducible: "18000.00",
		tipoCobertura: "amplia",
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
		{
			category: "wheels",
			photoType: "front-wheels",
			label: "Ruedas delanteras",
		},
		{ category: "damage", photoType: "scratches", label: "Detalles" },
	];

	const baseGithubUrl =
		"https://raw.githubusercontent.com/EkdeepSLubana/raw_dataset/master/ISP_processed/";

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
		{
			category: "documentos",
			label: "Tarjeta de circulación",
			isRejectionCriteria: true,
		},
		{
			category: "documentos",
			label: "Título de propiedad",
			isRejectionCriteria: true,
		},
		{
			category: "documentos",
			label: "Seguro vigente",
			isRejectionCriteria: false,
		},
		{
			category: "documentos",
			label: "Historial de mantenimiento",
			isRejectionCriteria: false,
		},

		// Carrocería
		{
			category: "carroceria",
			label: "Sin daños estructurales",
			isRejectionCriteria: true,
		},
		{
			category: "carroceria",
			label: "Pintura en buen estado",
			isRejectionCriteria: false,
		},
		{
			category: "carroceria",
			label: "Sin óxido visible",
			isRejectionCriteria: false,
		},
		{
			category: "carroceria",
			label: "Puertas funcionan correctamente",
			isRejectionCriteria: false,
		},

		// Interior
		{
			category: "interior",
			label: "Asientos en buen estado",
			isRejectionCriteria: false,
		},
		{
			category: "interior",
			label: "Tablero sin daños",
			isRejectionCriteria: false,
		},
		{
			category: "interior",
			label: "Aire acondicionado funcional",
			isRejectionCriteria: false,
		},
		{
			category: "interior",
			label: "Sistema eléctrico operativo",
			isRejectionCriteria: true,
		},

		// Motor
		{ category: "motor", label: "Motor sin fugas", isRejectionCriteria: true },
		{
			category: "motor",
			label: "Niveles de fluidos correctos",
			isRejectionCriteria: false,
		},
		{
			category: "motor",
			label: "Sin ruidos anormales",
			isRejectionCriteria: true,
		},
		{
			category: "motor",
			label: "Sistema de enfriamiento funcional",
			isRejectionCriteria: false,
		},

		// Transmisión
		{
			category: "transmision",
			label: "Cambios suaves",
			isRejectionCriteria: true,
		},
		{
			category: "transmision",
			label: "Embrague funcional",
			isRejectionCriteria: true,
		},
		{
			category: "transmision",
			label: "Sin vibraciones",
			isRejectionCriteria: false,
		},

		// Frenos
		{
			category: "frenos",
			label: "Frenos responden bien",
			isRejectionCriteria: true,
		},
		{
			category: "frenos",
			label: "Discos/tambores en buen estado",
			isRejectionCriteria: true,
		},
		{
			category: "frenos",
			label: "Líquido de frenos al nivel",
			isRejectionCriteria: false,
		},
	];

	const insertedChecklists = [];

	for (const inspection of inspectionsList) {
		// Para cada inspección, crear items del checklist con valores aleatorios
		for (const template of checklistTemplates) {
			// Generar valor basado en el estado de la inspección
			let value = "yes";

			// Si la inspección fue rechazada, algunos criterios críticos deben ser 'no'
			if (
				inspection.status === "rejected" &&
				template.isRejectionCriteria &&
				Math.random() > 0.5
			) {
				value = "no";
			} else if (Math.random() > 0.85) {
				// 15% de probabilidad de que sea 'no' o 'n/a'
				value = Math.random() > 0.5 ? "no" : "n/a";
			}

			const [insertedItem] = await db
				.insert(inspectionChecklistItems)
				.values({
					inspectionId: inspection.id,
					category: template.category,
					item: template.label,
					checked: value === "yes",
					severity: template.isRejectionCriteria ? "critical" : "warning",
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
			inspectionResult:
				"Vehículo en excelentes condiciones. Motor en buen estado, carrocería sin daños relevantes.",
			vehicleRating: "Comercial",
			marketValue: "220000.00",
			suggestedCommercialValue: "205000.00",
			bankValue: "200000.00",
			currentConditionValue: "195000.00",
			vehicleEquipment:
				"Aire acondicionado, sistema de audio, bolsas de aire frontales y laterales",
			importantConsiderations: "Mantenimiento al día según bitácora",
			scannerUsed: true,
			airbagWarning: false,
			testDrive: true,
			status: "approved" as const,
			alerts: [],
		},
		{
			technicianName: "Ana Martínez",
			inspectionDate: new Date("2024-01-18"),
			inspectionResult:
				"Vehículo en buenas condiciones. Presenta desgaste normal por uso. Requiere cambio de frenos próximamente.",
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
			status: "pending" as const,
			alerts: ["Frenos"],
		},
		{
			technicianName: "Roberto Sánchez",
			inspectionDate: new Date("2024-01-20"),
			inspectionResult:
				"Vehículo con múltiples problemas. Transmisión con fallos, sistema eléctrico requiere revisión.",
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
			status: "rejected" as const,
			alerts: ["Airbag", "Transmisión", "Sistema eléctrico"],
		},
		{
			technicianName: "María López",
			inspectionDate: new Date("2024-01-22"),
			inspectionResult:
				"Vehículo en muy buenas condiciones. Mantenimiento al día según bitácora.",
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
			status: "approved" as const,
			alerts: [],
		},
		{
			technicianName: "Javier Mendoza",
			inspectionDate: new Date("2024-01-25"),
			inspectionResult:
				"Vehículo en excelentes condiciones. Sin problemas detectados.",
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
			status: "approved" as const,
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

// Datos de contratos de financiamiento
async function seedContratosFinanciamiento(
	clientsList: any[],
	vehiclesList: any[],
	usersList: any[],
) {
	console.log("💰 Seeding contratos de financiamiento...");

	try {
		const existingContratos = await db.select().from(contratosFinanciamiento);
		if (existingContratos.length > 0) {
			console.log("Contratos already exist, skipping seed...");
			return existingContratos;
		}

		// Crear 8 contratos de financiamiento con diferentes estados
		const contratosData = [
			{
				montoFinanciado: "500000.00",
				cuotaMensual: "25000.00",
				numeroCuotas: 24,
				tasaInteres: "15.50",
				fechaInicio: new Date("2023-06-01"),
				fechaVencimiento: new Date("2025-06-01"),
				diaPagoMensual: 15,
				estado: "activo" as const,
			},
			{
				montoFinanciado: "750000.00",
				cuotaMensual: "31250.00",
				numeroCuotas: 36,
				tasaInteres: "14.75",
				fechaInicio: new Date("2023-03-15"),
				fechaVencimiento: new Date("2026-03-15"),
				diaPagoMensual: 10,
				estado: "activo" as const,
			},
			{
				montoFinanciado: "300000.00",
				cuotaMensual: "18750.00",
				numeroCuotas: 18,
				tasaInteres: "16.25",
				fechaInicio: new Date("2023-09-01"),
				fechaVencimiento: new Date("2025-03-01"),
				diaPagoMensual: 5,
				estado: "activo" as const,
			},
			{
				montoFinanciado: "650000.00",
				cuotaMensual: "27083.33",
				numeroCuotas: 30,
				tasaInteres: "15.00",
				fechaInicio: new Date("2023-01-10"),
				fechaVencimiento: new Date("2025-07-10"),
				diaPagoMensual: 20,
				estado: "activo" as const,
			},
			{
				montoFinanciado: "400000.00",
				cuotaMensual: "20000.00",
				numeroCuotas: 24,
				tasaInteres: "17.00",
				fechaInicio: new Date("2023-12-01"),
				fechaVencimiento: new Date("2025-12-01"),
				diaPagoMensual: 25,
				estado: "completado" as const,
			},
			// Contratos al día (sin mora)
			{
				montoFinanciado: "350000.00",
				cuotaMensual: "17500.00",
				numeroCuotas: 24,
				tasaInteres: "14.50",
				fechaInicio: new Date("2024-01-15"),
				fechaVencimiento: new Date("2026-01-15"),
				diaPagoMensual: 8,
				estado: "activo" as const,
			},
			{
				montoFinanciado: "280000.00",
				cuotaMensual: "15555.56",
				numeroCuotas: 18,
				tasaInteres: "15.75",
				fechaInicio: new Date("2024-03-01"),
				fechaVencimiento: new Date("2025-09-01"),
				diaPagoMensual: 12,
				estado: "activo" as const,
			},
			// Contratos incobrables
			{
				montoFinanciado: "550000.00",
				cuotaMensual: "30555.56",
				numeroCuotas: 18,
				tasaInteres: "18.00",
				fechaInicio: new Date("2023-02-01"),
				fechaVencimiento: new Date("2024-08-01"),
				diaPagoMensual: 18,
				estado: "incobrable" as const,
			},
			{
				montoFinanciado: "420000.00",
				cuotaMensual: "23333.33",
				numeroCuotas: 18,
				tasaInteres: "19.50",
				fechaInicio: new Date("2022-10-01"),
				fechaVencimiento: new Date("2024-04-01"),
				diaPagoMensual: 22,
				estado: "recuperado" as const,
			},
		];

		const contratosWithRelations = contratosData.map((contrato, index) => {
			// Reutilizar clientes y vehículos si hay más contratos que entidades
			const responsableCobros =
				usersList.find((u) => u.role === "cobros") ||
				usersList.find((u) => u.role === "admin");
			return {
				...contrato,
				clientId: clientsList[index % clientsList.length].id, // Reutilizar clientes
				vehicleId: vehiclesList[index % vehiclesList.length].id, // Reutilizar vehículos
				responsableCobros: responsableCobros?.id,
				createdBy: usersList[0].id,
			};
		});

		const insertedContratos = await db
			.insert(contratosFinanciamiento)
			.values(contratosWithRelations)
			.returning();

		console.log(
			`✅ ${insertedContratos.length} contratos de financiamiento seeded`,
		);
		return insertedContratos;
	} catch (error) {
		console.error("❌ Error seeding contratos:", error);
		return [];
	}
}

// Datos de cuotas de pago
async function seedCuotasPago(contratosList: any[]) {
	console.log("📅 Seeding cuotas de pago...");

	try {
		const existingCuotas = await db.select().from(cuotasPago);
		if (existingCuotas.length > 0) {
			console.log("Cuotas already exist, skipping seed...");
			return existingCuotas;
		}

		const cuotasData = [];

		for (const contrato of contratosList) {
			// Crear cuotas mensuales para cada contrato
			const fechaInicio = new Date(contrato.fechaInicio);

			// Determinar hasta qué cuota ha pagado según el estado del contrato
			let ultimaCuotaPagada = 0;

			if (contrato.estado === "completado") {
				// Contrato completado: todas las cuotas pagadas
				ultimaCuotaPagada = contrato.numeroCuotas;
			} else if (contrato.estado === "activo") {
				// Contratos activos: diferentes niveles de pago
				const contratoIndex = contratosList.indexOf(contrato);
				if (contratoIndex < 4) {
					// Primeros 4: tienen mora (diferentes niveles)
					if (contratoIndex === 0)
						ultimaCuotaPagada = Math.floor(contrato.numeroCuotas * 0.7); // Mora leve
					else if (contratoIndex === 1)
						ultimaCuotaPagada = Math.floor(contrato.numeroCuotas * 0.6); // Mora moderada
					else if (contratoIndex === 2)
						ultimaCuotaPagada = Math.floor(contrato.numeroCuotas * 0.5); // Mora severa
					else ultimaCuotaPagada = Math.floor(contrato.numeroCuotas * 0.4); // Mora crítica
				} else {
					// Contratos 5-6: al día
					ultimaCuotaPagada = Math.floor(contrato.numeroCuotas * 0.95); // 95% pagadas, al día
				}
			} else if (
				contrato.estado === "incobrable" ||
				contrato.estado === "recuperado"
			) {
				// Contratos incobrables: pagaron muy poco antes de dejar de pagar
				ultimaCuotaPagada = Math.floor(contrato.numeroCuotas * 0.3); // Solo 30% pagadas
			}

			for (let i = 1; i <= contrato.numeroCuotas; i++) {
				const fechaVencimiento = new Date(fechaInicio);
				fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i - 1);
				fechaVencimiento.setDate(contrato.diaPagoMensual);

				const hoy = new Date();
				const diasRetraso = Math.floor(
					(hoy.getTime() - fechaVencimiento.getTime()) / (1000 * 60 * 60 * 24),
				);

				let estadoMora:
					| "al_dia"
					| "mora_30"
					| "mora_60"
					| "mora_90"
					| "mora_120"
					| "mora_120_plus"
					| "pagado"
					| "incobrable" = "al_dia";
				let fechaPago = null;
				let montoPagado = null;
				let montoMora = "0.00";

				if (i <= ultimaCuotaPagada) {
					// Cuotas ya pagadas (secuencialmente)
					estadoMora = "pagado" as const;

					// Simular fecha de pago: algunas a tiempo, otras con mora
					const pagoConMora = Math.random() > 0.7; // 30% de pagos tuvieron mora

					if (pagoConMora) {
						// Pago con mora: se pagó 1-15 días después del vencimiento
						fechaPago = new Date(fechaVencimiento);
						const diasMoraPago = Math.floor(Math.random() * 15) + 1;
						fechaPago.setDate(fechaPago.getDate() + diasMoraPago);

						// Calcular mora que se pagó
						const mesesMora = Math.ceil(diasMoraPago / 30);
						montoMora = (
							Number(contrato.cuotaMensual) *
							0.02 *
							mesesMora
						).toFixed(2);
						montoPagado = (
							Number(contrato.cuotaMensual) + Number(montoMora)
						).toFixed(2);
					} else {
						// Pago a tiempo
						fechaPago = new Date(fechaVencimiento);
						fechaPago.setDate(
							fechaPago.getDate() + Math.floor(Math.random() * 3),
						); // 0-3 días después
						montoPagado = contrato.cuotaMensual;
						montoMora = "0.00";
					}
				} else {
					// Cuotas pendientes/en mora (secuencialmente después de la última pagada)
					if (diasRetraso > 0) {
						// Cuota vencida - calcular nivel de mora
						if (diasRetraso <= 30) estadoMora = "mora_30" as const;
						else if (diasRetraso <= 60) estadoMora = "mora_60" as const;
						else if (diasRetraso <= 90) estadoMora = "mora_90" as const;
						else if (diasRetraso <= 120) estadoMora = "mora_120" as const;
						else estadoMora = "mora_120_plus" as const;

						// Calcular mora acumulada
						const mesesMora = Math.ceil(diasRetraso / 30);
						montoMora = (
							Number(contrato.cuotaMensual) *
							0.02 *
							mesesMora
						).toFixed(2);
					} else {
						// Cuota aún no vencida
						estadoMora = "al_dia" as const;
					}
				}

				cuotasData.push({
					contratoId: contrato.id,
					numeroCuota: i,
					fechaVencimiento,
					montoCuota: contrato.cuotaMensual,
					fechaPago,
					montoPagado,
					montoMora,
					estadoMora,
					diasMora: diasRetraso > 0 && i > ultimaCuotaPagada ? diasRetraso : 0,
				});
			}
		}

		const insertedCuotas = await db
			.insert(cuotasPago)
			.values(cuotasData)
			.returning();

		console.log(`✅ ${insertedCuotas.length} cuotas de pago seeded`);
		return insertedCuotas;
	} catch (error) {
		console.error("❌ Error seeding cuotas:", error);
		return [];
	}
}

// Datos de casos de cobros
async function seedCasosCobros(
	contratosList: any[],
	clientsList: any[],
	vehiclesList: any[],
	usersList: any[],
) {
	console.log("⚠️ Seeding casos de cobros...");

	try {
		const existingCasos = await db.select().from(casosCobros);
		if (existingCasos.length > 0) {
			console.log("Casos de cobros already exist, skipping seed...");
			return existingCasos;
		}

		// Crear casos para diferentes tipos de contratos
		const casosData: any[] = [];

		contratosList.forEach((contrato, index) => {
			if (index >= clientsList.length) return;

			const cliente = clientsList[index];
			const responsableCobros =
				usersList.find((u) => u.role === "cobros") ||
				usersList.find((u) => u.role === "admin");

			// Determinar tipo de caso basado en el estado del contrato
			if (contrato.estado === "activo") {
				// Casos activos: algunos en mora, otros al día
				if (index < 4) {
					// Primeros 4: casos con diferentes niveles de mora
					const estados = [
						"mora_30",
						"mora_60",
						"mora_90",
						"mora_120",
					] as const;
					const estadoMora = estados[index % estados.length];
					const montosEnMora = [
						"75000.00",
						"125000.00",
						"187500.00",
						"250000.00",
					];
					const diasMora = [35, 65, 85, 125];
					const cuotasVencidas = [2, 3, 4, 5];

					casosData.push({
						contratoId: contrato.id,
						estadoMora,
						montoEnMora: montosEnMora[index],
						diasMoraMaximo: diasMora[index],
						cuotasVencidas: cuotasVencidas[index],
						responsableCobros: responsableCobros?.id,
						telefonoPrincipal: "+502 5555 0" + (index + 1) + "01",
						telefonoAlternativo: "+502 4444 0" + (index + 1) + "01",
						emailContacto:
							cliente.contactPerson.toLowerCase().replace(" ", ".") +
							"@email.com",
						direccionContacto: `Zona ${index + 10}, Ciudad de Guatemala`,
						proximoContacto: new Date(
							Date.now() + (index + 1) * 24 * 60 * 60 * 1000,
						),
						metodoContactoProximo: (
							["llamada", "whatsapp", "email", "visita_domicilio"] as const
						)[index],
					});
				}
				// Los contratos 5-6 están al día, no necesitan casos de cobros
			} else if (
				contrato.estado === "incobrable" ||
				contrato.estado === "recuperado"
			) {
				// Casos incobrables con recuperación de vehículo
				casosData.push({
					contratoId: contrato.id,
					estadoMora: "incobrable" as const,
					montoEnMora: (Number(contrato.cuotaMensual) * 8).toFixed(2), // 8 cuotas vencidas
					diasMoraMaximo: 180, // 6 meses sin pagar
					cuotasVencidas: 8,
					responsableCobros: responsableCobros?.id,
					telefonoPrincipal: "+502 5555 0" + (index + 1) + "01",
					telefonoAlternativo: "+502 4444 0" + (index + 1) + "01",
					emailContacto:
						cliente.contactPerson.toLowerCase().replace(" ", ".") +
						"@email.com",
					direccionContacto: `Zona ${index + 10}, Ciudad de Guatemala`,
					proximoContacto: null, // No hay próximo contacto para incobrables
					metodoContactoProximo: null,
					activo: true, // Los casos incobrables también deben ser visibles
				});
			}
		});

		const insertedCasos = await db
			.insert(casosCobros)
			.values(casosData)
			.returning();

		console.log(`✅ ${insertedCasos.length} casos de cobros seeded`);
		return insertedCasos;
	} catch (error) {
		console.error("❌ Error seeding casos de cobros:", error);
		return [];
	}
}

// Datos de contactos de cobros
async function seedContactosCobros(casosList: any[], usersList: any[]) {
	console.log("📞 Seeding contactos de cobros...");

	try {
		const existingContactos = await db.select().from(contactosCobros);
		if (existingContactos.length > 0) {
			console.log("Contactos de cobros already exist, skipping seed...");
			return existingContactos;
		}

		const contactosData = [];
		const responsableCobros =
			usersList.find((u) => u.role === "cobros") ||
			usersList.find((u) => u.role === "admin");

		for (const caso of casosList) {
			// 2-4 contactos por caso
			const numeroContactos = Math.floor(Math.random() * 3) + 2;

			for (let i = 0; i < numeroContactos; i++) {
				const fechaContacto = new Date();
				fechaContacto.setDate(
					fechaContacto.getDate() - (numeroContactos - i) * 2,
				); // Contactos cada 2 días

				const metodos = ["llamada", "whatsapp", "email"] as const;
				const estados = [
					"contactado",
					"promesa_pago",
					"no_contesta",
					"acuerdo_parcial",
					"rechaza_pagar",
				] as const;

				const metodoContacto = metodos[i % metodos.length];
				const estadoContacto =
					estados[Math.floor(Math.random() * estados.length)];

				const comentarios = [
					"Cliente atendió la llamada, menciona dificultades económicas temporales",
					"Se estableció compromiso de pago para el próximo viernes",
					"Cliente no respondió, buzón de voz completo",
					"Acuerdo parcial: pagará 50% esta semana y 50% la siguiente",
					"Cliente rechaza reconocer la deuda, solicita verificación de documentos",
				];

				const acuerdos = [
					"Pago completo antes del viernes",
					"Pago en dos partes: 50% hoy, 50% en una semana",
					"",
					"Convenio de pago a 3 meses",
					"",
				];

				contactosData.push({
					casoCobroId: caso.id,
					fechaContacto,
					metodoContacto,
					estadoContacto,
					duracionLlamada:
						metodoContacto === "llamada"
							? Math.floor(Math.random() * 300) + 60
							: null,
					comentarios: comentarios[i % comentarios.length],
					acuerdosAlcanzados: acuerdos[i % acuerdos.length],
					compromisosPago:
						estadoContacto === "promesa_pago"
							? `Pago de Q${Math.floor(Math.random() * 50000) + 25000} antes del ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}`
							: "",
					requiereSeguimiento: Math.random() > 0.4,
					fechaProximoContacto:
						Math.random() > 0.4
							? new Date(
									Date.now() +
										Math.floor(Math.random() * 7) * 24 * 60 * 60 * 1000,
								)
							: null,
					realizadoPor: responsableCobros?.id,
				});
			}
		}

		const insertedContactos = await db
			.insert(contactosCobros)
			.values(contactosData)
			.returning();

		console.log(`✅ ${insertedContactos.length} contactos de cobros seeded`);
		return insertedContactos;
	} catch (error) {
		console.error("❌ Error seeding contactos:", error);
		return [];
	}
}

// Datos de convenios de pago
async function seedConveniosPago(casosList: any[], usersList: any[]) {
	console.log("🤝 Seeding convenios de pago...");

	try {
		const existingConvenios = await db.select().from(conveniosPago);
		if (existingConvenios.length > 0) {
			console.log("Convenios already exist, skipping seed...");
			return existingConvenios;
		}

		// Solo algunos casos tienen convenios (primeros 2 casos)
		const casosConConvenio = casosList.slice(0, 2);
		const responsableAdmin = usersList.find((u) => u.role === "admin");

		const conveniosData = casosConConvenio.map((caso, index) => ({
			casoCobroId: caso.id,
			montoAcordado: (Number(caso.montoEnMora) * 0.8).toFixed(2), // 80% del monto en mora
			numeroCuotasConvenio: [3, 4, 6, 8][index % 4], // 3-8 cuotas
			montoCuotaConvenio: (
				(Number(caso.montoEnMora) * 0.8) /
				[3, 4, 6, 8][index % 4]
			).toFixed(2),
			fechaInicioConvenio: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Inicia en una semana
			activo: true,
			cumplido: Math.random() > 0.7, // 30% están cumplidos
			cuotasCumplidas: Math.floor(Math.random() * 3),
			condicionesEspeciales:
				index % 2 === 0
					? "Pago únicamente los viernes, horario de 9am a 4pm"
					: "",
			aprobadoPor: responsableAdmin?.id,
		}));

		const insertedConvenios = await db
			.insert(conveniosPago)
			.values(conveniosData)
			.returning();

		console.log(`✅ ${insertedConvenios.length} convenios de pago seeded`);
		return insertedConvenios;
	} catch (error) {
		console.error("❌ Error seeding convenios:", error);
		return [];
	}
}

// Datos de recuperaciones de vehículo
async function seedRecuperacionesVehiculo(casosList: any[], usersList: any[]) {
	console.log("🚗 Seeding recuperaciones de vehículo...");

	try {
		const existingRecuperaciones = await db
			.select()
			.from(recuperacionesVehiculo);
		if (existingRecuperaciones.length > 0) {
			console.log("Recuperaciones already exist, skipping seed...");
			return existingRecuperaciones;
		}

		// Solo casos de mora avanzada requieren recuperación
		const casosCriticos = casosList.filter((caso) =>
			["mora_90", "mora_120", "mora_120_plus"].includes(caso.estadoMora),
		);

		const tiposRecuperacion = [
			"entrega_voluntaria",
			"tomado",
			"orden_secuestro",
		] as const;
		const responsableAdmin = usersList.find((u) => u.role === "admin");

		const recuperacionesData = casosCriticos.map((caso, index) => ({
			casoCobroId: caso.id,
			tipoRecuperacion: tiposRecuperacion[index % tiposRecuperacion.length],
			fechaRecuperacion:
				index % 2 === 0
					? new Date(
							Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000,
						)
					: null,

			// Proceso legal (solo para orden_secuestro)
			ordenSecuestro:
				tiposRecuperacion[index % tiposRecuperacion.length] ===
				"orden_secuestro",
			numeroExpediente:
				tiposRecuperacion[index % tiposRecuperacion.length] ===
				"orden_secuestro"
					? `EXP-${Math.floor(Math.random() * 90000) + 10000}`
					: null,
			juzgadoCompetente:
				tiposRecuperacion[index % tiposRecuperacion.length] ===
				"orden_secuestro"
					? "Juzgado de Primera Instancia Civil"
					: null,

			completada: Math.random() > 0.5, // 50% completadas
			observaciones:
				index % 2 === 0
					? "Vehículo localizado en buen estado"
					: "Cliente cooperativo en el proceso",
			responsableRecuperacion: responsableAdmin?.id,
		}));

		const insertedRecuperaciones = await db
			.insert(recuperacionesVehiculo)
			.values(recuperacionesData)
			.returning();

		console.log(
			`✅ ${insertedRecuperaciones.length} recuperaciones de vehículo seeded`,
		);
		return insertedRecuperaciones;
	} catch (error) {
		console.error("❌ Error seeding recuperaciones:", error);
		return [];
	}
}

// Datos de notificaciones
async function seedNotificacionesCobros(casosList: any[]) {
	console.log("🔔 Seeding notificaciones de cobros...");

	try {
		const existingNotificaciones = await db.select().from(notificacionesCobros);
		if (existingNotificaciones.length > 0) {
			console.log("Notificaciones already exist, skipping seed...");
			return existingNotificaciones;
		}

		const notificacionesData = [];

		for (const caso of casosList) {
			// 2-5 notificaciones por caso
			const numeroNotificaciones = Math.floor(Math.random() * 4) + 2;

			for (let i = 0; i < numeroNotificaciones; i++) {
				const tiposNotificacion = [
					"vencimiento_proximo",
					"mora_30",
					"mora_60",
					"recordatorio_pago",
				];
				const canales = ["email", "whatsapp", "llamada"] as const;

				const fechaEnvio =
					Math.random() > 0.3
						? new Date(
								Date.now() -
									Math.floor(Math.random() * 15) * 24 * 60 * 60 * 1000,
							)
						: null;

				notificacionesData.push({
					casoCobroId: caso.id,
					tipoNotificacion: tiposNotificacion[i % tiposNotificacion.length],
					canal: canales[i % canales.length],
					asunto: `Recordatorio de Pago - Cuota ${i + 1}`,
					mensaje: `Estimado cliente, le recordamos que tiene una cuota pendiente de pago por Q${Number(caso.montoEnMora) / caso.cuotasVencidas}. Por favor, acérquese a nuestras oficinas o contacte a su asesor.`,
					enviada: !!fechaEnvio,
					fechaEnvio,
					respuesta:
						fechaEnvio && Math.random() > 0.7
							? "Cliente confirmó recepción, pagará mañana"
							: null,
					fechaProgramada: new Date(Date.now() + i * 24 * 60 * 60 * 1000), // Una cada día
				});
			}
		}

		const insertedNotificaciones = await db
			.insert(notificacionesCobros)
			.values(notificacionesData)
			.returning();

		console.log(`✅ ${insertedNotificaciones.length} notificaciones seeded`);
		return insertedNotificaciones;
	} catch (error) {
		console.error("❌ Error seeding notificaciones:", error);
		return [];
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
	await seedDocumentRequirements();

	const companiesList = await seedCompanies(usersList);
	const leadsList = await seedLeads(usersList, companiesList);

	// Seed vehicles first so we can associate them with opportunities
	const vehiclesList = await seedVehicles(companiesList);

	const opportunitiesList = await seedOpportunities(
		usersList,
		companiesList,
		stagesList,
		leadsList,
		vehiclesList,
	);
	const clientsList = await seedClients(usersList, companiesList);
	const creditAnalysisList = await seedCreditAnalysis(usersList, leadsList);

	// Seed inspections, checklists and photos
	const inspectionsList = await seedVehicleInspections(vehiclesList);
	const checklistsList = await seedInspectionChecklists(inspectionsList);
	const photosList = await seedVehiclePhotos(vehiclesList);

	// Seed cobros system data
	const contratosList = await seedContratosFinanciamiento(
		clientsList,
		vehiclesList,
		usersList,
	);
	const cuotasList = await seedCuotasPago(contratosList);
	const casosList = await seedCasosCobros(
		contratosList,
		clientsList,
		vehiclesList,
		usersList,
	);
	const contactosList = await seedContactosCobros(casosList, usersList);
	const conveniosList = await seedConveniosPago(casosList, usersList);
	const recuperacionesList = await seedRecuperacionesVehiculo(
		casosList,
		usersList,
	);
	const notificacionesList = await seedNotificacionesCobros(casosList);

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
	console.log(`✅ ${contratosList.length} contratos de financiamiento`);
	console.log(`✅ ${cuotasList.length} cuotas de pago`);
	console.log(`✅ ${casosList.length} casos de cobros`);
	console.log(`✅ ${contactosList.length} contactos de cobros`);
	console.log(`✅ ${conveniosList.length} convenios de pago`);
	console.log(`✅ ${recuperacionesList.length} recuperaciones de vehículo`);
	console.log(`✅ ${notificacionesList.length} notificaciones de cobros`);

	process.exit(0);
}

if (require.main === module) {
	main();
}

export { seedSalesStages };

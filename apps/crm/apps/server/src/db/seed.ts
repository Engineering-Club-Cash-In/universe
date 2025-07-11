import { db } from "./index";
import { salesStages, companies, leads, opportunities, clients } from "./schema/crm";
import { user } from "./schema/auth";
import { eq } from "drizzle-orm";

const salesStagesData = [
  {
    name: "Preparación",
    order: 1,
    closurePercentage: 1,
    color: "#ef4444", // red-500
    description: "Fase inicial de preparación del contacto"
  },
  {
    name: "Llamada de presentación e identificación de necesidades",
    order: 2,
    closurePercentage: 10,
    color: "#eab308", // yellow-500
    description: "Primera llamada para presentar la empresa e identificar necesidades del cliente"
  },
  {
    name: "Solución y propuesta",
    order: 3,
    closurePercentage: 20,
    color: "#eab308", // yellow-500
    description: "Desarrollo de la solución y elaboración de propuesta"
  },
  {
    name: "Recepción de documentación y traslado a análisis",
    order: 4,
    closurePercentage: 30,
    color: "#eab308", // yellow-500
    description: "Recopilación de documentos necesarios y análisis interno"
  },
  {
    name: "Cierre de propuesta",
    order: 5,
    closurePercentage: 40,
    color: "#eab308", // yellow-500
    description: "Finalización y presentación de la propuesta al cliente"
  },
  {
    name: "Formalización",
    order: 6,
    closurePercentage: 50,
    color: "#22c55e", // green-500
    description: "Inicio del proceso de formalización del acuerdo"
  },
  {
    name: "Cierre Final",
    order: 7,
    closurePercentage: 80,
    color: "#22c55e", // green-500
    description: "Cierre definitivo del negocio"
  },
  {
    name: "Formalización Final",
    order: 8,
    closurePercentage: 90,
    color: "#22c55e", // green-500
    description: "Formalización completa de todos los documentos"
  },
  {
    name: "Post Venta",
    order: 9,
    closurePercentage: 100,
    color: "#22c55e", // green-500
    description: "Seguimiento post-venta y gestión de la relación cliente"
  }
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
    notes: "Leading technology solutions provider"
  },
  {
    name: "Global Finance SA",
    industry: "finance",
    size: "enterprise",
    website: "https://globalfinance.es",
    address: "456 Finance Ave, Barcelona, Spain",
    phone: "+34 93 987 6543",
    email: "info@globalfinance.es",
    notes: "Major financial services company"
  },
  {
    name: "HealthPlus Clinic",
    industry: "healthcare",
    size: "medium",
    website: "https://healthplus.es",
    address: "789 Health Blvd, Valencia, Spain",
    phone: "+34 96 555 0123",
    email: "contact@healthplus.es",
    notes: "Private healthcare clinic chain"
  },
  {
    name: "RetailMax",
    industry: "retail",
    size: "large",
    website: "https://retailmax.com",
    address: "321 Retail Plaza, Sevilla, Spain",
    phone: "+34 95 444 5678",
    email: "sales@retailmax.com",
    notes: "Multi-channel retail company"
  },
  {
    name: "StartupInnovate",
    industry: "technology",
    size: "startup",
    website: "https://startupinnovate.io",
    address: "654 Innovation Hub, Bilbao, Spain",
    phone: "+34 94 333 9876",
    email: "hello@startupinnovate.io",
    notes: "AI-focused startup company"
  },
  {
    name: "ManufacturingPro",
    industry: "manufacturing",
    size: "large",
    website: "https://manufacturingpro.es",
    address: "987 Industrial Zone, Zaragoza, Spain",
    phone: "+34 97 222 1234",
    email: "contact@manufacturingpro.es",
    notes: "Industrial manufacturing specialist"
  },
  {
    name: "EduConsulting",
    industry: "education",
    size: "small",
    website: "https://educonsulting.es",
    address: "147 Education Street, Granada, Spain",
    phone: "+34 95 888 7777",
    email: "info@educonsulting.es",
    notes: "Educational consulting services"
  },
  {
    name: "ConsultingExperts",
    industry: "consulting",
    size: "medium",
    website: "https://consultingexperts.com",
    address: "258 Business Center, Málaga, Spain",
    phone: "+34 95 111 2222",
    email: "experts@consultingexperts.com",
    notes: "Business strategy consulting firm"
  }
];

// Sample leads data
const leadsData = [
  {
    firstName: "Carlos",
    lastName: "Rodriguez",
    email: "carlos.rodriguez@techcorp.com",
    phone: "+34 91 123 4567",
    jobTitle: "CTO",
    source: "website" as const,
    status: "new" as const,
    notes: "Interested in our enterprise solutions"
  },
  {
    firstName: "Maria",
    lastName: "Garcia",
    email: "maria.garcia@globalfinance.es",
    phone: "+34 93 987 6543",
    jobTitle: "Finance Director",
    source: "referral" as const,
    status: "contacted" as const,
    notes: "Referred by existing client"
  },
  {
    firstName: "Javier",
    lastName: "Martinez",
    email: "javier.martinez@healthplus.es",
    phone: "+34 96 555 0123",
    jobTitle: "Operations Manager",
    source: "cold_call" as const,
    status: "qualified" as const,
    notes: "Looking for workflow automation"
  },
  {
    firstName: "Ana",
    lastName: "Lopez",
    email: "ana.lopez@retailmax.com",
    phone: "+34 95 444 5678",
    jobTitle: "IT Director",
    source: "email" as const,
    status: "new" as const,
    notes: "E-commerce integration needs"
  },
  {
    firstName: "Pedro",
    lastName: "Sanchez",
    email: "pedro.sanchez@startupinnovate.io",
    phone: "+34 94 333 9876",
    jobTitle: "CEO",
    source: "social_media" as const,
    status: "contacted" as const,
    notes: "Startup looking for scalable solutions"
  },
  {
    firstName: "Laura",
    lastName: "Fernandez",
    email: "laura.fernandez@manufacturingpro.es",
    phone: "+34 97 222 1234",
    jobTitle: "Production Manager",
    source: "event" as const,
    status: "qualified" as const,
    notes: "Met at industry conference"
  },
  {
    firstName: "Miguel",
    lastName: "Torres",
    email: "miguel.torres@educonsulting.es",
    phone: "+34 95 888 7777",
    jobTitle: "Director",
    source: "referral" as const,
    status: "unqualified" as const,
    notes: "Budget constraints identified"
  },
  {
    firstName: "Isabel",
    lastName: "Ruiz",
    email: "isabel.ruiz@consultingexperts.com",
    phone: "+34 95 111 2222",
    jobTitle: "Senior Consultant",
    source: "website" as const,
    status: "converted" as const,
    notes: "Successfully converted to opportunity"
  }
];

// Sample opportunities data
const opportunitiesData = [
  {
    title: "TechCorp Enterprise License",
    value: "150000.00",
    probability: 80,
    expectedCloseDate: new Date('2024-02-15'),
    status: "open" as const,
    notes: "Large enterprise deal with high probability"
  },
  {
    title: "GlobalFinance Integration Project",
    value: "75000.00",
    probability: 60,
    expectedCloseDate: new Date('2024-03-01'),
    status: "open" as const,
    notes: "Financial system integration project"
  },
  {
    title: "HealthPlus Automation Suite",
    value: "95000.00",
    probability: 70,
    expectedCloseDate: new Date('2024-02-28'),
    status: "open" as const,
    notes: "Healthcare workflow automation"
  },
  {
    title: "RetailMax E-commerce Platform",
    value: "120000.00",
    probability: 45,
    expectedCloseDate: new Date('2024-04-15'),
    status: "open" as const,
    notes: "Multi-channel e-commerce solution"
  },
  {
    title: "StartupInnovate MVP Package",
    value: "25000.00",
    probability: 90,
    expectedCloseDate: new Date('2024-01-30'),
    status: "open" as const,
    notes: "Small but high-probability startup deal"
  },
  {
    title: "ManufacturingPro ERP System",
    value: "200000.00",
    probability: 50,
    expectedCloseDate: new Date('2024-05-01'),
    status: "open" as const,
    notes: "Large ERP implementation project"
  },
  {
    title: "ConsultingExperts CRM Setup",
    value: "40000.00",
    probability: 95,
    expectedCloseDate: new Date('2024-01-25'),
    status: "won" as const,
    notes: "Successfully closed CRM implementation"
  }
];

// Sample clients data
const clientsData = [
  {
    contactPerson: "Isabel Ruiz",
    contractValue: "40000.00",
    startDate: new Date('2024-01-15'),
    endDate: new Date('2024-12-31'),
    status: "active" as const,
    notes: "CRM implementation client, very satisfied"
  },
  {
    contactPerson: "Roberto Silva",
    contractValue: "85000.00",
    startDate: new Date('2023-06-01'),
    endDate: new Date('2024-05-31'),
    status: "active" as const,
    notes: "Long-term software licensing client"
  },
  {
    contactPerson: "Carmen Vega",
    contractValue: "60000.00",
    startDate: new Date('2023-09-15'),
    endDate: new Date('2024-09-14'),
    status: "active" as const,
    notes: "Digital transformation project"
  },
  {
    contactPerson: "Antonio Morales",
    contractValue: "25000.00",
    startDate: new Date('2023-03-01'),
    endDate: new Date('2023-12-31'),
    status: "inactive" as const,
    notes: "Contract expired, considering renewal"
  },
  {
    contactPerson: "Sofia Herrera",
    contractValue: "110000.00",
    startDate: new Date('2022-11-01'),
    endDate: new Date('2023-10-31'),
    status: "churned" as const,
    notes: "Switched to competitor due to pricing"
  }
];

async function seedCompanies(adminUserId: string) {
  console.log("Seeding companies...");
  
  try {
    const existingCompanies = await db.select().from(companies);
    
    if (existingCompanies.length > 0) {
      console.log("Companies already exist, skipping seed...");
      return existingCompanies;
    }

    const companiesWithUser = companiesData.map(company => ({
      ...company,
      createdBy: adminUserId,
      updatedAt: new Date()
    }));

    const insertedCompanies = await db.insert(companies).values(companiesWithUser).returning();
    
    console.log("✅ Companies seeded successfully!");
    return insertedCompanies;
  } catch (error) {
    console.error("❌ Error seeding companies:", error);
    return [];
  }
}

async function seedLeads(adminUserId: string, companiesList: any[]) {
  console.log("Seeding leads...");
  
  try {
    const existingLeads = await db.select().from(leads);
    
    if (existingLeads.length > 0) {
      console.log("Leads already exist, skipping seed...");
      return existingLeads;
    }

    const leadsWithRelations = leadsData.map((lead, index) => ({
      ...lead,
      companyId: companiesList[index % companiesList.length]?.id || null,
      assignedTo: adminUserId,
      createdBy: adminUserId,
      updatedAt: new Date()
    }));

    const insertedLeads = await db.insert(leads).values(leadsWithRelations).returning();
    
    console.log("✅ Leads seeded successfully!");
    return insertedLeads;
  } catch (error) {
    console.error("❌ Error seeding leads:", error);
    return [];
  }
}

async function seedOpportunities(adminUserId: string, companiesList: any[], stagesList: any[]) {
  console.log("Seeding opportunities...");
  
  try {
    const existingOpportunities = await db.select().from(opportunities);
    
    if (existingOpportunities.length > 0) {
      console.log("Opportunities already exist, skipping seed...");
      return existingOpportunities;
    }

    const opportunitiesWithRelations = opportunitiesData.map((opp, index) => ({
      ...opp,
      companyId: companiesList[index % companiesList.length]?.id || null,
      stageId: stagesList[Math.floor(Math.random() * stagesList.length)]?.id || stagesList[0]?.id,
      assignedTo: adminUserId,
      createdBy: adminUserId,
      updatedAt: new Date()
    }));

    const insertedOpportunities = await db.insert(opportunities).values(opportunitiesWithRelations).returning();
    
    console.log("✅ Opportunities seeded successfully!");
    return insertedOpportunities;
  } catch (error) {
    console.error("❌ Error seeding opportunities:", error);
    return [];
  }
}

async function seedClients(adminUserId: string, companiesList: any[]) {
  console.log("Seeding clients...");
  
  try {
    const existingClients = await db.select().from(clients);
    
    if (existingClients.length > 0) {
      console.log("Clients already exist, skipping seed...");
      return existingClients;
    }

    const clientsWithRelations = clientsData.map((client, index) => ({
      ...client,
      companyId: companiesList[index % companiesList.length]?.id || companiesList[0]?.id,
      assignedTo: adminUserId,
      createdBy: adminUserId,
      updatedAt: new Date()
    }));

    const insertedClients = await db.insert(clients).values(clientsWithRelations).returning();
    
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
    updatedAt: new Date()
  },
  {
    id: "sales-user-1",
    name: "Carlos Rodriguez",
    email: "carlos@crm.com",
    emailVerified: true,
    image: null,
    role: "sales" as const,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: "sales-user-2",
    name: "Maria Garcia",
    email: "maria@crm.com",
    emailVerified: true,
    image: null,
    role: "sales" as const,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: "sales-user-3",
    name: "Javier Martinez",
    email: "javier@crm.com",
    emailVerified: true,
    image: null,
    role: "sales" as const,
    createdAt: new Date(),
    updatedAt: new Date()
  }
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

async function getOrCreateAdminUser() {
  try {
    // Look for an admin user
    const adminUser = await db.select().from(user).where(eq(user.role, 'admin')).limit(1);
    
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
    
    console.log("❌ No users found in database. Please create a user first before seeding CRM data.");
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
  
  // Get admin user
  const adminUserId = await getOrCreateAdminUser();
  if (!adminUserId) {
    console.log("❌ Cannot seed without a user. Please sign up first.");
    process.exit(1);
  }

  // Seed in order due to dependencies
  await seedSalesStages();
  const stagesList = await db.select().from(salesStages);
  
  const companiesList = await seedCompanies(adminUserId);
  const leadsList = await seedLeads(adminUserId, companiesList);
  const opportunitiesList = await seedOpportunities(adminUserId, companiesList, stagesList);
  const clientsList = await seedClients(adminUserId, companiesList);
  
  console.log("\n🎉 CRM database seeding completed!");
  console.log(`✅ ${usersList.length} users`);
  console.log(`✅ ${stagesList.length} sales stages`);
  console.log(`✅ ${companiesList.length} companies`);
  console.log(`✅ ${leadsList.length} leads`);
  console.log(`✅ ${opportunitiesList.length} opportunities`);
  console.log(`✅ ${clientsList.length} clients`);
  
  process.exit(0);
}

if (require.main === module) {
  main();
}

export { seedSalesStages };
import { db } from "./index";
import { user } from "./schema/auth";
import bcrypt from "bcryptjs";

// Sample users data with passwords
const usersData = [
  {
    name: "Admin User",
    email: "admin@clubcashin.com",
    password: "admin123",
    role: "admin" as const,
  },
  {
    name: "Carlos Rodriguez",
    email: "carlos@clubcashin.com",
    password: "sales123",
    role: "sales" as const,
  },
  {
    name: "Maria Garcia",
    email: "maria@clubcashin.com",
    password: "sales123",
    role: "sales" as const,
  },
  {
    name: "Javier Martinez",
    email: "javier@clubcashin.com",
    password: "sales123",
    role: "sales" as const,
  },
];

async function createUsers() {
  console.log("🌱 Creating users with hashed passwords...");

  try {
    const insertedUsers = [];

    for (const userData of usersData) {
      try {
        console.log(`Creating user: ${userData.email}`);

        // Hash the password
        const hashedPassword = await bcrypt.hash(userData.password, 10);

        const userToInsert = {
          id: crypto.randomUUID(),
          name: userData.name,
          email: userData.email,
          emailVerified: true,
          image: null,
          role: userData.role,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await db.insert(user).values(userToInsert).returning();

        if (result.length > 0) {
          insertedUsers.push(result[0]);
          console.log(
            `✅ Created user: ${userData.email} with password: ${userData.password}`,
          );
        }
      } catch (userError) {
        console.error(`❌ Error creating user ${userData.email}:`, userError);
      }
    }

    console.log("\n📋 Default user credentials:");
    console.log("Admin: admin@clubcashin.com / admin123");
    console.log("Sales: carlos@clubcashin.com / sales123");
    console.log("Sales: maria@clubcashin.com / sales123");
    console.log("Sales: javier@clubcashin.com / sales123");

    return insertedUsers;
  } catch (error) {
    console.error("❌ Error creating users:", error);
    return [];
  }
}

if (require.main === module) {
  createUsers().then(() => {
    console.log("✅ User creation completed!");
    process.exit(0);
  });
}

export { createUsers };

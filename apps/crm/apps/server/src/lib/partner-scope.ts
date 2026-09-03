import { eq } from "drizzle-orm";
import { db } from "../db";
import { partnerMembers } from "../db/schema/partners";

// Única fuente de verdad del alcance de un socio: las companies que puede ver.
export async function resolvePartnerScope(userId: string): Promise<string[]> {
	const rows = await db
		.select({ companyId: partnerMembers.companyId })
		.from(partnerMembers)
		.where(eq(partnerMembers.userId, userId));

	return rows.map((row) => row.companyId);
}

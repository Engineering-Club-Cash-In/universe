import { and, eq } from "drizzle-orm";
import type { CarteraEventTokenUsers } from "../routes/cartera-events";
import type { NexaDb } from "./index";
import { nexaTokenUsers } from "./schema";

export class DbCarteraEventTokenUserRepository implements CarteraEventTokenUsers {
  constructor(private readonly db: NexaDb) {}

  /**
   * Local deactivation only: Nexa exposes no operation to disable a token
   * user, so this marks the row inactive and leaves Nexa untouched.
   * Idempotent: a second call for the same credit changes nothing and returns 0.
   */
  async deactivateByCreditoId(creditoId: number) {
    const rows = await this.db
      .update(nexaTokenUsers)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(nexaTokenUsers.creditoId, creditoId), eq(nexaTokenUsers.active, true)))
      .returning({ id: nexaTokenUsers.id });
    return rows.length;
  }
}

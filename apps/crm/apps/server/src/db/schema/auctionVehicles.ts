import { pgTable, uuid, text, decimal, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { vehicles } from "./vehicles";

/**
 * Enum: Auction Status
 * Represents the lifecycle of a vehicle auction.
 * - pending: Vehicle has been listed for auction but not sold yet.
 * - sold: Vehicle has been sold at auction.
 */
export const auctionStatusEnum = pgEnum("auction_status", [
  "pending",
  "sold",
]);

/**
 * Table: auction_vehicles
 * Stores vehicles that are sent to auction, linked to the main vehicles table.
 * Each record represents a single vehicle's auction process.
 */
export const auctionVehicles = pgTable("auction_vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Foreign key linking this auction entry to the vehicle
  vehicleId: uuid("vehicle_id").references(() => vehicles.id).notNull(),

  // Auction details
  description: text("description").notNull(), // Reason for sending the vehicle to auction
  status: auctionStatusEnum("status").notNull().default("pending"),

  // Economic values
  marketValue: decimal("market_value", { precision: 12, scale: 2 }).notNull(), // Market value at auction start
  auctionPrice: decimal("auction_price", { precision: 12, scale: 2 }),         // Final auction sale price
  lossValue: decimal("loss_value", { precision: 12, scale: 2 }),               // Loss = marketValue - auctionPrice

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Table: auction_expenses
 * Stores additional expenses associated with an auctioned vehicle.
 * Examples: towing, cleaning, listing fees, etc.
 */
export const auctionExpenses = pgTable("auction_expenses", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Foreign key linking this expense to an auction entry
  auctionId: uuid("auction_id").references(() => auctionVehicles.id).notNull(),

  // Expense details
  description: text("description").notNull(), // Expense concept (e.g., "Towing", "Cleaning")
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), // Expense amount

  // Timestamp
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Relations: auction_vehicles
 * - Links each auction entry to its vehicle.
 * - Links each auction entry to multiple expenses.
 */
export const auctionVehiclesRelations = relations(auctionVehicles, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [auctionVehicles.vehicleId],
    references: [vehicles.id],
  }),
  expenses: many(auctionExpenses),
}));

/**
 * Relations: auction_expenses
 * - Links each expense back to its auction entry.
 */
export const auctionExpensesRelations = relations(auctionExpenses, ({ one }) => ({
  auction: one(auctionVehicles, {
    fields: [auctionExpenses.auctionId],
    references: [auctionVehicles.id],
  }),
}));

/**
 * TypeScript Types
 * For selecting and inserting data into auction-related tables.
 */
export type AuctionVehicle = typeof auctionVehicles.$inferSelect;
export type NewAuctionVehicle = typeof auctionVehicles.$inferInsert;

export type AuctionExpense = typeof auctionExpenses.$inferSelect;
export type NewAuctionExpense = typeof auctionExpenses.$inferInsert;

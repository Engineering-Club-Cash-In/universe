import { pgTable, text, integer, timestamp, boolean, decimal, json, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { companies } from './crm';

// Vehicles table
export const vehicles = pgTable('vehicles', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Basic vehicle info
  make: text('make').notNull(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  licensePlate: text('license_plate').notNull().unique(),
  vinNumber: text('vin_number').notNull().unique(),
  color: text('color').notNull(),
  vehicleType: text('vehicle_type').notNull(), // Sedan, SUV, Pickup, etc.
  
  // Technical details
  milesMileage: integer('miles_mileage'),
  kmMileage: integer('km_mileage').notNull(),
  origin: text('origin').notNull(), // Agencia, Rodado
  cylinders: text('cylinders').notNull(),
  engineCC: text('engine_cc').notNull(),
  fuelType: text('fuel_type').notNull(), // Gasolina, Diesel, Eléctrico, Híbrido
  transmission: text('transmission').notNull(), // Automático, Manual
  
  // Status
  status: text('status').notNull().default('pending'), // pending, available, sold, maintenance
  
  // Company relationship
  companyId: uuid('company_id').references(() => companies.id),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Vehicle Inspections table
export const vehicleInspections = pgTable('vehicle_inspections', {
  id: uuid('id').defaultRandom().primaryKey(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id).notNull(),
  
  // Inspector info
  technicianName: text('technician_name').notNull(),
  inspectionDate: timestamp('inspection_date').notNull(),
  
  // Inspection result
  inspectionResult: text('inspection_result').notNull(),
  
  // Vehicle rating and values
  vehicleRating: text('vehicle_rating').notNull(), // Comercial, No comercial
  marketValue: decimal('market_value', { precision: 12, scale: 2 }).notNull(),
  suggestedCommercialValue: decimal('suggested_commercial_value', { precision: 12, scale: 2 }).notNull(),
  bankValue: decimal('bank_value', { precision: 12, scale: 2 }).notNull(),
  currentConditionValue: decimal('current_condition_value', { precision: 12, scale: 2 }).notNull(),
  
  // Equipment and considerations
  vehicleEquipment: text('vehicle_equipment').notNull(),
  importantConsiderations: text('important_considerations'),
  
  // Scanner and airbag info
  scannerUsed: boolean('scanner_used').notNull().default(false),
  scannerResultUrl: text('scanner_result_url'),
  airbagWarning: boolean('airbag_warning').notNull().default(false),
  missingAirbag: text('missing_airbag'),
  
  // Test drive
  testDrive: boolean('test_drive').notNull().default(false),
  noTestDriveReason: text('no_test_drive_reason'),
  
  // Approval status
  status: text('status').notNull().default('pending'), // pending, approved, rejected
  
  // Alerts (stored as JSON array)
  alerts: json('alerts').$type<string[]>().default([]),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Vehicle Photos table
export const vehiclePhotos = pgTable('vehicle_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id).notNull(),
  inspectionId: uuid('inspection_id').references(() => vehicleInspections.id),
  
  category: text('category').notNull(), // exterior, wheels, interior, engine, damage
  photoType: text('photo_type').notNull(), // front-view, rear-view, etc.
  title: text('title').notNull(),
  description: text('description'),
  url: text('url').notNull(),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const vehiclesRelations = relations(vehicles, ({ many, one }) => ({
  inspections: many(vehicleInspections),
  photos: many(vehiclePhotos),
  company: one(companies, {
    fields: [vehicles.companyId],
    references: [companies.id],
  }),
}));

export const vehicleInspectionsRelations = relations(vehicleInspections, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleInspections.vehicleId],
    references: [vehicles.id],
  }),
  photos: many(vehiclePhotos),
}));

export const vehiclePhotosRelations = relations(vehiclePhotos, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [vehiclePhotos.vehicleId],
    references: [vehicles.id],
  }),
  inspection: one(vehicleInspections, {
    fields: [vehiclePhotos.inspectionId],
    references: [vehicleInspections.id],
  }),
}));

// Export types for TypeScript
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type VehicleInspection = typeof vehicleInspections.$inferSelect;
export type NewVehicleInspection = typeof vehicleInspections.$inferInsert;

export type VehiclePhoto = typeof vehiclePhotos.$inferSelect;
export type NewVehiclePhoto = typeof vehiclePhotos.$inferInsert;
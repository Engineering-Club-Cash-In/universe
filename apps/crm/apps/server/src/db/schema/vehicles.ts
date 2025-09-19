import { pgTable, text, integer, timestamp, boolean, decimal, json, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { companies } from './crm';

// Vehicle Vendors table - Sellers of vehicles
export const vehicleVendors = pgTable('vehicle_vendors', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  // Basic vendor info
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  dpi: text('dpi').notNull().unique(),
  
  // Vendor type
  vendorType: text('vendor_type').notNull(), // 'individual' or 'empresa'
  
  // Company info (if empresa)
  companyName: text('company_name'), // Solo si es empresa
  
  // Contact details
  email: text('email'),
  address: text('address'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  origin: text('origin').notNull(), // Nacional, Importado
  cylinders: text('cylinders').notNull(),
  engineCC: text('engine_cc').notNull(),
  fuelType: text('fuel_type').notNull(), // Gasolina, Diesel, Eléctrico, Híbrido
  transmission: text('transmission').notNull(), // Automático, Manual
  
  // Status
  status: text('status').notNull().default('pending'), // pending, available, sold, maintenance
  
  // Company relationship
  companyId: uuid('company_id').references(() => companies.id),
  
  // Vendor relationship
  vendorId: uuid('vendor_id').references(() => vehicleVendors.id),
  
  // GPS Information
  gpsActivo: boolean('gps_activo').notNull().default(false),
  dispositivoGPS: text('dispositivo_gps'), // Marca/modelo del dispositivo GPS
  imeiGPS: text('imei_gps'), // IMEI único del dispositivo
  ubicacionActualGPS: text('ubicacion_actual_gps'), // JSON con coordenadas actuales
  ultimaSeñalGPS: timestamp('ultima_señal_gps'),
  
  // Insurance Information  
  seguroVigente: boolean('seguro_vigente').notNull().default(false),
  numeroPoliza: text('numero_poliza'),
  companiaSeguro: text('compania_seguro'),
  fechaInicioSeguro: timestamp('fecha_inicio_seguro'),
  fechaVencimientoSeguro: timestamp('fecha_vencimiento_seguro'),
  montoAsegurado: decimal('monto_asegurado', { precision: 12, scale: 2 }),
  deducible: decimal('deducible', { precision: 12, scale: 2 }),
  tipoCobertura: text('tipo_cobertura'), // "basica", "amplia", "total"
  
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
  
  // Valuator comments and verification
  valuatorComment: text('valuator_comment'), // Comentario del valuador sobre la foto
  noCommentsChecked: boolean('no_comments_checked').notNull().default(false), // Checkbox "Sin comentarios"
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Inspection Checklist Items table - for critical criteria evaluation
export const inspectionChecklistItems = pgTable('inspection_checklist_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  inspectionId: uuid('inspection_id').references(() => vehicleInspections.id).notNull(),
  
  category: text('category').notNull(), // motor, transmision, suspension, etc.
  item: text('item').notNull(), // description of the criterion
  checked: boolean('checked').notNull().default(false),
  severity: text('severity').notNull().default('critical'), // critical, warning, info
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const vehicleVendorsRelations = relations(vehicleVendors, ({ many }) => ({
  vehicles: many(vehicles),
}));

export const vehiclesRelations = relations(vehicles, ({ many, one }) => ({
  inspections: many(vehicleInspections),
  photos: many(vehiclePhotos),
  company: one(companies, {
    fields: [vehicles.companyId],
    references: [companies.id],
  }),
  vendor: one(vehicleVendors, {
    fields: [vehicles.vendorId],
    references: [vehicleVendors.id],
  }),
}));

export const vehicleInspectionsRelations = relations(vehicleInspections, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleInspections.vehicleId],
    references: [vehicles.id],
  }),
  photos: many(vehiclePhotos),
  checklistItems: many(inspectionChecklistItems),
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

export const inspectionChecklistItemsRelations = relations(inspectionChecklistItems, ({ one }) => ({
  inspection: one(vehicleInspections, {
    fields: [inspectionChecklistItems.inspectionId],
    references: [vehicleInspections.id],
  }),
}));

// Export types for TypeScript
export type VehicleVendor = typeof vehicleVendors.$inferSelect;
export type NewVehicleVendor = typeof vehicleVendors.$inferInsert;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type VehicleInspection = typeof vehicleInspections.$inferSelect;
export type NewVehicleInspection = typeof vehicleInspections.$inferInsert;

export type VehiclePhoto = typeof vehiclePhotos.$inferSelect;
export type NewVehiclePhoto = typeof vehiclePhotos.$inferInsert;

export type InspectionChecklistItem = typeof inspectionChecklistItems.$inferSelect;
export type NewInspectionChecklistItem = typeof inspectionChecklistItems.$inferInsert;
-- Add new bus vehicle types with RCDP to vehicle_type enum
ALTER TYPE "vehicle_type" ADD VALUE IF NOT EXISTS 'microbus_20';
ALTER TYPE "vehicle_type" ADD VALUE IF NOT EXISTS 'microbus_35';
ALTER TYPE "vehicle_type" ADD VALUE IF NOT EXISTS 'microbus_36plus';

-- Add bus insurance columns to insurance_costs table
ALTER TABLE "insurance_costs" ADD COLUMN IF NOT EXISTS "bus_hasta_20" decimal(10, 2);
ALTER TABLE "insurance_costs" ADD COLUMN IF NOT EXISTS "bus_21_a_35" decimal(10, 2);
ALTER TABLE "insurance_costs" ADD COLUMN IF NOT EXISTS "bus_mas_35" decimal(10, 2);

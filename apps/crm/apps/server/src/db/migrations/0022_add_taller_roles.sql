DO $$ BEGIN
	ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'service_center_manager';
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'vehicle_verifier';
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

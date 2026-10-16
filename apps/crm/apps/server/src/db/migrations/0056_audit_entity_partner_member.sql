-- Bitácora de socios: el valor 'partner_member' del tipo de entidad auditada,
-- para registrar altas, ediciones y (des)activaciones de socios y membresías.
--
-- Idempotente. ADD VALUE no se puede usar en la misma transacción en la que se
-- crea: correrla sola, sin BEGIN.

ALTER TYPE "public"."crm_audit_entity_type" ADD VALUE IF NOT EXISTS 'partner_member';

-- Agrega las fechas ideales de pago sugeridas por la IA al análisis de capacidad de pago.
-- Hasta 3 candidatos rankeados con su % de recomendación (ej. [{"dia":5,"porcentaje":50}, ...]).
-- Dato informativo; el detalle (días de ingreso detectados y justificación) vive en
-- credit_analysis.full_analysis.
ALTER TABLE "credit_analysis" ADD COLUMN IF NOT EXISTS "suggested_payment_days" jsonb;

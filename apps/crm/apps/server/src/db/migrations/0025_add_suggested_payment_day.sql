-- Agrega la fecha ideal de pago sugerida por la IA al análisis de capacidad de pago.
-- Día del mes (1-31) según cuándo recibe ingresos el solicitante. Dato informativo;
-- el detalle (días detectados y justificación) vive en credit_analysis.full_analysis.
ALTER TABLE "credit_analysis" ADD COLUMN IF NOT EXISTS "suggested_payment_day" integer;

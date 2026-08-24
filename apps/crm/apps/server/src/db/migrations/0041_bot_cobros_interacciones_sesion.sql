-- Hallazgo de Codex en el PR #1411: cuando la purga de OTPs (D-14) borre la
-- fila de otps, el ON DELETE SET NULL de otp_id desagruparía las interacciones
-- de esa sesión y la ficha las mostraría como "intentos sin sesión".
--
-- sesion_id es el MISMO uuid pero SIN foreign key: es la llave de agrupado de
-- la ficha y sobrevive a la purga. otp_id se conserva para el join mientras el
-- OTP viva. sesion_id queda NULL solo cuando la sesión nunca existió
-- (acceso_fallido, D-43).

ALTER TABLE "bot_cobros_interacciones" ADD COLUMN IF NOT EXISTS "sesion_id" uuid;

-- Backfill de lo escrito antes de esta columna (dev, días de prueba): el otp
-- todavía existe, así que el id se copia de ahí.
UPDATE "bot_cobros_interacciones" SET "sesion_id" = "otp_id"
	WHERE "sesion_id" IS NULL AND "otp_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "bot_cobros_interacciones_sesion_idx"
	ON "bot_cobros_interacciones" ("sesion_id");

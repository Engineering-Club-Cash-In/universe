-- Hallazgo de Codex en el PR #1411 (4ª ronda): el cruce del codeudor
-- multi-lead dependía de que su fila de co_debtors siguiera viva — borrarla
-- limpia co_debtor_id (SET NULL) y la sesión desaparecía de todas las fichas
-- menos la del lead_id guardado.
--
-- persona_hash = sha256 del DPI sin espacios (la misma normalización de
-- eqDpi): identifica a la PERSONA sin importar qué filas sigan vivas, y va
-- hasheado porque esta tabla no guarda PII (D-42 / propuesta de D-14). Null
-- cuando la identificación no fue por DPI (placa/NIT del titular).

ALTER TABLE "bot_cobros_interacciones"
	ADD COLUMN IF NOT EXISTS "persona_hash" text;

-- Backfill desde el OTP de cada sesión (los de dev siguen vivos). digest()
-- necesita pgcrypto, que Neon trae disponible.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "bot_cobros_interacciones" bci
	SET "persona_hash" = encode(digest(regexp_replace(o."dpi", '\s', '', 'g'), 'sha256'), 'hex')
	FROM "otps" o
	WHERE bci."otp_id" = o."id"
	  AND o."dpi" IS NOT NULL
	  AND bci."persona_hash" IS NULL;

CREATE INDEX IF NOT EXISTS "bot_cobros_interacciones_persona_idx"
	ON "bot_cobros_interacciones" ("persona_hash");

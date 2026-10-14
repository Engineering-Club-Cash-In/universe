-- Extensión del buró interno para evidencias automáticas provenientes de Cartera.
ALTER TABLE public.buro_interno_personas
	ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'buro_interno_personas_origen_chk'
			AND conrelid = 'public.buro_interno_personas'::regclass
	) THEN
		ALTER TABLE public.buro_interno_personas
			ADD CONSTRAINT buro_interno_personas_origen_chk
			CHECK (origen IN ('manual', 'automatico_cartera'));
	END IF;
END $$;

ALTER TABLE public.buro_interno_personas
	ALTER COLUMN creado_por DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.buro_interno_fuentes_cartera (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	persona_id uuid NOT NULL REFERENCES public.buro_interno_personas(id) ON DELETE CASCADE,
	cartera_usuario_id integer NOT NULL,
	cartera_credito_id integer NOT NULL,
	numero_credito_sifco text NOT NULL,
	estado_credito text NOT NULL,
	categoria text NOT NULL,
	motivo text NOT NULL,
	evidencia jsonb NOT NULL DEFAULT '{}'::jsonb,
	observado_at timestamptz NOT NULL DEFAULT now(),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT buro_interno_fuentes_cartera_usuario_credito_uq
		UNIQUE (cartera_usuario_id, cartera_credito_id)
);

CREATE INDEX IF NOT EXISTS buro_interno_fuentes_cartera_persona_idx
	ON public.buro_interno_fuentes_cartera (persona_id);
CREATE INDEX IF NOT EXISTS buro_interno_fuentes_cartera_usuario_idx
	ON public.buro_interno_fuentes_cartera (cartera_usuario_id);

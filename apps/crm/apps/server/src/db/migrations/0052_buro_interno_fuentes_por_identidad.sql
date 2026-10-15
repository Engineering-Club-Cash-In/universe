-- Permite asociar el mismo credito de un usuario compuesto a una ficha por
-- identidad, sin que una identidad posterior sobrescriba la anterior.
ALTER TABLE public.buro_interno_fuentes_cartera
	DROP CONSTRAINT IF EXISTS buro_interno_fuentes_cartera_usuario_credito_uq;

DROP INDEX IF EXISTS public.buro_interno_fuentes_cartera_usuario_credito_uq;

CREATE UNIQUE INDEX IF NOT EXISTS buro_interno_fuentes_cartera_persona_usuario_credito_uq
	ON public.buro_interno_fuentes_cartera (
		persona_id,
		cartera_usuario_id,
		cartera_credito_id
	);

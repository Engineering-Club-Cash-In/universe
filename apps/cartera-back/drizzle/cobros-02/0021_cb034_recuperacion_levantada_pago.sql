-- COBROS-02 · Fase 4 — poder DEVOLVER el estado `EN_RECUPERACION` si se revierte
-- el pago que lo levantó.
--
-- El levantamiento deja el crédito `ACTIVO` y con eso desaparece toda huella de
-- que alguien había decidido recuperar la unidad. Si contabilidad reversa ese
-- pago —una boleta que no era, un depósito mal aplicado—, `reversePayment`
-- restaura cuotas, capital y mora, pero el crédito se queda `ACTIVO`: la
-- corrida nocturna a lo sumo lo pone `MOROSO`, y la decisión humana (con su
-- piso en B4) se pierde para siempre sin que nadie se entere.
--
-- Esta columna guarda QUÉ pago levantó la recuperación. Es lo mínimo que hace
-- falta para poder deshacerlo: si el pago que se reversa es ese, el crédito
-- vuelve a `EN_RECUPERACION` y la columna se limpia.
--
-- Sin FK a `pagos_credito` a propósito: es una marca histórica y no debe
-- impedir ni arrastrar el borrado de un pago.
ALTER TABLE cartera.creditos
  ADD COLUMN IF NOT EXISTS recuperacion_levantada_pago_id integer;
--> statement-breakpoint

COMMENT ON COLUMN cartera.creditos.recuperacion_levantada_pago_id IS
  'COBROS-02 Fase 4: pago cuya validacion levanto EN_RECUPERACION. Si ese pago se reversa, el credito vuelve a EN_RECUPERACION y esto se limpia. NULL = el credito no viene de una recuperacion levantada.';

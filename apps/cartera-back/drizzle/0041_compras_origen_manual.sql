-- Compras de cartera cargadas en el modo manual (el operador elige créditos y
-- montos a mano).
--
-- Es como inversiones vuelve a meter una compra que se cayó porque el
-- inversionista tardó en pagar: los contratos de esa compra jurídico ya los
-- hizo. Al aceptarla, el CRM no le abre batería ni le avisa a jurídico por
-- estos créditos (ver compraCarteraAceptada.ts).
--
-- false en todas las de antes: siguen como hasta ahora.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE cartera.compras_credito_inversionista
  ADD COLUMN IF NOT EXISTS origen_manual boolean NOT NULL DEFAULT false;

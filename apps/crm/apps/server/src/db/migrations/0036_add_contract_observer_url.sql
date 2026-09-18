-- Enlace de observador de WeeTrust para cada contrato.
--
-- Es el único link que el analista o el vendedor pueden abrir sin riesgo:
-- muestra el documento y quién firmó, pero no deja firmar. El link de un
-- firmante (`/signatory/...`) firma en su nombre, así que no sirve para "ir a
-- ver cómo va".
--
-- Sale de `sharedWith` en la respuesta del documento, y sólo existe cuando hay
-- observadores configurados.

ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "observer_url" text;

-- COBROS-02 · La asignación asesor ↔ crédito vive en CARTERA, no en el CRM (1/2).
--
-- `casos_cobros.responsable_cobros` venía de antes de la integración con
-- cartera: un reparto propio del CRM (el job de sync le daba cada caso nuevo
-- al agente con menos casos, y la ficha lo ponía a nombre de quien la abría).
-- No coincidía con cartera en ~48 % de los casos activos de producción, y el
-- asesor que cartera dejaba con un crédito recibía "caso no encontrado" al
-- abrir su ficha. El acceso, los listados y los avisos ahora salen de cartera
-- (lib/acceso-caso-cobro.ts) y el código ya no lee ni escribe esta columna.
--
-- Paso 1: dejarla NULLABLE. Es compatible con las dos versiones del código: la
-- vieja la sigue llenando, la nueva crea casos sin ella. Correr ANTES de
-- desplegar el código nuevo (o junto con el deploy).
--
-- Paso 2 (0067): borrarla, recién cuando el código nuevo ya esté desplegado.
--
-- Idempotente.

ALTER TABLE "casos_cobros" ALTER COLUMN "responsable_cobros" DROP NOT NULL;

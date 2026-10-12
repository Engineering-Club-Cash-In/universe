-- Catálogo de documentos de backend-2 (schema docuseal, Supabase PROD), PASO 1 de 2.
-- Anexos 1 y 2 separados (individual) + contrato de participación y sus
-- anexos para sociedad. Lo corre a mano quien tenga acceso a PROD.
--
-- Va en su propia ejecución, ANTES del paso 2: Postgres no deja usar un valor
-- de enum en la misma transacción que lo agrega, y el editor de Supabase manda
-- todo lo que se corre junto en una sola transacción (error 55P04). Se puede
-- repetir sin problema.

-- ============================================================================
-- 1) Valores nuevos del enum (fuera de transacción, uno por uno)
-- ============================================================================
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo1_confirmacion_participacion';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo2_designacion_beneficiario';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'contrato_participacion_administracion_cartera_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo1_confirmacion_participacion_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo2_designacion_beneficiario_sociedad';

-- Catálogo de documentos de backend-2 (schema docuseal, Supabase PROD), PASO 1 de 2.
-- Batería de ventas a nombre de una sociedad: firma su representante legal.
-- Lo corre a mano quien tenga acceso a PROD.
--
-- Va en su propia ejecución, ANTES del paso 2: Postgres no deja usar un valor
-- de enum en la misma transacción que lo agrega, y el editor de Supabase manda
-- todo lo que se corre junto en una sola transacción (error 55P04). Se puede
-- repetir sin problema.

-- La categoría: el CRM la pide cuando la oportunidad es de una sociedad.
ALTER TYPE docuseal.document_categoria_enum ADD VALUE IF NOT EXISTS 'ventas_sociedad';

-- Los documentos, en el orden en que salen en la lista (se ordena por el enum).
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'solicitud_compra_vehiculo_tercero_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'carta_aceptacion_instalacion_gps_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'carta_traspaso_vehiculo_rdbe_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'descargo_responsabilidades_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'cobertura_inrexsa_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'cobertura_inrexsa_comercial_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'cobertura_gyt_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'reconocimiento_deuda_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'carta_carro_nuevo_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'contrato_privado_uso_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'pagare_unico_libre_protesto_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'carta_emision_cheques_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'garantia_mobiliaria_sociedad';

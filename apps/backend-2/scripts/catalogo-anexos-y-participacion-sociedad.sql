-- Catálogo de documentos de backend-2 (schema docuseal, Supabase PROD).
-- Anexos 1 y 2 separados (individual) + contrato de participación y sus
-- anexos para sociedad. Lo corre a mano quien tenga acceso a PROD.
--
-- Correr en orden. El paso 1 va SUELTO (fuera de transacción): Postgres no deja
-- usar un valor de enum en la misma transacción que lo agrega.

-- ============================================================================
-- 1) Valores nuevos del enum (fuera de transacción, uno por uno)
-- ============================================================================
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo1_confirmacion_participacion';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo2_designacion_beneficiario';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'contrato_participacion_administracion_cartera_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo1_confirmacion_participacion_sociedad';
ALTER TYPE docuseal.document_name_enum ADD VALUE IF NOT EXISTS 'anexo2_designacion_beneficiario_sociedad';

-- ============================================================================
-- 2) Campos, documentos y enlaces (en una transacción)
-- ============================================================================
BEGIN;

-- Campos nuevos que jurídico llena a mano. `relation` es el orden en el
-- asistente: junto a los demás datos de la sociedad (99.x).
-- `key` no tiene restricción única en la base: se evita el duplicado a mano.
INSERT INTO docuseal.field (name, key, regex, description, required, relation, type, options)
SELECT v.* FROM (VALUES
  ('Cargo del Representante Legal', 'cargoRepresentanteLegal',
   '^[A-ZÁÉÍÓÚÑa-záéíóúñü\s,.]+$',
   'Calidad con la que actúa el representante de la sociedad, con mayúscula inicial en cada palabra. Ej.: Administrador Único y Representante Legal',
   true, '99.15', 'text', NULL),
  ('Notario o notaria del acta de nombramiento', 'articuloNotarioActaNombramiento',
   NULL,
   'Si el acta la autorizó un notario o una notaria',
   true, '99.35', 'select',
   '[{"label": "El notario", "value": "el notario"}, {"label": "La notaria", "value": "la notaria"}]'::jsonb)
) AS v(name, key, regex, description, required, relation, type, options)
WHERE NOT EXISTS (SELECT 1 FROM docuseal.field f WHERE f.key = v.key);

-- Documentos: dos filas por documento (hombre y mujer), como los demás.
INSERT INTO docuseal.documents
  (nombre_documento, categoria, id_docuseal, genero, descripcion, serialid, url_insercion, large_spacing, count_double_line)
VALUES
  ('anexo1_confirmacion_participacion', 'inversiones', 9049, 'hombre', 'Anexo 1 - Confirmación de Participación (hombre)', 'srl-anexo1-conf-part-h', 'https://docuseal.placeholder/anexo1-conf-part-h', false, 0),
  ('anexo1_confirmacion_participacion', 'inversiones', 9050, 'mujer',  'Anexo 1 - Confirmación de Participación (mujer)',  'srl-anexo1-conf-part-m', 'https://docuseal.placeholder/anexo1-conf-part-m', false, 0),
  ('anexo2_designacion_beneficiario',   'inversiones', 9051, 'hombre', 'Anexo 2 - Designación de Beneficiario (hombre)',   'srl-anexo2-benef-h',     'https://docuseal.placeholder/anexo2-benef-h', false, 0),
  ('anexo2_designacion_beneficiario',   'inversiones', 9052, 'mujer',  'Anexo 2 - Designación de Beneficiario (mujer)',    'srl-anexo2-benef-m',     'https://docuseal.placeholder/anexo2-benef-m', false, 0),
  ('contrato_participacion_administracion_cartera_sociedad', 'inversiones_sociedad', 9053, 'hombre', 'Contrato de Participación y Administración de Cartera - Sociedad (hombre)', 'srl-contrato-part-admin-cartera-soc-h', 'https://docuseal.placeholder/contrato-part-admin-cartera-soc-h', false, 0),
  ('contrato_participacion_administracion_cartera_sociedad', 'inversiones_sociedad', 9054, 'mujer',  'Contrato de Participación y Administración de Cartera - Sociedad (mujer)',  'srl-contrato-part-admin-cartera-soc-m', 'https://docuseal.placeholder/contrato-part-admin-cartera-soc-m', false, 0),
  ('anexo1_confirmacion_participacion_sociedad', 'inversiones_sociedad', 9055, 'hombre', 'Anexo 1 - Confirmación de Participación - Sociedad (hombre)', 'srl-anexo1-conf-part-soc-h', 'https://docuseal.placeholder/anexo1-conf-part-soc-h', false, 0),
  ('anexo1_confirmacion_participacion_sociedad', 'inversiones_sociedad', 9056, 'mujer',  'Anexo 1 - Confirmación de Participación - Sociedad (mujer)',  'srl-anexo1-conf-part-soc-m', 'https://docuseal.placeholder/anexo1-conf-part-soc-m', false, 0),
  ('anexo2_designacion_beneficiario_sociedad',   'inversiones_sociedad', 9057, 'hombre', 'Anexo 2 - Designación de Beneficiario - Sociedad (hombre)',   'srl-anexo2-benef-soc-h',     'https://docuseal.placeholder/anexo2-benef-soc-h', false, 0),
  ('anexo2_designacion_beneficiario_sociedad',   'inversiones_sociedad', 9058, 'mujer',  'Anexo 2 - Designación de Beneficiario - Sociedad (mujer)',    'srl-anexo2-benef-soc-m',     'https://docuseal.placeholder/anexo2-benef-soc-m', false, 0)
ON CONFLICT (id_docuseal) DO NOTHING;

-- Enlaces campo ↔ documento, por clave de campo (los ids de field no se fijan).
INSERT INTO docuseal.detail_document_field (id_field, id_document)
SELECT f.id, d.id_docuseal
FROM (VALUES
  -- Anexo 1 individual: los del unificado menos la lista de beneficiarios.
  (9049, 'dia'), (9049, 'ano'), (9049, 'diaTexto'), (9049, 'mesTexto'), (9049, 'anoTexto'),
  (9049, 'nombreCompleto'), (9049, 'dpi'), (9049, 'montoNumero'), (9049, 'montoLetras'),
  (9049, 'modalidadRetorno'), (9049, 'figuraFiscal'),
  (9050, 'dia'), (9050, 'ano'), (9050, 'diaTexto'), (9050, 'mesTexto'), (9050, 'anoTexto'),
  (9050, 'nombreCompleto'), (9050, 'dpi'), (9050, 'montoNumero'), (9050, 'montoLetras'),
  (9050, 'modalidadRetorno'), (9050, 'figuraFiscal'),
  -- Anexo 2 individual
  (9051, 'dia'), (9051, 'ano'), (9051, 'diaTexto'), (9051, 'mesTexto'), (9051, 'anoTexto'),
  (9051, 'nombreCompleto'), (9051, 'dpi'), (9051, 'listaBeneficiarios'),
  (9052, 'dia'), (9052, 'ano'), (9052, 'diaTexto'), (9052, 'mesTexto'), (9052, 'anoTexto'),
  (9052, 'nombreCompleto'), (9052, 'dpi'), (9052, 'listaBeneficiarios'),
  -- Contrato de participación, sociedad
  (9053, 'diaTexto'), (9053, 'mesTexto'), (9053, 'anoTexto'), (9053, 'nombreCompleto'), (9053, 'dpi'),
  (9053, 'dpiTexto'), (9053, 'nacionalidad'), (9053, 'profesion'), (9053, 'cargoRepresentanteLegal'),
  (9053, 'nombreSociedadInversionista'), (9053, 'fechaAutorizacionActaNombramiento'),
  (9053, 'articuloNotarioActaNombramiento'), (9053, 'nombreNotarioActaNombramiento'),
  (9053, 'numeroRegistroSociedad'), (9053, 'folioRegistroSociedad'), (9053, 'libroRegistroSociedad'),
  (9053, 'tasaRetornoAnual'), (9053, 'tasaRetornoAnualIva'),
  (9054, 'diaTexto'), (9054, 'mesTexto'), (9054, 'anoTexto'), (9054, 'nombreCompleto'), (9054, 'dpi'),
  (9054, 'dpiTexto'), (9054, 'nacionalidad'), (9054, 'profesion'), (9054, 'cargoRepresentanteLegal'),
  (9054, 'nombreSociedadInversionista'), (9054, 'fechaAutorizacionActaNombramiento'),
  (9054, 'articuloNotarioActaNombramiento'), (9054, 'nombreNotarioActaNombramiento'),
  (9054, 'numeroRegistroSociedad'), (9054, 'folioRegistroSociedad'), (9054, 'libroRegistroSociedad'),
  (9054, 'tasaRetornoAnual'), (9054, 'tasaRetornoAnualIva'),
  -- Anexo 1 sociedad: el individual + la sociedad y el cargo
  (9055, 'dia'), (9055, 'ano'), (9055, 'diaTexto'), (9055, 'mesTexto'), (9055, 'anoTexto'),
  (9055, 'nombreCompleto'), (9055, 'dpi'), (9055, 'montoNumero'), (9055, 'montoLetras'),
  (9055, 'modalidadRetorno'), (9055, 'figuraFiscal'), (9055, 'nombreSociedadInversionista'), (9055, 'cargoRepresentanteLegal'),
  (9056, 'dia'), (9056, 'ano'), (9056, 'diaTexto'), (9056, 'mesTexto'), (9056, 'anoTexto'),
  (9056, 'nombreCompleto'), (9056, 'dpi'), (9056, 'montoNumero'), (9056, 'montoLetras'),
  (9056, 'modalidadRetorno'), (9056, 'figuraFiscal'), (9056, 'nombreSociedadInversionista'), (9056, 'cargoRepresentanteLegal'),
  -- Anexo 2 sociedad
  (9057, 'dia'), (9057, 'ano'), (9057, 'diaTexto'), (9057, 'mesTexto'), (9057, 'anoTexto'),
  (9057, 'nombreCompleto'), (9057, 'dpi'), (9057, 'listaBeneficiarios'), (9057, 'nombreSociedadInversionista'), (9057, 'cargoRepresentanteLegal'),
  (9058, 'dia'), (9058, 'ano'), (9058, 'diaTexto'), (9058, 'mesTexto'), (9058, 'anoTexto'),
  (9058, 'nombreCompleto'), (9058, 'dpi'), (9058, 'listaBeneficiarios'), (9058, 'nombreSociedadInversionista'), (9058, 'cargoRepresentanteLegal'),
  -- Cesión de sociedad (ya existe): los dos campos nuevos de la redacción nueva
  (9039, 'cargoRepresentanteLegal'), (9039, 'articuloNotarioActaNombramiento'),
  (9040, 'cargoRepresentanteLegal'), (9040, 'articuloNotarioActaNombramiento')
) AS e(id_document, key)
JOIN docuseal.field f ON f.key = e.key
JOIN docuseal.documents d ON d.id_docuseal = e.id_document
ON CONFLICT DO NOTHING;

-- Verificación antes de confirmar: debe dar 11, 11, 8, 8, 18, 18, 13, 13, 10, 10, 20, 20.
SELECT d.id_docuseal, d.nombre_documento, d.genero, count(x.id_field) AS campos
FROM docuseal.documents d
LEFT JOIN docuseal.detail_document_field x ON x.id_document = d.id_docuseal
WHERE d.id_docuseal BETWEEN 9049 AND 9058 OR d.id_docuseal IN (9039, 9040)
GROUP BY d.id_docuseal, d.nombre_documento, d.genero
ORDER BY d.id_docuseal;

COMMIT;

-- ============================================================================
-- 3) DESPUÉS del deploy: dejar de ofrecer el anexo unificado (individual)
-- ============================================================================
-- Sólo saca la opción del selector de jurídico. Los contratos ya generados con
-- él no dependen de estas filas: se siguen reemitiendo y vinculando igual.
-- Correr cuando el CRM y el generador nuevos ya estén arriba, para que no quede
-- un rato sin ningún anexo. Los enlaces van primero: en la base la FK no borra
-- en cascada (el schema de drizzle dice que sí, pero la base no).
--
-- BEGIN;
-- DELETE FROM docuseal.detail_document_field WHERE id_document IN (9047, 9048);
-- DELETE FROM docuseal.documents
--  WHERE nombre_documento = 'anexos_confirmacion_participacion_beneficiario'
--    AND id_docuseal IN (9047, 9048);
-- COMMIT;

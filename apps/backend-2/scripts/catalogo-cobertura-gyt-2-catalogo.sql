-- Catálogo de documentos de backend-2 (schema docuseal, Supabase PROD), PASO 2 de 2.
-- Correr DESPUÉS de catalogo-cobertura-gyt-1-enum.sql, en otra ejecución. Se
-- puede repetir: no duplica el documento ni los enlaces.
BEGIN;

-- Una sola fila, sin género, como las coberturas de Universales (8 y 30).
INSERT INTO docuseal.documents
  (nombre_documento, categoria, id_docuseal, genero, descripcion, serialid, url_insercion, large_spacing, count_double_line)
VALUES
  ('cobertura_gyt', 'ventas', 31, 'unisex', 'Carta Cobertura Seguros G&T', 'template31_unisex', '/docuSeal/31', true, NULL)
ON CONFLICT (id_docuseal) DO NOTHING;

-- Lleva los mismos campos que la cobertura de placas comerciales (30): nombre,
-- día, mes y año en letras, correo y firma. No hay campos nuevos.
INSERT INTO docuseal.detail_document_field (id_field, id_document)
SELECT ddf.id_field, 31
FROM docuseal.detail_document_field ddf
WHERE ddf.id_document = 30
ON CONFLICT DO NOTHING;

-- Verificación: la 31 con los mismos 6 campos que la 30.
SELECT d.id_docuseal, d.nombre_documento, count(ddf.id_field) AS campos,
       string_agg(f.key, ', ' ORDER BY f.relation) AS claves
FROM docuseal.documents d
LEFT JOIN docuseal.detail_document_field ddf ON ddf.id_document = d.id_docuseal
LEFT JOIN docuseal.field f ON f.id = ddf.id_field
WHERE d.id_docuseal IN (30, 31)
GROUP BY d.id_docuseal, d.nombre_documento
ORDER BY d.id_docuseal;

COMMIT;

-- El PDF firmado de un contrato, ya copiado a R2.
--
-- `pdf_link` guarda el borrador: el documento como se generó, sin firmas. El
-- que vale cuando todos firman es otro archivo y vive en WeeTrust, detrás de
-- sus credenciales. Se baja una sola vez —esta columna es la marca de que ya
-- se bajó— y desde acá lo sirve la ficha del inversionista y se copia a su
-- papelería en cartera.
--
-- El borrador no se pisa: es el que se vuelve a subir al reemitir el documento.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "signed_pdf_link" text;

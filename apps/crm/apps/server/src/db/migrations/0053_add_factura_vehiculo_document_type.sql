-- Tipo de documento "Factura del Vehículo": la factura que manda la agencia al
-- comprar el carro. Es la que sale por correo a la aseguradora (para generar el
-- seguro); el "Seguro del Vehículo" vuelve a ser un documento más.
--
-- Idempotente. ADD VALUE no se puede usar en la misma transacción en la que se
-- crea: correrla sola, sin BEGIN.

ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'factura_vehiculo';

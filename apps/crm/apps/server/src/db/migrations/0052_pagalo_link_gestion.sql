-- Una gestión automática cuando asesor genera links Págalo desde Ficha 360.
-- ADD VALUE no tiene rollback seguro en PostgreSQL; es aditivo e idempotente.
ALTER TYPE public.estado_contacto ADD VALUE IF NOT EXISTS 'link_pago_generado';

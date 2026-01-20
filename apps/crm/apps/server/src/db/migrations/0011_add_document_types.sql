-- Agregar nuevos tipos de documento al enum document_type

-- === VERIFICACIONES DE CLIENTE ===
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'usuario_sat_cliente';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'rtu_cliente';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'omisos_incumplimientos_cliente';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'infornet';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'confirmacion_referencias';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'visita_domiciliar';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'redes_sociales_internet';

-- === VERIFICACIONES DE VEHÍCULO / PROPIETARIO ===
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'usuario_sat_propietario';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'rtu_propietario';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'omisos_incumplimientos_propietario';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'garantia_mobiliaria_sat';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'garantia_mobiliaria_dpi';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'garantia_mobiliaria_nit';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'garantia_mobiliaria_serie';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'multas_vehiculo';

-- === DOCUMENTOS ETAPA 90% (CIERRE) ===
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'seguro_vehiculo';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'inscripcion_garantia_mobiliaria';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'traspaso';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'documentos_firmados_vendedor';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'copia_llave';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'confirmacion_enganche';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'desembolso';

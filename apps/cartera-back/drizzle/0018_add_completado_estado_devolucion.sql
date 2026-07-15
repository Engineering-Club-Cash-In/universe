-- Agregar 'COMPLETADO' al enum de estado_devolucion en el esquema cartera.
--
-- Representa que el proceso de devolución ha finalizado y el crédito 
-- ahora pertenece a CUBE de manera normal.
--
ALTER TYPE cartera.estado_devolucion ADD VALUE IF NOT EXISTS 'COMPLETADO';

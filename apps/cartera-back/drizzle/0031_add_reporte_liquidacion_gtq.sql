-- Reporte de liquidación en las dos monedas.
-- (renumerada de 0027 a 0031: develop ya tenía un 0027_add_excluir_compras_creditos)
--
-- Los inversionistas en dólares reciben su reporte en USD, pero esta tabla
-- guarda todos sus totales en quetzales. `reporte_liquidacion_url_gtq` es la
-- copia del mismo reporte expresada en Q, para que contabilidad pueda cuadrar
-- contra la base sin reconvertir a mano.
--
-- `tipo_cambio_reporte` deja el reporte reproducible: guarda la tasa con la que
-- se generó, para que un cambio futuro de tasa no altere lo ya emitido.
--
-- Ambas quedan NULL para inversionistas en quetzales (su reporte principal ya
-- está en Q) y para todas las liquidaciones existentes.
-- Aditiva y retrocompatible: nada existente cambia de valor.
-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).

ALTER TABLE cartera.liquidaciones ADD COLUMN IF NOT EXISTS reporte_liquidacion_url_gtq text;
ALTER TABLE cartera.liquidaciones ADD COLUMN IF NOT EXISTS tipo_cambio_reporte numeric(10, 4);

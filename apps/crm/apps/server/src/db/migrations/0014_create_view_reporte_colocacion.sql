CREATE OR REPLACE VIEW vista_reporte_colocacion AS
WITH stage_inicio AS (
    -- Primera vez que la oportunidad llegó a la segunda etapa (MIN + 1)
    SELECT
        osh.opportunity_id,
        MIN(osh.changed_at) AS dia_inicio
    FROM opportunity_stage_history osh
    JOIN sales_stages s ON osh.to_stage_id = s.id
    WHERE s."order" = (SELECT MIN("order") + 1 FROM sales_stages)
    GROUP BY osh.opportunity_id
),
stage_ganada AS (
    -- Primera vez que llegó a la penúltima etapa (por orden)
    SELECT
        osh.opportunity_id,
        MIN(osh.changed_at) AS dia_ganada
    FROM opportunity_stage_history osh
    JOIN sales_stages s ON osh.to_stage_id = s.id
    WHERE s."order" = (SELECT MAX("order") - 1 FROM sales_stages)
    GROUP BY osh.opportunity_id
)
SELECT
    EXTRACT(YEAR FROM o.created_at)::integer AS anio,
    EXTRACT(MONTH FROM o.created_at)::integer AS mes,
    o.created_at AS fecha,
    o.id AS codigo_oportunidad,
    CONCAT(l.first_name, ' ', l.last_name) AS nombre_cliente,
    u.name AS asesor,
    o.credit_type AS descripcion_tipo_prestamo,
    ss.closure_percentage AS porcentaje_etapa,
    COALESCE(o.source::text, l.source::text) AS descripcion_medio,
    ss.name AS descripcion_etapa,
    o.status AS estado,
    o.value AS monto_colocado,
    -- Vehículo
    v.make AS marca,
    v.model AS linea,
    v.year AS modelo,
    v.license_plate AS placa,
    -- Extras
    o.notes AS razon,
    o.royalti AS royalti,
    -- Inicio (primera vez en etapa order=2)
    EXTRACT(MONTH FROM si.dia_inicio)::integer AS mes_inicio,
    si.dia_inicio AS dia_inicio,
    -- Ganada (penúltima etapa, solo si won)
    CASE WHEN o.status = 'won' THEN EXTRACT(MONTH FROM sg.dia_ganada)::integer END AS mes_ganada,
    CASE WHEN o.status = 'won' THEN sg.dia_ganada END AS dia_ganada,
    -- Días hasta el cierre
    CASE
        WHEN o.status = 'won' AND si.dia_inicio IS NOT NULL AND sg.dia_ganada IS NOT NULL
        THEN (sg.dia_ganada::date - si.dia_inicio::date)
    END AS dias_hasta_el_cierre,
    -- Semana del inicio
    EXTRACT(WEEK FROM si.dia_inicio)::integer AS semana,
    -- Stage actual
    ss."order" AS orden_etapa,
    ss.name AS etapa
FROM opportunities o
LEFT JOIN leads l ON o.lead_id = l.id
LEFT JOIN "user" u ON o.assigned_to = u.id
LEFT JOIN sales_stages ss ON o.stage_id = ss.id
LEFT JOIN vehicles v ON o.vehicle_id = v.id
LEFT JOIN stage_inicio si ON o.id = si.opportunity_id
LEFT JOIN stage_ganada sg ON o.id = sg.opportunity_id;

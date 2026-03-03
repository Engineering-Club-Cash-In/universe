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
    -- 1-4: Identificación
    EXTRACT(YEAR FROM o.created_at)::integer AS anio,
    EXTRACT(MONTH FROM o.created_at)::integer AS mes,
    o.created_at AS fecha,
    o.id AS codigo_oportunidad,
    -- 5-6: Personas
    CONCAT(l.first_name, ' ', l.last_name) AS nombre_cliente,
    u.name AS asesor,
    -- 7-10: Clasificación
    o.credit_type AS descripcion_tipo_prestamo,
    ss.closure_percentage AS porcentaje_etapa,
    COALESCE(o.source::text, l.source::text) AS descripcion_medio,
    o.status AS estado,
    -- 11: Monto
    o.value AS monto_colocado,
    -- 12-14: Vehículo
    v.make AS marca,
    v.model AS linea,
    v.year AS modelo,
    -- 15: Comisionista (pendiente)
    NULL::text AS comisionista,
    -- 16-18: Extras
    o.notes AS razon,
    v.license_plate AS placa,
    o.royalti AS royalti,
    -- 19-20: Período
    EXTRACT(QUARTER FROM o.created_at)::integer AS semestre,
    EXTRACT(QUARTER FROM o.created_at)::integer AS trimestre,
    -- 21-22: Inicio
    EXTRACT(MONTH FROM si.dia_inicio)::integer AS mes_inicio,
    si.dia_inicio AS dia_inicio,
    -- 23-24: Ganada
    CASE WHEN o.status = 'won' THEN EXTRACT(MONTH FROM sg.dia_ganada)::integer END AS mes_ganada,
    CASE WHEN o.status = 'won' THEN sg.dia_ganada END AS dia_ganada,
    -- 25-26: Cierre
    CASE
        WHEN o.status = 'won' AND si.dia_inicio IS NOT NULL AND sg.dia_ganada IS NOT NULL
        THEN (sg.dia_ganada::date - si.dia_inicio::date)
    END AS dias_hasta_el_cierre,
    EXTRACT(WEEK FROM si.dia_inicio)::integer AS semana,
    -- 27-28: Stage actual
    ss."order" AS orden_etapa,
    ss.name AS etapa,
    -- 29-30: Pendientes
    NULL::decimal AS meta,
    NULL::decimal AS royalti_f
FROM opportunities o
LEFT JOIN leads l ON o.lead_id = l.id
LEFT JOIN "user" u ON o.assigned_to = u.id
LEFT JOIN sales_stages ss ON o.stage_id = ss.id
LEFT JOIN vehicles v ON o.vehicle_id = v.id
LEFT JOIN stage_inicio si ON o.id = si.opportunity_id
LEFT JOIN stage_ganada sg ON o.id = sg.opportunity_id;

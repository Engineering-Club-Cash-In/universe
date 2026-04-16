import { sql } from "drizzle-orm";
import { decimal, integer, pgView, text, timestamp } from "drizzle-orm/pg-core";

export const vistaReporteColocacion = pgView("vista_reporte_colocacion", {
	anio: integer("anio"),
	mes: integer("mes"),
	fecha: timestamp("fecha"),
	codigoOportunidad: text("codigo_oportunidad"),
	nombreCliente: text("nombre_cliente"),
	asesor: text("asesor"),
	descripcionTipoPrestamo: text("descripcion_tipo_prestamo"),
	porcentajeEtapa: integer("porcentaje_etapa"),
	descripcionMedio: text("descripcion_medio"),
	estado: text("estado"),
	montoColocado: decimal("monto_colocado", { precision: 12, scale: 2 }),
	marca: text("marca"),
	linea: text("linea"),
	modelo: integer("modelo"),
	comisionista: text("comisionista"),
	razon: text("razon"),
	placa: text("placa"),
	royalti: decimal("royalti", { precision: 12, scale: 2 }),
	semestre: integer("semestre"),
	trimestre: integer("trimestre"),
	mesInicio: integer("mes_inicio"),
	diaInicio: timestamp("dia_inicio"),
	mesGanada: integer("mes_ganada"),
	diaGanada: timestamp("dia_ganada"),
	diasHastaElCierre: integer("dias_hasta_el_cierre"),
	semana: integer("semana"),
	ordenEtapa: integer("orden_etapa"),
	etapa: text("etapa"),
	meta: decimal("meta", { precision: 12, scale: 2 }),
	royaltiF: decimal("royalti_f", { precision: 12, scale: 2 }),
}).as(sql`
	WITH stage_inicio AS (
		SELECT
			osh.opportunity_id,
			MIN(osh.changed_at) AS dia_inicio
		FROM opportunity_stage_history osh
		JOIN sales_stages s ON osh.to_stage_id = s.id
		WHERE s."order" = (SELECT MIN("order") + 1 FROM sales_stages)
		GROUP BY osh.opportunity_id
	),
	stage_ganada AS (
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
		o.status AS estado,
		o.value AS monto_colocado,
		v.make AS marca,
		v.model AS linea,
		v.year AS modelo,
		NULL::text AS comisionista,
		o.notes AS razon,
		v.license_plate AS placa,
		o.royalti AS royalti,
		EXTRACT(QUARTER FROM o.created_at)::integer AS semestre,
		EXTRACT(QUARTER FROM o.created_at)::integer AS trimestre,
		EXTRACT(MONTH FROM si.dia_inicio)::integer AS mes_inicio,
		si.dia_inicio AS dia_inicio,
		CASE WHEN o.status = 'won' THEN EXTRACT(MONTH FROM sg.dia_ganada)::integer END AS mes_ganada,
		CASE WHEN o.status = 'won' THEN sg.dia_ganada END AS dia_ganada,
		CASE
			WHEN o.status = 'won' AND si.dia_inicio IS NOT NULL AND sg.dia_ganada IS NOT NULL
			THEN (sg.dia_ganada::date - si.dia_inicio::date)
		END AS dias_hasta_el_cierre,
		EXTRACT(WEEK FROM si.dia_inicio)::integer AS semana,
		ss."order" AS orden_etapa,
		ss.name AS etapa,
		NULL::decimal AS meta,
		NULL::decimal AS royalti_f
	FROM opportunities o
	LEFT JOIN leads l ON o.lead_id = l.id
	LEFT JOIN "user" u ON o.assigned_to = u.id
	LEFT JOIN sales_stages ss ON o.stage_id = ss.id
	LEFT JOIN vehicles v ON o.vehicle_id = v.id
	LEFT JOIN stage_inicio si ON o.id = si.opportunity_id
	LEFT JOIN stage_ganada sg ON o.id = sg.opportunity_id
`);

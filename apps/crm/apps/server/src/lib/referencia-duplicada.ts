import { sql } from "drizzle-orm";
import { db } from "../db";
import {
	coincidenciasDeReferencia,
	type FilaCandidata,
	type ResultadoReferenciasDuplicadas,
} from "./referencia-coincidencias";
import {
	normalizarDpiReferencia,
	type ReferenciaComparable,
	telefonosDeReferencia,
} from "./referencia-normalizacion";

/**
 * Busca a la misma persona como referencia de OTRO cliente (EXTRAIT-267).
 * Fuentes: `referencias_lead` (cobros, sin DPI: solo teléfono) y, en cada
 * solicitud de crédito, las listas JSONB `referencias_personales` y
 * `referencias_crediticias` (la lista «familiar», llave legada).
 */

export type ExclusionesReferenciaDuplicada = {
	/** La oportunidad que se revisa: sus propias filas no cuentan. */
	excluirOportunidadId?: string | null;
};

/**
 * Tope de DPI y teléfonos distintos a buscar: cada uno es un parámetro y datos
 * viejos enormes pasarían el límite de Postgres. Arriba, falla a la vista.
 */
export const MAX_VALORES_LOTE = 500;

/**
 * Una consulta para todas las referencias; devuelve, por cada una (misma
 * posición), sus coincidencias en otros clientes. El SQL solo PREFILTRA, amplio
 * (DPI igual, o los 8 dígitos del teléfono dentro del campo); la regla fina la
 * aplica `coincidenciasDeReferencia` en memoria.
 */
export async function buscarReferenciasDuplicadasLote(
	referencias: ReferenciaComparable[],
	exclusiones: ExclusionesReferenciaDuplicada = {},
	cliente: Pick<typeof db, "execute"> = db,
): Promise<ResultadoReferenciasDuplicadas[]> {
	const dpis = new Set<string>();
	const telefonos = new Set<string>();
	for (const referencia of referencias) {
		const dpi = normalizarDpiReferencia(referencia.dpi);
		if (dpi) dpis.add(dpi);
		for (const telefono of telefonosDeReferencia(referencia.telefono)) {
			telefonos.add(telefono);
		}
	}
	if (dpis.size === 0 && telefonos.size === 0) {
		return referencias.map(() => ({ total: 0, coincidencias: [] }));
	}
	const valores = dpis.size + telefonos.size;
	if (valores > MAX_VALORES_LOTE) {
		// Nombre y código propios, y solo el conteo: los valores son datos personales.
		const error = new Error(`Demasiados valores para buscar: ${valores}`);
		error.name = "DemasiadosValoresError";
		throw Object.assign(error, { code: "REFERENCIAS_DEMASIADOS_VALORES" });
	}

	const excluirOportunidad = exclusiones.excluirOportunidadId ?? null;
	const telefonoEnCampo =
		telefonos.size > 0
			? sql.join(
					[...telefonos].map((t) => sql`strpos(digitos.telefono, ${t}) > 0`),
					sql` OR `,
				)
			: sql`false`;
	// Nombres sin espacios de más, vengan del lead, de la solicitud o del codeudor.
	const nombre = (texto: string) =>
		sql.raw(`NULLIF(regexp_replace(btrim(${texto}), '\\s+', ' ', 'g'), '')`);
	const nombreDe = (t: string) =>
		nombre(
			`concat_ws(' ', ${t}.first_name, ${t}.middle_name, ${t}.last_name, ${t}.second_last_name)`,
		);
	const ca = "credit_applications";
	const nombreDeLaSolicitud = nombre(
		`concat_ws(' ', ${ca}.primer_nombre, ${ca}.segundo_nombre, ${ca}.primer_apellido, ${ca}.segundo_apellido)`,
	);
	// Cada fila lleva UNA atribución: quién la dio (quien llenó la solicitud, o
	// el lead de cobros) y de qué cliente es (quien la dio si es titular; si es
	// codeudor, el titular actual de esa oportunidad). Más recientes primero,
	// con desempate fijo.
	const resultado = await cliente.execute(sql`
		WITH candidatas AS (
			-- En cobros, quien la dio y el cliente son el mismo lead.
			SELECT
				'cobros' AS tipo, referencias_lead.id::text AS fila_id, 0 AS posicion,
				referencias_lead.created_at AS fecha, NULL::uuid AS oportunidad_id,
				NULL::uuid AS titular_actual, referencias_lead.nombre AS referencia_nombre,
				referencias_lead.parentesco::text AS parentesco, NULL::text AS referencia_dpi,
				referencias_lead.telefono AS referencia_telefono, false AS codeudor,
				leads.id AS quien_lead,
				${nombreDe("leads")} AS quien_nombre, ${nombreDe("leads")} AS cliente_nombre
			FROM referencias_lead
			JOIN leads ON leads.id = referencias_lead.lead_id
			CROSS JOIN LATERAL (
				SELECT regexp_replace(referencias_lead.telefono, '\\D', '', 'g') AS telefono
			) AS digitos
			WHERE (${telefonoEnCampo})
			UNION ALL
			-- Quien la llenó; sin dueño (formulario legado) se atribuye al titular actual.
			SELECT
				lista.tipo, credit_applications.id::text, ref.posicion::int,
				credit_applications.created_at, opportunities.id, opportunities.lead_id,
				ref.elem->>'nombre', ref.elem->>'relacion', ref.elem->>'dpi', ref.elem->>'telefono',
				rol.codeudor,
				CASE WHEN rol.titular THEN credit_applications.person_id
					WHEN rol.codeudor THEN NULL ELSE opportunities.lead_id END,
				COALESCE(CASE WHEN rol.titular THEN ${nombreDe("dueno")}
					WHEN rol.codeudor THEN ${nombre("co_debtors.full_name")}
					ELSE ${nombreDe("leads")} END, ${nombreDeLaSolicitud}),
				CASE WHEN rol.codeudor THEN ${nombreDe("leads")}
					WHEN rol.titular THEN COALESCE(${nombreDe("dueno")}, ${nombreDeLaSolicitud})
					ELSE COALESCE(${nombreDe("leads")}, ${nombreDeLaSolicitud}) END
			FROM credit_applications
			JOIN opportunities ON opportunities.id = credit_applications.opportunity_id
			LEFT JOIN leads ON leads.id = opportunities.lead_id
			LEFT JOIN co_debtors ON credit_applications.person_type = 'coDebtor' AND co_debtors.id = credit_applications.person_id
			LEFT JOIN leads AS dueno ON credit_applications.person_type = 'lead' AND dueno.id = credit_applications.person_id
			CROSS JOIN LATERAL (SELECT
				COALESCE(credit_applications.person_type = 'coDebtor', false) AS codeudor,
				COALESCE(credit_applications.person_type = 'lead' AND credit_applications.person_id IS NOT NULL, false) AS titular
			) AS rol
			CROSS JOIN LATERAL (VALUES
				('personal', credit_applications.referencias_personales),
				('familiar', credit_applications.referencias_crediticias)
			) AS lista(tipo, arreglo)
			CROSS JOIN LATERAL jsonb_array_elements(
				CASE WHEN jsonb_typeof(lista.arreglo) = 'array' THEN lista.arreglo ELSE '[]'::jsonb END
			) WITH ORDINALITY AS ref(elem, posicion)
			CROSS JOIN LATERAL (
				SELECT
					regexp_replace(COALESCE(ref.elem->>'dpi', ''), '\\D', '', 'g') AS dpi,
					regexp_replace(COALESCE(ref.elem->>'telefono', ''), '\\D', '', 'g') AS telefono
			) AS digitos
			WHERE digitos.dpi = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify([...dpis])}::jsonb)))
				OR (${telefonoEnCampo})
		)
		SELECT
			tipo, fila_id, posicion, fecha, cliente.lead::text AS lead_id,
			oportunidad_id::text AS oportunidad_id, cliente_nombre, referencia_nombre,
			parentesco, referencia_dpi, referencia_telefono, quien_nombre AS dada_por_nombre,
			CASE WHEN codeudor THEN 'codeudor' ELSE 'titular' END AS dada_por_rol
		FROM candidatas
		CROSS JOIN LATERAL (SELECT
			CASE WHEN candidatas.codeudor THEN candidatas.titular_actual ELSE candidatas.quien_lead END AS lead
		) AS cliente
		WHERE (${excluirOportunidad}::uuid IS NULL OR candidatas.oportunidad_id IS DISTINCT FROM ${excluirOportunidad}::uuid)
		ORDER BY fecha DESC, tipo, fila_id, posicion
	`);

	const candidatas = resultado.rows as FilaCandidata[];
	return referencias.map((referencia) =>
		coincidenciasDeReferencia(referencia, candidatas),
	);
}

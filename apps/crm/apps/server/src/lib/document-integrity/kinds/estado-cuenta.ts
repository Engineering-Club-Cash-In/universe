import { z } from "zod";
import { createDocumentIntegrityAiSchema, type SignalSeverity } from "../types";

export const ESTADO_CUENTA_OBSERVATION_CODES = [
	"desalineacion_columnas",
	"tipografia_inconsistente",
	"montos_sobrepuestos",
	"espacios_en_blanco_sospechosos",
	"logo_baja_calidad",
	"formato_no_corresponde_al_emisor",
	"fechas_inconsistentes",
	"correlativos_fuera_de_secuencia",
	"texto_borroso_o_rasterizado",
	"marca_de_agua_ausente",
	"documento_declarado_sintetico_o_sin_validez",
	"otro",
] as const;

export const ESTADO_CUENTA_ISSUERS = [
	"banrural",
	"banco_industrial",
	"gyt_continental",
	"bac",
	"promerica",
	"banco_de_antigua",
	"banco_inmobiliario",
	"interbanco",
	"banco_azteca",
	"ficohsa",
	"vivibanco",
	"banco_de_los_trabajadores",
	"otro",
] as const;

export const estadoCuentaAiSchema = createDocumentIntegrityAiSchema(
	ESTADO_CUENTA_OBSERVATION_CODES,
	ESTADO_CUENTA_ISSUERS,
	{ observationCode: "otro", issuer: "otro" },
);

export const estadoCuentaBatchAiSchema = z.object({
	documentos: z
		.array(
			estadoCuentaAiSchema.extend({
				document_ref: z.string().trim().min(1).max(40),
			}),
		)
		.min(1)
		.max(9)
		.superRefine((documents, context) => {
			const references = documents.map((document) => document.document_ref);
			if (new Set(references).size !== references.length) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Cada documento debe tener un document_ref único",
				});
			}
		}),
});

export const ESTADO_CUENTA_PROMPT = `
Inspeccioná visualmente el PDF adjunto como un posible estado de cuenta bancario de Guatemala.
Validá únicamente identidad documental, emisor, período, titular, identificador reutilizable y anomalías visuales. No extraigás ni calculés saldos, montos, totales ni resúmenes financieros.
El número de cuenta puede devolverse en identificador_detectado, porque se usa solamente para detectar reutilización entre expedientes.
Un mismo PDF puede contener varios estados de cuenta legítimos, incluso de meses, cuentas o bancos distintos, porque el usuario puede haberlos unido antes de cargarlos. El cambio de diseño o emisor entre estados completos no es una anomalía por sí mismo; evaluá las inconsistencias dentro de cada estado de cuenta.
No emitas un veredicto. No uses las palabras fraude, falso, alterado ni rechazado. Reportá solo lo que observás.
Si no observás nada anómalo devolvé observaciones_forenses: []. No inventes observaciones para parecer útil.
Redactá todas las descripciones en español y limitadas a hechos visibles.
Expresá confianza_tipo_documento y la confianza de cada observación como porcentajes entre 0 y 100; nunca uses escala decimal de 0 a 1.
Usá documento_declarado_sintetico_o_sin_validez únicamente cuando una leyenda visible declare explícitamente que el documento es sintético, simulado, ficticio, de prueba, una muestra, ejemplo, plantilla, espécimen, demostración, generado por IA, sin validez, no válido, no oficial, sin valor legal o que no debe utilizarse para trámites. Considerá también equivalentes inequívocos en inglés como SAMPLE, SPECIMEN, TEST DOCUMENT, DEMO, MOCK DOCUMENT, AI-GENERATED, NOT VALID, VOID o FOR DEMONSTRATION ONLY.
Para documento_declarado_sintetico_o_sin_validez, pagina debe identificar dónde aparece la leyenda, texto_detectado debe copiar literalmente el texto visible y confianza debe ser al menos 90. Si falta alguno de esos elementos, reportá la observación como otro.
No uses esa señal por palabras aisladas dentro de movimientos, nombres, descripciones o cláusulas normales. Tampoco por leyendas legítimas como copia, vista previa, documento informativo o no negociable, ni solamente porque el diseño parezca artificial.
`;

export const ESTADO_CUENTA_BATCH_PROMPT = `${ESTADO_CUENTA_PROMPT}
Recibirás uno o más PDFs. Antes de cada archivo se indica un document_ref único.
Devolvé exactamente un resultado por PDF dentro de documentos y copiá su document_ref sin modificarlo.
No omitás, dupliqués, combinés ni reordenés la identidad de los documentos.
`;

export const ESTADO_CUENTA_AI_SIGNAL_META: Record<
	(typeof ESTADO_CUENTA_OBSERVATION_CODES)[number],
	{ label: string; severity: SignalSeverity; weight: 1 | 2 | 4 | 7 }
> = {
	desalineacion_columnas: {
		label: "Columnas desalineadas",
		severity: "alta",
		weight: 4,
	},
	tipografia_inconsistente: {
		label: "Tipografía inconsistente",
		severity: "alta",
		weight: 4,
	},
	montos_sobrepuestos: {
		label: "Texto o montos sobrepuestos",
		severity: "alta",
		weight: 4,
	},
	espacios_en_blanco_sospechosos: {
		label: "Espacios en blanco sospechosos",
		severity: "media",
		weight: 2,
	},
	logo_baja_calidad: {
		label: "Logo de baja calidad",
		severity: "baja",
		weight: 1,
	},
	formato_no_corresponde_al_emisor: {
		label: "Formato no corresponde al emisor",
		severity: "alta",
		weight: 4,
	},
	fechas_inconsistentes: {
		label: "Fechas visualmente inconsistentes",
		severity: "media",
		weight: 2,
	},
	correlativos_fuera_de_secuencia: {
		label: "Correlativos fuera de secuencia",
		severity: "media",
		weight: 2,
	},
	texto_borroso_o_rasterizado: {
		label: "Texto borroso o rasterizado",
		severity: "baja",
		weight: 1,
	},
	marca_de_agua_ausente: {
		label: "Marca de agua esperada ausente",
		severity: "baja",
		weight: 1,
	},
	documento_declarado_sintetico_o_sin_validez: {
		label: "El documento se identifica como sintético o sin validez",
		severity: "alta",
		weight: 7,
	},
	otro: { label: "Otra observación visual", severity: "baja", weight: 1 },
};

export interface IssuerFingerprintProfile {
	producerPatterns?: RegExp[];
	encrypted?: boolean;
	fontFamilies?: string[];
}

// Se sembrará con PDFs reales una vez exista una muestra representativa.
export const ESTADO_CUENTA_ISSUER_FINGERPRINTS: Record<
	string,
	IssuerFingerprintProfile
> = {};

export function getIssuerFingerprint(
	issuer: string | null | undefined,
): IssuerFingerprintProfile | null {
	if (!issuer || issuer === "otro") return null;
	return ESTADO_CUENTA_ISSUER_FINGERPRINTS[issuer] ?? null;
}

export function normalizeStatementIdentifier(
	value: string | null | undefined,
): string | null {
	if (!value) return null;
	const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
	return normalized.length >= 4 ? normalized : null;
}

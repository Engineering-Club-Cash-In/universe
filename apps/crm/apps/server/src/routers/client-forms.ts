import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	clientFormTokens,
	creditApplications,
	financialStatements,
} from "../db/schema/client-forms";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { verificarDpiDelFormulario } from "../lib/client-form-dpi";
import { crmProcedure, publicProcedure } from "../lib/orpc";
import {
	armarParticipantes,
	claveDeFormulario,
	type EntradaParticipantes,
	type FilaDeFormulario,
	nombreDelFormulario,
	participantesDeLaAlerta,
	personasPropias,
} from "../lib/participantes-formulario";
import {
	type NivelAlertaReferencias,
	nivelAlertaReferencias,
} from "../lib/permiso-alerta-referencias";
import type { ReferenciaDuplicada } from "../lib/referencia-coincidencias";
import { buscarReferenciasDuplicadasLote } from "../lib/referencia-duplicada";
import { ROLES } from "../lib/roles";
import { validarDpi } from "../utils/cui-validation";

const formPersonTypeSchema = z.enum(["lead", "coDebtor"]);
type FormPersonType = z.infer<typeof formPersonTypeSchema>;

/**
 * El resto del formulario se valida relajado a propósito, pero el DPI no puede
 * entrar crudo: es la llave con la que se cruza la identidad contra RENAP, buró
 * y cartera. Un CUI inválido guardado acá reaparece después como una validación
 * que no corresponde a nadie. Mismo criterio que el resto de las rutas que
 * escriben un DPI (`createLead`, `updateLead`, portal, bot, co-deudores).
 */
function normalizarDpiDelFormulario<T extends { dpi?: string }>(datos: T): T {
	if (datos.dpi === undefined || datos.dpi.trim() === "") return datos;

	const resultado = validarDpi(datos.dpi);
	if (!resultado.valid) {
		throw new ORPCError("BAD_REQUEST", { message: resultado.error });
	}

	return { ...datos, dpi: resultado.dpiLimpio };
}

// Relaxed server-side validation schemas (all fields optional, only validates types)

/**
 * El formulario manda 3 referencias por lista; el tope es holgado y frena un
 * envío público con miles, que después no se podría revisar.
 */
export const MAX_REFERENCIAS_POR_LISTA = 10;

const referenciaCrediticiaServerSchema = z.object({
	nombre: z.string().optional(),
	telefono: z.string().optional(),
	dpi: z.string().optional(),
});

const cuentaBancariaServerSchema = z.object({
	numero: z.string().optional(),
	tipo: z.string().optional(),
	banco: z.string().optional(),
});

const referenciaPersonalServerSchema = z.object({
	nombre: z.string().optional(),
	relacion: z.string().optional(),
	telefono: z.string().optional(),
	dpi: z.string().optional(),
});

export const creditApplicationServerSchema = z.object({
	primerApellido: z.string().optional(),
	segundoApellido: z.string().optional(),
	apellidoCasada: z.string().optional(),
	primerNombre: z.string().optional(),
	segundoNombre: z.string().optional(),
	dpi: z.string().optional(),
	nit: z.string().optional(),
	licenciaNo: z.string().optional(),
	edad: z.coerce.number().optional(),
	estadoCivil: z.string().optional(),
	dependientes: z.coerce.number().optional(),
	fechaNacimiento: z.string().optional(),
	sexo: z.string().optional(),
	nacionalidad: z.string().optional(),
	direccionResidencia: z.string().optional(),
	telResidencia: z.string().optional(),
	telMovil: z.string().optional(),
	telEmergencia: z.string().optional(),
	email: z.string().optional(),
	vehiculoMarca: z.string().optional(),
	vehiculoLinea: z.string().optional(),
	vehiculoModelo: z.string().optional(),
	valorEstimado: z.string().optional(),
	montoSolicitado: z.string().optional(),
	usoUber: z.boolean().optional(),
	profesion: z.string().optional(),
	puesto: z.string().optional(),
	sueldo: z.string().optional(),
	sueldoPeriodicidad: z.string().optional(),
	egresos: z.string().optional(),
	egresosPeriodicidad: z.string().optional(),
	fechaProximoPago: z.string().optional(),
	empresa: z.string().optional(),
	direccionTrabajo: z.string().optional(),
	fechaInicioLabores: z.string().optional(),
	tiempoTrabajado: z.string().optional(),
	horarios: z.string().optional(),
	telTrabajo: z.string().optional(),
	supervisor: z.string().optional(),
	rrhh: z.string().optional(),
	bancoPago: z.string().optional(),
	numCuenta: z.string().optional(),
	tipoCuenta: z.string().optional(),
	conyugeNombre: z.string().optional(),
	conyugeEmpresa: z.string().optional(),
	conyugeDireccion: z.string().optional(),
	conyugeTelOficina: z.string().optional(),
	conyugeTelMovil: z.string().optional(),
	referenciasCrediticias: z
		.array(referenciaCrediticiaServerSchema)
		.max(MAX_REFERENCIAS_POR_LISTA)
		.optional(),
	cuentasBancarias: z.array(cuentaBancariaServerSchema).optional(),
	referenciasPersonales: z
		.array(referenciaPersonalServerSchema)
		.max(MAX_REFERENCIAS_POR_LISTA)
		.optional(),
	esPep: z.boolean().optional(),
	comoSeEntero: z.string().optional(),
	utilizacionCredito: z.string().optional(),
});

const depositoBancarioServerSchema = z.object({
	descripcion: z.string().optional(),
	monto: z.string().optional(),
});

const descripcionMontoServerSchema = z.object({
	descripcion: z.string().optional(),
	monto: z.string().optional(),
});

const anexoInmuebleServerSchema = z.object({
	finca: z.string().optional(),
	folio: z.string().optional(),
	libro: z.string().optional(),
	valor: z.string().optional(),
	hipotecada: z.boolean().optional(),
	aFavorDe: z.string().optional(),
	direccion: z.string().optional(),
});

const anexoVehiculoServerSchema = z.object({
	marca: z.string().optional(),
	linea: z.string().optional(),
	placa: z.string().optional(),
	modeloAnio: z.string().optional(),
	valor: z.string().optional(),
});

const financialStatementServerSchema = z.object({
	primerNombre: z.string().optional(),
	segundoNombre: z.string().optional(),
	primerApellido: z.string().optional(),
	segundoApellido: z.string().optional(),
	apellidoCasada: z.string().optional(),
	dpi: z.string().optional(),
	dpiExtendidoEn: z.string().optional(),
	nit: z.string().optional(),
	efectivo: z.string().optional(),
	depositosBancarios: z.array(depositoBancarioServerSchema).optional(),
	cuentasCobrarAmigos: z.string().optional(),
	cuentasCobrarOtros: z.string().optional(),
	documentosCobrar: z.string().optional(),
	bienesInmueblesCantidad: z.coerce.number().optional(),
	bienesInmueblesValor: z.string().optional(),
	vehiculosCantidad: z.coerce.number().optional(),
	vehiculosValor: z.string().optional(),
	maquinaria: z.string().optional(),
	muebles: z.string().optional(),
	menaje: z.string().optional(),
	otrosActivos: z.array(descripcionMontoServerSchema).optional(),
	cuentasPagarAmigos: z.string().optional(),
	cuentasPagarOtros: z.string().optional(),
	letrasPagar: z.string().optional(),
	obligacionesParticulares: z.array(descripcionMontoServerSchema).optional(),
	obligacionesCortoPlazo: z.array(descripcionMontoServerSchema).optional(),
	obligacionesLargoPlazo: z.array(descripcionMontoServerSchema).optional(),
	otrosPasivos: z.array(descripcionMontoServerSchema).optional(),
	sueldos: z.string().optional(),
	bonificaciones: z.string().optional(),
	arrendamientos: z.string().optional(),
	otrosIngresos: z.array(descripcionMontoServerSchema).optional(),
	gastosPersonales: z.string().optional(),
	alquileres: z.string().optional(),
	amortizacionVivienda: z.string().optional(),
	deudasPersonales: z.string().optional(),
	otrosEgresos: z.array(descripcionMontoServerSchema).optional(),
	origenIngresos: z.string().optional(),
	comoAcreditanIngresos: z.string().optional(),
	anexoInmuebles: z.array(anexoInmuebleServerSchema).optional(),
	anexoVehiculos: z.array(anexoVehiculoServerSchema).optional(),
	firmaImagen: z.string().optional(),
	fechaFirma: z.string().optional(),
});

// Fields that are decimal/integer in the DB and must not receive empty strings
const DECIMAL_FIELDS = new Set([
	"valorEstimado",
	"montoSolicitado",
	"sueldo",
	"egresos",
	"efectivo",
	"cuentasCobrarAmigos",
	"cuentasCobrarOtros",
	"documentosCobrar",
	"bienesInmueblesValor",
	"vehiculosValor",
	"maquinaria",
	"muebles",
	"menaje",
	"cuentasPagarAmigos",
	"cuentasPagarOtros",
	"letrasPagar",
	"sueldos",
	"bonificaciones",
	"arrendamientos",
	"gastosPersonales",
	"alquileres",
	"amortizacionVivienda",
	"deudasPersonales",
]);

const INTEGER_FIELDS = new Set([
	"edad",
	"dependientes",
	"bienesInmueblesCantidad",
	"vehiculosCantidad",
]);

// Fields with monto/valor inside JSONB arrays that need sanitization
const JSONB_DECIMAL_KEYS = new Set(["monto", "valor"]);

function sanitizeJsonbArray(
	arr: Record<string, unknown>[],
): Record<string, unknown>[] {
	return arr.map((item) => {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(item)) {
			if (JSONB_DECIMAL_KEYS.has(key)) {
				if (value === "" || value === null || value === undefined) {
					sanitized[key] = null;
				} else {
					const num = Number(value);
					sanitized[key] = Number.isNaN(num) ? null : String(num);
				}
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	});
}

const JSONB_ARRAY_FIELDS = new Set([
	"depositosBancarios",
	"otrosActivos",
	"obligacionesParticulares",
	"obligacionesCortoPlazo",
	"obligacionesLargoPlazo",
	"otrosPasivos",
	"otrosIngresos",
	"otrosEgresos",
]);

function sanitizeFormData(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (DECIMAL_FIELDS.has(key)) {
			if (value === "" || value === null || value === undefined) {
				sanitized[key] = null;
			} else {
				const num = Number(value);
				sanitized[key] = Number.isNaN(num) ? null : String(num);
			}
		} else if (INTEGER_FIELDS.has(key)) {
			if (value === "" || value === null || value === undefined) {
				sanitized[key] = null;
			} else {
				const num = Number(value);
				sanitized[key] = Number.isNaN(num) ? null : Math.trunc(num);
			}
		} else if (JSONB_ARRAY_FIELDS.has(key) && Array.isArray(value)) {
			sanitized[key] = sanitizeJsonbArray(value as Record<string, unknown>[]);
		} else {
			sanitized[key] = value;
		}
	}
	return sanitized;
}

function personWhereClause(
	opportunityId: string,
	personType: FormPersonType,
	personId: string,
) {
	return and(
		eq(creditApplications.opportunityId, opportunityId),
		eq(creditApplications.personType, personType),
		eq(creditApplications.personId, personId),
	);
}

function financialPersonWhereClause(
	opportunityId: string,
	personType: FormPersonType,
	personId: string,
) {
	return and(
		eq(financialStatements.opportunityId, opportunityId),
		eq(financialStatements.personType, personType),
		eq(financialStatements.personId, personId),
	);
}

type TokenRow = typeof clientFormTokens.$inferSelect;
type FormRow = Record<string, unknown> | null;

async function getOpportunityOrThrow(opportunityId: string) {
	const [opp] = await db
		.select()
		.from(opportunities)
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!opp) {
		throw new ORPCError("NOT_FOUND", {
			message: "Oportunidad no encontrada",
		});
	}

	return opp;
}

/**
 * Ventas solo trabaja los formularios de las oportunidades asignadas a sí
 * mismo, la misma regla que el resto del CRM (crm.ts, upload.ts). Va antes de
 * leer o tocar cualquier formulario: la solicitud trae DPI, firma, referencias
 * y estado patrimonial del cliente. Los demás roles con acceso a clientes no
 * cambian acá.
 */
function exigirOportunidadPropiaDeVentas(
	opp: { assignedTo: string },
	usuario: { userRole?: string | null; userId: string },
) {
	if (usuario.userRole === ROLES.SALES && opp.assignedTo !== usuario.userId) {
		throw new ORPCError("FORBIDDEN", {
			message: "No tienes permiso para ver los formularios de esta oportunidad",
		});
	}
}

async function resolveParticipant(
	opportunityId: string,
	personType: FormPersonType,
	personId: string,
) {
	const opp = await getOpportunityOrThrow(opportunityId);

	if (personType === "lead") {
		if (!opp.leadId || opp.leadId !== personId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "El lead no pertenece a la oportunidad",
			});
		}

		const [lead] = await db
			.select()
			.from(leads)
			.where(eq(leads.id, personId))
			.limit(1);

		if (!lead) {
			throw new ORPCError("NOT_FOUND", {
				message: "Lead no encontrado",
			});
		}

		return {
			opp,
			participantType: "lead" as const,
			participant: lead,
			displayName: [
				lead.firstName,
				lead.middleName,
				lead.lastName,
				lead.secondLastName,
			]
				.filter(Boolean)
				.join(" "),
		};
	}

	const [coDebtor] = await db
		.select()
		.from(coDebtors)
		.where(
			and(
				eq(coDebtors.id, personId),
				eq(coDebtors.opportunityId, opportunityId),
			),
		)
		.limit(1);

	if (!coDebtor) {
		throw new ORPCError("NOT_FOUND", {
			message: "Co-firmante no encontrado",
		});
	}

	return {
		opp,
		participantType: "coDebtor" as const,
		participant: coDebtor,
		displayName: coDebtor.fullName,
	};
}

async function getValidToken(token: string) {
	const [tokenRow] = await db
		.select()
		.from(clientFormTokens)
		.where(
			and(
				eq(clientFormTokens.token, token),
				gt(clientFormTokens.expiresAt, new Date()),
			),
		)
		.limit(1);

	if (!tokenRow) {
		throw new ORPCError("NOT_FOUND", {
			message: "El enlace es inválido o ha expirado",
		});
	}

	if (tokenRow.used) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Este formulario ya fue completado",
		});
	}

	return tokenRow;
}

async function resolveTokenParticipant(tokenRow: TokenRow): Promise<{
	personType: FormPersonType;
	personId: string;
} | null> {
	if (tokenRow.personType && tokenRow.personId) {
		return {
			personType: tokenRow.personType as FormPersonType,
			personId: tokenRow.personId,
		};
	}

	const opp = await getOpportunityOrThrow(tokenRow.opportunityId);
	if (!opp.leadId) return null;

	await db
		.update(clientFormTokens)
		.set({
			personType: "lead",
			personId: opp.leadId,
		})
		.where(eq(clientFormTokens.id, tokenRow.id));

	return {
		personType: "lead",
		personId: opp.leadId,
	};
}

/**
 * El DPI que el CRM ya tiene guardado para el participante del token.
 *
 * `null` cuando todavía no tiene ninguno: ese es el caso de captura legítima y
 * el formulario lo puede traer. Ver `verificarDpiDelFormulario`.
 */
async function dpiGuardadoDelParticipante(
	participantRef: { personType: FormPersonType; personId: string } | null,
): Promise<string | null> {
	if (!participantRef) return null;

	if (participantRef.personType === "coDebtor") {
		const [fila] = await db
			.select({ dpi: coDebtors.dpi })
			.from(coDebtors)
			.where(eq(coDebtors.id, participantRef.personId))
			.limit(1);
		return fila?.dpi ?? null;
	}

	const [fila] = await db
		.select({ dpi: leads.dpi })
		.from(leads)
		.where(eq(leads.id, participantRef.personId))
		.limit(1);
	return fila?.dpi ?? null;
}

/**
 * Corta el submit si el DPI del formulario no es el del dueño del enlace.
 *
 * 🔴 Estas rutas son públicas: la única credencial es el token, que identifica
 * a UNA persona. Sin este cruce, con un enlace vigente se podía firmar una
 * solicitud a nombre de otro DPI —puenteando de paso el invariante del candado,
 * que existe para que la identidad de un expediente no se mueva—.
 */
async function exigirDpiDelParticipante(
	participantRef: { personType: FormPersonType; personId: string } | null,
	datos: { dpi?: string },
): Promise<void> {
	const guardado = await dpiGuardadoDelParticipante(participantRef);
	const resultado = verificarDpiDelFormulario(guardado, datos.dpi);

	if (!resultado.coincide) {
		throw new ORPCError("BAD_REQUEST", { message: resultado.mensaje });
	}
}

async function getVehicleForOpportunity(opportunityId: string) {
	const [opp] = await db
		.select({ vehicleId: opportunities.vehicleId })
		.from(opportunities)
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!opp?.vehicleId) return null;

	const [vehicle] = await db
		.select()
		.from(vehicles)
		.where(eq(vehicles.id, opp.vehicleId))
		.limit(1);

	return vehicle ?? null;
}

function serializeRow(row: unknown): FormRow {
	if (!row) return null;
	return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

/** Una referencia de la solicitud que ya figura en otro cliente. */
type ReferenciaEnAlerta = {
	tipo: "personal" | "familiar";
	indice: number;
	nombre: string;
	dpi: string;
	total: number;
	/** Quiénes son esos otros clientes: solo con nivel «detalle». */
	coincidencias?: ReferenciaDuplicada[];
};

/** La alerta de una oportunidad; `null` en la respuesta si el usuario no la puede ver. */
export type AlertaReferencias = {
	nivel: Exclude<NivelAlertaReferencias, "ninguno">;
	/** La búsqueda falló: no es lo mismo que «sin coincidencias». */
	error: boolean;
	participantes: {
		personType: "lead" | "coDebtor";
		personId: string;
		nombre: string;
		etiqueta: string;
		referencias: ReferenciaEnAlerta[];
	}[];
};

/** De una solicitud o estado patrimonial, solo lo que identifica y nombra a su dueño. */
function columnasDelNombre(
	tabla: typeof creditApplications | typeof financialStatements,
) {
	return {
		personType: tabla.personType,
		personId: tabla.personId,
		opportunityId: tabla.opportunityId,
		primerNombre: tabla.primerNombre,
		segundoNombre: tabla.segundoNombre,
		primerApellido: tabla.primerApellido,
		segundoApellido: tabla.segundoApellido,
	};
}

/** Lo que la alerta necesita de la oportunidad; cada endpoint lo lee a su manera. */
type DatosDeLaAlerta = Omit<
	EntradaParticipantes,
	"tokens" | "lead" | "coDebtors" | "creditRows" | "financialRows"
> & {
	lead:
		| (NonNullable<EntradaParticipantes["lead"]> & { dpi: string | null })
		| null;
	coDebtors: (EntradaParticipantes["coDebtors"][number] & { dpi: string })[];
	/** Con sus dos listas de referencias (JSONB sin garantías). */
	solicitudes: (FilaDeFormulario & { dpi?: string | null } & Record<
			"referenciasPersonales" | "referenciasCrediticias",
			unknown
		>)[];
	/** Solo sirven para nombrar a un histórico: se piden si hay algo que mostrar. */
	patrimoniales: () => Promise<FilaDeFormulario[]>;
};

/**
 * Las referencias de cada participante (hasta `MAX_REFERENCIAS_POR_LISTA` por
 * lista, aunque datos viejos traigan más) que ya son de OTRO cliente: ni de
 * esta oportunidad ni de sus personas propias. Una sola búsqueda.
 */
async function referenciasRepetidas(datos: DatosDeLaAlerta) {
	const planas: (Omit<ReferenciaEnAlerta, "total"> & {
		participante: string;
		telefono?: string | number;
	})[] = [];
	for (const solicitud of datos.solicitudes) {
		for (const [tipo, referencias] of [
			["personal", solicitud.referenciasPersonales],
			["familiar", solicitud.referenciasCrediticias],
		] as const) {
			if (!Array.isArray(referencias)) continue;
			const revisadas = referencias.slice(0, MAX_REFERENCIAS_POR_LISTA);
			for (const [indice, referencia] of revisadas.entries()) {
				// JSONB sin garantías: un null o un número no deben llegar a la vista como «null».
				const dato = (referencia ?? {}) as Record<string, unknown>;
				planas.push({
					participante: claveDeFormulario(solicitud),
					tipo,
					indice,
					nombre: String(dato.nombre ?? ""),
					dpi: String(dato.dpi ?? ""),
					telefono: dato.telefono as string | number | undefined,
				});
			}
		}
	}

	const porParticipante = new Map<string, ReferenciaEnAlerta[]>();
	if (planas.length === 0) return porParticipante;
	// Las mismas personas que nombra la alerta, históricos incluidos.
	const propias = personasPropias({ ...datos, creditRows: datos.solicitudes });
	const resultados = await buscarReferenciasDuplicadasLote(planas, {
		excluirOportunidadId: datos.opportunityId,
		excluirLeadIds: propias.leadIds,
		excluirDpis: propias.dpis,
	});
	for (const [
		i,
		{ participante, telefono: _, ...referencia },
	] of planas.entries()) {
		const { total, coincidencias } = resultados[i];
		if (total === 0) continue;
		const lista = porParticipante.get(participante) ?? [];
		lista.push({ ...referencia, total, coincidencias });
		porParticipante.set(participante, lista);
	}
	return porParticipante;
}

/**
 * La alerta que ven «Formularios del Cliente» y la pantalla de análisis, con
 * los mismos participantes (`participantesDeLaAlerta`). Con nivel «aviso» el
 * recorte se hace acá, en el servidor: no sale nada de los otros clientes. Si
 * la búsqueda falla devuelve `error` y la pantalla sigue cargando.
 */
async function alertaDeReferencias(
	nivel: AlertaReferencias["nivel"],
	datos: DatosDeLaAlerta,
): Promise<AlertaReferencias> {
	try {
		const repetidas = await referenciasRepetidas(datos);
		if (repetidas.size === 0) return { nivel, error: false, participantes: [] };
		const participantes = participantesDeLaAlerta({
			...datos,
			creditRows: datos.solicitudes,
			financialRows: await datos.patrimoniales(),
		});
		return {
			nivel,
			error: false,
			participantes: [...participantes].flatMap(([clave, p]) => {
				const referencias = repetidas.get(clave) ?? [];
				if (referencias.length === 0) return [];
				return {
					personType: p.personType,
					personId: p.personId,
					nombre: p.displayName,
					etiqueta: p.roleLabel,
					// Sin detalle, nada de los otros clientes sale del servidor.
					referencias:
						nivel === "detalle"
							? referencias
							: referencias.map(({ coincidencias: _, ...aviso }) => aviso),
				};
			}),
		};
	} catch (error) {
		// Sin el error completo: el de la base trae los parámetros (DPI, teléfonos).
		const { name, code, cause } = (error ?? {}) as {
			name?: string;
			code?: string;
			cause?: { code?: string };
		};
		console.error(
			"[alertaDeReferencias] No se pudo buscar referencias repetidas, opportunity:",
			datos.opportunityId,
			name ?? typeof error,
			code ?? cause?.code ?? "",
		);
		return { nivel, error: true, participantes: [] };
	}
}

export const clientFormsRouter = {
	generateFormToken: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				personType: formPersonTypeSchema,
				personId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			exigirOportunidadPropiaDeVentas(
				await getOpportunityOrThrow(input.opportunityId),
				context,
			);
			await resolveParticipant(
				input.opportunityId,
				input.personType,
				input.personId,
			);

			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7);

			const tokenRow = await db.transaction(async (tx) => {
				// Se vuelve a verificar con la oportunidad tomada FOR SHARE: la
				// verificación de arriba es una lectura suelta, y una reasignación
				// (UPDATE de la fila) entre ella y este punto dejaría al asesor viejo
				// borrar la solicitud firmada de una oportunidad que ya no es suya.
				// Con el candado, la reasignación espera a que esto termine, o esto
				// ve al dueño nuevo.
				const [vigente] = await tx
					.select({ assignedTo: opportunities.assignedTo })
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId))
					.for("share");
				if (!vigente) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}
				exigirOportunidadPropiaDeVentas(vigente, context);

				await tx
					.delete(creditApplications)
					.where(
						personWhereClause(
							input.opportunityId,
							input.personType,
							input.personId,
						),
					);

				await tx
					.delete(financialStatements)
					.where(
						financialPersonWhereClause(
							input.opportunityId,
							input.personType,
							input.personId,
						),
					);

				const [row] = await tx
					.insert(clientFormTokens)
					.values({
						opportunityId: input.opportunityId,
						personType: input.personType,
						personId: input.personId,
						expiresAt,
					})
					.returning();

				return row;
			});

			return {
				token: tokenRow.token,
				url: `${process.env.FRONT_URL}/formulario/${tokenRow.token}`,
			};
		}),

	validateFormToken: publicProcedure
		.input(z.object({ token: z.string().uuid() }))
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);
			const participantRef = await resolveTokenParticipant(tokenRow);
			const vehicle = await getVehicleForOpportunity(tokenRow.opportunityId);

			const [existingCredit] = await db
				.select()
				.from(creditApplications)
				.where(
					participantRef
						? personWhereClause(
								tokenRow.opportunityId,
								participantRef.personType,
								participantRef.personId,
							)
						: eq(creditApplications.opportunityId, tokenRow.opportunityId),
				)
				.limit(1);

			const [existingFinancial] = await db
				.select()
				.from(financialStatements)
				.where(
					participantRef
						? financialPersonWhereClause(
								tokenRow.opportunityId,
								participantRef.personType,
								participantRef.personId,
							)
						: eq(financialStatements.opportunityId, tokenRow.opportunityId),
				)
				.limit(1);

			if (!participantRef) {
				const displayName =
					nombreDelFormulario(existingCredit ?? existingFinancial) || "Titular";

				return {
					opportunityId: tokenRow.opportunityId,
					personType: "lead" as const,
					personId: null,
					personDisplayName: displayName,
					person: {
						firstName: (existingCredit?.primerNombre as string | null) ?? "",
						middleName: (existingCredit?.segundoNombre as string | null) ?? "",
						lastName: (existingCredit?.primerApellido as string | null) ?? "",
						secondLastName:
							(existingCredit?.segundoApellido as string | null) ?? "",
						dpi: (existingCredit?.dpi as string | null) ?? "",
						nit: (existingCredit?.nit as string | null) ?? "",
						email: (existingCredit?.email as string | null) ?? "",
						phone: (existingCredit?.telMovil as string | null) ?? "",
						direccion:
							(existingCredit?.direccionResidencia as string | null) ?? "",
					},
					vehicle,
					creditApplicationExists: !!existingCredit,
					creditHasSignature: !!existingCredit?.firmaImagen,
					financialStatementExists: !!existingFinancial,
					existingCreditApplication: existingCredit
						? {
								primerNombre: existingCredit.primerNombre,
								segundoNombre: existingCredit.segundoNombre,
								primerApellido: existingCredit.primerApellido,
								segundoApellido: existingCredit.segundoApellido,
								apellidoCasada: existingCredit.apellidoCasada,
								dpi: existingCredit.dpi,
								nit: existingCredit.nit,
							}
						: null,
				};
			}

			const { participant, participantType, displayName } =
				await resolveParticipant(
					tokenRow.opportunityId,
					participantRef.personType,
					participantRef.personId,
				);

			return {
				opportunityId: tokenRow.opportunityId,
				personType: participantType,
				personId: participantRef.personId,
				personDisplayName: displayName,
				person:
					participantType === "lead"
						? {
								firstName: participant.firstName,
								middleName: participant.middleName,
								lastName: participant.lastName,
								secondLastName: participant.secondLastName,
								dpi: participant.dpi,
								nit: participant.nit,
								email: participant.email,
								phone: participant.phone,
								direccion: participant.direccion,
							}
						: {
								fullName: participant.fullName,
								dpi: participant.dpi,
								email: participant.email,
								phone: participant.phone,
							},
				vehicle,
				creditApplicationExists: !!existingCredit,
				creditHasSignature: !!existingCredit?.firmaImagen,
				financialStatementExists: !!existingFinancial,
				existingCreditApplication: existingCredit
					? {
							primerNombre: existingCredit.primerNombre,
							segundoNombre: existingCredit.segundoNombre,
							primerApellido: existingCredit.primerApellido,
							segundoApellido: existingCredit.segundoApellido,
							apellidoCasada: existingCredit.apellidoCasada,
							dpi: existingCredit.dpi,
							nit: existingCredit.nit,
						}
					: null,
			};
		}),

	submitCreditApplication: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);
			const participantRef = await resolveTokenParticipant(tokenRow);

			const parsed = creditApplicationServerSchema.safeParse(input.data);
			if (!parsed.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Datos de solicitud inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
				});
			}

			const datos = normalizarDpiDelFormulario(parsed.data);

			// El enlace identifica a UNA persona: el DPI que llega no puede ser el
			// de otra. Ver `exigirDpiDelParticipante`.
			await exigirDpiDelParticipante(participantRef, datos);

			const values = {
				opportunityId: tokenRow.opportunityId,
				...(participantRef
					? {
							personType: participantRef.personType,
							personId: participantRef.personId,
						}
					: {}),
				...sanitizeFormData(datos as Record<string, unknown>),
				updatedAt: new Date(),
			};

			try {
				const [existing] = await db
					.select()
					.from(creditApplications)
					.where(
						participantRef
							? personWhereClause(
									tokenRow.opportunityId,
									participantRef.personType,
									participantRef.personId,
								)
							: eq(creditApplications.opportunityId, tokenRow.opportunityId),
					)
					.limit(1);

				if (existing) {
					await db
						.update(creditApplications)
						.set(values)
						.where(eq(creditApplications.id, existing.id));
				} else {
					await db.insert(creditApplications).values(values);
				}

				await db
					.update(clientFormTokens)
					.set({ creditSubmittedAt: new Date() })
					.where(eq(clientFormTokens.id, tokenRow.id));
			} catch (error) {
				console.error(
					"[submitCreditApplication] DB error for token:",
					tokenRow.id,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al guardar la solicitud de crédito",
				});
			}

			return { success: true };
		}),

	signCreditApplication: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				firmaImagen: z.string(),
				fechaFirma: z.string(),
				horaFirma: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);
			const participantRef = await resolveTokenParticipant(tokenRow);

			try {
				const [existing] = await db
					.select()
					.from(creditApplications)
					.where(
						participantRef
							? personWhereClause(
									tokenRow.opportunityId,
									participantRef.personType,
									participantRef.personId,
								)
							: eq(creditApplications.opportunityId, tokenRow.opportunityId),
					)
					.limit(1);

				if (!existing) {
					throw new ORPCError("NOT_FOUND", {
						message: "No se encontró la solicitud de crédito para firmar",
					});
				}

				await db
					.update(creditApplications)
					.set({
						firmaImagen: input.firmaImagen,
						fechaFirma: input.fechaFirma,
						horaFirma: input.horaFirma,
						updatedAt: new Date(),
					})
					.where(eq(creditApplications.id, existing.id));
			} catch (error) {
				if (error instanceof ORPCError) throw error;
				console.error(
					"[signCreditApplication] DB error for token:",
					tokenRow.id,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al firmar la solicitud de crédito",
				});
			}

			return { success: true };
		}),

	submitFinancialStatement: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);
			const participantRef = await resolveTokenParticipant(tokenRow);

			const parsed = financialStatementServerSchema.safeParse(input.data);
			if (!parsed.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Datos de estado patrimonial inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
				});
			}

			const datos = normalizarDpiDelFormulario(parsed.data);

			// El enlace identifica a UNA persona: el DPI que llega no puede ser el
			// de otra. Ver `exigirDpiDelParticipante`.
			await exigirDpiDelParticipante(participantRef, datos);

			const values = {
				opportunityId: tokenRow.opportunityId,
				...(participantRef
					? {
							personType: participantRef.personType,
							personId: participantRef.personId,
						}
					: {}),
				...sanitizeFormData(datos as Record<string, unknown>),
				updatedAt: new Date(),
			};

			try {
				const [existing] = await db
					.select()
					.from(financialStatements)
					.where(
						participantRef
							? financialPersonWhereClause(
									tokenRow.opportunityId,
									participantRef.personType,
									participantRef.personId,
								)
							: eq(financialStatements.opportunityId, tokenRow.opportunityId),
					)
					.limit(1);

				if (existing) {
					await db
						.update(financialStatements)
						.set(values)
						.where(eq(financialStatements.id, existing.id));
				} else {
					await db.insert(financialStatements).values(values);
				}

				await db
					.update(clientFormTokens)
					.set({ used: true })
					.where(eq(clientFormTokens.id, tokenRow.id));
			} catch (error) {
				console.error(
					"[submitFinancialStatement] DB error for token:",
					tokenRow.id,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al guardar el estado patrimonial",
				});
			}

			return { success: true };
		}),

	/**
	 * Para la pantalla de análisis: la misma alerta que `getClientFormData`
	 * (mismo armado, participantes y permisos), leyendo solo las columnas que
	 * hacen falta: sin firmas, formularios completos ni enlaces.
	 */
	getReferenciasRepetidas: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }): Promise<AlertaReferencias | null> => {
			const opp = await getOpportunityOrThrow(input.opportunityId);
			exigirOportunidadPropiaDeVentas(opp, context);
			// Se autoriza antes de leer nada más: sin permiso ni se busca.
			const nivel = nivelAlertaReferencias({
				userRole: context.userRole,
				userId: context.userId,
				assignedTo: opp.assignedTo,
			});
			if (nivel === "ninguno") return null;

			const [lead, codeudores, solicitudes] = await Promise.all([
				opp.leadId
					? db
							.select({
								id: leads.id,
								dpi: leads.dpi,
								email: leads.email,
								phone: leads.phone,
								firstName: leads.firstName,
								middleName: leads.middleName,
								lastName: leads.lastName,
								secondLastName: leads.secondLastName,
							})
							.from(leads)
							.where(eq(leads.id, opp.leadId))
							.limit(1)
							.then(([fila]) => fila ?? null)
					: null,
				db
					.select({
						id: coDebtors.id,
						fullName: coDebtors.fullName,
						dpi: coDebtors.dpi,
						email: coDebtors.email,
						phone: coDebtors.phone,
					})
					.from(coDebtors)
					.where(eq(coDebtors.opportunityId, input.opportunityId))
					.orderBy(coDebtors.createdAt),
				db
					.select({
						...columnasDelNombre(creditApplications),
						email: creditApplications.email,
						telMovil: creditApplications.telMovil,
						// el DPI que escribió quien la llenó: lo hace persona propia
						dpi: creditApplications.dpi,
						referenciasPersonales: creditApplications.referenciasPersonales,
						referenciasCrediticias: creditApplications.referenciasCrediticias,
					})
					.from(creditApplications)
					.where(eq(creditApplications.opportunityId, input.opportunityId)),
			]);
			return alertaDeReferencias(nivel, {
				opportunityId: input.opportunityId,
				lead,
				coDebtors: codeudores,
				solicitudes,
				patrimoniales: () =>
					db
						.select(columnasDelNombre(financialStatements))
						.from(financialStatements)
						.where(eq(financialStatements.opportunityId, input.opportunityId)),
			});
		}),

	getClientFormData: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const opp = await getOpportunityOrThrow(input.opportunityId);
			exigirOportunidadPropiaDeVentas(opp, context);
			const vehicle = await getVehicleForOpportunity(input.opportunityId);

			const [lead] = opp.leadId
				? await db.select().from(leads).where(eq(leads.id, opp.leadId)).limit(1)
				: [null];

			const coDebtorsList = await db
				.select()
				.from(coDebtors)
				.where(eq(coDebtors.opportunityId, input.opportunityId))
				.orderBy(coDebtors.createdAt);

			const tokenRows = await db
				.select()
				.from(clientFormTokens)
				.where(eq(clientFormTokens.opportunityId, input.opportunityId))
				.orderBy(desc(clientFormTokens.createdAt));

			const creditRows = await db
				.select()
				.from(creditApplications)
				.where(eq(creditApplications.opportunityId, input.opportunityId));

			const financialRows = await db
				.select()
				.from(financialStatements)
				.where(eq(financialStatements.opportunityId, input.opportunityId));

			const latestTokens = new Map<string, TokenRow>();
			for (const tokenRow of tokenRows) {
				const key = claveDeFormulario(tokenRow);
				if (!latestTokens.has(key)) {
					latestTokens.set(key, tokenRow);
				}
			}

			const creditByPerson = new Map(
				creditRows.map((row) => [claveDeFormulario(row), row]),
			);
			const financialByPerson = new Map(
				financialRows.map((row) => [claveDeFormulario(row), row]),
			);
			const participantMap = armarParticipantes({
				opportunityId: input.opportunityId,
				lead: lead ?? null,
				coDebtors: coDebtorsList,
				tokens: tokenRows,
				creditRows,
				financialRows,
			});

			const participants = Array.from(participantMap.entries()).map(
				([key, participant]) => {
					const latestToken = latestTokens.get(key) ?? null;
					const creditApp = creditByPerson.get(key) ?? null;
					const financialStmt = financialByPerson.get(key) ?? null;

					return {
						...participant,
						latestToken: latestToken
							? {
									token: latestToken.token,
									url: `${process.env.FRONT_URL}/formulario/${latestToken.token}`,
									expiresAt: latestToken.expiresAt,
									used: latestToken.used,
									createdAt: latestToken.createdAt,
								}
							: null,
						creditApplication: serializeRow(creditApp),
						financialStatement: serializeRow(financialStmt),
						creditApplicationExists: !!creditApp,
						creditHasSignature: !!creditApp?.firmaImagen,
						financialStatementExists: !!financialStmt,
					};
				},
			);

			// La alerta se decide antes de buscar: sin permiso ni se consulta.
			const nivel = nivelAlertaReferencias({
				userRole: context.userRole,
				userId: context.userId,
				assignedTo: opp.assignedTo,
			});
			const alertaReferencias =
				nivel === "ninguno"
					? null
					: await alertaDeReferencias(nivel, {
							opportunityId: input.opportunityId,
							lead: lead ?? null,
							coDebtors: coDebtorsList,
							solicitudes: creditRows,
							patrimoniales: async () => financialRows,
						});

			return {
				opportunityId: input.opportunityId,
				vehicle,
				participants,
				alertaReferencias,
			};
		}),

	getFormTokenByOpportunity: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Los enlaces abren el formulario público con los datos del cliente.
			// Solo ventas lee la oportunidad: el resto sigue igual que antes.
			if (context.userRole === ROLES.SALES) {
				exigirOportunidadPropiaDeVentas(
					await getOpportunityOrThrow(input.opportunityId),
					context,
				);
			}
			const tokenRows = await db
				.select()
				.from(clientFormTokens)
				.where(eq(clientFormTokens.opportunityId, input.opportunityId))
				.orderBy(desc(clientFormTokens.createdAt));

			const latestTokens = new Map<string, TokenRow>();
			for (const tokenRow of tokenRows) {
				const key = `${tokenRow.personType}:${tokenRow.personId}`;
				if (!latestTokens.has(key)) {
					latestTokens.set(key, tokenRow);
				}
			}

			return Array.from(latestTokens.values()).map((tokenRow) => ({
				personType: tokenRow.personType,
				personId: tokenRow.personId,
				url: `${process.env.FRONT_URL}/formulario/${tokenRow.token}`,
				expiresAt: tokenRow.expiresAt,
				used: tokenRow.used,
			}));
		}),
};

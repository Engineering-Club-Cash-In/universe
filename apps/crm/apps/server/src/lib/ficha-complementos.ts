/**
 * Ficha 360 · lo que llena `getFichaComplementos` (issue #1864).
 *
 * Cada bloque tiene su cargador (consulta) y su armado (función pura, con
 * pruebas). El router los corre en paralelo y aísla las fallas: si un bloque
 * falla, ese bloque queda en `null` y la ficha lo muestra pendiente; los demás
 * siguen.
 *
 * Plan y decisiones: docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import { renapInfo } from "../db/schema/renap";
import { vehicles } from "../db/schema/vehicles";
import type {
	CodeudorFicha,
	DatosPersonalesFicha,
	SeguroComplemento,
} from "../routers/ficha-cobros";
import type { ContextoCaso } from "../services/referencias-cobros-datos";
import { quetzales } from "./bot-cobros/mensajes-credito";
import { seguroPorAseguradora } from "./cobros-plantillas";
import { eqDpi } from "./dpi-lookup";

/* ── Utilidades puras ───────────────────────────────────────────────────────── */

/** Texto con contenido o `null` (los formularios guardan "" en vez de NULL). */
export function limpio(v: string | null | undefined): string | null {
	const t = v?.trim();
	return t ? t : null;
}

/** Une las partes con contenido; `null` si ninguna tiene. */
function unir(
	partes: Array<string | null | undefined>,
	sep = " ",
): string | null {
	const llenas = partes.map(limpio).filter((p): p is string => p !== null);
	return llenas.length > 0 ? llenas.join(sep) : null;
}

const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y"]);

/**
 * "MARÍA DE LA CRUZ" → "María de la Cruz". RENAP guarda los nombres en
 * mayúsculas; el resto de la ficha los muestra como nombre propio.
 */
export function nombrePropio(texto: string): string {
	return texto
		.toLocaleLowerCase("es")
		.split(/\s+/)
		.filter(Boolean)
		.map((p, i) =>
			i > 0 && PARTICULAS.has(p)
				? p
				: p.charAt(0).toLocaleUpperCase("es") + p.slice(1),
		)
		.join(" ");
}

/**
 * Fecha a "YYYY-MM-DD". Acepta `Date` (los `timestamp` sin zona de Drizzle se
 * leen como UTC, así que la fecha UTC es la guardada), "YYYY-MM-DD…" y
 * "DD/MM/YYYY". Cualquier otra cosa → `null`.
 */
export function fechaISO(v: Date | string | null | undefined): string | null {
	if (!v) return null;
	if (v instanceof Date) {
		return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
	}
	const t = v.trim();
	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
	if (iso) return armarFecha(iso[1], iso[2], iso[3]);
	const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
	if (dmy) return armarFecha(dmy[3], dmy[2], dmy[1]);
	return null;
}

/** "YYYY-MM-DD" solo si el día existe en el calendario (31/02 → `null`). */
function armarFecha(a: string, m: string, d: string): string | null {
	const año = Number(a);
	const mes = Number(m);
	const dia = Number(d);
	const fecha = new Date(Date.UTC(año, mes - 1, dia));
	if (
		fecha.getUTCFullYear() !== año ||
		fecha.getUTCMonth() !== mes - 1 ||
		fecha.getUTCDate() !== dia
	)
		return null;
	return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export type Sexo = "Masculino" | "Femenino";

/** RENAP "M"/"F", lead "male"/"female", solicitud "masculino"/"femenino". */
export function textoSexo(v: string | null | undefined): Sexo | null {
	const t = limpio(v)?.toLowerCase();
	if (!t) return null;
	if (t === "m" || t === "male" || t.startsWith("masc")) return "Masculino";
	if (t === "f" || t === "female" || t.startsWith("fem")) return "Femenino";
	return null;
}

const ESTADOS_CIVILES: Record<string, [masculino: string, femenino: string]> = {
	soltero: ["Soltero", "Soltera"],
	casado: ["Casado", "Casada"],
	divorciado: ["Divorciado", "Divorciada"],
	viudo: ["Viudo", "Viuda"],
	unido: ["Unido", "Unida"],
};

const ALIAS_ESTADO_CIVIL: Record<string, string> = {
	// RENAP
	s: "soltero",
	c: "casado",
	// Lead / codeudor (enum `marital_status`)
	single: "soltero",
	married: "casado",
	divorced: "divorciado",
	widowed: "viudo",
};

/**
 * Estado civil en texto, concordado con el sexo cuando se conoce
 * ("Casada"); sin sexo, "Casado(a)".
 */
export function textoEstadoCivil(
	v: string | null | undefined,
	sexo: Sexo | null,
): string | null {
	const t = limpio(v)?.toLowerCase();
	if (!t) return null;
	const raiz =
		ALIAS_ESTADO_CIVIL[t] ??
		Object.keys(ESTADOS_CIVILES).find((k) => t.startsWith(k.slice(0, -1)));
	const formas = raiz ? ESTADOS_CIVILES[raiz] : undefined;
	if (!formas) return null;
	if (sexo === "Masculino") return formas[0];
	if (sexo === "Femenino") return formas[1];
	return `${formas[0]}(a)`;
}

/* ── F1 · Datos personales ──────────────────────────────────────────────────── */

export interface FuenteRenap {
	dpi: string;
	firstName: string;
	secondName: string | null;
	thirdName: string | null;
	firstLastName: string;
	secondLastName: string | null;
	marriedLastName: string | null;
	birthDate: string | null;
	gender: string | null;
	civilStatus: string | null;
}

export interface FuenteLead {
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
	dpi: string | null;
	birthDate: Date | null;
	gender: string | null;
	maritalStatus: string | null;
}

export interface FuenteSolicitud {
	fechaNacimiento: string | null;
	sexo: string | null;
	estadoCivil: string | null;
}

/**
 * RENAP a veces ya trae la preposición («DE MÉNDEZ»); sin esto saldría
 * «de de Méndez».
 */
export function apellidoDeCasada(casada: string): string {
	return /^(de|del)\s/i.test(casada.trim()) ? casada.trim() : `de ${casada}`;
}

/** "MARÍA JOSÉ LÓPEZ PÉREZ DE GARCÍA", en nombre propio. */
export function nombreRenap(r: FuenteRenap): string | null {
	const casada = limpio(r.marriedLastName);
	const nombre = unir([
		r.firstName,
		r.secondName,
		r.thirdName,
		r.firstLastName,
		r.secondLastName,
		casada ? apellidoDeCasada(casada) : null,
	]);
	return nombre ? nombrePropio(nombre) : null;
}

/**
 * Precedencia POR CAMPO: RENAP → lead → solicitud de crédito del titular.
 * RENAP es la fuente oficial pero cubre pocos créditos; un dato que le falta
 * a RENAP se toma del siguiente, sin descartar los que sí trae.
 */
export function armarDatosPersonales(fuentes: {
	renap: FuenteRenap | null;
	lead: FuenteLead | null;
	solicitud: FuenteSolicitud | null;
}): DatosPersonalesFicha | null {
	const { renap, lead, solicitud } = fuentes;
	const nombreCompleto =
		(renap ? nombreRenap(renap) : null) ??
		(lead
			? unir([
					lead.firstName,
					lead.middleName,
					lead.lastName,
					lead.secondLastName,
				])
			: null);
	if (!nombreCompleto) return null;

	const sexo =
		textoSexo(renap?.gender) ??
		textoSexo(lead?.gender) ??
		textoSexo(solicitud?.sexo);
	return {
		nombreCompleto,
		dpi: limpio(renap?.dpi) ?? limpio(lead?.dpi),
		fechaNacimiento:
			fechaISO(renap?.birthDate) ??
			fechaISO(lead?.birthDate) ??
			fechaISO(solicitud?.fechaNacimiento),
		sexo,
		estadoCivil:
			textoEstadoCivil(renap?.civilStatus, sexo) ??
			textoEstadoCivil(lead?.maritalStatus, sexo) ??
			textoEstadoCivil(solicitud?.estadoCivil, sexo),
	};
}

export async function cargarDatosPersonales(
	ctx: ContextoCaso,
): Promise<DatosPersonalesFicha | null> {
	if (!ctx.leadId) return null;
	const [lead] = await db
		.select({
			firstName: leads.firstName,
			middleName: leads.middleName,
			lastName: leads.lastName,
			secondLastName: leads.secondLastName,
			dpi: leads.dpi,
			birthDate: leads.birthDate,
			gender: leads.gender,
			maritalStatus: leads.maritalStatus,
		})
		.from(leads)
		.where(eq(leads.id, ctx.leadId))
		.limit(1);
	if (!lead) return null;

	const dpi = limpio(lead.dpi);
	const [renap, solicitud] = await Promise.all([
		dpi
			? db
					.select({
						dpi: renapInfo.dpi,
						firstName: renapInfo.firstName,
						secondName: renapInfo.secondName,
						thirdName: renapInfo.thirdName,
						firstLastName: renapInfo.firstLastName,
						secondLastName: renapInfo.secondLastName,
						marriedLastName: renapInfo.marriedLastName,
						birthDate: renapInfo.birthDate,
						gender: renapInfo.gender,
						civilStatus: renapInfo.civilStatus,
					})
					.from(renapInfo)
					.where(eqDpi(renapInfo.dpi, dpi))
					.limit(1)
					.then((f) => f[0] ?? null)
			: Promise.resolve(null),
		ctx.opportunityId
			? db
					.select({
						fechaNacimiento: creditApplications.fechaNacimiento,
						sexo: creditApplications.sexo,
						estadoCivil: creditApplications.estadoCivil,
					})
					.from(creditApplications)
					.where(
						and(
							eq(creditApplications.opportunityId, ctx.opportunityId),
							// La del titular. NULL = solicitud anterior a la 0015 (una
							// sola por oportunidad), mismo criterio que getDatosLaboralesCaso.
							or(
								eq(creditApplications.personType, "lead"),
								isNull(creditApplications.personType),
							),
						),
					)
					.orderBy(desc(creditApplications.updatedAt))
					.limit(1)
					.then((f) => f[0] ?? null)
			: Promise.resolve(null),
	]);
	return armarDatosPersonales({ renap, lead, solicitud });
}

/* ── F2 · Codeudores ────────────────────────────────────────────────────────── */

export interface FuenteCodeudor {
	id: string;
	fullName: string;
	email: string | null;
	phone: string | null;
}

export interface FuenteSolicitudCodeudor {
	personId: string | null;
	email: string | null;
	telMovil: string | null;
	telResidencia: string | null;
	direccionResidencia: string | null;
	empresa: string | null;
	direccionTrabajo: string | null;
}

/**
 * Mismo número aunque uno venga con guiones, espacios o con el código de país
 * (`50258783734` y `58783734` son el mismo): se comparan los últimos 8
 * dígitos, la longitud de un número de Guatemala.
 */
export function mismoTelefono(a: string | null, b: string | null): boolean {
	if (!a || !b) return false;
	const ultimos = (t: string) => t.replace(/\D/g, "").slice(-8);
	return ultimos(a).length >= 7 && ultimos(a) === ultimos(b);
}

/**
 * Un codeudor con su contacto: lo de `co_debtors` primero y, lo que le falte,
 * de su solicitud de crédito (la única que guarda sus direcciones). La
 * numeración sigue el orden de alta, igual que en el resto del CRM.
 */
export function armarCodeudores(
	codeudores: FuenteCodeudor[],
	solicitudes: FuenteSolicitudCodeudor[],
): CodeudorFicha[] {
	return codeudores.map((c, i) => {
		const s = solicitudes.find((x) => x.personId === c.id) ?? null;
		const telefonoPrincipal = limpio(c.phone) ?? limpio(s?.telMovil);
		const movil = limpio(s?.telMovil);
		const casa = limpio(s?.telResidencia);
		// Cada número una sola vez: ni el principal repetido, ni el celular y el
		// de casa iguales entre sí.
		const celularAlterno =
			movil && !mismoTelefono(movil, telefonoPrincipal) ? movil : null;
		const telefonoCasa =
			casa &&
			!mismoTelefono(casa, telefonoPrincipal) &&
			!mismoTelefono(casa, celularAlterno)
				? casa
				: null;
		return {
			id: c.id,
			nombre: c.fullName.trim(),
			rol: `Codeudor ${i + 1}`,
			correo: limpio(c.email) ?? limpio(s?.email),
			telefonoPrincipal,
			celularAlterno,
			telefonoCasa,
			residencia: limpio(s?.direccionResidencia),
			trabajo: unir([s?.empresa, s?.direccionTrabajo], " · "),
		};
	});
}

/** `null` = el caso no tiene oportunidad (no se sabe); `[]` = no tiene codeudores. */
export async function cargarCodeudores(
	ctx: ContextoCaso,
): Promise<CodeudorFicha[] | null> {
	if (!ctx.opportunityId) return null;
	const codeudores = await db
		.select({
			id: coDebtors.id,
			fullName: coDebtors.fullName,
			email: coDebtors.email,
			phone: coDebtors.phone,
		})
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, ctx.opportunityId))
		.orderBy(asc(coDebtors.createdAt));
	if (codeudores.length === 0) return [];

	const solicitudes = await db
		.select({
			personId: creditApplications.personId,
			email: creditApplications.email,
			telMovil: creditApplications.telMovil,
			telResidencia: creditApplications.telResidencia,
			direccionResidencia: creditApplications.direccionResidencia,
			empresa: creditApplications.empresa,
			direccionTrabajo: creditApplications.direccionTrabajo,
		})
		.from(creditApplications)
		.where(
			and(
				eq(creditApplications.opportunityId, ctx.opportunityId),
				eq(creditApplications.personType, "coDebtor"),
				inArray(
					creditApplications.personId,
					codeudores.map((c) => c.id),
				),
			),
		);
	return armarCodeudores(codeudores, solicitudes);
}

/* ── F5 · Seguro ────────────────────────────────────────────────────────────── */

const TIPOS_COBERTURA: Record<string, string> = {
	basica: "Cobertura básica",
	amplia: "Cobertura amplia",
	total: "Cobertura total",
};

/**
 * Tipo de seguro y coberturas desde el vehículo. Hoy esas columnas están
 * vacías en todos los vehículos (nadie las captura): el bloque sale con
 * `null` y la ficha muestra «—» hasta que ventas las llene.
 */
export function armarSeguro(vehiculo: {
	tipoCobertura: string | null;
	deducible: string | null;
	numeroPoliza?: string | null;
	montoAsegurado?: string | null;
	fechaVencimientoSeguro?: Date | string | null;
	/** `opportunities.insurance_provider`; `null` si no se pudo resolver. */
	insuranceProvider?: string | null;
}): SeguroComplemento {
	const tipo = limpio(vehiculo.tipoCobertura);
	const clave = tipo?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
	const deducible =
		vehiculo.deducible != null && Number(vehiculo.deducible) > 0
			? `Deducible ${quetzales(vehiculo.deducible)}`
			: null;
	const proveedor = limpio(vehiculo.insuranceProvider)
		? seguroPorAseguradora(vehiculo.insuranceProvider)
		: null;
	return {
		tipoSeguro: tipo ? (TIPOS_COBERTURA[clave ?? ""] ?? tipo) : null,
		coberturas: deducible,
		aseguradora: proveedor?.aseguradora ?? null,
		telefonoEmergencia: proveedor?.cabinaSeguro ?? null,
		poliza: limpio(vehiculo.numeroPoliza),
		montoAsegurado:
			vehiculo.montoAsegurado != null && Number(vehiculo.montoAsegurado) > 0
				? vehiculo.montoAsegurado
				: null,
		vencimiento: fechaISO(vehiculo.fechaVencimientoSeguro),
	};
}

export async function cargarSeguro(
	ctx: ContextoCaso,
): Promise<SeguroComplemento | null> {
	// El vehículo del contrato es el autoritativo (mismo criterio que
	// resolverVehiculoCasoPagalo): la oportunidad puede apuntar a otro
	// vehículo si su vínculo cambió. Solo sin contrato se cae a la oportunidad.
	// La aseguradora sale de la oportunidad del contexto del caso, que con
	// contrato ya es la del cliente del contrato (resolverContextoCaso).
	const [[delContrato], [delProveedor]] = await Promise.all([
		db
			.select({
				contratoId: casosCobros.contratoId,
				tipoCobertura: vehicles.tipoCobertura,
				deducible: vehicles.deducible,
				numeroPoliza: vehicles.numeroPoliza,
				montoAsegurado: vehicles.montoAsegurado,
				fechaVencimientoSeguro: vehicles.fechaVencimientoSeguro,
			})
			.from(casosCobros)
			.leftJoin(
				contratosFinanciamiento,
				eq(contratosFinanciamiento.id, casosCobros.contratoId),
			)
			.leftJoin(vehicles, eq(vehicles.id, contratosFinanciamiento.vehicleId))
			.where(eq(casosCobros.id, ctx.casoCobroId))
			.limit(1),
		ctx.opportunityId
			? db
					.select({ insuranceProvider: opportunities.insuranceProvider })
					.from(opportunities)
					.where(eq(opportunities.id, ctx.opportunityId))
					.limit(1)
			: Promise.resolve([]),
	]);
	const insuranceProvider = delProveedor?.insuranceProvider ?? null;
	if (delContrato?.contratoId) {
		return armarSeguro({ ...delContrato, insuranceProvider });
	}
	if (!ctx.opportunityId) return null;

	const [fila] = await db
		.select({
			tipoCobertura: vehicles.tipoCobertura,
			deducible: vehicles.deducible,
			numeroPoliza: vehicles.numeroPoliza,
			montoAsegurado: vehicles.montoAsegurado,
			fechaVencimientoSeguro: vehicles.fechaVencimientoSeguro,
		})
		.from(opportunities)
		.innerJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
		.where(eq(opportunities.id, ctx.opportunityId))
		.limit(1);
	return fila ? armarSeguro({ ...fila, insuranceProvider }) : null;
}

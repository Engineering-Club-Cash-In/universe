import { z } from "zod";
import type { MembresiaSocio } from "./partner-scope";

/**
 * Factura del seguro que el vendedor de la agencia/predio sube desde el
 * tracker, en la etapa final (90%), antes de que el vehículo pase a Cube.
 */
export const ETAPA_FACTURA_SEGURO = 90;

export const MIME_FACTURA_SEGURO = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;

export type MimeFacturaSeguro = (typeof MIME_FACTURA_SEGURO)[number];

const EXTENSION_FACTURA: Record<MimeFacturaSeguro, string> = {
	"application/pdf": ".pdf",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
};

function empiezaCon(bytes: Uint8Array, firma: number[], desde = 0) {
	return firma.every((b, i) => bytes[desde + i] === b);
}

/**
 * Tipo real del archivo según su firma, o null si no es PDF ni imagen
 * admitida. El tipo y el nombre que manda el cliente no se usan: el archivo
 * sale adjunto en un correo de Club Cash In.
 */
export function tipoRealDeFactura(bytes: Uint8Array): MimeFacturaSeguro | null {
	// El estándar de PDF admite basura antes del encabezado (hasta 1024 bytes).
	const inicio = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
	if (inicio.includes("%PDF-")) return "application/pdf";
	if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return "image/png";
	if (
		empiezaCon(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		empiezaCon(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	)
		return "image/webp";
	return null;
}

/** Nombre del adjunto con la extensión del tipo real ("factura.exe" → "factura.pdf"). */
export function nombreDeFactura(
	original: string,
	tipo: MimeFacturaSeguro,
): string {
	const base = (original.split(/[\\/]/).pop() ?? "")
		.replace(/\.[^.]*$/, "")
		.replace(/[^\p{L}\p{N} ._-]/gu, "")
		.trim();
	return `${base || "factura"}${EXTENSION_FACTURA[tipo]}`;
}

export type Aseguradora = "gyt" | "universales";

export type MotivoSinFactura =
	| "etapa"
	| "estado"
	| "no_es_el_vendedor"
	| "ya_subida";

export const MENSAJE_MOTIVO: Record<MotivoSinFactura, string> = {
	etapa:
		"La factura del seguro se sube cuando el crédito está en formalización final",
	estado: "Este crédito ya no admite la factura del seguro",
	no_es_el_vendedor:
		"Solo el vendedor asignado puede subir la factura del seguro",
	ya_subida: "La factura del seguro de este crédito ya fue subida",
};

// En el flujo normal la oportunidad llega a 90% ya ganada: confirmar los
// contratos firmados la cierra (won) y después la mueve a formalización.
const ESTADOS_CON_FACTURA = new Set(["open", "on_hold", "won"]);

export function puedeSubirFacturaSeguro(caso: {
	closurePercentage: number;
	status: string;
	companyId: string | null;
	sellerId: string | null;
	membresias: MembresiaSocio[];
	yaSubida: boolean;
}): { ok: true } | { ok: false; motivo: MotivoSinFactura } {
	if (caso.yaSubida) return { ok: false, motivo: "ya_subida" };
	if (!ESTADOS_CON_FACTURA.has(caso.status)) {
		return { ok: false, motivo: "estado" };
	}
	if (
		caso.closurePercentage < ETAPA_FACTURA_SEGURO ||
		caso.closurePercentage >= 100
	) {
		return { ok: false, motivo: "etapa" };
	}
	if (!esVendedorAsignado(caso))
		return { ok: false, motivo: "no_es_el_vendedor" };
	return { ok: true };
}

export type MotivoSinEnvioDesdeCrm =
	| "etapa"
	| "estado"
	| "sin_agencia"
	| "ya_subida";

export const MENSAJE_SIN_ENVIO_DESDE_CRM: Record<
	MotivoSinEnvioDesdeCrm,
	string
> = {
	etapa: "la oportunidad no está en formalización final (90%)",
	estado: "la oportunidad ya no admite la factura del seguro",
	sin_agencia: "la oportunidad no es de una agencia o predio",
	ya_subida: "la oportunidad ya tiene su factura del seguro registrada",
};

/**
 * Si un "Seguro del Vehículo" subido desde el CRM se manda a la aseguradora:
 * las mismas reglas que el tracker, salvo el vendedor asignado (en el CRM ya
 * filtra el permiso de subir documentos).
 */
export function puedeEnviarFacturaDesdeCrm(caso: {
	closurePercentage: number;
	status: string;
	companyId: string | null;
	yaSubida: boolean;
}): { ok: true } | { ok: false; motivo: MotivoSinEnvioDesdeCrm } {
	if (caso.yaSubida) return { ok: false, motivo: "ya_subida" };
	if (!ESTADOS_CON_FACTURA.has(caso.status)) {
		return { ok: false, motivo: "estado" };
	}
	if (
		caso.closurePercentage < ETAPA_FACTURA_SEGURO ||
		caso.closurePercentage >= 100
	) {
		return { ok: false, motivo: "etapa" };
	}
	if (!caso.companyId) return { ok: false, motivo: "sin_agencia" };
	return { ok: true };
}

// Solo el vendedor asignado: una membresía de gerente (sellerId null) no
// alcanza, aunque vea el caso.
export function esVendedorAsignado(caso: {
	companyId: string | null;
	sellerId: string | null;
	membresias: MembresiaSocio[];
}): boolean {
	return (
		!!caso.companyId &&
		!!caso.sellerId &&
		caso.membresias.some(
			(m) => m.companyId === caso.companyId && m.sellerId === caso.sellerId,
		)
	);
}

export type MotivoSinReenvio =
	| "sin_factura"
	| "ya_enviada"
	| "en_curso"
	| "sin_reintentos";

export const MENSAJE_SIN_REENVIO: Record<MotivoSinReenvio, string> = {
	sin_factura: "Este crédito todavía no tiene la factura del seguro",
	ya_enviada: "La factura del seguro ya fue enviada a la aseguradora",
	en_curso: "El envío de la factura del seguro está en curso",
	sin_reintentos: "Esta factura ya usó su único reintento de envío",
};

// Un envío `pendiente` más viejo que esto se da por caído (el proceso murió
// entre reservar y registrar el resultado) y se puede reenviar.
export const PENDIENTE_ABANDONADO_MS = 10 * 60 * 1000;

/**
 * Un envío `pendiente` que ya pasó el plazo: no se sabe si salió. Vale para
 * cualquiera que vea el caso (el gerente también), no solo para quien puede
 * reintentarlo.
 */
export function envioSinConfirmar(caso: {
	envio: string | null;
	envioActualizadoAt?: Date | null;
	ahora?: Date;
}): boolean {
	if (caso.envio !== "pendiente" || !caso.envioActualizadoAt) return false;
	const ahora = caso.ahora ?? new Date();
	return (
		ahora.getTime() - caso.envioActualizadoAt.getTime() >
		PENDIENTE_ABANDONADO_MS
	);
}

// Los mismos roles que pueden subir documentos a la oportunidad en el CRM
// (uploadOpportunityDocument); un asesor comercial, solo en las suyas.
const ROLES_REINTENTO_CRM = new Set([
	"admin",
	"sales",
	"sales_supervisor",
	"analyst",
]);

export function puedeReintentarDesdeCrm(
	usuario: { userId: string; userRole: string | null | undefined },
	asignadoA: string | null | undefined,
): boolean {
	if (!usuario.userRole || !ROLES_REINTENTO_CRM.has(usuario.userRole)) {
		return false;
	}
	return usuario.userRole !== "sales" || asignadoA === usuario.userId;
}

/** El CRM permite un único reintento por factura, si el envío no se confirmó. */
export function puedeReenviarFacturaSeguro(caso: {
	envio: string | null;
	envioActualizadoAt?: Date | null;
	ahora?: Date;
	retryCount: number;
}): { ok: true } | { ok: false; motivo: MotivoSinReenvio } {
	if (caso.envio === null) return { ok: false, motivo: "sin_factura" };
	if (caso.envio === "enviado") return { ok: false, motivo: "ya_enviada" };
	if (caso.retryCount >= 1) return { ok: false, motivo: "sin_reintentos" };
	if (caso.envio === "pendiente" && !envioSinConfirmar(caso)) {
		return { ok: false, motivo: "en_curso" };
	}
	return { ok: true };
}

/**
 * Cuándo un `pendiente` todavía en plazo pasa a reintentable; null si no va a
 * pasar (ya se reintentó, no está pendiente o el plazo ya venció). El CRM
 * refresca en ese momento en vez de consultar sin fin.
 */
export function reintentoDisponibleDesde(caso: {
	envio: string | null;
	envioActualizadoAt?: Date | null;
	ahora?: Date;
	retryCount: number;
}): Date | null {
	if (caso.envio !== "pendiente" || caso.retryCount >= 1) return null;
	if (!caso.envioActualizadoAt || envioSinConfirmar(caso)) return null;
	return new Date(caso.envioActualizadoAt.getTime() + PENDIENTE_ABANDONADO_MS);
}

// La aseguradora es la de la cotización que usa el cierre: la aceptada o, si no
// hay, la última (confirmado con negocio). La oportunidad recién la copia al
// cerrarse (close-opportunity.ts): sin cotización se usa la de la oportunidad
// y, si tampoco hay, Universales.
export function resolverAseguradora(
	deCotizacion: string | null | undefined,
	deOportunidad: string | null | undefined,
): Aseguradora {
	const valor = (deCotizacion ?? deOportunidad ?? "").trim().toLowerCase();
	return valor === "gyt" ? "gyt" : "universales";
}

// Correos de pólizas: fijos, todos van en "Para". Fuera de producción no les
// llega nada: @cci/email con SERVER=DEV desvía todo a EMAIL_DEV_RECIPIENT.
export const CORREOS_POLIZAS_GYT: readonly string[] = [
	"rcordoba@gyt.com.gt",
	"npixtun@gyt.com.gt",
];
export const CORREOS_POLIZAS_UNIVERSALES: readonly string[] = [
	"ccicorredores@universales.com",
];
// Equipo de Club Cash In que da seguimiento a la póliza: va en todos los envíos,
// sea a G&T o a Universales.
export const CORREOS_POLIZAS_INTERNOS: readonly string[] = [
	"maylin.j@clubcashin.com",
	"luis.e@clubcashin.com",
	"werner.o@clubcashin.com",
	"lucia.s@clubcashin.com",
	"info@clubcashin.com",
	"gabriela.c@clubcashin.com",
	"elizabeth.l@clubcashin.com",
	"alex.b@clubcashin.com",
	"daniel.l@clubcashin.com",
	"dulce.a@clubcashin.com",
];

export type CorreosPorAseguradora = Record<Aseguradora, readonly string[]>;

const CORREOS_POLIZAS: CorreosPorAseguradora = {
	gyt: CORREOS_POLIZAS_GYT,
	universales: CORREOS_POLIZAS_UNIVERSALES,
};

const correo = z.string().email();

function limpiar(lista: readonly string[]): string[] {
	return lista
		.map((c) => c.trim().toLowerCase())
		.filter((c) => correo.safeParse(c).success);
}

/**
 * Destinatarios del envío: la aseguradora y el equipo interno, limpios y sin
 * duplicados. Sin correos de la aseguradora no se manda solo a los internos:
 * la lista vacía deja el envío en `sin_destinatario`.
 */
export function destinatariosDe(
	aseguradora: Aseguradora,
	correos: CorreosPorAseguradora = CORREOS_POLIZAS,
	internos: readonly string[] = CORREOS_POLIZAS_INTERNOS,
): string[] {
	const deLaAseguradora = limpiar(correos[aseguradora]);
	if (deLaAseguradora.length === 0) return [];
	return [...new Set([...deLaAseguradora, ...limpiar(internos)])];
}

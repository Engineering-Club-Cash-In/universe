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

export function puedeSubirFacturaSeguro(caso: {
	closurePercentage: number;
	status: string;
	companyId: string | null;
	sellerId: string | null;
	membresias: MembresiaSocio[];
	yaSubida: boolean;
}): { ok: true } | { ok: false; motivo: MotivoSinFactura } {
	if (caso.yaSubida) return { ok: false, motivo: "ya_subida" };
	if (caso.status !== "open" && caso.status !== "on_hold") {
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
	| "no_es_el_vendedor";

export const MENSAJE_SIN_REENVIO: Record<MotivoSinReenvio, string> = {
	sin_factura: "Este crédito todavía no tiene la factura del seguro",
	ya_enviada: "La factura del seguro ya fue enviada a la aseguradora",
	en_curso: "El envío de la factura del seguro está en curso",
	no_es_el_vendedor:
		"Solo el vendedor asignado puede reenviar la factura del seguro",
};

// Un envío `pendiente` más viejo que esto se da por caído (el proceso murió
// entre reservar y registrar el resultado) y se puede reenviar.
export const PENDIENTE_ABANDONADO_MS = 10 * 60 * 1000;

/** El reenvío existe solo para cuando el primer envío no salió. */
export function puedeReenviarFacturaSeguro(caso: {
	envio: string | null;
	envioActualizadoAt?: Date | null;
	ahora?: Date;
	companyId: string | null;
	sellerId: string | null;
	membresias: MembresiaSocio[];
}): { ok: true } | { ok: false; motivo: MotivoSinReenvio } {
	if (!esVendedorAsignado(caso))
		return { ok: false, motivo: "no_es_el_vendedor" };
	if (caso.envio === null) return { ok: false, motivo: "sin_factura" };
	if (caso.envio === "enviado") return { ok: false, motivo: "ya_enviada" };
	if (caso.envio === "pendiente") {
		const ahora = caso.ahora ?? new Date();
		const abandonado =
			!!caso.envioActualizadoAt &&
			ahora.getTime() - caso.envioActualizadoAt.getTime() >
				PENDIENTE_ABANDONADO_MS;
		if (!abandonado) return { ok: false, motivo: "en_curso" };
	}
	return { ok: true };
}

// PROVISIONAL, pendiente de confirmar con negocio qué define la aseguradora.
// La cotización es la fuente mientras la oportunidad no se cierra; la
// oportunidad recién copia la aseguradora al cerrarse (close-opportunity.ts).
export function resolverAseguradora(
	deCotizacion: string | null | undefined,
	deOportunidad: string | null | undefined,
): Aseguradora {
	const valor = (deCotizacion ?? deOportunidad ?? "").trim().toLowerCase();
	return valor === "gyt" ? "gyt" : "universales";
}

const VARIABLE_DESTINATARIOS: Record<Aseguradora, string> = {
	gyt: "CORREOS_ASEGURADORA_GYT",
	universales: "CORREOS_ASEGURADORA_UNIVERSALES",
};

const correo = z.string().email();

/** Destinatarios configurados para la aseguradora; los inválidos se descartan. */
export function destinatariosDe(
	aseguradora: Aseguradora,
	env: Record<string, string | undefined> = process.env,
): string[] {
	const crudo = env[VARIABLE_DESTINATARIOS[aseguradora]] ?? "";
	return [
		...new Set(
			crudo
				.split(",")
				.map((c) => c.trim().toLowerCase())
				.filter((c) => correo.safeParse(c).success),
		),
	];
}

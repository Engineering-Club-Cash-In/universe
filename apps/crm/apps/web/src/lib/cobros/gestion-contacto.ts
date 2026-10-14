/**
 * W1 (#1873) · Datos de la gestión en el historial del caso: dirección del
 * contacto, con quién se habló, el teléfono marcado y la hora y el medio del
 * próximo contacto. `getHistorialContactos` y `getHistorialContactosPaginado`
 * los devuelven desde la migración 0079.
 *
 * Funciones puras que comparten la Ficha 360 y el Workspace para armar cada
 * fila de `HistorialGestiones` con el mismo texto.
 */
import { etiquetaMetodoContacto } from "server/src/lib/gestion-temprana-b1";
import { fechaLargaGT } from "./reglas-caso";

/** Lo que leen estas funciones de una fila del historial. */
export type DatosContactoGestion = {
	metodoContacto?: string | null;
	estadoContacto?: string | null;
	/** "saliente" | "entrante" (null en gestiones anteriores a W1). */
	direccionContacto?: string | null;
	/** "titular" | "codeudor" | "referencia". */
	participanteTipo?: string | null;
	participanteNombre?: string | null;
	telefonoContactado?: string | null;
	fechaProximoContacto?: string | Date | null;
	/** "HH:MM" o "HH:MM:SS" (columna `time`). */
	horaProximoContacto?: string | null;
	/** "llamada" | "whatsapp". */
	medioProximoContacto?: string | null;
};

const ROL: Record<string, string> = {
	titular: "titular",
	codeudor: "codeudor",
	referencia: "referencia",
};

const MEDIO: Record<string, string> = {
	llamada: "por llamada",
	whatsapp: "por WhatsApp",
};

/** Resultados en los que no hubo conversación con nadie. */
const SIN_CONVERSACION = ["no_contesta", "numero_equivocado"];

/**
 * «Llamada entrante» o «WhatsApp entrante» si el cliente buscó al asesor; si
 * no, la etiqueta del canal de siempre («Llamada», «Visita a domicilio»…).
 */
export function etiquetaCanalGestion(
	g: Pick<DatosContactoGestion, "metodoContacto" | "direccionContacto">,
): string {
	const canal = etiquetaMetodoContacto(g.metodoContacto ?? "");
	return g.direccionContacto === "entrante" ? `${canal} entrante` : canal;
}

/**
 * «Habló con: Juan Pérez (codeudor)». Sin conversación (no contestó, número
 * equivocado) dice «Intentó con», y un mensaje enviado, «Mensaje a». null si la
 * gestión no guardó al participante.
 */
export function textoParticipanteGestion(
	g: Pick<
		DatosContactoGestion,
		"participanteTipo" | "participanteNombre" | "estadoContacto"
	>,
): string | null {
	const nombre = g.participanteNombre?.trim() || null;
	const rol = g.participanteTipo ? (ROL[g.participanteTipo] ?? null) : null;
	if (!nombre && !rol) return null;
	const quien = nombre
		? rol
			? `${nombre} (${rol})`
			: nombre
		: `${rol?.charAt(0).toUpperCase()}${rol?.slice(1)}`;
	if (g.estadoContacto === "mensaje_enviado") return `Mensaje a: ${quien}`;
	if (SIN_CONVERSACION.includes(g.estadoContacto ?? "")) {
		return `Intentó con: ${quien}`;
	}
	return `Habló con: ${quien}`;
}

/** Lo que se ve bajo el subtítulo de la gestión (`ItemGestion.contacto`). */
export function contactoDeGestion(
	g: DatosContactoGestion,
): { participante: string | null; telefono: string | null } | null {
	const participante = textoParticipanteGestion(g);
	const telefono = g.telefonoContactado?.trim() || null;
	if (!participante && !telefono) return null;
	return { participante, telefono };
}

/** "10:30" a partir de "10:30:00"; null si no es una hora válida. */
export function horaCorta(hora: string | null | undefined): string | null {
	const m = hora?.match(/^([01]\d|2[0-3]):([0-5]\d)/);
	return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * «15 oct 2026 · 10:30 · por WhatsApp»: la fecha del próximo contacto con la
 * hora y el medio que eligió el asesor (lo que haya). null sin fecha ni hora.
 */
export function textoProximoContacto(
	g: Pick<
		DatosContactoGestion,
		"fechaProximoContacto" | "horaProximoContacto" | "medioProximoContacto"
	>,
): string | null {
	const partes = [
		fechaLargaGT(g.fechaProximoContacto) || null,
		horaCorta(g.horaProximoContacto),
		g.medioProximoContacto ? (MEDIO[g.medioProximoContacto] ?? null) : null,
	].filter(Boolean);
	return partes.length > 0 ? partes.join(" · ") : null;
}

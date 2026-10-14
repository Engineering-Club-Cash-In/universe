import { inflateRawSync } from "node:zlib";
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

const INICIO_PDF = Buffer.from("%PDF-");
const FIN_PDF = Buffer.from("%%EOF");
const FIN_JPEG = Buffer.from([0xff, 0xd9]);

/**
 * Recorre los segmentos hasta los datos de la imagen principal y exige el
 * cierre (FFD9) después de ellos. Saltar los segmentos por su largo deja
 * afuera la miniatura EXIF, que trae su propio cierre.
 */
function jpegCompleto(datos: Buffer): boolean {
	let pos = 2;
	while (pos + 4 <= datos.length) {
		if (datos[pos] !== 0xff) return false;
		const marcador = datos[pos + 1];
		if (marcador === 0xff) {
			pos++;
		} else if (marcador === 0xda) {
			return datos.indexOf(FIN_JPEG, pos + 2) !== -1;
		} else if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd9)) {
			pos += 2;
		} else {
			pos += 2 + datos.readUInt16BE(pos + 2);
		}
	}
	return false;
}

/** Recorre los chunks del PNG, desde IHDR hasta IEND, todos completos. */
function pngCompleto(datos: Buffer): boolean {
	if (datos.toString("latin1", 12, 16) !== "IHDR") return false;
	let pos = 8;
	while (pos + 12 <= datos.length) {
		const largo = datos.readUInt32BE(pos);
		if (pos + 12 + largo > datos.length) return false;
		if (datos.toString("latin1", pos + 4, pos + 8) === "IEND") return true;
		pos += 12 + largo;
	}
	return false;
}

/**
 * Tipo real del archivo según su firma, o null si no es PDF ni imagen
 * admitida. El tipo y el nombre que manda el cliente no se usan: el archivo
 * sale adjunto en un correo de Club Cash In.
 */
export function tipoRealDeFactura(bytes: Uint8Array): MimeFacturaSeguro | null {
	const datos = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// El estándar de PDF admite basura antes del encabezado (hasta 1024 bytes).
	const inicioPdf = datos.subarray(0, 1024).indexOf(INICIO_PDF);
	// Además de la firma, la marca de cierre de cada formato: un archivo
	// truncado (solo la firma) no se puede abrir y no debe salir adjunto. Lo
	// que venga después del cierre (relleno, el video de una foto en
	// movimiento) no lo invalida.
	if (inicioPdf !== -1) {
		return datos.lastIndexOf(FIN_PDF) > inicioPdf ? "application/pdf" : null;
	}
	if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) {
		return jpegCompleto(datos) ? "image/jpeg" : null;
	}
	if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return pngCompleto(datos) ? "image/png" : null;
	}
	if (
		empiezaCon(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		empiezaCon(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		// El tamaño que declara el RIFF tiene que estar completo.
		const declarado = Buffer.from(bytes.subarray(4, 8)).readUInt32LE(0);
		return bytes.length >= 20 && declarado + 8 <= bytes.length
			? "image/webp"
			: null;
	}
	return null;
}

const DOCX =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOC = "application/msword";
const XLS = "application/vnd.ms-excel";

/**
 * Nombres de las entradas de un ZIP según su directorio central (el índice al
 * final del archivo), o null si no es un ZIP bien formado.
 */
// Tope al descomprimir el manifiesto o la parte principal de un Word/Excel.
const MAX_PARTE_OFFICE = 20 * 1024 * 1024;

interface EntradaZip {
	metodo: number;
	comprimido: number;
	desplazamiento: number;
}

function entradasDeZip(bytes: Uint8Array): Map<string, EntradaZip> | null {
	const datos = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (datos.length < 22) return null;
	// El fin del directorio central ocupa 22 bytes más un comentario opcional.
	let fin = -1;
	for (
		let i = datos.length - 22;
		i >= Math.max(0, datos.length - 22 - 0xffff);
		i--
	) {
		if (datos.readUInt32LE(i) === 0x06054b50) {
			fin = i;
			break;
		}
	}
	if (fin < 0) return null;
	const total = datos.readUInt16LE(fin + 10);
	let pos = datos.readUInt32LE(fin + 16);
	const entradas = new Map<string, EntradaZip>();
	for (let n = 0; n < total; n++) {
		if (pos + 46 > datos.length || datos.readUInt32LE(pos) !== 0x02014b50) {
			return null;
		}
		const largoNombre = datos.readUInt16LE(pos + 28);
		const largoExtra = datos.readUInt16LE(pos + 30);
		const largoComentario = datos.readUInt16LE(pos + 32);
		const inicio = pos + 46;
		if (inicio + largoNombre > datos.length) return null;
		entradas.set(datos.toString("utf8", inicio, inicio + largoNombre), {
			metodo: datos.readUInt16LE(pos + 10),
			comprimido: datos.readUInt32LE(pos + 20),
			desplazamiento: datos.readUInt32LE(pos + 42),
		});
		pos = inicio + largoNombre + largoExtra + largoComentario;
	}
	return entradas;
}

/** Contenido de una entrada del ZIP (sin comprimir o deflate), o null. */
function leerEntradaZip(bytes: Uint8Array, entrada: EntradaZip): string | null {
	const datos = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const local = entrada.desplazamiento;
	if (local + 30 > datos.length || datos.readUInt32LE(local) !== 0x04034b50) {
		return null;
	}
	const inicio =
		local +
		30 +
		datos.readUInt16LE(local + 26) +
		datos.readUInt16LE(local + 28);
	const crudo = datos.subarray(inicio, inicio + entrada.comprimido);
	if (crudo.length !== entrada.comprimido) return null;
	try {
		if (entrada.metodo === 0) return crudo.toString("utf8");
		if (entrada.metodo === 8) {
			// Con tope: un ZIP armado a propósito puede inflarse a gigas.
			return inflateRawSync(crudo, {
				maxOutputLength: MAX_PARTE_OFFICE,
			}).toString("utf8");
		}
	} catch {
		return null;
	}
	return null;
}

/** Un .docx/.xlsx de verdad: el manifiesto declara su parte principal y esta es XML. */
function esOfficeAbierto(bytes: Uint8Array, tipo: "docx" | "xlsx"): boolean {
	const entradas = entradasDeZip(bytes);
	const manifiesto = entradas?.get("[Content_Types].xml");
	const parte = entradas?.get(
		tipo === "docx" ? "word/document.xml" : "xl/workbook.xml",
	);
	if (!entradas || !manifiesto || !parte) return false;
	const tipos = leerEntradaZip(bytes, manifiesto);
	const principal = leerEntradaZip(bytes, parte);
	const contenidoPrincipal =
		tipo === "docx"
			? "wordprocessingml.document.main+xml"
			: "spreadsheetml.sheet.main+xml";
	return (
		!!tipos?.includes(contenidoPrincipal) &&
		!!principal?.trimStart().startsWith("<")
	);
}

/**
 * Nombres de los streams de un archivo OLE (formato compuesto de los
 * .doc/.xls viejos), recorriendo su directorio por la tabla FAT; null si el
 * contenedor no está bien formado.
 */
function streamsDeOle(bytes: Uint8Array): Set<string> | null {
	const datos = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (datos.length < 512) return null;
	const desplazamientoSector = datos.readUInt16LE(0x1e);
	if (desplazamientoSector !== 9 && desplazamientoSector !== 12) return null;
	const tamSector = 1 << desplazamientoSector;
	const inicioDe = (sector: number) => (sector + 1) * tamSector;
	// Los primeros 109 sectores de la FAT vienen listados en el encabezado.
	const sectoresFat: number[] = [];
	const totalFat = Math.min(datos.readUInt32LE(0x2c), 109);
	for (let i = 0; i < totalFat; i++) {
		sectoresFat.push(datos.readUInt32LE(0x4c + i * 4));
	}
	const porSector = tamSector / 4;
	const siguiente = (sector: number) => {
		const sectorFat = sectoresFat[Math.floor(sector / porSector)];
		if (sectorFat === undefined) return null;
		const pos = inicioDe(sectorFat) + (sector % porSector) * 4;
		return pos + 4 <= datos.length ? datos.readUInt32LE(pos) : null;
	};
	const nombres = new Set<string>();
	let sector: number | null = datos.readUInt32LE(0x30);
	for (let vueltas = 0; sector !== null && sector < 0xfffffffa; vueltas++) {
		const base = inicioDe(sector);
		if (vueltas > 10_000 || base + tamSector > datos.length) return null;
		for (let entrada = base; entrada < base + tamSector; entrada += 128) {
			const largo = datos.readUInt16LE(entrada + 0x40);
			// Solo streams (tipo 2) con contenido y un sector de inicio válido.
			const esStream = datos[entrada + 0x42] === 2;
			const inicioStream = datos.readUInt32LE(entrada + 0x74);
			const tamStream = datos.readUInt32LE(entrada + 0x78);
			if (
				largo >= 2 &&
				largo <= 64 &&
				esStream &&
				tamStream > 0 &&
				inicioStream < 0xfffffffa
			) {
				nombres.add(datos.toString("utf16le", entrada, entrada + largo - 2));
			}
		}
		sector = siguiente(sector);
	}
	return sector === 0xfffffffe ? nombres : null;
}

/**
 * Un AVIF entero: sus cajas (ISO-BMFF) se encadenan hasta el final del archivo
 * sin pasarse, y trae los metadatos (`meta`) y los datos de imagen (`mdat`).
 */
function esAvifCompleto(bytes: Uint8Array): boolean {
	const datos = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const cajas = new Set<string>();
	let pos = 0;
	while (pos < datos.length) {
		if (pos + 8 > datos.length) return false;
		let tam = datos.readUInt32BE(pos);
		const tipo = datos.toString("latin1", pos + 4, pos + 8);
		if (tam === 1) {
			if (pos + 16 > datos.length) return false;
			tam = Number(datos.readBigUInt64BE(pos + 8));
		} else if (tam === 0) {
			tam = datos.length - pos;
		}
		if (tam < 8 || pos + tam > datos.length) return false;
		if (tipo !== "mdat" || tam > 8) cajas.add(tipo);
		pos += tam;
	}
	return cajas.has("ftyp") && cajas.has("meta") && cajas.has("mdat");
}

/**
 * Tipo con el que una factura subida desde el CRM puede ir a la aseguradora,
 * según su contenido: PDF, imagen (también AVIF), o Word/Excel cuyo contenido
 * sea de verdad un documento de Office del tipo declarado. Null si no: así un
 * HTML declarado como PDF, o un ZIP cualquiera declarado como Word, no sale
 * adjunto desde un correo de Club Cash In.
 */
export function tipoPermitidoDesdeCrm(
	bytes: Uint8Array,
	declarado: string,
): string | null {
	const real = tipoRealDeFactura(bytes);
	if (real) return real;
	const marca = Buffer.from(bytes.subarray(4, 12)).toString("latin1");
	if ((marca === "ftypavif" || marca === "ftypavis") && esAvifCompleto(bytes)) {
		return "image/avif";
	}
	if (empiezaCon(bytes, [0x50, 0x4b, 0x03, 0x04])) {
		// Un .docx/.xlsx es un ZIP con el manifiesto de Office y la parte
		// principal de su tipo, según el índice del propio ZIP.
		if (declarado === DOCX && esOfficeAbierto(bytes, "docx")) return DOCX;
		if (declarado === XLSX && esOfficeAbierto(bytes, "xlsx")) return XLSX;
		return null;
	}
	if (empiezaCon(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
		// .doc/.xls viejos: contenedor OLE con el stream principal de su tipo.
		const streams = streamsDeOle(bytes);
		if (declarado === DOC && streams?.has("WordDocument")) return DOC;
		if (
			declarado === XLS &&
			(streams?.has("Workbook") || streams?.has("Book"))
		) {
			return XLS;
		}
		return null;
	}
	return null;
}

const EXTENSION_POR_TIPO: Record<string, string> = {
	...EXTENSION_FACTURA,
	"image/avif": ".avif",
	[DOCX]: ".docx",
	[XLSX]: ".xlsx",
	[DOC]: ".doc",
	[XLS]: ".xls",
};

/** Nombre del adjunto con la extensión del tipo aceptado ("factura.exe" → "factura.pdf"). */
export function nombreDeFactura(original: string, tipo: string): string {
	const base = (original.split(/[\\/]/).pop() ?? "")
		.replace(/\.[^.]*$/, "")
		.replace(/[^\p{L}\p{N} ._-]/gu, "")
		.trim();
	return `${base || "factura"}${EXTENSION_POR_TIPO[tipo] ?? ""}`;
}

export type Aseguradora = "gyt" | "universales";

export type MotivoSinFactura =
	| "etapa"
	| "estado"
	| "sin_cerrar"
	| "no_es_el_vendedor"
	| "ya_subida";

export const MENSAJE_MOTIVO: Record<MotivoSinFactura, string> = {
	etapa:
		"La factura del seguro se sube desde que el crédito está en formalización final (90%)",
	estado: "Este crédito ya no admite la factura del seguro",
	sin_cerrar:
		"La factura del seguro se sube cuando el crédito ya está cerrado (ganado)",
	no_es_el_vendedor:
		"Solo el vendedor asignado puede subir la factura del seguro",
	ya_subida: "La factura del seguro de este crédito ya fue subida",
};

// Solo con el crédito cerrado: en el flujo normal la oportunidad llega a 90%
// ya ganada (confirmar los contratos la cierra y después la mueve a
// formalización). Antes del cierre todavía puede cambiar la cotización con la
// que se arma el crédito, y la factura saldría con otra.
function motivoPorEstadoYEtapa(caso: {
	status: string;
	closurePercentage: number;
}): "estado" | "etapa" | "sin_cerrar" | null {
	if (caso.status === "lost") return "estado";
	// Desde el 90% en adelante, también ya desembolsada (100%).
	if (caso.closurePercentage < ETAPA_FACTURA_SEGURO) return "etapa";
	if (caso.status !== "won") return "sin_cerrar";
	return null;
}

export function puedeSubirFacturaSeguro(caso: {
	closurePercentage: number;
	status: string;
	companyId: string | null;
	sellerId: string | null;
	membresias: MembresiaSocio[];
	yaSubida: boolean;
}): { ok: true } | { ok: false; motivo: MotivoSinFactura } {
	if (caso.yaSubida) return { ok: false, motivo: "ya_subida" };
	const motivo = motivoPorEstadoYEtapa(caso);
	if (motivo) return { ok: false, motivo };
	if (!esVendedorAsignado(caso))
		return { ok: false, motivo: "no_es_el_vendedor" };
	return { ok: true };
}

export type MotivoSinEnvioDesdeCrm =
	| "etapa"
	| "estado"
	| "sin_cerrar"
	| "sin_agencia"
	| "ya_subida";

export const MENSAJE_SIN_ENVIO_DESDE_CRM: Record<
	MotivoSinEnvioDesdeCrm,
	string
> = {
	etapa: "la oportunidad todavía no llega a formalización final (90%)",
	estado: "la oportunidad ya no admite la factura del seguro",
	sin_cerrar: "la oportunidad todavía no está ganada (crédito sin cerrar)",
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
	const motivo = motivoPorEstadoYEtapa(caso);
	if (motivo) return { ok: false, motivo };
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
	| "programada"
	| "sin_reintentos";

export const MENSAJE_SIN_REENVIO: Record<MotivoSinReenvio, string> = {
	sin_factura: "Este crédito todavía no tiene la factura del seguro",
	ya_enviada: "La factura del seguro ya fue enviada a la aseguradora",
	en_curso: "El envío de la factura del seguro está en curso",
	programada:
		"La factura del seguro se enviará sola al confirmar los contratos",
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
	if (caso.envio === "programado") return { ok: false, motivo: "programada" };
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

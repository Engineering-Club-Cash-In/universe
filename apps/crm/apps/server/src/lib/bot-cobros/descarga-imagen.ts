/**
 * Bajar la foto de la boleta desde la nube de SimpleTech.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UN SERVIDOR QUE DESCARGA CUALQUIER URL QUE LE PASEN ES UN SSRF.
 *
 * Le sirve a un atacante para pedirle a NUESTRA red lo que él no alcanza desde
 * afuera: metadatos del cloud, servicios internos, bases sin puerto público. Y
 * acá la URL viene de un tercero, así que el control no es opcional.
 *
 * Cinco filtros, y falla cerrada (D-29).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "node:crypto";

/** Dominios permitidos, coma-separados. Sin esto no se descarga nada. */
const ENV_DOMINIOS = "BOT_COBROS_DOMINIOS_IMAGEN";

const TIMEOUT_MS = 15_000;
const MAXIMO_BYTES = 8 * 1024 * 1024;

/** Lo que se acepta, verificado por contenido y no por la cabecera. */
const FIRMAS: { tipo: string; ext: string; test: (b: Buffer) => boolean }[] = [
	{
		tipo: "image/jpeg",
		ext: "jpg",
		test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		tipo: "image/png",
		ext: "png",
		test: (b) => b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
	},
	{
		tipo: "image/webp",
		ext: "webp",
		test: (b) =>
			b.subarray(0, 4).toString() === "RIFF" &&
			b.subarray(8, 12).toString() === "WEBP",
	},
	{
		tipo: "application/pdf",
		ext: "pdf",
		test: (b) => b.subarray(0, 4).toString() === "%PDF",
	},
];

export type ResultadoDescarga =
	| {
			ok: true;
			buffer: Buffer;
			tipo: string;
			extension: string;
			bytes: number;
			/** sha256 del archivo: con esto se detecta la misma foto repetida. */
			hash: string;
	  }
	| {
			ok: false;
			codigo:
				| "URL_NO_PERMITIDA"
				| "IMAGEN_NO_DESCARGABLE"
				| "ARCHIVO_MUY_GRANDE"
				| "ARCHIVO_NO_SOPORTADO";
	  };

function dominiosPermitidos(): string[] {
	return (process.env[ENV_DOMINIOS] ?? "")
		.split(",")
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
}

/**
 * Rangos que nunca son un CDN público.
 *
 * Se comprueba sobre el host de la URL: si alguien manda `http://169.254.169.254`
 * —los metadatos de AWS— o un `10.x` de la red interna, no se sale a buscarlo.
 */
export function esDireccionPrivada(host: string): boolean {
	const h = host.toLowerCase().replace(/^\[|\]$/g, "");

	if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) {
		return true;
	}
	// IPv6 local: ::1, fc00::/7 (únicas locales), fe80::/10 (link-local).
	if (h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;

	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (!ipv4) return false;

	const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];

	return (
		a === 10 ||
		a === 127 ||
		a === 0 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		(a === 100 && b >= 64 && b <= 127)
	);
}

/** ¿La URL pasa los filtros de forma? (sin salir a la red todavía) */
export function urlPermitida(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== "https:") return false;
	if (esDireccionPrivada(parsed.hostname)) return false;

	const permitidos = dominiosPermitidos();
	// Lista vacía = no se descarga nada. Falla cerrada a propósito: si alguien
	// despliega sin configurar la env, el bot deja de leer boletas — molesto,
	// pero infinitamente mejor que descargar lo que sea.
	if (permitidos.length === 0) return false;

	const host = parsed.hostname.toLowerCase();

	return permitidos.some((d) => host === d || host.endsWith(`.${d}`));
}

export async function descargarBoleta(url: string): Promise<ResultadoDescarga> {
	if (!urlPermitida(url)) return { ok: false, codigo: "URL_NO_PERMITIDA" };

	let respuesta: Response;
	try {
		respuesta = await fetch(url, {
			// Las redirecciones se cortan en vez de seguirse: un 302 hacia
			// 169.254.169.254 saltearía todos los filtros de arriba.
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };
	}

	if (respuesta.status >= 300 && respuesta.status < 400) {
		const destino = respuesta.headers.get("location");
		// Se permite UN salto, y solo si el destino vuelve a pasar los filtros.
		if (!destino || !urlPermitida(new URL(destino, url).toString())) {
			return { ok: false, codigo: "URL_NO_PERMITIDA" };
		}
		return descargarBoleta(new URL(destino, url).toString());
	}

	if (!respuesta.ok) return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };

	// El content-length puede mentir o no venir; igual sirve para cortar temprano.
	const declarado = Number(respuesta.headers.get("content-length") ?? 0);
	if (declarado > MAXIMO_BYTES) {
		return { ok: false, codigo: "ARCHIVO_MUY_GRANDE" };
	}

	let buffer: Buffer;
	try {
		buffer = Buffer.from(await respuesta.arrayBuffer());
	} catch {
		return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };
	}

	// El de verdad: se mide lo que llegó, no lo que dijeron que iba a llegar.
	if (buffer.length > MAXIMO_BYTES) {
		return { ok: false, codigo: "ARCHIVO_MUY_GRANDE" };
	}
	if (buffer.length === 0)
		return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };

	// El tipo sale del CONTENIDO, no del `content-type`: un tercero puede
	// declarar `image/jpeg` y mandar un ejecutable.
	const firma = FIRMAS.find((f) => f.test(buffer));
	if (!firma) return { ok: false, codigo: "ARCHIVO_NO_SOPORTADO" };

	return {
		ok: true,
		buffer,
		tipo: firma.tipo,
		extension: firma.ext,
		bytes: buffer.length,
		hash: createHash("sha256").update(buffer).digest("hex"),
	};
}

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
 * Seis filtros, y falla cerrada (D-29).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";

/** Dominios permitidos, coma-separados. Sin esto no se descarga nada. */
const ENV_DOMINIOS = "BOT_COBROS_DOMINIOS_IMAGEN";

const TIMEOUT_MS = 15_000;
/** Tope para el DNS. `lookup` no acepta timeout y el suyo puede ser larguísimo. */
const TIMEOUT_DNS_MS = 3_000;
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

/**
 * ¿A dónde apunta de verdad ese nombre?
 *
 * `urlPermitida` solo mira el texto del host, y eso deja un hueco: un dominio
 * de la allowlist puede resolver a `10.0.0.5`. Basta con que a SimpleTech le
 * tomen el DNS, o con que alguien de acá apunte mal un subdominio, para que la
 * allowlist esté conforme y el servidor termine llamando a un servicio interno
 * —justo lo que todo este archivo existe para evitar—.
 *
 * Se resuelve antes de salir, y con que UNA de las direcciones sea privada
 * alcanza para no ir: un host legítimo de CDN no tiene por qué traer una.
 *
 * ⚠️ Esto no cierra un *DNS rebinding* con el tiempo justo: entre este `lookup`
 * y el `fetch` hay una segunda resolución que podría dar otra cosa. Cerrarlo del
 * todo pide conectarse a la IP ya validada y llevar el nombre aparte para el
 * SNI y el certificado, que en `fetch` no se puede sin un dispatcher propio. Lo
 * que queda cubierto es el caso realista —el registro que apunta adentro— y no
 * el que exige ganarle a la carrera.
 */
export async function destinoResuelto(
	host: string,
): Promise<"publica" | "privada" | "desconocida"> {
	let direcciones: { address: string }[];
	let reloj: ReturnType<typeof setTimeout> | undefined;

	try {
		direcciones = await Promise.race([
			lookup(host, { all: true, verbatim: true }),
			new Promise<never>((_, rechazar) => {
				reloj = setTimeout(
					() => rechazar(new Error("dns lento")),
					TIMEOUT_DNS_MS,
				);
			}),
		]);
	} catch {
		return "desconocida";
	} finally {
		// Sin esto queda un timer vivo 3 s por cada boleta que sí resolvió.
		if (reloj) clearTimeout(reloj);
	}

	if (direcciones.length === 0) return "desconocida";

	return direcciones.some((d) => esDireccionPrivada(d.address))
		? "privada"
		: "publica";
}

/** Se lanza al pasar el tope, para distinguirlo de un corte de red. */
class DemasiadoGrande extends Error {}

/**
 * Baja el cuerpo de a trozos y aborta apenas se pasa del tope.
 *
 * Se cancela el stream además de cortar el bucle: sin el `cancel()` el servidor
 * remoto seguiría mandando bytes que ya nadie va a leer.
 */
async function leerConTope(respuesta: Response, tope: number): Promise<Buffer> {
	const stream = respuesta.body;
	if (!stream) return Buffer.alloc(0);

	const lector = stream.getReader();
	const trozos: Uint8Array[] = [];
	let acumulado = 0;

	try {
		while (true) {
			const { done, value } = await lector.read();
			if (done) break;
			if (!value) continue;

			acumulado += value.byteLength;
			if (acumulado > tope) throw new DemasiadoGrande();

			trozos.push(value);
		}
	} finally {
		// Si salimos por el tope, esto le corta el chorro al otro lado.
		await lector.cancel().catch(() => {});
	}

	return Buffer.concat(trozos);
}

/**
 * Cuántos saltos se permiten en toda la descarga.
 *
 * El contador viaja en la recursión a propósito: si cada llamada empezara de
 * cero, una cadena de redirecciones —o un bucle— se seguiría persiguiendo para
 * siempre, y encima con un timeout nuevo de 15 s en cada vuelta.
 */
const MAXIMO_SALTOS = 1;

export async function descargarBoleta(
	url: string,
	saltos = 0,
): Promise<ResultadoDescarga> {
	if (!urlPermitida(url)) return { ok: false, codigo: "URL_NO_PERMITIDA" };

	// El filtro de arriba es sobre el texto; este es sobre a dónde apunta.
	const destino = await destinoResuelto(new URL(url).hostname);
	if (destino === "privada") return { ok: false, codigo: "URL_NO_PERMITIDA" };
	// Si el nombre no resuelve, el `fetch` tampoco iba a poder: es un problema
	// de la imagen, no del permiso, y por eso no gasta el código de allowlist.
	if (destino === "desconocida") {
		return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };
	}

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
		if (saltos >= MAXIMO_SALTOS) {
			return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };
		}

		const destino = respuesta.headers.get("location");
		// Se permite UN salto, y solo si el destino vuelve a pasar los filtros.
		if (!destino || !urlPermitida(new URL(destino, url).toString())) {
			return { ok: false, codigo: "URL_NO_PERMITIDA" };
		}
		return descargarBoleta(new URL(destino, url).toString(), saltos + 1);
	}

	if (!respuesta.ok) return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };

	// El content-length puede mentir o no venir; igual sirve para cortar temprano.
	const declarado = Number(respuesta.headers.get("content-length") ?? 0);
	if (declarado > MAXIMO_BYTES) {
		return { ok: false, codigo: "ARCHIVO_MUY_GRANDE" };
	}

	// ── Se lee por trozos y se corta al pasarse ────────────────────────────────
	// `arrayBuffer()` bajaría el cuerpo ENTERO antes de poder medirlo: una
	// respuesta sin `content-length` —o con uno mentiroso— alojada en un dominio
	// permitido nos haría reservar cientos de megas en memoria para recién
	// después decir "pesa demasiado". El tope tiene que frenar la descarga, no
	// describirla.
	let buffer: Buffer;
	try {
		buffer = await leerConTope(respuesta, MAXIMO_BYTES);
	} catch (error) {
		if (error instanceof DemasiadoGrande) {
			return { ok: false, codigo: "ARCHIVO_MUY_GRANDE" };
		}
		return { ok: false, codigo: "IMAGEN_NO_DESCARGABLE" };
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

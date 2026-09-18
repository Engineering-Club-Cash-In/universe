import type { Context, Next } from "hono";

/**
 * Limitador en memoria, por IP+ruta. No sobrevive un restart ni se comparte
 * entre réplicas, pero alcanza para el objetivo real: frenar un script
 * probando contraseñas contra una sola cuenta desde una sola máquina.
 */
type RegistroLimite = { intentos: number; expiraEn: number };

// cf-connecting-ip lo pone Cloudflare y no se puede falsificar si todo el
// tráfico pasa por ahí. x-forwarded-for es una lista que cada proxy va
// agregando al final ("cliente, proxy1, proxy2"); el último valor es el que
// puso el proxy más cercano al origin — el único que un atacante pegándole
// directo a la API no puede escribir él mismo con un header falso.
export function extraerIp(
	obtenerHeader: (nombre: string) => string | null | undefined,
): string {
	const cfIp = obtenerHeader("cf-connecting-ip");
	if (cfIp) return cfIp;

	const xff = obtenerHeader("x-forwarded-for");
	if (xff) {
		const saltos = xff
			.split(",")
			.map((salto) => salto.trim())
			.filter(Boolean);
		if (saltos.length > 0) return saltos[saltos.length - 1];
	}

	return "unknown";
}

// Exportado para que los tests puedan crear una instancia aislada con su
// propio almacén, en vez de compartir el estado de partnerAuthLimiter.
export function crearLimitador(opciones: {
	ventanaMs: number;
	maximo: number;
	mensaje: string;
}) {
	const almacen = new Map<string, RegistroLimite>();

	const limpieza = setInterval(() => {
		const ahora = Date.now();
		for (const [clave, registro] of almacen) {
			if (ahora > registro.expiraEn) almacen.delete(clave);
		}
	}, 60_000);
	limpieza.unref();

	// Núcleo sin depender de Hono: lo usa tanto el middleware de la ruta cruda
	// como el procedure oRPC `changePartnerPassword`, que nunca pasa por esa
	// ruta — comparten cupo llamando esto con la misma clave.
	function permitir(clave: string): boolean {
		const ahora = Date.now();
		let registro = almacen.get(clave);
		if (!registro || ahora > registro.expiraEn) {
			registro = { intentos: 0, expiraEn: ahora + opciones.ventanaMs };
			almacen.set(clave, registro);
		}
		registro.intentos++;
		return registro.intentos <= opciones.maximo;
	}

	async function middleware(c: Context, next: Next) {
		const ip = extraerIp((nombre) => c.req.header(nombre));
		if (!permitir(`${ip}:${c.req.path}`)) {
			return c.json(
				{
					error: {
						code: "RATE_LIMIT_EXCEEDED",
						message: opciones.mensaje,
					},
				},
				429,
			);
		}
		await next();
	}

	return { middleware, permitir, mensaje: opciones.mensaje };
}

// Login y cambio de contraseña de socios (predios/agencias): sin esto, nada
// frena fuerza bruta contra una cuenta ajena — las contraseñas suelen
// arrancar como temporales. Mismo umbral que apps/auth-google.
export const partnerAuthLimiter = crearLimitador({
	ventanaMs: 15 * 60 * 1000,
	maximo: 5,
	mensaje: "Demasiados intentos. Intenta de nuevo en unos minutos.",
});

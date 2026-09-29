import type { Context, Next } from "hono";

// 10 MB del archivo + margen del multipart.
export const MAXIMO_CUERPO_FACTURA_SEGURO = 11 * 1024 * 1024;

// oRPC quita una barra final antes de buscar el procedure: ambas rutas llegan
// a `subirFacturaSeguro`.
const RUTA_FACTURA_SEGURO = /^\/rpc\/subirFacturaSeguro\/?$/;

function facturaMuyGrande(c: Context) {
	return c.json(
		{
			json: {
				defined: false,
				code: "PAYLOAD_TOO_LARGE",
				status: 413,
				message: "La factura no puede pesar más de 10MB",
			},
		},
		413,
	);
}

/**
 * Corta la subida de la factura antes de que oRPC parsee el multipart. Sin
 * esto Bun acepta hasta 128 MB y el límite se validaba al final.
 *
 * No se usa `bodyLimit` de Hono porque, sin Content-Length, su error ocurre
 * mientras oRPC lee el cuerpo y oRPC lo convierte en un 400 genérico.
 */
export function limiteFacturaSeguro(maximo = MAXIMO_CUERPO_FACTURA_SEGURO) {
	return async (c: Context, next: Next) => {
		if (!RUTA_FACTURA_SEGURO.test(c.req.path)) return next();

		const declarado = c.req.header("content-length");
		// Con Content-Length el servidor HTTP no entrega más bytes que esos.
		if (declarado !== undefined) {
			if (Number(declarado) > maximo) return facturaMuyGrande(c);
			return next();
		}

		const cuerpo = c.req.raw.body;
		if (!cuerpo) return next();

		const partes: Uint8Array[] = [];
		let leidos = 0;
		for await (const parte of cuerpo) {
			leidos += parte.byteLength;
			// Pasado el límite se sigue leyendo sin guardar: cortar la lectura deja
			// bytes en la conexión y la siguiente petición en ella falla con 400.
			if (leidos <= maximo) partes.push(parte);
		}
		if (leidos > maximo) return facturaMuyGrande(c);
		c.req.raw = new Request(c.req.raw, { body: Buffer.concat(partes) });
		return next();
	};
}

import { describe, expect, test } from "bun:test";
import type { Context, Next } from "hono";
import { crearLimitador, extraerIp } from "./rate-limit";

// Contexto mínimo: el middleware solo usa `req.header`, `req.path` y `json`.
function contextoFalso(opciones: { ip?: string; path?: string } = {}) {
	const headers: Record<string, string> = {};
	if (opciones.ip) headers["x-forwarded-for"] = opciones.ip;

	return {
		req: {
			header: (nombre: string) => headers[nombre],
			path: opciones.path ?? "/api/partner-auth/sign-in/email",
		},
		json: (body: unknown, status: number) => ({ body, status }),
	} as unknown as Context;
}

async function llamar(
	middleware: (c: Context, next: Next) => Promise<Response | void>,
	c: Context,
) {
	let siguienteLlamado = false;
	const resultado = await middleware(c, async () => {
		siguienteLlamado = true;
	});
	return { resultado, siguienteLlamado };
}

describe("extraerIp", () => {
	function headersFalsos(valores: Record<string, string>) {
		return (nombre: string) => valores[nombre];
	}

	test("usa cf-connecting-ip cuando está presente, sin mirar x-forwarded-for", () => {
		const ip = extraerIp(
			headersFalsos({
				"cf-connecting-ip": "203.0.113.5",
				"x-forwarded-for": "1.1.1.1",
			}),
		);
		expect(ip).toBe("203.0.113.5");
	});

	test("sin cf-connecting-ip, usa x-forwarded-for si es un solo valor", () => {
		const ip = extraerIp(headersFalsos({ "x-forwarded-for": "198.51.100.7" }));
		expect(ip).toBe("198.51.100.7");
	});

	// El cliente puede escribir cualquier cosa al principio de la lista; el
	// último salto es el que agregó el proxy más cercano al origin.
	test("con varios saltos en x-forwarded-for, toma el último, no el primero", () => {
		const ip = extraerIp(
			headersFalsos({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" }),
		);
		expect(ip).toBe("10.0.0.2");
	});

	test("ignora espacios y comas de más entre saltos", () => {
		const ip = extraerIp(
			headersFalsos({ "x-forwarded-for": "  1.2.3.4 ,, 10.0.0.9  " }),
		);
		expect(ip).toBe("10.0.0.9");
	});

	test("sin ningún header, devuelve 'unknown'", () => {
		expect(extraerIp(headersFalsos({}))).toBe("unknown");
	});
});

describe("crearLimitador — middleware de Hono", () => {
	test("deja pasar mientras esté bajo el máximo", async () => {
		const limitador = crearLimitador({
			ventanaMs: 60_000,
			maximo: 3,
			mensaje: "límite",
		});
		const c = contextoFalso({ ip: "1.1.1.1" });

		for (let i = 0; i < 3; i++) {
			const { siguienteLlamado, resultado } = await llamar(limitador.middleware, c);
			expect(siguienteLlamado).toBe(true);
			expect(resultado).toBeUndefined();
		}
	});

	test("bloquea con 429 al superar el máximo, sin llegar al handler", async () => {
		const limitador = crearLimitador({
			ventanaMs: 60_000,
			maximo: 2,
			mensaje: "Demasiados intentos.",
		});
		const c = contextoFalso({ ip: "2.2.2.2" });

		await llamar(limitador.middleware, c);
		await llamar(limitador.middleware, c);
		const { siguienteLlamado, resultado } = await llamar(limitador.middleware, c);

		expect(siguienteLlamado).toBe(false);
		expect(resultado).toMatchObject({
			status: 429,
			body: { error: { code: "RATE_LIMIT_EXCEEDED", message: "Demasiados intentos." } },
		});
	});

	test("cuenta IP y ruta por separado: una no contamina a la otra", async () => {
		const limitador = crearLimitador({ ventanaMs: 60_000, maximo: 1, mensaje: "x" });

		await llamar(limitador.middleware, contextoFalso({ ip: "3.3.3.3" }));
		const otraIp = await llamar(limitador.middleware, contextoFalso({ ip: "4.4.4.4" }));
		const otraRuta = await llamar(
			limitador.middleware,
			contextoFalso({ ip: "3.3.3.3", path: "/api/partner-auth/change-password" }),
		);

		expect(otraIp.siguienteLlamado).toBe(true);
		expect(otraRuta.siguienteLlamado).toBe(true);
	});

	test("la ventana expira y vuelve a dejar pasar", async () => {
		const limitador = crearLimitador({ ventanaMs: 10, maximo: 1, mensaje: "x" });
		const c = contextoFalso({ ip: "5.5.5.5" });

		await llamar(limitador.middleware, c);
		const bloqueado = await llamar(limitador.middleware, c);
		expect(bloqueado.siguienteLlamado).toBe(false);

		await new Promise((resolve) => setTimeout(resolve, 20));

		const despuesDeLaVentana = await llamar(limitador.middleware, c);
		expect(despuesDeLaVentana.siguienteLlamado).toBe(true);
	});

	// El límite es el mismo en cualquier ambiente — local tiene que comportarse
	// igual que producción, sin excepción por NODE_ENV.
	for (const nodeEnv of [undefined, "development", "production", "test"]) {
		test(`bloquea igual con NODE_ENV=${nodeEnv ?? "undefined"}`, async () => {
			const original = process.env.NODE_ENV;
			process.env.NODE_ENV = nodeEnv;
			try {
				const limitador = crearLimitador({ ventanaMs: 60_000, maximo: 1, mensaje: "x" });
				const c = contextoFalso({ ip: `env-${nodeEnv}` });

				await llamar(limitador.middleware, c);
				const { siguienteLlamado } = await llamar(limitador.middleware, c);
				expect(siguienteLlamado).toBe(false);
			} finally {
				process.env.NODE_ENV = original;
			}
		});
	}
});

describe("crearLimitador — permitir (núcleo sin Hono)", () => {
	test("deja pasar hasta el máximo y bloquea después, con la misma clave", () => {
		const limitador = crearLimitador({ ventanaMs: 60_000, maximo: 3, mensaje: "x" });

		expect(limitador.permitir("clave-1")).toBe(true);
		expect(limitador.permitir("clave-1")).toBe(true);
		expect(limitador.permitir("clave-1")).toBe(true);
		expect(limitador.permitir("clave-1")).toBe(false);
	});

	// Esto es justo lo que arregla que changePartnerPassword (oRPC) comparta
	// cupo con /api/partner-auth/change-password (ruta cruda): ambos llaman
	// `permitir` con la misma clave, así que uno agota lo que el otro dejó.
	test("middleware y permitir comparten el mismo almacén cuando usan la misma clave", async () => {
		const limitador = crearLimitador({ ventanaMs: 60_000, maximo: 2, mensaje: "x" });
		const ruta = "/api/partner-auth/change-password";
		const c = contextoFalso({ ip: "9.9.9.9", path: ruta });

		// Un intento por la ruta cruda (vía middleware)...
		await llamar(limitador.middleware, c);
		// ...deja solo uno disponible para el mismo intento vía oRPC (vía permitir).
		expect(limitador.permitir(`9.9.9.9:${ruta}`)).toBe(true);
		expect(limitador.permitir(`9.9.9.9:${ruta}`)).toBe(false);
	});
});

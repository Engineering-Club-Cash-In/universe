import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { os, type RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { z } from "zod";
import {
	limiteFacturaSeguro,
	MAXIMO_CUERPO_FACTURA_SEGURO,
} from "./limite-factura-seguro";

// Se prueba sobre HTTP real (Bun.serve + fetch), como en index.ts: el
// Content-Length y el cuerpo por partes solo existen al pasar por la red.
const MAXIMO = 64 * 1024;

const router = {
	subirFacturaSeguro: os
		.input(z.object({ archivo: z.instanceof(File) }))
		.handler(({ input }) => ({ tamano: input.archivo.size })),
	otro: os
		.input(z.object({ archivo: z.instanceof(File) }))
		.handler(({ input }) => ({ tamano: input.archivo.size })),
};

let servidor: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
	const handler = new RPCHandler(router);
	const app = new Hono();
	app.use("/rpc/*", limiteFacturaSeguro(MAXIMO));
	app.use("/rpc/*", async (c, next) => {
		const { matched, response } = await handler.handle(c.req.raw, {
			prefix: "/rpc",
			context: {},
		});
		if (matched) return c.newResponse(response.body, response);
		await next();
	});
	servidor = Bun.serve({ port: 0, fetch: app.fetch });
	base = `http://localhost:${servidor.port}`;
});

afterAll(() => servidor.stop(true));

function archivo(bytes: number) {
	return new File([new Uint8Array(bytes)], "factura.pdf", {
		type: "application/pdf",
	});
}

function cliente() {
	return createORPCClient<RouterClient<typeof router>>(
		new RPCLink({ url: `${base}/rpc` }),
	);
}

// El multipart tal como lo arma el cliente oRPC, para mandarlo a mano.
async function cuerpoMultipart(bytes: number) {
	let capturado: Request | undefined;
	const link = new RPCLink({
		url: `${base}/rpc`,
		fetch: async (request) => {
			capturado = request as Request;
			return new Response(JSON.stringify({ json: { tamano: 0 } }));
		},
	});
	await createORPCClient<RouterClient<typeof router>>(link)
		.subirFacturaSeguro({ archivo: archivo(bytes) })
		.catch(() => {});
	if (!capturado) throw new Error("el cliente no hizo la petición");
	return {
		tipo: capturado.headers.get("content-type") ?? "",
		cuerpo: new Uint8Array(await capturado.arrayBuffer()),
	};
}

function porPartes(cuerpo: Uint8Array) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (let i = 0; i < cuerpo.length; i += 8192) {
				controller.enqueue(cuerpo.slice(i, i + 8192));
			}
			controller.close();
		},
	});
}

async function esperar413(respuesta: Response) {
	expect(respuesta.status).toBe(413);
	expect(await respuesta.json()).toEqual({
		json: {
			defined: false,
			code: "PAYLOAD_TOO_LARGE",
			status: 413,
			message: "La factura no puede pesar más de 10MB",
		},
	});
}

describe("límite de la factura del seguro", () => {
	test("por defecto admite 10 MB más el margen del multipart", () => {
		expect(MAXIMO_CUERPO_FACTURA_SEGURO).toBe(11 * 1024 * 1024);
	});

	test("una factura dentro del límite llega al procedure por el cliente oRPC", async () => {
		expect(
			await cliente().subirFacturaSeguro({ archivo: archivo(1024) }),
		).toEqual({ tamano: 1024 });
	});

	test("por el cliente oRPC, una factura grande recibe el 413", async () => {
		const error = await cliente()
			.subirFacturaSeguro({ archivo: archivo(MAXIMO * 2) })
			.catch((e) => e);
		expect(error).toMatchObject({
			code: "PAYLOAD_TOO_LARGE",
			status: 413,
			message: "La factura no puede pesar más de 10MB",
		});
	});

	for (const ruta of ["/rpc/subirFacturaSeguro", "/rpc/subirFacturaSeguro/"]) {
		test(`${ruta} con Content-Length grande: 413`, async () => {
			const { tipo, cuerpo } = await cuerpoMultipart(MAXIMO * 2);
			await esperar413(
				await fetch(`${base}${ruta}`, {
					method: "POST",
					headers: { "content-type": tipo },
					body: cuerpo,
				}),
			);
		});

		test(`${ruta} sin Content-Length (por partes) y grande: 413`, async () => {
			const { tipo, cuerpo } = await cuerpoMultipart(MAXIMO * 2);
			await esperar413(
				await fetch(`${base}${ruta}`, {
					method: "POST",
					headers: { "content-type": tipo },
					body: porPartes(cuerpo),
					// El cliente fetch de Bun reusa la conexión mientras su cuerpo
					// todavía se está enviando; el server no tiene problema.
					keepalive: false,
				}),
			);
		});
	}

	test("sin Content-Length y dentro del límite, el procedure recibe el archivo completo", async () => {
		const { tipo, cuerpo } = await cuerpoMultipart(20 * 1024);
		const respuesta = await fetch(`${base}/rpc/subirFacturaSeguro/`, {
			method: "POST",
			headers: { "content-type": tipo },
			body: porPartes(cuerpo),
		});
		expect(respuesta.status).toBe(200);
		expect(await respuesta.json()).toEqual({ json: { tamano: 20 * 1024 } });
	});

	test("un cuerpo por partes que nunca termina recibe el 413 sin esperar el final", async () => {
		const respuesta = await new Promise<string>((resolve, reject) => {
			let intervalo: ReturnType<typeof setInterval> | undefined;
			const sock = connect(Number(servidor.port), "127.0.0.1", () => {
				sock.write(
					"POST /rpc/subirFacturaSeguro HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n",
				);
				const trozo = "a".repeat(8192);
				// Sigue mandando mientras no haya respuesta: nunca manda el final.
				intervalo = setInterval(() => {
					if (!sock.destroyed) sock.write(`2000\r\n${trozo}\r\n`);
				}, 2);
			});
			const terminar = (resultado: string | Error) => {
				clearInterval(intervalo);
				clearTimeout(limite);
				sock.destroy();
				if (resultado instanceof Error) reject(resultado);
				else resolve(resultado);
			};
			const limite = setTimeout(
				() => terminar(new Error("el server esperó el final del cuerpo")),
				3000,
			);
			sock.on("data", (d) => terminar(d.toString().split("\r\n")[0] ?? ""));
			sock.on("error", (e) => terminar(e));
		});
		expect(respuesta).toBe("HTTP/1.1 413 Payload Too Large");
	});

	test("no afecta a los demás procedures", async () => {
		const respuesta = await cliente().otro({ archivo: archivo(MAXIMO * 2) });
		expect(respuesta).toEqual({ tamano: MAXIMO * 2 });
	});
});

/**
 * CB-121 — Trazabilidad y manejo de fallas de la integración GPS/Wialon.
 *
 * Cubre lo que wialon-client.test.ts no cubre: política de reintentos,
 * circuit breaker, resultado incierto en escrituras, clasificación de
 * fallas y sanitización de payloads antes de persistirlos.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
	clasificarFallaWialon,
	esIntentoExitoso,
	esOperacionIdempotente,
	sanitizarPayloadWialon,
	WIALON_SVC_IDEMPOTENTES,
} from "./wialon-clasificacion";
import { WialonClient } from "./wialon-client";
import {
	WialonClientError,
	type WialonFetch,
	type WialonIntentoEvento,
} from "./wialon-types";

describe("CB-121 — clasificarFallaWialon", () => {
	test("timeout es transitorio y reintentable", () => {
		const { severidad, reintentable } = clasificarFallaWialon(
			new WialonClientError("timeout", "WIALON_TIMEOUT"),
		);
		expect(severidad).toBe("warning");
		expect(reintentable).toBe(true);
	});

	test("error de red con status 5xx es reintentable", () => {
		const { reintentable } = clasificarFallaWialon(
			new WialonClientError(
				"bad gateway",
				"WIALON_NETWORK_ERROR",
				undefined,
				502,
			),
		);
		expect(reintentable).toBe(true);
	});

	test("error de red con status 4xx NO es reintentable", () => {
		const { severidad, reintentable } = clasificarFallaWialon(
			new WialonClientError(
				"bad request",
				"WIALON_NETWORK_ERROR",
				undefined,
				404,
			),
		);
		expect(reintentable).toBe(false);
		expect(severidad).toBe("critical");
	});

	test("Wialon 7 (acceso denegado) es crítico y no reintentable", () => {
		const { severidad, reintentable } = clasificarFallaWialon(
			new WialonClientError("denegado", "WIALON_API_ERROR", 7),
		);
		expect(severidad).toBe("critical");
		expect(reintentable).toBe(false);
	});

	test("Wialon 7 en core/search_item (unidad borrada o invisible) es warning, no crítico", () => {
		const { severidad, reintentable } = clasificarFallaWialon(
			new WialonClientError("denegado", "WIALON_API_ERROR", 7),
			"core/search_item",
		);
		expect(severidad).toBe("warning");
		expect(reintentable).toBe(false);
	});

	test("Wialon 7 en otro svc sigue siendo crítico", () => {
		const { severidad } = clasificarFallaWialon(
			new WialonClientError("denegado", "WIALON_API_ERROR", 7),
			"core/search_items",
		);
		expect(severidad).toBe("critical");
	});

	test("Wialon 8 (credenciales) es crítico", () => {
		const { severidad } = clasificarFallaWialon(
			new WialonClientError("credenciales", "WIALON_API_ERROR", 8),
		);
		expect(severidad).toBe("critical");
	});

	test("Wialon 9 (cuota excedida) es warning pero NO reintentable", () => {
		const { severidad, reintentable } = clasificarFallaWialon(
			new WialonClientError("cuota", "WIALON_API_ERROR", 9),
		);
		expect(severidad).toBe("warning");
		expect(reintentable).toBe(false);
	});

	test("Wialon 5 (error de ejecución) es warning y reintentable", () => {
		const { severidad, reintentable } = clasificarFallaWialon(
			new WialonClientError("ejecucion", "WIALON_API_ERROR", 5),
		);
		expect(severidad).toBe("warning");
		expect(reintentable).toBe(true);
	});

	test("un error que no es WialonClientError se clasifica como crítico no reintentable", () => {
		const { severidad, reintentable } = clasificarFallaWialon(
			new Error("boom"),
		);
		expect(severidad).toBe("critical");
		expect(reintentable).toBe(false);
	});
});

describe("CB-121 — esOperacionIdempotente", () => {
	test("las lecturas conocidas son idempotentes", () => {
		for (const svc of WIALON_SVC_IDEMPOTENTES) {
			expect(esOperacionIdempotente(svc)).toBe(true);
		}
	});

	test("token/update (crear/borrar link) NO es idempotente", () => {
		expect(esOperacionIdempotente("token/update")).toBe(false);
	});

	test("un svc desconocido se trata como escritura (no idempotente)", () => {
		expect(esOperacionIdempotente("algo/inventado")).toBe(false);
	});
});

describe("CB-121 — sanitizarPayloadWialon", () => {
	test("redacta token, sid y eid en cualquier profundidad", () => {
		const resultado = sanitizarPayloadWialon({
			token: "secreto-123",
			sid: "sid-abc",
			anidado: { eid: "eid-xyz", ok: true },
		}) as Record<string, unknown>;

		expect(resultado.token).toBe("[redactado]");
		expect(resultado.sid).toBe("[redactado]");
		expect((resultado.anidado as Record<string, unknown>).eid).toBe(
			"[redactado]",
		);
		expect((resultado.anidado as Record<string, unknown>).ok).toBe(true);
	});

	test("redacta el hash h de un link de Locator", () => {
		const resultado = sanitizarPayloadWialon({
			h: "hash-publico",
			app: "locator",
		}) as Record<string, unknown>;

		expect(resultado.h).toBe("[redactado]");
		expect(resultado.app).toBe("locator");
	});

	test("trunca payloads grandes en vez de guardarlos completos", () => {
		const items = Array.from({ length: 500 }, (_, i) => ({
			id: i,
			nm: `unidad-${i}`,
		}));
		const resultado = sanitizarPayloadWialon({ items }, 200) as {
			_truncado: boolean;
			preview: string;
		};
		expect(resultado._truncado).toBe(true);
		expect(resultado.preview.length).toBeLessThanOrEqual(200);
	});

	test("no toca un payload chico sin campos sensibles", () => {
		const resultado = sanitizarPayloadWialon({ id: 1, nm: "A-04" });
		expect(resultado).toEqual({ id: 1, nm: "A-04" });
	});
});

describe("CB-121 — política de reintentos en WialonClient", () => {
	const originalEnv = { ...process.env };
	beforeEach(() => {
		delete process.env.WIALON_TOKEN;
	});
	afterAll(() => {
		process.env.WIALON_TOKEN = originalEnv.WIALON_TOKEN;
	});

	function fetchLogin(bodyStr: string): Response | null {
		if (bodyStr.includes("svc=token%2Flogin")) {
			return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
		}
		return null;
	}

	test("reintenta una lectura (core/search_items) ante timeout hasta 3 intentos", async () => {
		let intentos = 0;
		const eventos: WialonIntentoEvento[] = [];
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			const login = fetchLogin(bodyStr);
			if (login) return login;
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				intentos++;
				throw new DOMException("aborted", "AbortError");
			}
			return new Response("{}");
		};

		const client = new WialonClient(
			{ token: "tok", timeoutMs: 5 },
			fetchMock,
			(e) => eventos.push(e),
		);

		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow(
			WialonClientError,
		);
		expect(intentos).toBe(3);
		// El primer evento es el login (ok); los 3 intentos de search_items son
		// "reintentado", "reintentado", "error".
		const resultados = eventos
			.filter((e) => e.operacion === "core/search_items")
			.map((e) => e.resultado);
		expect(resultados).toEqual(["reintentado", "reintentado", "error"]);
	}, 10_000);

	test("NO reintenta ante error 7 (acceso denegado) aunque sea una lectura", async () => {
		let intentos = 0;
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			const login = fetchLogin(bodyStr);
			if (login) return login;
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				intentos++;
				return new Response(JSON.stringify({ error: 7 }), { status: 200 });
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok" }, fetchMock);
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow(
			WialonClientError,
		);
		expect(intentos).toBe(1);
	});

	test("NO reintenta ante error 9 (cuota excedida)", async () => {
		let intentos = 0;
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			const login = fetchLogin(bodyStr);
			if (login) return login;
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				intentos++;
				return new Response(JSON.stringify({ error: 9 }), { status: 200 });
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok" }, fetchMock);
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow(
			WialonClientError,
		);
		expect(intentos).toBe(1);
	});

	test("una escritura (createLocatorLink) NUNCA se reintenta ante timeout", async () => {
		let intentosUpdate = 0;
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			const login = fetchLogin(bodyStr);
			if (login) return login;
			if (bodyStr.includes("svc=token%2Fupdate")) {
				intentosUpdate++;
				throw new DOMException("aborted", "AbortError");
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok", timeoutMs: 5 }, fetchMock);
		await expect(
			client.createLocatorLink({ unitId: 1, durationSeconds: 60 }),
		).rejects.toThrow(WialonClientError);
		expect(intentosUpdate).toBe(1);
	});

	test("una escritura que falla por timeout se propaga como WIALON_RESULTADO_INCIERTO", async () => {
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			const login = fetchLogin(bodyStr);
			if (login) return login;
			if (bodyStr.includes("svc=token%2Fupdate")) {
				throw new DOMException("aborted", "AbortError");
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok", timeoutMs: 5 }, fetchMock);
		try {
			await client.createLocatorLink({ unitId: 1, durationSeconds: 60 });
			throw new Error("no debió resolver");
		} catch (error) {
			expect(error).toBeInstanceOf(WialonClientError);
			expect((error as WialonClientError).code).toBe(
				"WIALON_RESULTADO_INCIERTO",
			);
		}
	});

	test("una escritura que falla por error no transitorio (ej. 4) NO se marca incierta", async () => {
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			const login = fetchLogin(bodyStr);
			if (login) return login;
			if (bodyStr.includes("svc=token%2Fupdate")) {
				return new Response(JSON.stringify({ error: 4 }), { status: 200 });
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok" }, fetchMock);
		try {
			await client.createLocatorLink({ unitId: 1, durationSeconds: 60 });
			throw new Error("no debió resolver");
		} catch (error) {
			expect(error).toBeInstanceOf(WialonClientError);
			expect((error as WialonClientError).code).toBe("WIALON_API_ERROR");
		}
	});
});

describe("CB-121 — circuit breaker", () => {
	beforeEach(() => {
		delete process.env.WIALON_TOKEN;
	});

	test("abre el circuito tras 5 fallos reintentables consecutivos y deja de llamar a fetch", async () => {
		let llamadasSearch = 0;
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				llamadasSearch++;
				throw new DOMException("aborted", "AbortError");
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok", timeoutMs: 5 }, fetchMock);

		// El circuito se evalúa al INICIO de cada llamada pública (requestRaw),
		// no entre los reintentos internos de una misma llamada: una tanda de 3
		// intentos que ya está en curso no se corta a mitad. La primera llamada
		// agota sus 3 intentos (3 fallos consecutivos, todavía bajo el umbral
		// de 5) y falla normalmente.
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow(
			WialonClientError,
		);
		expect(llamadasSearch).toBe(3);

		// La segunda llamada también agota sus 3 intentos: el 2° de esa tanda
		// cruza el umbral de 5 fallos consecutivos y abre el circuito, pero ya
		// dentro de esta misma tanda (que no se corta a mitad de camino).
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow(
			WialonClientError,
		);
		expect(llamadasSearch).toBe(6);

		// Con el circuito ya abierto, una TERCERA llamada ni siquiera toca
		// fetch: falla de inmediato con WIALON_NO_DISPONIBLE.
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow(
			/temporalmente deshabilitada/,
		);
		expect(llamadasSearch).toBe(6);
	}, 15_000);

	test("con el circuito abierto una escritura falla de inmediato sin llamar a Wialon", async () => {
		let llamadasUpdate = 0;
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				throw new DOMException("aborted", "AbortError");
			}
			if (bodyStr.includes("svc=token%2Fupdate")) {
				llamadasUpdate++;
				return new Response(JSON.stringify({ h: "hash" }), { status: 200 });
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok", timeoutMs: 5 }, fetchMock);
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow();
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow();
		expect(client.getEstadoCircuito().abierto).toBe(true);

		try {
			await client.createLocatorLink({ unitId: 1, durationSeconds: 60 });
			throw new Error("no debió resolver");
		} catch (error) {
			expect((error as WialonClientError).code).toBe("WIALON_NO_DISPONIBLE");
		}
		expect(llamadasUpdate).toBe(0);
	}, 15_000);

	test("una escritura fallida no reinicia el contador de fallos del circuito", async () => {
		let llamadasSearch = 0;
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				llamadasSearch++;
				throw new DOMException("aborted", "AbortError");
			}
			if (bodyStr.includes("svc=token%2Fupdate")) {
				return new Response(JSON.stringify({ error: 4 }), { status: 200 });
			}
			return new Response("{}");
		};

		const client = new WialonClient({ token: "tok", timeoutMs: 5 }, fetchMock);
		// 3 fallos reintentables: el circuito sigue cerrado.
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow();
		expect(client.getEstadoCircuito().fallosConsecutivos).toBe(3);

		// Una escritura que falla por error no transitorio no cuenta ni reinicia.
		await expect(
			client.createLocatorLink({ unitId: 1, durationSeconds: 60 }),
		).rejects.toThrow(WialonClientError);
		expect(client.getEstadoCircuito().fallosConsecutivos).toBe(3);

		// Con 3 fallos más cruza el umbral de 5 y se abre.
		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow();
		expect(client.getEstadoCircuito().abierto).toBe(true);
		expect(llamadasSearch).toBe(6);
	}, 15_000);
});

describe("CB-121 — hook de eventos nunca rompe la llamada real", () => {
	beforeEach(() => {
		delete process.env.WIALON_TOKEN;
	});

	test("si el hook onIntento lanza, la respuesta a Wialon igual se devuelve", async () => {
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			return new Response(
				JSON.stringify({ items: [{ id: 1, nm: "A-01" }], totalItemsCount: 1 }),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok" }, fetchMock, () => {
			throw new Error("hook roto");
		});

		const resultado = await client.searchUnits({ flags: 1 });
		expect(resultado.totalItemsCount).toBe(1);
	});
});

describe("CB-121 — la bitácora registra el desenlace real de cada intento", () => {
	beforeEach(() => {
		delete process.env.WIALON_TOKEN;
	});

	test("sin token, login deja un evento crítico antes de fallar", async () => {
		const eventos: WialonIntentoEvento[] = [];
		const client = new WialonClient(
			{ token: "" },
			async () => new Response("{}"),
			(e) => eventos.push(e),
		);

		await expect(client.login()).rejects.toThrow(/WIALON_TOKEN/);
		expect(eventos).toHaveLength(1);
		expect(eventos[0]).toMatchObject({
			operacion: "token/login",
			resultado: "error",
			errorCode: "WIALON_AUTH_REQUIRED",
			severidad: "critical",
		});
	});

	test("un login sin eid queda como error crítico, no como ok", async () => {
		const eventos: WialonIntentoEvento[] = [];
		const client = new WialonClient(
			{ token: "tok" },
			async () => new Response(JSON.stringify({}), { status: 200 }),
			(e) => eventos.push(e),
		);

		await expect(client.login()).rejects.toThrow(/eid/);
		expect(eventos.map((e) => e.resultado)).toEqual(["error"]);
		expect(eventos[0]).toMatchObject({
			errorCode: "WIALON_INVALID_RESPONSE",
			severidad: "critical",
		});
	});

	test("core/search_items sin items queda como error, no como ok", async () => {
		const eventos: WialonIntentoEvento[] = [];
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			return new Response(JSON.stringify({ totalItemsCount: 0 }), {
				status: 200,
			});
		};
		const client = new WialonClient({ token: "tok" }, fetchMock, (e) =>
			eventos.push(e),
		);

		await expect(client.searchUnits({ flags: 1 })).rejects.toThrow(/items/);
		const search = eventos.filter((e) => e.operacion === "core/search_items");
		expect(search.map((e) => e.resultado)).toEqual(["error"]);
		expect(search[0]?.errorCode).toBe("WIALON_INVALID_RESPONSE");
	});

	test("una escritura con falla transitoria queda como incierto", async () => {
		const eventos: WialonIntentoEvento[] = [];
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			throw new DOMException("aborted", "AbortError");
		};
		const client = new WialonClient(
			{ token: "tok", timeoutMs: 5 },
			fetchMock,
			(e) => eventos.push(e),
		);

		await expect(
			client.createLocatorLink({ unitId: 1, durationSeconds: 60 }),
		).rejects.toThrow(WialonClientError);
		const update = eventos.filter((e) => e.operacion === "token/update");
		expect(update.map((e) => e.resultado)).toEqual(["incierto"]);
	});

	test("una sesión vencida queda como reintentado y no cuenta como fallo", async () => {
		const eventos: WialonIntentoEvento[] = [];
		let llamadasSearch = 0;
		const fetchMock: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			llamadasSearch++;
			if (llamadasSearch === 1) {
				return new Response(JSON.stringify({ error: 1 }), { status: 200 });
			}
			return new Response(JSON.stringify({ items: [], totalItemsCount: 0 }), {
				status: 200,
			});
		};
		const client = new WialonClient({ token: "tok" }, fetchMock, (e) =>
			eventos.push(e),
		);

		await client.searchUnits({ flags: 1 });
		const search = eventos.filter((e) => e.operacion === "core/search_items");
		expect(search.map((e) => e.resultado)).toEqual(["reintentado", "ok"]);
		expect(search[0]?.errorCode).toBe("WIALON_INVALID_SESSION");
		expect(
			esIntentoExitoso({
				resultado: "reintentado",
				errorCode: "WIALON_INVALID_SESSION",
			}),
		).toBe(true);
	});
});

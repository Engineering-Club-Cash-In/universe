import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { WialonClient } from "./wialon-client";
import {
	createLocatorLinkInputSchema,
	getUnitDetailInputSchema,
	getUnitsStatusInputSchema,
	searchUnitsInputSchema,
	WialonClientError,
	type WialonFetch,
} from "./wialon-types";

describe("WialonClient", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Aislamiento total en tests: evitar que process.env.WIALON_TOKEN del entorno local afecte las aserciones
		delete process.env.WIALON_TOKEN;
	});

	afterAll(() => {
		process.env.WIALON_TOKEN = originalEnv.WIALON_TOKEN;
	});

	test("lanza error WIALON_AUTH_REQUIRED si no hay token configurado", async () => {
		const client = new WialonClient(
			{ token: undefined },
			async () => new Response("{}"),
		);

		await expect(client.login()).rejects.toThrow(WialonClientError);
		try {
			await client.login();
		} catch (err) {
			expect((err as WialonClientError).code).toBe("WIALON_AUTH_REQUIRED");
		}
	});

	test("login con token llama a token/login y cachea el sid (eid)", async () => {
		const calls: { url: string; body: string }[] = [];
		const mockFetch: WialonFetch = async (url, init) => {
			calls.push({
				url: String(url),
				body: String(init?.body || ""),
			});
			return new Response(
				JSON.stringify({
					eid: "test-sid-12345",
					user: { id: 999, nm: "Andre IT" },
				}),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "mock-token-abc" }, mockFetch);

		const sid = await client.login();
		expect(sid).toBe("test-sid-12345");
		expect(calls.length).toBe(1);
		expect(calls[0].body).toContain("svc=token%2Flogin");
		expect(calls[0].body).toContain("mock-token-abc");

		// Segunda llamada: debe usar caché en memoria y no hacer otro fetch
		const sid2 = await client.login();
		expect(sid2).toBe("test-sid-12345");
		expect(calls.length).toBe(1);
	});

	test("searchUnits envía spec y sid correctos", async () => {
		let capturedBody = "";
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-activa" }), {
					status: 200,
				});
			}
			capturedBody = bodyStr;
			return new Response(
				JSON.stringify({
					totalItemsCount: 1,
					indexFrom: 0,
					indexTo: 0,
					items: [
						{
							id: 28554757,
							nm: "Camion-01",
							cls: 2,
						},
					],
				}),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-xyz" }, mockFetch);
		const res = await client.searchUnits({ filterName: "Camion" });

		expect(res.totalItemsCount).toBe(1);
		expect(res.items[0].nm).toBe("Camion-01");
		expect(capturedBody).toContain("svc=core%2Fsearch_items");
		expect(capturedBody).toContain("sid=sid-activa");
		expect(capturedBody).toContain("*Camion*");
	});

	test("getUnitsStatus formatea telemetría y sensores (Encendido/Apagado)", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-status" }), {
					status: 200,
				});
			}
			return new Response(
				JSON.stringify([
					{
						i: 20060450,
						mileage: {
							value: 154200.5,
							format: { value: "154200.50 km" },
						},
						engine_hours: {
							value: 1250.2,
							format: { value: "1250.20 h" },
						},
						pos: {
							y: 14.6103,
							x: -90.5158,
							s: { value: 45.5, format: { value: "45.5 km/h" } },
						},
						sensors: {
							"1": {
								value: 1,
								format: { value: "Encendido" },
							},
						},
					},
				]),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-xyz" }, mockFetch);
		const summary = await client.getUnitsStatus([20060450]);

		expect(summary.length).toBe(1);
		expect(summary[0].unitId).toBe(20060450);
		expect(summary[0].mileageFormatted).toBe("154200.50 km");
		expect(summary[0].engineHoursFormatted).toBe("1250.20 h");
		expect(summary[0].latitude).toBe(14.6103);
		expect(summary[0].longitude).toBe(-90.5158);
		expect(summary[0].speedKmh).toBe(45.5);
		expect(summary[0].isIgnitionOn).toBe(true);
		expect(summary[0].sensorsFormatted?.["1"]).toBe("Encendido");
	});

	test("createLocatorLink construye la URL completa con el hash devuelto", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-locator" }), {
					status: 200,
				});
			}
			return new Response(
				JSON.stringify({
					h: "HASH_LOCALIZADOR_ABC123",
					app: "locator",
					dur: 86400,
					items: [28554757],
				}),
				{ status: 200 },
			);
		};

		const client = new WialonClient(
			{
				token: "tok-xyz",
				locatorBaseUrl: "https://gps.lalegion.gt/locator/index.html",
			},
			mockFetch,
		);

		const result = await client.createLocatorLink({
			unitId: 28554757,
			durationSeconds: 86400,
		});

		expect(result.hash).toBe("HASH_LOCALIZADOR_ABC123");
		expect(result.url).toBe(
			"https://gps.lalegion.gt/locator/index.html?t=HASH_LOCALIZADOR_ABC123",
		);
		expect(result.unitId).toBe(28554757);
		expect(result.durationSeconds).toBe(86400);
	});

	test("auto-renueva sesión transparentemente ante error 1 (invalid session)", async () => {
		let attempt = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				attempt++;
				return new Response(JSON.stringify({ eid: `sid-intento-${attempt}` }), {
					status: 200,
				});
			}

			// La primera vez que se consulta la unidad, Wialon dice que la sesión expiró (error: 1)
			if (bodyStr.includes("sid=sid-intento-1")) {
				return new Response(JSON.stringify({ error: 1 }), { status: 200 });
			}

			// En el segundo intento con la nueva sesión, responde exitoso
			return new Response(
				JSON.stringify({
					item: { id: 28233911, nm: "Unidad-OK" },
					flags: 1025,
				}),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-xyz" }, mockFetch);
		const detail = await client.getUnitDetail(28233911);

		expect(detail.item.id).toBe(28233911);
		expect(detail.item.nm).toBe("Unidad-OK");
		// Debe haber intentado el login 2 veces (inicial + renovación)
		expect(attempt).toBe(2);
	});

	test("deleteLocatorLink envía callMode delete a token/update", async () => {
		let capturedBody = "";
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-del" }), {
					status: 200,
				});
			}
			capturedBody = bodyStr;
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-xyz" }, mockFetch);
		const res = await client.deleteLocatorLink("HASH_A_ELIMINAR");

		expect(res.success).toBe(true);
		expect(capturedBody).toContain("svc=token%2Fupdate");
		expect(capturedBody).toContain("HASH_A_ELIMINAR");
	});

	test("lanza WialonClientError ante códigos de error de la API (ej: error 7)", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-err" }), {
					status: 200,
				});
			}
			return new Response(JSON.stringify({ error: 7 }), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-xyz" }, mockFetch);

		await expect(client.getUnitDetail(1234)).rejects.toThrow(WialonClientError);
		try {
			await client.getUnitDetail(1234);
		} catch (err) {
			const wError = err as WialonClientError;
			expect(wError.code).toBe("WIALON_API_ERROR");
			expect(wError.wialonErrorCode).toBe(7);
			expect(wError.message).toContain("Acceso denegado");
		}
	});

	test("getUnitsStatus no genera falsos positivos con subcadenas como 'conexión' o 'contacto'", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-mock" }), {
					status: 200,
				});
			}
			return new Response(
				JSON.stringify([
					{
						i: 99999,
						sensors: {
							"1": { value: 1, format: { value: "Sin conexión" } },
							"2": { value: 2, format: { value: "Contacto primario" } },
							"3": { value: 50, format: { value: "15 Gallons" } },
						},
					},
				]),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const res = await client.getUnitsStatus([99999]);
		expect(res[0].isIgnitionOn).toBeUndefined();
	});

	test("createLocatorLink rechaza duraciones superiores a 30 días", async () => {
		const client = new WialonClient(
			{ token: "tok-test" },
			async () => new Response(JSON.stringify({ h: "hash" }), { status: 200 }),
		);

		await expect(
			client.createLocatorLink({
				unitId: 100,
				durationSeconds: 31 * 86400, // 31 días > límite de 30 días
			}),
		).rejects.toThrow("30 días");
	});

	test("executeWithSession reintenta sólo una vez ante error de sesión y no entra en bucle", async () => {
		let attempts = 0;
		const mockFetch: WialonFetch = async () => {
			attempts++;
			// Siempre devuelve error 1
			return new Response(JSON.stringify({ error: 1 }), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await expect(client.getUnitDetail(1234)).rejects.toThrow(WialonClientError);
		// Intento 1 (login inicial falla con error 1)
		expect(attempts).toBe(1);
	});

	test("executeWithSession NO reintenta ante error 7 de permisos", async () => {
		let attempts = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			attempts++;
			return new Response(JSON.stringify({ error: 7 }), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await expect(client.getUnitDetail(1234)).rejects.toThrow(WialonClientError);
		// Se intentó exactamente 1 vez sin reintentos innecesarios
		expect(attempts).toBe(1);
	});

	test("getUnitsStatus lanza WIALON_INVALID_RESPONSE si la respuesta de Wialon no es un arreglo", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			// Wialon devuelve un objeto degradado en vez de arreglo
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await expect(client.getUnitsStatus([123])).rejects.toThrow(
			"se esperaba un arreglo en 'unit/calc_last'",
		);
	});

	test("searchUnits usa to: 0xffffffff por defecto para devolver la flota completa", async () => {
		let capturedParams = "";
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			capturedParams = bodyStr;
			return new Response(
				JSON.stringify({
					totalItemsCount: 0,
					indexFrom: 0,
					indexTo: 0,
					items: [],
				}),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await client.searchUnits();
		expect(capturedParams).toContain("%22to%22%3A4294967295");
	});

	test("getUnitsStatus evalúa sensores de ignición ignorando sensores genéricos con valor 0 o 1", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			return new Response(
				JSON.stringify([
					{
						i: 111,
						sensors: {
							"2": { value: 0, format: { value: "0" } }, // sensor de combustible/odómetro en 0
							"10": { value: 1, format: { value: "Encendido" } }, // sensor de ignición real
						},
					},
					{
						i: 222,
						sensors: {
							"1": { value: 0, format: { value: "APAGADO (Apagado)" } },
							"2": { value: 1, format: { value: "1" } },
						},
					},
					{
						i: 333,
						sensors: {
							"1": { value: 1, format: { value: "ENCENDIDO (Encendido)" } },
						},
					},
					{
						i: 444,
						sensors: {
							"1": { value: 0, format: { value: "0 km" } },
						},
					},
				]),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const status = await client.getUnitsStatus([111, 222, 333, 444]);
		expect(status[0].isIgnitionOn).toBe(true); // El sensor "2" con "0" no debe enmascarar "Encendido"
		expect(status[1].isIgnitionOn).toBe(false); // "APAGADO (Apagado)" debe detectarse como false
		expect(status[2].isIgnitionOn).toBe(true); // "ENCENDIDO (Encendido)" debe detectarse como true
		expect(status[3].isIgnitionOn).toBeUndefined(); // "0 km" no debe detectarse como ignición
	});

	test("getUnitsStatus resuelve correctamente los casos de prueba del reviewer (Conectado, Alarma desconectado, GPS off) mediante identidad de sensor y fallback estricto", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			// unit 101: sensor 2 "Conectado", sensor 10 "Apagado" (ignición real apagada)
			// unit 102: sensor 1 "Alarma desconectado", sensor 10 "Encendido" (ignición real encendida)
			// unit 103: sensor 1 "GPS off", sensor 10 "Encendido" (ignición real encendida)
			return new Response(
				JSON.stringify([
					{
						i: 101,
						sensors: {
							"2": { value: 1, format: { value: "Conectado" } },
							"10": { value: 0, format: { value: "Apagado" } },
						},
					},
					{
						i: 102,
						sensors: {
							"1": { value: 0, format: { value: "Alarma desconectado" } },
							"10": { value: 1, format: { value: "Encendido" } },
						},
					},
					{
						i: 103,
						sensors: {
							"1": { value: 0, format: { value: "GPS off" } },
							"10": { value: 1, format: { value: "Encendido" } },
						},
					},
				]),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);

		// Caso A: Con metadatos de sensor cargados explícitamente (identidad 'engine operation' en id 10)
		client.setUnitIgnitionSensor(101, "10");
		client.setUnitIgnitionSensor(102, "10");
		client.setUnitIgnitionSensor(103, "10");

		const statusWithMeta = await client.getUnitsStatus([101, 102, 103]);
		expect(statusWithMeta[0].isIgnitionOn).toBe(false); // 101: id 10 "Apagado" gana sobre id 2 "Conectado"
		expect(statusWithMeta[1].isIgnitionOn).toBe(true); // 102: id 10 "Encendido" gana sobre id 1 "Alarma desconectado"
		expect(statusWithMeta[2].isIgnitionOn).toBe(true); // 103: id 10 "Encendido" gana sobre id 1 "GPS off"

		// Caso B: Fallback sin metadatos en caché (los sensores de alarma/GPS no hacen match con regex de ignición)
		client.clearSession(); // Limpia la caché de sensores
		const statusFallback = await client.getUnitsStatus([101, 102, 103]);
		expect(statusFallback[0].isIgnitionOn).toBe(false); // "Conectado" ignorado, "Apagado" detectado
		expect(statusFallback[1].isIgnitionOn).toBe(true); // "Alarma desconectado" ignorado, "Encendido" detectado
		expect(statusFallback[2].isIgnitionOn).toBe(true); // "GPS off" ignorado, "Encendido" detectado
	});

	test("login concurrente comparte la misma promesa en vuelo y no dispara múltiples peticiones a Wialon", async () => {
		let loginCallCount = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				loginCallCount++;
				await new Promise((r) => setTimeout(r, 50));
				return new Response(JSON.stringify({ eid: "sid-shared-123" }), {
					status: 200,
				});
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const results = await Promise.all([
			client.login(),
			client.login(),
			client.login(),
			client.login(),
			client.login(),
		]);

		expect(loginCallCount).toBe(1);
		expect(results).toEqual([
			"sid-shared-123",
			"sid-shared-123",
			"sid-shared-123",
			"sid-shared-123",
			"sid-shared-123",
		]);
	});

	test("searchUnits lanza WIALON_INVALID_RESPONSE si la respuesta no contiene items válidos", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			return new Response(JSON.stringify([]), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await expect(client.searchUnits()).rejects.toThrow(WialonClientError);
		try {
			await client.searchUnits();
		} catch (e) {
			expect((e as WialonClientError).code).toBe("WIALON_INVALID_RESPONSE");
		}
	});

	test("getUnitDetail lanza WIALON_INVALID_RESPONSE si la respuesta no contiene item válido", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			return new Response(JSON.stringify({ error: undefined }), {
				status: 200,
			});
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await expect(client.getUnitDetail(123)).rejects.toThrow(WialonClientError);
		try {
			await client.getUnitDetail(123);
		} catch (e) {
			expect((e as WialonClientError).code).toBe("WIALON_INVALID_RESPONSE");
		}
	});

	test("lanza WIALON_INVALID_RESPONSE cuando la respuesta upstream no es JSON válido (ej. HTML 502)", async () => {
		const mockFetch: WialonFetch = async () => {
			return new Response("<html><body>502 Bad Gateway</body></html>", {
				status: 200,
				headers: { "Content-Type": "text/html" },
			});
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await expect(client.login()).rejects.toThrow(WialonClientError);
		try {
			await client.login();
		} catch (e) {
			expect((e as WialonClientError).code).toBe("WIALON_INVALID_RESPONSE");
		}
	});

	test("searchUnits sanitiza asteriscos ingresados por el usuario", async () => {
		let capturedParams = "";
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			capturedParams = bodyStr;
			return new Response(JSON.stringify({ totalItemsCount: 0, items: [] }), {
				status: 200,
			});
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await client.searchUnits({ filterName: "***" });
		expect(capturedParams).toContain("%22propValueMask%22%3A%22*%22");

		await client.searchUnits({ filterName: "*420?CDP*" });
		expect(capturedParams).toContain("%22propValueMask%22%3A%22*420CDP*%22");
	});

	test("timeoutMs en getWialonConfig maneja 0 o valores inválidos con el fallback por defecto", () => {
		const clientWithZero = new WialonClient({ timeoutMs: 0 });
		// @ts-expect-error Acceso a config privada para verificación
		expect(clientWithZero.config.timeoutMs).toBe(15000);

		const clientWithNegative = new WialonClient({ timeoutMs: -100 });
		// @ts-expect-error Acceso a config privada para verificación
		expect(clientWithNegative.config.timeoutMs).toBe(15000);
	});

	test("clearSession limpia sessionCache pero preserva ignitionSensorCache", () => {
		const client = new WialonClient({ token: "tok-test" });
		client.setUnitIgnitionSensor(101, "10");
		// @ts-expect-error Acceso a sesión interna para verificación
		client.sessionCache = { eid: "sid-test", expiresAt: Date.now() + 10000 };

		client.clearSession();
		expect(client.getCachedSession()).toBeNull();

		// @ts-expect-error Acceso a ignitionSensorCache para verificación
		expect(client.ignitionSensorCache.get(101)?.sensorId).toBe("10");

		client.clearSensorCache();
		// @ts-expect-error Acceso a ignitionSensorCache para verificación
		expect(client.ignitionSensorCache.get(101)).toBeUndefined();
	});

	test("login(true) fuerza una nueva autenticación y no retorna sesión en caché", async () => {
		let loginCalls = 0;
		const mockFetch: WialonFetch = async () => {
			loginCalls++;
			return new Response(JSON.stringify({ eid: `sid-${loginCalls}` }), {
				status: 200,
			});
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const sid1 = await client.login(false);
		expect(sid1).toBe("sid-1");
		expect(loginCalls).toBe(1);

		// Con force = false, devuelve la sesión en memoria sin llamar a Wialon
		const sidCached = await client.login(false);
		expect(sidCached).toBe("sid-1");
		expect(loginCalls).toBe(1);

		// Con force = true, invalida la caché y fuerza una nueva llamada a Wialon
		const sidForced = await client.login(true);
		expect(sidForced).toBe("sid-2");
		expect(loginCalls).toBe(2);
	});

	test("getUnitsStatus implementa negative caching para unidades sin metadatos o inexistentes", async () => {
		let searchItemsCalls = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				searchItemsCalls++;
				// Devuelve arreglo vacío simulando que la unidad 555 no existe o no tiene sensores
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(JSON.stringify([{ i: 555, sensors: {} }]), {
					status: 200,
				});
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);

		// Llamada 1: unidad 555 no está en caché -> consulta core/search_items
		await client.getUnitsStatus([555]);
		expect(searchItemsCalls).toBe(1);

		// Llamadas 2 y 3: negative cache debe recordar que 555 no tiene sensores -> NO vuelve a consultar core/search_items
		await client.getUnitsStatus([555]);
		await client.getUnitsStatus([555]);
		expect(searchItemsCalls).toBe(1);
	});

	test("getUnitsStatus solo retorna las unidades explícitamente solicitadas filtrando respuestas ajenas de Wialon", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				// Simula que Wialon devuelve unidades no solicitadas (ej. 999) además de las pedidas
				return new Response(
					JSON.stringify([
						{ i: 101, sensors: {} },
						{ i: 999, sensors: {} },
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const status = await client.getUnitsStatus([101, 102]);
		expect(status.length).toBe(1);
		expect(status[0].unitId).toBe(101);
	});

	test("getUnitsStatus en fallback heurístico prioriza encendido si coexisten sensores con 'encendido' y 'apagado'", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(
					JSON.stringify([
						{
							i: 201,
							sensors: {
								"1": { value: 0, format: { value: "Motor apagado" } },
								"2": { value: 1, format: { value: "Motor encendido" } },
							},
						},
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		// Sin metadatos en caché para forzar el fallback heurístico
		const status = await client.getUnitsStatus([201]);
		expect(status[0].isIgnitionOn).toBe(true);
	});

	test("login(true) no permite que el finally de una promesa previa pise una nueva en vuelo", async () => {
		let resolveFirst!: (val: Response) => void;
		let resolveSecond!: (val: Response) => void;
		let callCount = 0;

		const mockFetch: WialonFetch = async () => {
			callCount++;
			if (callCount === 1) {
				return new Promise<Response>((resolve) => {
					resolveFirst = resolve;
				});
			}
			return new Promise<Response>((resolve) => {
				resolveSecond = resolve;
			});
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);

		// Disparamos la primera llamada (lenta)
		const promise1 = client.login();

		// Forzamos un login concurrentemente
		const forcePromise = client.login(true);

		// Resolvemos la primera
		resolveFirst(
			new Response(JSON.stringify({ eid: "sid-1" }), { status: 200 }),
		);
		await promise1;

		// En este punto, promise1 terminó su finally.
		// Verificamos que una llamada concurrente posterior comparta forcePromise y no inicie una tercera petición
		const concurrentCaller = client.login();

		resolveSecond(
			new Response(JSON.stringify({ eid: "sid-2" }), { status: 200 }),
		);
		const [resForce, resConcurrent] = await Promise.all([
			forcePromise,
			concurrentCaller,
		]);

		expect(resForce).toBe("sid-2");
		expect(resConcurrent).toBe("sid-2");
		expect(callCount).toBe(2);
	});

	test("getUnitsStatus usa propValueMask con CSV para múltiples IDs", async () => {
		let capturedMask = "";
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-csv" }), {
					status: 200,
				});
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				const paramsObj = JSON.parse(
					new URLSearchParams(bodyStr).get("params") || "{}",
				);
				capturedMask = paramsObj?.spec?.propValueMask || "";
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(JSON.stringify([]), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await client.getUnitsStatus([101, 102, 103]);
		expect(capturedMask).toBe("101,102,103");
	});

	test("login valida token inmediatamente antes de cualquier promesa en vuelo", async () => {
		const client = new WialonClient({ token: undefined });
		await expect(client.login(false)).rejects.toThrow(WialonClientError);
		await expect(client.login(true)).rejects.toThrow(WialonClientError);
	});

	test("searchUnits asigna TTL negativo (5 min) si la unidad no tiene sensor de ignición", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), {
					status: 200,
				});
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(
					JSON.stringify({
						items: [
							{
								id: 888,
								sens: {
									"1": { id: 1, n: "Nivel Combustible", t: "fuel level" },
								},
							},
						],
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await client.searchUnits();
		const cacheEntry = (
			client as unknown as {
				ignitionSensorCache: Map<
					number,
					{ sensorId: string | null; expiresAt: number }
				>;
			}
		).ignitionSensorCache.get(888);
		expect(cacheEntry).toBeDefined();
		expect(cacheEntry?.sensorId).toBeNull();
		const diffMs = (cacheEntry?.expiresAt ?? 0) - Date.now();
		expect(diffMs).toBeLessThanOrEqual(5 * 60 * 1000);
		expect(diffMs).toBeGreaterThan(4 * 60 * 1000);
	});

	test("searchUnitsInputSchema rechaza to menor que from", () => {
		const res = searchUnitsInputSchema.safeParse({ from: 100, to: 5 });
		expect(res.success).toBe(false);
		if (!res.success) {
			expect(res.error.issues[0].message).toContain("mayor o igual");
		}
	});

	test("getUnitsStatusInputSchema rechaza más de 100 unidades", () => {
		const over100 = Array.from({ length: 101 }, (_, i) => i + 1);
		const res = getUnitsStatusInputSchema.safeParse({ unitIds: over100 });
		expect(res.success).toBe(false);
		if (!res.success) {
			expect(res.error.issues[0].message).toContain("100 unidades");
		}
	});

	test("createLocatorLinkInputSchema rechaza notas superiores a 200 caracteres", () => {
		const longNote = "a".repeat(201);
		const res = createLocatorLinkInputSchema.safeParse({
			unitId: 101,
			note: longNote,
		});
		expect(res.success).toBe(false);
		if (!res.success) {
			expect(res.error.issues[0].message).toContain("200 caracteres");
		}
	});

	test("setSensorCache purga elementos expirados cuando alcanza el límite de tamaño", () => {
		const client = new WialonClient({ token: "tok-test" });
		const cache = client as unknown as {
			ignitionSensorCache: Map<
				number,
				{ sensorId: string | null; expiresAt: number }
			>;
			setSensorCache: (
				id: number,
				sensorId: string | null,
				expiresAt: number,
			) => void;
		};

		// Poblamos hasta 1000 entradas, la mitad expiradas
		const now = Date.now();
		for (let i = 1; i <= 500; i++) {
			cache.setSensorCache(i, `sensor-${i}`, now - 1000); // ya expirado
		}
		for (let i = 501; i <= 1000; i++) {
			cache.setSensorCache(i, `sensor-${i}`, now + 100000); // activo
		}
		expect(cache.ignitionSensorCache.size).toBe(1000);

		// Al insertar la 1001, debe purgar los 500 expirados y quedar en 501
		cache.setSensorCache(1001, "sensor-1001", now + 100000);
		expect(cache.ignitionSensorCache.size).toBe(501);
		expect(cache.ignitionSensorCache.has(1)).toBe(false);
		expect(cache.ignitionSensorCache.has(1001)).toBe(true);
	});

	test("searchUnitsInputSchema rechaza flags arbitrarios fuera de la whitelist", () => {
		const res = searchUnitsInputSchema.safeParse({ flags: 0xffffffff });
		expect(res.success).toBe(false);

		const validDefault = searchUnitsInputSchema.safeParse({});
		expect(validDefault.success).toBe(true);
		if (validDefault.success) {
			expect(validDefault.data.flags).toBe(8392705);
		}
	});

	test("getUnitDetailInputSchema rechaza flags arbitrarios fuera de la whitelist", () => {
		const res = getUnitDetailInputSchema.safeParse({
			unitId: 1,
			flags: 0xffffffff,
		});
		expect(res.success).toBe(false);

		const validDefault = getUnitDetailInputSchema.safeParse({ unitId: 1 });
		expect(validDefault.success).toBe(true);
		if (validDefault.success) {
			expect(validDefault.data.flags).toBe(1025);
		}
	});

	test("getUnitsStatus divide missingIds en lotes de 100 para no exceder límites de red", async () => {
		const batchesSent: string[] = [];
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-chunk" }), {
					status: 200,
				});
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				const paramsObj = JSON.parse(
					new URLSearchParams(bodyStr).get("params") || "{}",
				);
				batchesSent.push(paramsObj?.spec?.propValueMask || "");
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(JSON.stringify([]), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		// 150 IDs simulando llamada interna de backend
		const ids150 = Array.from({ length: 150 }, (_, i) => i + 1);
		await client.getUnitsStatus(ids150);

		expect(batchesSent.length).toBe(2);
		expect(batchesSent[0].split(",").length).toBe(100);
		expect(batchesSent[1].split(",").length).toBe(50);
	});

	test("getUnitsStatus con 150 IDs realiza 2 llamadas a unit/calc_last, preserva orden solicitado y deduplica", async () => {
		const calcBatches: number[][] = [];
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-chunk-calc" }), {
					status: 200,
				});
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				const paramsObj = JSON.parse(
					new URLSearchParams(bodyStr).get("params") || "{}",
				);
				const itemIds = (paramsObj?.itemIds || []) as number[];
				calcBatches.push(itemIds);
				// Simular respuesta de Wialon para estos IDs en cualquier orden
				const batchResult = itemIds.map((id) => ({
					i: id,
					pos: { x: -89.2, y: 13.7, s: 45 },
				}));
				return new Response(JSON.stringify(batchResult), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);

		// Generamos 150 IDs en orden inverso: 150, 149, ..., 1
		// Añadimos duplicados intencionales al final: [150, 149, 100]
		const ids150Desc = Array.from({ length: 150 }, (_, i) => 150 - i);
		const requestedWithDuplicates = [...ids150Desc, 150, 149, 100];

		const results = await client.getUnitsStatus(requestedWithDuplicates);

		// 1. Debe haber realizado exactamente 2 llamadas a unit/calc_last (100 + 50)
		expect(calcBatches.length).toBe(2);
		expect(calcBatches[0].length).toBe(100);
		expect(calcBatches[1].length).toBe(50);

		// 2. Debe devolver exactamente 150 resultados (deduplicados)
		expect(results.length).toBe(150);

		// 3. Debe preservar el orden posicional exacto solicitado (150, 149, ..., 1)
		const returnedIds = results.map((r) => r.unitId);
		expect(returnedIds).toEqual(ids150Desc);
	});

	test("getUnitsStatus propaga error (fail-fast) si el segundo lote de unit/calc_last falla", async () => {
		let callCount = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-fail" }), {
					status: 200,
				});
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				callCount++;
				if (callCount === 1) {
					return new Response(
						JSON.stringify([{ i: 1, pos: { x: 0, y: 0, s: 0 } }]),
						{ status: 200 },
					);
				}
				// Segundo lote falla con error upstream
				return new Response(JSON.stringify({ error: 4 }), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const ids150 = Array.from({ length: 150 }, (_, i) => i + 1);

		await expect(client.getUnitsStatus(ids150)).rejects.toThrow(
			WialonClientError,
		);
	});
});

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
	extraerFechasUnidad,
	extraerNucleoDeNombreUnidad,
	extraerNucleoPlaca,
	extraerUltimaSenal,
	findIgnitionSensorId,
	matchUnidadPorPlaca,
	resolveWialonEnvironment,
	WialonClient,
} from "./wialon-client";
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
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(JSON.stringify({ items: [] }), {
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
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
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
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
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
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
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

	test("getUnitsStatus usa propValueMask con CSV para múltiples IDs con semántica OR", async () => {
		let capturedSpec: {
			propName?: string;
			propValueMask?: string;
			propType?: string;
			or_logic?: number;
		} = {};
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
				capturedSpec = paramsObj?.spec || {};
				return new Response(JSON.stringify({ items: [] }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(JSON.stringify([]), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await client.getUnitsStatus([101, 102, 103]);
		expect(capturedSpec.propName).toBe("sys_id,sys_id,sys_id");
		expect(capturedSpec.propValueMask).toBe("101,102,103");
		expect(capturedSpec.propType).toBe("property,property,property");
		expect(capturedSpec.or_logic).toBe(1);
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
			expect(validDefault.data.flags).toBe(8392707);
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
			expect(validDefault.data.flags).toBe(5123);
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

	test("getUnitsStatus preserva estado desconocido si el sensor de ignición identificado por metadatos está ausente de calc_last", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			// La unidad 201 tiene sensor de ignición identificado en metadata como "10".
			// Sin embargo, en calc_last el sensor "10" no viene en la lectura (stale/incompleto).
			// Solo viene sensor "2" (ej. puerta/alarma) con valor "Encendido".
			return new Response(
				JSON.stringify([
					{
						i: 201,
						sensors: {
							"2": { value: 1, format: { value: "Encendido" } },
						},
					},
				]),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		client.setUnitIgnitionSensor(201, "10");

		const status = await client.getUnitsStatus([201]);
		// Debe preservar isIgnitionOn como undefined en lugar de clasificarlo como true por el sensor "2"
		expect(status[0].isIgnitionOn).toBeUndefined();
	});

	test("checkHealth valida activamente la sesión aguas arriba y auto-renueva si la sesión upstream expiró", async () => {
		let searchCallCount = 0;
		let loginCallCount = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				loginCallCount++;
				return new Response(
					JSON.stringify({
						eid: `sid-health-${loginCallCount}`,
						user: { id: 500, nm: "Fleet User" },
					}),
					{ status: 200 },
				);
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				searchCallCount++;
				if (searchCallCount === 1) {
					// Simula que en Wialon la sesión anterior ya fue invalidada (error: 1)
					return new Response(JSON.stringify({ error: 1 }), { status: 200 });
				}
				return new Response(
					JSON.stringify({ totalItemsCount: 10, items: [] }),
					{
						status: 200,
					},
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-health" }, mockFetch);

		// Ejecutar primer login para poblar la sesión en caché
		await client.login();
		expect(loginCallCount).toBe(1);

		// checkHealth con sesión en caché: debe hacer llamada upstream para validar el SID.
		// Al recibir error 1 de Wialon, debe auto-renovar y devolver status connected con el nuevo SID.
		const health = await client.checkHealth();
		expect(health.status).toBe("connected");
		expect(health.sid).toBe("sid-health-2");
		expect(health.user?.nm).toBe("Fleet User");
		expect(health.unitCount).toBe(10);
		expect(loginCallCount).toBe(2);
		expect(searchCallCount).toBe(2);
	});

	test("checkHealth propaga error si Wialon rechaza la conexión con error de API", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ error: 7 }), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-invalido" }, mockFetch);
		await expect(client.checkHealth()).rejects.toThrow(WialonClientError);
	});

	test("checkHealth lanza WIALON_INVALID_RESPONSE si core/search_items devuelve respuesta malformada sin items", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(
					JSON.stringify({ eid: "sid-ok", user: { id: 1, nm: "Admin" } }),
					{ status: 200 },
				);
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				// Respuesta 200 con JSON malformado ({}) durante degradación upstream
				return new Response(JSON.stringify({}), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		try {
			await client.checkHealth();
			expect.unreachable(
				"checkHealth debió lanzar error ante respuesta malformada",
			);
		} catch (error) {
			expect(error).toBeInstanceOf(WialonClientError);
			expect((error as WialonClientError).code).toBe("WIALON_INVALID_RESPONSE");
		}
	});

	test("findIgnitionSensorId prioriza prp.monitoring_sensor_id cuando el sensor tiene nombre/tipo genérico", () => {
		const genericSensors = {
			"5": { id: 5, n: "Digital 1", t: "custom" },
			"12": { id: 12, n: "Auxiliar", t: "generic" },
		};

		// Sin prp.monitoring_sensor_id, no se detecta ignición por nombre genérico
		expect(findIgnitionSensorId(genericSensors)).toBeNull();

		// Con prp.monitoring_sensor_id configurado en Wialon, debe retornar el sensor configurado
		expect(
			findIgnitionSensorId(genericSensors, { monitoring_sensor_id: 12 }),
		).toBe("12");
		expect(
			findIgnitionSensorId(genericSensors, { monitoring_sensor_id: "5" }),
		).toBe("5");
	});

	test("getUnitsStatus carga y honra prp.monitoring_sensor_id evitando falsos positivos de sensores secundarios", async () => {
		let capturedSearchFlags: number | undefined;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				const paramsStr = new URLSearchParams(bodyStr).get("params");
				if (paramsStr) {
					try {
						const parsed = JSON.parse(paramsStr);
						capturedSearchFlags = parsed.flags;
					} catch {
						// Ignora si no parsea JSON
					}
				}
				return new Response(
					JSON.stringify({
						items: [
							{
								id: 501,
								prp: { monitoring_sensor_id: "8" },
								sens: {
									"2": { id: 2, n: "Puerta trasera", t: "custom" },
									"8": { id: 8, n: "Input 1", t: "custom" },
								},
							},
						],
					}),
					{ status: 200 },
				);
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(
					JSON.stringify([
						{
							i: 501,
							sensors: {
								// El sensor 2 de puerta reporta "Encendido"
								"2": { value: 1, format: { value: "Encendido" } },
								// El sensor 8 configurado como monitoring_sensor_id reporta "Apagado"
								"8": { value: 0, format: { value: "Apagado" } },
							},
						},
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const status = await client.getUnitsStatus([501]);

		// Debe usar flag 4099 (base 1 | custom properties 2 | sensors 4096)
		expect(capturedSearchFlags).toBe(4099);
		expect(status.length).toBe(1);
		// Debe honrar el sensor 8 ("Apagado") en lugar del sensor 2 ("Encendido")
		expect(status[0].isIgnitionOn).toBe(false);
	});

	test("findIgnitionSensorId degrada limpiamente cuando monitoring_sensor_id es 0, vacío o inexistente en sens", () => {
		const sens = {
			"1": { id: 1, n: "Motor", t: "engine operation" },
			"2": { id: 2, n: "Alarma", t: "custom" },
		};

		// "0" o 0 o "" deben ser ignorados y pasar a tipo "engine operation"
		expect(findIgnitionSensorId(sens, { monitoring_sensor_id: "0" })).toBe("1");
		expect(findIgnitionSensorId(sens, { monitoring_sensor_id: 0 })).toBe("1");
		expect(findIgnitionSensorId(sens, { monitoring_sensor_id: "" })).toBe("1");

		// Si apunta a un ID inexistente en sens (ej. "99"), debe degradar a engine operation
		expect(findIgnitionSensorId(sens, { monitoring_sensor_id: "99" })).toBe(
			"1",
		);

		// Si prp es undefined, degrada normalmente
		expect(findIgnitionSensorId(sens, undefined)).toBe("1");
	});

	test("esquemas de flags aceptan todos los valores válidos de la whitelist incluyendo 4099 y variantes", () => {
		const searchFlags = [
			1, 4097, 4099, 4105, 8388609, 8392705, 8392707, 8392713,
		];
		for (const f of searchFlags) {
			const res = searchUnitsInputSchema.safeParse({ flags: f });
			expect(res.success).toBe(true);
		}

		const detailFlags = [1, 1025, 1027, 1033, 4097, 4099, 4105, 5123];
		for (const f of detailFlags) {
			const res = getUnitDetailInputSchema.safeParse({ unitId: 10, flags: f });
			expect(res.success).toBe(true);
		}
	});

	test("searchUnits no aplica negative cache si las propiedades (prp) no fueron solicitadas en flags", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(
					JSON.stringify({
						items: [
							{
								id: 999,
								sens: {
									"1": { id: 1, n: "Alarma", t: "custom" },
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
		// Consulta con flags: 4097 (base + sensors, SIN bit 2 de propiedades)
		await client.searchUnits({ flags: 4097 });

		const cacheEntry = (
			client as unknown as {
				ignitionSensorCache: Map<
					number,
					{ sensorId: string | null; expiresAt: number }
				>;
			}
		).ignitionSensorCache.get(999);

		// No debe fijar negative cache (null) porque prp no fue consultado
		expect(cacheEntry).toBeUndefined();
	});

	test("getUnitsStatus relanza WIALON_INVALID_SESSION si la sesión expira durante consulta de metadatos y reintenta limpiamente", async () => {
		let searchCalls = 0;
		let loginCalls = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				loginCalls++;
				return new Response(
					JSON.stringify({ eid: `sid-session-${loginCalls}` }),
					{ status: 200 },
				);
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				searchCalls++;
				if (searchCalls === 1) {
					// Simula sesión expirada en la primera llamada de metadatos
					return new Response(JSON.stringify({ error: 1 }), { status: 200 });
				}
				// Segunda llamada con SID renovado: devuelve metadatos autoritativos
				return new Response(
					JSON.stringify({
						items: [
							{
								id: 701,
								prp: { monitoring_sensor_id: "5" },
								sens: {
									"5": { id: 5, n: "Ignición", t: "custom" },
								},
							},
						],
					}),
					{ status: 200 },
				);
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(
					JSON.stringify([
						{
							i: 701,
							sensors: {
								"5": { value: 1, format: { value: "Encendido" } },
							},
						},
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const status = await client.getUnitsStatus([701]);

		// Debe haberse recuperado de la sesión expirada, reintentado el login y la búsqueda
		expect(loginCalls).toBe(2);
		expect(searchCalls).toBe(2);
		expect(status.length).toBe(1);
		expect(status[0].isIgnitionOn).toBe(true);
	});

	test("clearSession con failingSid preserva una sesión que ya fue renovada por otra solicitud", async () => {
		let loginCount = 0;
		const mockFetch: WialonFetch = async () => {
			loginCount++;
			return new Response(JSON.stringify({ eid: `sid-v${loginCount}` }), {
				status: 200,
			});
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		await client.login(); // login 1 -> sid-v1

		// Supongamos que otra petición ya renovó la sesión a sid-v2
		await client.login(true); // forzar login -> sid-v2
		expect(loginCount).toBe(2);

		// Una petición lenta rezagada que falló con sid-v1 llama a clearSession("sid-v1")
		client.clearSession("sid-v1");

		// No debió haber limpiado la sesión porque la actual es sid-v2
		const currentSid = await client.login();
		expect(currentSid).toBe("sid-v2");
		expect(loginCount).toBe(2); // No debió disparar otro login

		// Si falla con la sesión actual sid-v2, sí debe invalidar
		client.clearSession("sid-v2");
		const nextSid = await client.login();
		expect(nextSid).toBe("sid-v3");
		expect(loginCount).toBe(3);
	});

	test("getUnitDetail utiliza flags: 5123 por defecto (base + prp + lmsg + sens)", async () => {
		let capturedFlags: number | undefined;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_item")) {
				const paramsStr = new URLSearchParams(bodyStr).get("params");
				if (paramsStr) {
					const parsed = JSON.parse(paramsStr);
					capturedFlags = parsed.flags;
				}
				return new Response(
					JSON.stringify({
						item: {
							id: 123,
							nm: "Camión 1",
							cls: 2,
							prp: { monitoring_sensor_id: "1" },
							sens: { "1": { id: 1, n: "Motor", t: "engine operation" } },
							lmsg: { t: 1700000000, p: { io_1: 1 } },
						},
						flags: 5123,
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const detail = await client.getUnitDetail(123);

		// flags debe ser 5123 (1 | 2 | 1024 | 4096)
		expect(capturedFlags).toBe(5123);
		expect(detail.item.id).toBe(123);
		expect(detail.item.prp?.monitoring_sensor_id).toBe("1");
		expect(detail.item.sens?.["1"].n).toBe("Motor");
	});

	test("reemplaza entradas expiradas de sensor con negative cache tras fallo en búsqueda de metadatos", async () => {
		let searchCalls = 0;
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				searchCalls++;
				// Falla con error 5 (error de ejecución en el servidor upstream)
				return new Response(JSON.stringify({ error: 5 }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(
					JSON.stringify([
						{
							i: 333,
							sensors: {
								// El sensor obsoleto 10 no existe o está apagado; sensor 2 reporta ignición off
								"2": { value: 0, format: { value: "Apagado" } },
							},
						},
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);

		// Simulamos que la unidad 333 tenía en caché un sensor '10' que YA expiró hace 10 segundos
		(
			client as unknown as {
				setSensorCache: (id: number, s: string | null, exp: number) => void;
			}
		).setSensorCache(333, "10", Date.now() - 10_000);

		// Ejecutamos getUnitsStatus: la búsqueda de metadatos fallará
		const status = await client.getUnitsStatus([333]);
		expect(searchCalls).toBe(1);
		expect(status.length).toBe(1);

		// Verificamos que la entrada expirada fue SOBRESCRITA con negative cache (null) y lookupFailed: true
		const cacheEntry = (
			client as unknown as {
				ignitionSensorCache: Map<
					number,
					{ sensorId: string | null; expiresAt: number; lookupFailed?: boolean }
				>;
			}
		).ignitionSensorCache.get(333);

		expect(cacheEntry).toBeDefined();
		expect(cacheEntry?.sensorId).toBeNull();
		expect(cacheEntry?.lookupFailed).toBe(true);
		expect(status[0].isIgnitionOn).toBeUndefined();
		const remainingTtl = (cacheEntry?.expiresAt ?? 0) - Date.now();
		// Debe tener ~5 minutos de TTL
		expect(remainingTtl).toBeGreaterThan(4 * 60 * 1000);
		expect(remainingTtl).toBeLessThanOrEqual(5 * 60 * 1000);

		// En la siguiente llamada inmediata, NO debe reintentar la búsqueda de metadatos (respeta backoff)
		// y continúa preservando isIgnitionOn como undefined
		const statusSecond = await client.getUnitsStatus([333]);
		expect(searchCalls).toBe(1); // Sigue siendo 1 llamada
		expect(statusSecond[0].isIgnitionOn).toBeUndefined();
	});

	test("preserva ignición desconocida (undefined) tras fallo de búsqueda de metadatos incluso si calc_last tiene sensores con texto encendido", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				// Falla con timeout simulado / error upstream
				return new Response(JSON.stringify({ error: 5 }), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(
					JSON.stringify([
						{
							i: 555,
							sensors: {
								// Sensor no relacionado (ej. alarma o botón) con texto "Encendido"
								"9": { value: 1, format: { value: "Encendido" } },
							},
						},
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const status = await client.getUnitsStatus([555]);
		expect(status.length).toBe(1);
		// No debe activar el fallback heurístico ni clasificar la alarma como ignición: debe ser undefined
		expect(status[0].isIgnitionOn).toBeUndefined();

		// Segunda llamada en el periodo de backoff de 5 minutos
		const statusCached = await client.getUnitsStatus([555]);
		expect(statusCached[0].isIgnitionOn).toBeUndefined();
	});

	test("searchUnits no cachea coincidencias heurísticas de sensor si flags omite propiedades personalizadas (prp)", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				return new Response(
					JSON.stringify({
						items: [
							{
								id: 888,
								sens: {
									"1": { id: 1, n: "Motor encendido", t: "engine operation" },
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
		// Consulta con flags: 4097 (sensores, pero sin bit 2 de prp)
		await client.searchUnits({ flags: 4097 });

		const cacheEntry = (
			client as unknown as {
				ignitionSensorCache: Map<
					number,
					{ sensorId: string | null; expiresAt: number }
				>;
			}
		).ignitionSensorCache.get(888);

		// No debe poblar el caché con "1" porque prp fue omitido y el match es no-autoritativo
		expect(cacheEntry).toBeUndefined();
	});

	test("getUnitDetail no actualiza caché de ignición ante máscaras parciales (1027 o 4097) pero sí con 5123", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_item")) {
				return new Response(
					JSON.stringify({
						item: {
							id: 991,
							nm: "Unidad Test",
							cls: 2,
							prp: { monitoring_sensor_id: "5" },
							sens: { "5": { id: 5, n: "Ignición", t: "engine operation" } },
						},
						flags: 5123,
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const getCache = () =>
			(
				client as unknown as {
					ignitionSensorCache: Map<
						number,
						{ sensorId: string | null; expiresAt: number }
					>;
				}
			).ignitionSensorCache.get(991);

		// 1. Con máscara parcial 1027 (sin sens): no debe cachear
		await client.getUnitDetail(991, 1027);
		expect(getCache()).toBeUndefined();

		// 2. Con máscara parcial 4097 (sin prp): no debe cachear
		await client.getUnitDetail(991, 4097);
		expect(getCache()).toBeUndefined();

		// 3. Con máscara completa 5123 (prp + sens): sí debe cachear de forma autoritativa
		await client.getUnitDetail(991, 5123);
		expect(getCache()).toBeDefined();
		expect(getCache()?.sensorId).toBe("5");
	});

	test("rechaza respuestas malformadas de core/search_items (ej. objeto vacío {}) enrutándolas a la ruta de fallo y preservando ignición desconocida", async () => {
		const mockFetch: WialonFetch = async (_, init) => {
			const bodyStr = String(init?.body || "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(JSON.stringify({ eid: "sid-ok" }), { status: 200 });
			}
			if (bodyStr.includes("svc=core%2Fsearch_items")) {
				// Respuesta 200 pero malformada: omite la propiedad 'items'
				return new Response(JSON.stringify({}), { status: 200 });
			}
			if (bodyStr.includes("svc=unit%2Fcalc_last")) {
				return new Response(
					JSON.stringify([
						{
							i: 666,
							sensors: {
								"1": { value: 1, format: { value: "Encendido" } },
							},
						},
					]),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new WialonClient({ token: "tok-test" }, mockFetch);
		const status = await client.getUnitsStatus([666]);
		expect(status.length).toBe(1);

		// No debe activar la heurística ni clasificar erróneamente como encendido
		expect(status[0].isIgnitionOn).toBeUndefined();

		// Debe haberse guardado en caché con lookupFailed: true y sensorId: null
		const cacheEntry = (
			client as unknown as {
				ignitionSensorCache: Map<
					number,
					{ sensorId: string | null; expiresAt: number; lookupFailed?: boolean }
				>;
			}
		).ignitionSensorCache.get(666);

		expect(cacheEntry).toBeDefined();
		expect(cacheEntry?.sensorId).toBeNull();
		expect(cacheEntry?.lookupFailed).toBe(true);

		// Durante el backoff de 5 minutos, llamadas posteriores no deben activar la heurística
		const statusCached = await client.getUnitsStatus([666]);
		expect(statusCached[0].isIgnitionOn).toBeUndefined();
	});

	describe("resolveWialonEnvironment", () => {
		test("clasifica hosts *.lalegion.gt como producción", () => {
			expect(resolveWialonEnvironment("https://gps.lalegion.gt/locator")).toBe(
				"produccion",
			);
		});

		test("clasifica hosts *.wialon.com como hosting-wialon", () => {
			expect(
				resolveWialonEnvironment("https://hst-api.wialon.com/wialon/ajax.html"),
			).toBe("hosting-wialon");
		});

		test("clasifica cualquier otro host como personalizado", () => {
			expect(
				resolveWialonEnvironment("https://otro-proveedor.example.com"),
			).toBe("personalizado");
		});

		test("clasifica como personalizado ante una URL inválida sin lanzar", () => {
			expect(resolveWialonEnvironment("no-es-una-url")).toBe("personalizado");
		});

		test("no confunde un dominio que solo termina en 'lalegion.gt' sin ser subdominio real", () => {
			// endsWith("lalegion.gt") matchearía esto incorrectamente como producción
			expect(
				resolveWialonEnvironment("https://evil-lalegion.gt/phishing"),
			).toBe("personalizado");
			expect(resolveWialonEnvironment("https://maliciouslalegion.gt")).toBe(
				"personalizado",
			);
		});

		test("no confunde un dominio que solo termina en 'wialon.com' sin ser subdominio real", () => {
			expect(resolveWialonEnvironment("https://fakewialon.com")).toBe(
				"personalizado",
			);
		});

		test("acepta el dominio raíz exacto sin subdominio", () => {
			expect(resolveWialonEnvironment("https://lalegion.gt")).toBe(
				"produccion",
			);
			expect(resolveWialonEnvironment("https://wialon.com")).toBe(
				"hosting-wialon",
			);
		});
	});

	describe("getPublicConfig", () => {
		test("expone baseUrl, locatorUrl, timeoutMs y tokenConfigured sin incluir el token", () => {
			const client = new WialonClient(
				{
					token: "secreto-nunca-expuesto",
					baseUrl: "https://hst-api.wialon.com/wialon/ajax.html",
					locatorBaseUrl: "https://gps.lalegion.gt/locator/index.html",
					timeoutMs: 15000,
				},
				async () => new Response("{}", { status: 200 }),
			);

			const config = client.getPublicConfig();

			expect(config).toEqual({
				baseUrl: "https://hst-api.wialon.com/wialon/ajax.html",
				locatorUrl: "https://gps.lalegion.gt/locator/index.html",
				timeoutMs: 15000,
				tokenConfigured: true,
			});
			expect(Object.values(config)).not.toContain("secreto-nunca-expuesto");
		});

		test("tokenConfigured es false cuando no hay WIALON_TOKEN configurado", () => {
			const client = new WialonClient(
				{ token: undefined },
				async () => new Response("{}", { status: 200 }),
			);

			expect(client.getPublicConfig().tokenConfigured).toBe(false);
		});
	});
});

describe("matchUnidadPorPlaca (CB-118)", () => {
	const catalogo = [
		{ id: 28554757, nm: "Bidgar Yatz - C-629BNC" },
		{ id: 28233911, nm: "A-04" },
		{ id: 28233912, nm: "Maria Lopez - P-123ABC" },
	];

	test("encuentra la unidad cuando la placa viene dentro del nombre", () => {
		const { unidad, motivo } = matchUnidadPorPlaca("C-629BNC", catalogo);

		expect(motivo).toBe("ok");
		expect(unidad?.id).toBe(28554757);
	});

	test("ignora guiones, espacios y mayúsculas al comparar", () => {
		// La misma placa escrita por tres personas distintas.
		for (const placa of ["c 629 bnc", "C629BNC", " c-629-bnc "]) {
			expect(matchUnidadPorPlaca(placa, catalogo).unidad?.id).toBe(28554757);
		}
	});

	test("una unidad sin placa en el nombre no se adivina", () => {
		const { unidad, motivo } = matchUnidadPorPlaca("Z-999ZZZ", catalogo);

		expect(unidad).toBeNull();
		expect(motivo).toBe("sin_coincidencia");
	});

	test("dos unidades con la misma placa devuelven ambiguo, no la primera", () => {
		// Elegir cualquiera mandaría al gestor de campo al vehículo equivocado.
		const duplicado = [
			{ id: 1, nm: "Juan Perez - C-629BNC" },
			{ id: 2, nm: "C-629BNC (repuesto)" },
		];
		const { unidad, motivo } = matchUnidadPorPlaca("C-629BNC", duplicado);

		expect(unidad).toBeNull();
		expect(motivo).toBe("ambiguo");
	});

	test("una placa vacía o de menos de 3 caracteres no busca nada", () => {
		// "A" haría match con medio catálogo.
		for (const placa of ["", "  ", "A", "A-"]) {
			const { unidad, motivo } = matchUnidadPorPlaca(placa, catalogo);
			expect(unidad).toBeNull();
			expect(motivo).toBe("sin_placa");
		}
	});

	test("catálogo vacío devuelve sin_coincidencia", () => {
		expect(matchUnidadPorPlaca("C-629BNC", []).motivo).toBe("sin_coincidencia");
	});

	test("encuentra la unidad aunque el CRM tenga el prefijo mal tipeado (P0-) o sin prefijo", () => {
		// ~10% de las placas del CRM vienen como "P0-720GVH" y otras sin "P-":
		// el núcleo 720GVH es lo único que coincide con "P-720GVH SIN APAGADO".
		const unidades = [{ id: 7, nm: "P-720GVH SIN APAGADO" }];
		for (const placa of ["P0-720GVH", "P0 - 720GVH", "P0720GVH", "720GVH"]) {
			expect(matchUnidadPorPlaca(placa, unidades).unidad?.id).toBe(7);
		}
	});

	test("exige el núcleo completo: una placa incompleta o más larga no coincide", () => {
		// Con subcadena suelta, "P-123A" elegía "P-123ABC" y la deducción se
		// guardaba: el error quedaba fijado.
		const unidades = [
			{ id: 1, nm: "P-123ABCD" },
			{ id: 2, nm: "P-1720GVH" },
		];
		expect(matchUnidadPorPlaca("P-123ABC", unidades).motivo).toBe(
			"sin_coincidencia",
		);
		expect(matchUnidadPorPlaca("P-720GVH", unidades).motivo).toBe(
			"sin_coincidencia",
		);
		expect(matchUnidadPorPlaca("P-123A", unidades).motivo).toBe("sin_placa");
	});

	test("mismo núcleo con distinto prefijo es ambiguo, no se adivina", () => {
		const unidades = [
			{ id: 1, nm: "P-720GVH" },
			{ id: 2, nm: "C-720GVH - CON APAGADO" },
		];
		const { unidad, motivo, coincidencias } = matchUnidadPorPlaca(
			"P-720GVH",
			unidades,
		);
		expect(unidad).toBeNull();
		expect(motivo).toBe("ambiguo");
		expect(coincidencias.map((u) => u.id)).toEqual([1, 2]);
	});

	test("valores de relleno del CRM se tratan como sin placa", () => {
		for (const placa of ["NUEVO", "P-NUEVO", "N/A", "EJEMPLO", "0"]) {
			expect(
				matchUnidadPorPlaca(placa, [{ id: 1, nm: "NUEVO EJEMPLO N/A" }]).motivo,
			).toBe("sin_placa");
		}
	});
});

describe("extraerNucleoPlaca (CB-118)", () => {
	test("extrae 3 dígitos + 3 letras sin importar prefijo ni separadores", () => {
		expect(extraerNucleoPlaca("P - 278KJQ")).toEqual({
			digitos: "278",
			letras: "KJQ",
		});
		expect(extraerNucleoPlaca("p0-720gvh")).toEqual({
			digitos: "720",
			letras: "GVH",
		});
	});

	test("devuelve null sin forma de placa", () => {
		for (const valor of [null, undefined, "", "NUEVO", "N/A", "12AB"]) {
			expect(extraerNucleoPlaca(valor)).toBeNull();
		}
	});

	test("rechaza placas mal cargadas en vez de reducirlas a otro núcleo", () => {
		// "P-1720GVH" o "P-720GVHX" se reducían a 720GVH y vinculaban solas la
		// unidad P-720GVH de otro cliente.
		for (const valor of [
			"P-1720GVH",
			"P-720GVHX",
			"P-720GVH-2",
			"X P-720GVH",
		]) {
			expect(extraerNucleoPlaca(valor)).toBeNull();
		}
	});

	test("acepta las formas reales del CRM", () => {
		for (const [valor, nucleo] of [
			["P0619LTS", "619LTS"],
			["C0-856CBP", "856CBP"],
			["263LBM", "263LBM"],
			["P0 - 822LMW", "822LMW"],
			[" c-629-bnc ", "629BNC"],
		] as const) {
			const n = extraerNucleoPlaca(valor);
			expect(n ? n.digitos + n.letras : null).toBe(nucleo);
		}
	});
});

describe("extraerNucleoDeNombreUnidad (CB-118)", () => {
	test("encuentra la placa dentro del nombre de la unidad", () => {
		const n = extraerNucleoDeNombreUnidad("Bidgar Yatz - C-629BNC");
		expect(n ? n.digitos + n.letras : null).toBe("629BNC");
		const m = extraerNucleoDeNombreUnidad("P-720GVH SIN APAGADO");
		expect(m ? m.digitos + m.letras : null).toBe("720GVH");
	});

	test("respeta los bordes: no toma un núcleo dentro de algo más largo", () => {
		for (const nombre of [
			"P-1720GVH",
			"P-720GVHX",
			"HFC1037D5K2TSTT9",
			"A-04",
		]) {
			expect(extraerNucleoDeNombreUnidad(nombre)).toBeNull();
		}
	});
});

describe("extraerUltimaSenal (CB-118)", () => {
	test("convierte el epoch en SEGUNDOS de Wialon a fecha real", () => {
		// Sin multiplicar por 1000 esto daría enero de 1970.
		const fecha = extraerUltimaSenal({ item: { lmsg: { t: 1773704628 } } });

		expect(fecha?.getTime()).toBe(1773704628 * 1000);
		expect(fecha?.getUTCFullYear()).toBeGreaterThan(2020);
	});

	test("prefiere lmsg.t sobre pos.t", () => {
		// Una unidad puede reportar sin fix de GPS: el mensaje es más reciente.
		const fecha = extraerUltimaSenal({
			item: { pos: { t: 1000 }, lmsg: { t: 2000 } },
		});

		expect(fecha?.getTime()).toBe(2000 * 1000);
	});

	test("un lmsg.t inválido (0) no tapa un pos.t válido", () => {
		expect(
			extraerUltimaSenal({
				item: { lmsg: { t: 0 }, pos: { t: 1773704628 } },
			})?.getTime(),
		).toBe(1773704628 * 1000);
	});

	test("usa pos.t cuando no hay lmsg", () => {
		expect(
			extraerUltimaSenal({ item: { pos: { t: 1773704628 } } })?.getTime(),
		).toBe(1773704628 * 1000);
	});

	test("devuelve null cuando no hay timestamp o es inválido", () => {
		expect(extraerUltimaSenal({ item: {} })).toBeNull();
		expect(extraerUltimaSenal({})).toBeNull();
		expect(extraerUltimaSenal({ item: { pos: { t: 0 } } })).toBeNull();
		expect(extraerUltimaSenal({ item: { pos: { t: -5 } } })).toBeNull();
		expect(
			extraerUltimaSenal({
				item: { pos: { t: Number.NaN } },
			}),
		).toBeNull();
	});
});

describe("extraerFechasUnidad (CB-118)", () => {
	test("separa el último mensaje de la última posición", () => {
		// Equipo que sigue reportando sin fix de GPS: el mensaje es de ahora,
		// las coordenadas son viejas. La ubicación no puede verse "reciente".
		const f = extraerFechasUnidad({
			item: { lmsg: { t: 2000 }, pos: { t: 1000 } },
		});
		expect(f.ultimoMensajeAt?.getTime()).toBe(2000 * 1000);
		expect(f.ultimaPosicionAt?.getTime()).toBe(1000 * 1000);
	});

	test("null cuando falta o es inválido", () => {
		const f = extraerFechasUnidad({ item: { lmsg: { t: 0 }, pos: null } });
		expect(f.ultimoMensajeAt).toBeNull();
		expect(f.ultimaPosicionAt).toBeNull();
	});
});

describe("getUnitLastSignal (CB-118)", () => {
	test("lee la última señal desde core/search_item", async () => {
		const fetchMock: WialonFetch = async (_url, init) => {
			const bodyStr = String(init?.body ?? "");
			if (bodyStr.includes("svc=token%2Flogin")) {
				return new Response(
					JSON.stringify({ eid: "sid-123", user: { id: 1, nm: "test" } }),
					{ status: 200 },
				);
			}
			return new Response(
				JSON.stringify({
					item: { id: 28233911, nm: "A-04", lmsg: { t: 1773704628 } },
					flags: 1025,
				}),
				{ status: 200 },
			);
		};

		const client = new WialonClient({ token: "tok" }, fetchMock);
		const fecha = await client.getUnitLastSignal(28233911);

		expect(fecha?.getTime()).toBe(1773704628 * 1000);
	});
});

import { beforeEach, expect, mock, test } from "bun:test";

/**
 * QUIÉN PUBLICA UN MOCK PUBLICA EL NAMESPACE ENTERO (misma regla que
 * `routers/investor-documents.portalAccess.test.ts`): `mock.module` es global al
 * proceso y congela la lista de exports del módulo en cuanto alguien se enlaza
 * contra él. El spread sale del módulo REAL —sufijo `?real`, que resuelve al
 * mismo archivo saltándose el registro de mocks— y lo único sustituido son las
 * dos funciones que hay que OBSERVAR.
 *
 * Se mockean porque las dos salen a la red de verdad: `invalidateAndReauth`
 * hace `POST ${CARTERA_BACK_URL}/auth/login`. Por eso el 403 de cartera no
 * estaba probado acá hasta ahora — con el reenvío por reautenticación, probarlo
 * disparaba un login real desde la suite.
 */
const authReal = (await import(
	`${"./cartera-auth.service.ts"}?real`
)) as typeof import("./cartera-auth.service");

let reautenticaciones = 0;
let tokensTirados = 0;

mock.module("./cartera-auth.service", () => ({
	...authReal,
	invalidateAndReauth: async () => {
		reautenticaciones += 1;
		return "token-reautenticado";
	},
	clearCarteraTokens: () => {
		tokensTirados += 1;
	},
}));

// Canario del `?real`: si dejara de saltarse el registro de mocks, el namespace
// quedaría recortado y los módulos que importan el resto no cargarían.
const authPublicado: any = await import("./cartera-auth.service");
for (const exportFaltante of [
	"getCarteraAccessToken",
	"ensureCarteraAuth",
	"loginCartera",
]) {
	if (typeof authPublicado[exportFaltante] !== "function") {
		throw new Error(
			`./cartera-auth.service quedó publicado recortado (falta ${exportFaltante}).`,
		);
	}
}

const { CarteraBackClient } = await import("./cartera-back-client");

beforeEach(() => {
	reautenticaciones = 0;
	tokensTirados = 0;
});

const fetchTransport = (
	handler: (
		...args: Parameters<typeof globalThis.fetch>
	) => ReturnType<typeof globalThis.fetch>,
) => Object.assign(handler, { preconnect: globalThis.fetch.preconnect });

const respuesta = () => ({
	message: "Procesados 1 inversionista(s)",
	resultados: [
		{
			inversionistaId: 7,
			estado: "creada" as const,
			usuarioEmail: "ana@ejemplo.com",
			correo: {
				enviado: true,
				plantilla: "bienvenida",
				redirigido: false,
				destinatarioReal: null,
			},
			advertencias: [],
			motivo: null,
		},
	],
});

test("pega a /investor/portal-access con inversionista_ids como arreglo", async () => {
	const esperado = respuesta();
	let requestedUrl = "";
	let requestedMethod = "";
	let authorization = "";
	let requestedBody: BodyInit | null | undefined;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async (input, init) => {
			requestedUrl = String(input);
			requestedMethod = init?.method ?? "";
			authorization = new Headers(init?.headers).get("authorization") ?? "";
			requestedBody = init?.body;
			return Response.json(esperado);
		}),
	});

	const actual = await client.otorgarAccesoPortal([7]);

	expect(actual).toEqual(esperado);
	expect(requestedUrl).toBe("https://cartera.test/investor/portal-access");
	expect(requestedMethod).toBe("POST");
	expect(authorization).toBe("Bearer test-token");
	// El contrato de cartera es un ARREGLO (`t.Array(..., { minItems: 1 })`).
	// Mandar un escalar lo rebota con 400.
	expect(JSON.parse(String(requestedBody))).toEqual({ inversionista_ids: [7] });
});

test("un POST que manda contraseñas no se reintenta", async () => {
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		// Un 500 SÍ es reintentable para una lectura: si el método fuera
		// idempotente, estos 2 intentos extra ocurrirían.
		retryAttempts: 2,
		retryDelay: 1,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => {
			llamadas += 1;
			return Response.json({ error: "boom" }, { status: 500 });
		}),
	});

	await expect(client.otorgarAccesoPortal([7])).rejects.toThrow("boom");
	// Cada reintento le manda OTRA contraseña al inversionista.
	expect(llamadas).toBe(1);
});

// LA PRUEBA QUE IMPORTA del reenvío por reautenticación.
//
// `request()` reenviaba la MISMA petición una vez ante 401/403 —mismo método,
// mismo cuerpo— al margen de la política de reintentos. Para este POST eso es
// una SEGUNDA contraseña al inversionista. Hoy el 403 de cartera es la primera
// línea de `otorgarAccesoPortal.ts` y llega antes de provisionar, pero basta que
// el 403 lo ponga algo intermedio —un balanceador, un WAF— o un chequeo futuro
// ubicado después de provisionar para que el reenvío duplique el acto.
//
// Es además de lo que depende que el CRM pueda afirmar "un 403 descarta el
// efecto" y no deje constancia (`lib/salud-cuenta-portal.ts`,
// `STATUS_SIN_EFECTO`): si esto se reactiva, esa lista miente.
test("un 403 NO se reenvía reautenticado: sería una segunda contraseña", async () => {
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => {
			llamadas += 1;
			return Response.json(
				{
					error: "forbidden",
					message: "Solo un ADMIN puede abrir accesos al portal",
				},
				{ status: 403 },
			);
		}),
	});

	const error = await client.otorgarAccesoPortal([7]).then(
		() => null,
		(e) => e,
	);

	// El status y el `payload` se conservan tal cual: son los que
	// `toCarteraOrpcError` convierte en el mensaje que ve la persona, en vez del
	// "Internal server error" genérico.
	expect(error).toBeInstanceOf(Error);
	expect(error.status).toBe(403);
	expect(error.payload.message).toBe(
		"Solo un ADMIN puede abrir accesos al portal",
	);

	expect(llamadas).toBe(1);
	expect(reautenticaciones).toBe(0);
	// Un 403 es la identidad rechazada: otro token de la misma cuenta de
	// servicio vuelve con el mismo 403, así que el cacheado no se tira.
	expect(tokensTirados).toBe(0);
});

test("un 401 tampoco se reenvía, pero sí tira el token cacheado", async () => {
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => {
			llamadas += 1;
			return Response.json({ error: "unauthorized" }, { status: 401 });
		}),
	});

	await expect(client.otorgarAccesoPortal([7])).rejects.toThrow(
		"Authentication failed",
	);

	// La petición NO se repite; el token sí se invalida para que la SIGUIENTE
	// llamada entre reautenticada. Quién repite el acto lo decide una persona.
	expect(llamadas).toBe(1);
	expect(reautenticaciones).toBe(0);
	expect(tokensTirados).toBe(1);
});

// El contraste que prueba que lo anterior es un ESTRECHAMIENTO y no una
// amputación: en una lectura no hay efecto que duplicar, así que el reenvío
// reautenticado sigue vivo tal cual.
test("una LECTURA sí se reenvía reautenticada ante un 401", async () => {
	const esperado = {
		estado: "ya_tenia" as const,
		usuarioEmail: "ana@ejemplo.com",
		resueltoPor: "dpi" as const,
		advertencias: [] as string[],
		motivo: null,
	};
	const tokens: string[] = [];
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "token-vencido",
		fetchTransport: fetchTransport(async (_input, init) => {
			const token = new Headers(init?.headers).get("authorization") ?? "";
			tokens.push(token);
			if (token === "Bearer token-vencido") {
				return Response.json({ error: "unauthorized" }, { status: 401 });
			}
			return Response.json(esperado);
		}),
	});

	expect(await client.consultarAccesoPortal(7)).toEqual(esperado);
	expect(reautenticaciones).toBe(1);
	expect(tokens).toEqual([
		"Bearer token-vencido",
		"Bearer token-reautenticado",
	]);
});

test("un rechazo de cartera-back se propaga en vez de devolver datos vacíos", async () => {
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () =>
			Response.json(
				{ message: "Hay que indicar al menos un inversionista_id" },
				{ status: 400 },
			),
		),
	});

	await expect(client.otorgarAccesoPortal([7])).rejects.toThrow(
		"Hay que indicar al menos un inversionista_id",
	);
});

// ============================================================================
// EL CORREO APROBADO (se aprueba un correo, no un id)
// ============================================================================

/** Un cliente que solo anota el cuerpo que salió, sin red de verdad. */
const clienteQueAnota = () => {
	const cuerpos: any[] = [];
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async (_input, init) => {
			llamadas += 1;
			cuerpos.push(JSON.parse(String(init?.body)));
			return Response.json(respuesta());
		}),
	});
	return { client, cuerpos, llamadas: () => llamadas };
};

test("el correo aprobado VIAJA a cartera junto al id", async () => {
	const { client, cuerpos } = clienteQueAnota();

	await client.otorgarAccesoPortal([7], "ana@ejemplo.com");

	// La mutación que esto mata: dejar de reenviar el campo. Sin él cartera
	// vuelve a decidir el destinatario releyendo la fila, que es el agujero.
	expect(cuerpos[0]).toEqual({
		inversionista_ids: [7],
		correo_aprobado: "ana@ejemplo.com",
	});
});

test("se manda RECORTADO: el maxLength 255 de cartera mide lo que recibe", async () => {
	const { client, cuerpos } = clienteQueAnota();

	await client.otorgarAccesoPortal([7], "  ana@ejemplo.com  ");

	expect(cuerpos[0].correo_aprobado).toBe("ana@ejemplo.com");

	// Un correo que USA los 255 y viene con espacios: recortado entra, crudo se
	// iría en 422 contra `t.String({ maxLength: 255 })` sin llegar al handler.
	const alLimite = `${"a".repeat(243)}@ejemplo.com`;
	expect(alLimite).toHaveLength(255);
	await client.otorgarAccesoPortal([7], `  ${alLimite}  `);
	expect(cuerpos[1].correo_aprobado).toHaveLength(255);
});

// El camino de la EMPRESA: su diálogo no enseña correo porque la cuenta es del
// representante. La llave tiene que quedar AUSENTE — no en `""`, que cartera
// rebota con 400, ni en `null`.
test("sin correo aprobado la llave NO viaja (empresa)", async () => {
	const { client, cuerpos } = clienteQueAnota();

	await client.otorgarAccesoPortal([7]);

	expect(cuerpos[0]).toEqual({ inversionista_ids: [7] });
	expect("correo_aprobado" in cuerpos[0]).toBe(false);
});

// LA PRUEBA QUE IMPORTA de la llave vacía. Un diálogo que SÍ tenía que enseñar
// un correo y llegó sin él es un llamador roto. Omitir la llave en silencio lo
// convertiría en un provisionamiento SIN aprobación — el agujero, servido por
// el propio arreglo. Tiene que tronar, y ANTES de salir a la red.
test("un correo aprobado vacío TRUENA sin llegar a cartera", async () => {
	for (const vacio of ["", "   ", "\t\n"]) {
		const { client, cuerpos, llamadas } = clienteQueAnota();

		await expect(client.otorgarAccesoPortal([7], vacio)).rejects.toThrow(
			"`correoAprobado` vino vacío",
		);

		// Nada salió: ni una petición, ni un cuerpo con la llave omitida.
		expect(llamadas()).toBe(0);
		expect(cuerpos).toHaveLength(0);
	}
});

// El veto de cartera es un 200 con `fallo` adentro, NO un rechazo HTTP: el
// cliente tiene que devolverlo tal cual para que el procedure lo lea y deje
// constancia. Si lo tratara como error, el veto subiría por el `catch` y se
// anotaría como "no se sabe si la contraseña salió", que es falso: no salió.
test("el veto vuelve como resultado normal, no como excepción", async () => {
	const vetada = {
		message: "Procesados 1 inversionista(s)",
		resultados: [
			{
				inversionistaId: 7,
				estado: "fallo" as const,
				usuarioEmail: null,
				correo: {
					enviado: false,
					plantilla: null,
					redirigido: false,
					destinatarioReal: null,
				},
				advertencias: [],
				motivo: "correo_aprobado_no_coincide",
			},
		],
	};
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => Response.json(vetada)),
	});

	expect(await client.otorgarAccesoPortal([7], "vieja@ejemplo.com")).toEqual(
		vetada,
	);
});

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { call, os } from "@orpc/server";

/**
 * Acceso al Portal del Inversionista disparado desde el CRM.
 *
 * Lo que protege esta suite es la TRAZABILIDAD. `cartera.audit_logs` graba el
 * "quién" decodificándolo del JWT, y el CRM llama a cartera con un token de
 * servicio que pertenece a una persona real: en la bitácora de cartera, mandar
 * la contraseña de un inversionista aparece siempre firmado por ESA persona,
 * apriete el botón quien lo apriete. El insert en `investor_activity_log` es la
 * única constancia veraz de quién lo autorizó.
 */

// `inserts` son las filas que QUEDARON escritas; `intentos` incluye también las
// que la base rechazó. La diferencia entre las dos es la prueba de que la
// constancia es best-effort y no puede tumbar la respuesta.
const inserts: { tabla: unknown; valores: Record<string, any> }[] = [];
const intentos: { tabla: unknown; valores: Record<string, any> }[] = [];
let fallaDelInsert: Error | null = null;
const idsEnviados: number[][] = [];
// El SEGUNDO argumento con que el procedure llamó al cliente. `undefined` es
// "no mandó la llave" (empresa), y es distinto de no haber llamado: para eso
// está el largo de `idsEnviados`.
const correosAprobadosEnviados: (string | undefined)[] = [];
let responderCartera: () => Promise<unknown> = async () => ({
	message: "Procesados 1 inversionista(s)",
	resultados: [],
});

const procedure = os.$context<any>();

// `../lib/orpc` se publica ENTERO, con SOLO los tres procedures que este router
// usa sustituidos por uno permisivo.
//
// Publicar un recorte —2 de 25 exports— congela la lista de exports del módulo
// para todo el proceso: el siguiente archivo que importe uno de los que
// faltaban ni siquiera carga (`SyntaxError: Export named '…' not found`) y sus
// pruebas se dan por verdes sin ejecutar una aserción. Es el mismo antipatrón
// que arrastraba `cobros.moraRecuperacion.test.ts` (18 de 25), hoy corregido.
//
// El spread sale del módulo REAL (sufijo `?real`, que resuelve al mismo archivo
// saltándose el registro de mocks) y no de lo publicado, para no reexportar el
// recorte de otra suite. Los guards reales de las otras suites del directorio
// quedan en pie: lo único sustituido son los tres procedures de este router.
const orpcReal = (await import(
	`${"../lib/orpc.ts"}?real`
)) as typeof import("../lib/orpc");

mock.module("../lib/orpc", () => ({
	...orpcReal,
	crmCobrosOrInvestmentsProcedure: procedure,
	investmentManagerProcedure: procedure,
	// El guard REAL de `darAccesoPortal` desde que dejó de colgar del ancho. Se
	// sustituye por el permisivo para que la suite pueda llamar al handler sin
	// sesión; quién puede llamarlo de verdad lo prueba, leyendo el fuente, "el
	// procedure cuelga del guard de inversiones".
	investmentProcedure: procedure,
}));

// CANARIO de `../lib/orpc` (el hermano del de `cartera-back-client`, más abajo):
// si otra suite llegó primero con un recorte y la lista quedó congelada, esto
// revienta con un mensaje que lo dice, en vez de dejar el archivo sin cargar.
const orpcPublicado: any = await import("../lib/orpc");
// Se chequean exports que NINGÚN mock de este repo sustituye y que el recorte
// histórico de `cobros.moraRecuperacion.test.ts` omitía: si el canario mirara
// los que el recorte sí traía, pasaría en verde sobre una lista rota.
// `investmentProcedure` YA NO sirve de canario: esta suite lo mockea. Se lo
// reemplaza por `cobranzaReportProcedure`, que el recorte histórico también
// omitía y que ningún mock de este repo sustituye.
for (const exportFaltante of [
	"cobranzaReportProcedure",
	"accountingProcedure",
	"crmOnlyProcedure",
]) {
	if (orpcPublicado[exportFaltante] === undefined) {
		throw new Error(
			`../lib/orpc quedó publicado recortado (falta ${exportFaltante}): otra suite lo mockeó parcialmente antes que esta.`,
		);
	}
}

mock.module("../db", () => ({
	db: {
		insert: (tabla: unknown) => ({
			values: async (valores: Record<string, any>) => {
				intentos.push({ tabla, valores });
				// El enum `acceso_portal` sin aplicar en ese ambiente, el pool, la FK
				// de `performed_by`: la fila no entra y el insert TIRA.
				if (fallaDelInsert) throw fallaDelInsert;
				inserts.push({ tabla, valores });
			},
		}),
	},
}));

// CONVIVENCIA CON LAS OTRAS SUITES DEL DIRECTORIO (no es decoración):
//
// `mock.module` es global al proceso y, en cuanto algún módulo se enlaza contra
// un mock, la LISTA DE EXPORTS de ese mock queda CONGELADA: republicarlo
// completo más tarde ya no agrega los exports que faltaban. Dos suites hermanas
// (`cobros.moraRecuperacion.test.ts` y `reports.authorization.test.ts`)
// publican un cartera-back-client recortado a `carteraBackClient`, y
// `investor-documents.ts` importa además `CarteraBackHttpError`: con ese
// recorte congelado, este archivo ni siquiera lograba cargar el router y la
// corrida por directorio lo daba por verde sin ejecutar una sola aserción.
//
// La regla es que QUIEN PUBLICA un mock publique el namespace entero. Las
// suites hermanas ya lo hacen, así que la lista de exports no la recorta nadie.
// Se probó también un preload por `bunfig.toml`, y se DESCARTÓ: `bunfig.toml`
// solo se lee cuando el cwd es este directorio, y el CI invoca `bun test` desde
// la raíz del repo, así que no habría corrido justo donde hace falta. El
// mecanismo vive entero acá, sin depender del cwd.
//
// Acá quedan las dos defensas locales:
//
//  1. El sufijo `?real` al capturar el módulo: resuelve al mismo archivo
//     saltándose el registro de mocks, así que lo que se reexporta es el módulo
//     de VERDAD y no lo que otra suite haya dejado publicado. Un
//     `await import("../services/cartera-back-client")` a secas devolvía el
//     recorte del hermano, y esparcirlo era justo lo que perdía
//     `CarteraBackHttpError`.
//
//  2. El chequeo de `nsPublicado`: si el namespace vuelve a quedar recortado,
//     esto REVIENTA en vez de volver a pasar en falso.
const moduloReal = (await import(
	`${"../services/cartera-back-client.ts"}?real`
)) as typeof import("../services/cartera-back-client");

mock.module("../services/cartera-back-client", () => ({
	...moduloReal,
	carteraBackClient: {
		otorgarAccesoPortal: async (ids: number[], correoAprobado?: string) => {
			idsEnviados.push(ids);
			correosAprobadosEnviados.push(correoAprobado);
			return await responderCartera();
		},
	},
}));

// Alarma de las defensas de arriba: si otra suite llegó primero con un
// namespace recortado, el router no se puede enlazar y estas pruebas volverían
// a no correr. Mejor un rojo ruidoso que un verde falso.
const nsPublicado: any = await import("../services/cartera-back-client");
if (typeof nsPublicado.CarteraBackHttpError !== "function") {
	throw new Error(
		"cartera-back-client quedó publicado recortado: otra suite lo mockeó parcialmente antes que esta. Ver el comentario del encabezado de este archivo.",
	);
}

const { investorDocumentsRouter } = await import("./investor-documents");
const { investorActivityLog } = await import("../db/schema");

const respuestaCartera = () => ({
	message: "Procesados 1 inversionista(s)",
	resultados: [
		{
			inversionistaId: 7,
			estado: "creada" as const,
			usuarioEmail: "ana@ejemplo.com",
			correo: {
				enviado: true,
				plantilla: "bienvenida",
				redirigido: true,
				destinatarioReal: "qa@clubcashin.com",
			},
			advertencias: ["correo_redirigido"],
			motivo: null,
		},
	],
});

const contexto = () =>
	({
		context: {
			session: {
				user: {
					id: "usr_operador",
					name: "Operador Real",
					email: "operador@clubcashin.com",
				},
			},
		},
	}) as never;

// Una respuesta de cartera con el desenlace que se quiera, sin correo enviado y
// sin advertencias: así el ÚNICO que decide si hay fila es el estado/motivo, y
// no los dos atajos que `exigeConstancia` resuelve antes.
const desenlace = (over: {
	estado: "creada" | "ya_tenia" | "avisada" | "omitida" | "fallo";
	motivo?: string | null;
}) => ({
	message: "Procesados 1 inversionista(s)",
	resultados: [
		{
			inversionistaId: 7,
			usuarioEmail: null as string | null,
			correo: {
				enviado: false,
				plantilla: null as string | null,
				redirigido: false,
				destinatarioReal: null as string | null,
			},
			advertencias: [] as string[],
			motivo: null as string | null,
			...over,
		},
	],
});

describe("darAccesoPortal", () => {
	beforeEach(() => {
		inserts.length = 0;
		intentos.length = 0;
		fallaDelInsert = null;
		idsEnviados.length = 0;
		correosAprobadosEnviados.length = 0;
		responderCartera = async () => respuestaCartera();
	});

	test("manda a cartera el id como arreglo y devuelve su respuesta tal cual", async () => {
		const actual = await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			contexto(),
		);

		expect(idsEnviados).toEqual([[7]]);
		expect(actual).toEqual(respuestaCartera());
	});

	test("deja constancia del actor REAL del CRM, no del token de servicio", async () => {
		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			contexto(),
		);

		expect(inserts).toHaveLength(1);
		expect(inserts[0].tabla).toBe(investorActivityLog);
		expect(inserts[0].valores).toMatchObject({
			inversionistaId: 7,
			action: "acceso_portal",
			performedBy: "usr_operador",
			performedByName: "Operador Real",
		});
		expect(inserts[0].valores.details).toMatchObject({
			estado: "creada",
			usuarioEmail: "ana@ejemplo.com",
			advertencias: ["correo_redirigido"],
		});
	});

	test("si el usuario del CRM no tiene nombre, firma con su correo", async () => {
		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			{
				context: {
					session: {
						user: { id: "usr_sin_nombre", email: "sinnombre@clubcashin.com" },
					},
				},
			} as never,
		);

		expect(inserts[0].valores.performedByName).toBe("sinnombre@clubcashin.com");
	});

	// ========================================================================
	// QUÉ APRETONES DEJAN FILA (el cableado, no la función pura)
	// ========================================================================

	// LA PRUEBA QUE IMPORTA del guard. Apretar sobre una EMPRESA no crea nada y
	// no manda ningún correo, y el camino de lectura contesta `omitida/es_empresa`
	// para siempre, así que el botón NUNCA se apaga: se puede apretar sin
	// límite. Sin el guard, cada apretón escribía una fila y la bitácora —que
	// existe para conservar QUIÉN autorizó mandar una contraseña— quedaba
	// enterrada bajo apretones que no autorizaron nada.
	test("apretar sobre una EMPRESA no deja fila: no crea nada ni manda correo", async () => {
		const respuesta = desenlace({
			estado: "fallo",
			motivo: "es_empresa_el_acceso_es_del_representante",
		});
		responderCartera = async () => respuesta;

		const actual = await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			contexto(),
		);

		expect(intentos).toHaveLength(0);
		// Y la respuesta llega igual: el front necesita el motivo para explicar
		// por qué ese botón no le sirve a esta fila.
		expect(actual).toEqual(respuesta);
	});

	// El hermano de la de arriba: si el guard se borrara, la de la empresa se
	// pondría roja; si se invirtiera, esta. Las dos juntas lo fijan.
	test("un desenlace sin correo ni advertencias SÍ deja fila si hubo acto", async () => {
		responderCartera = async () => desenlace({ estado: "ya_tenia" });

		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			contexto(),
		);

		expect(inserts).toHaveLength(1);
		expect(inserts[0].valores.details).toMatchObject({ estado: "ya_tenia" });
		expect(inserts[0].valores.performedBy).toBe("usr_operador");
	});

	// Un `fallo` que cartera NO decide sola —se salió a la red y auth-google no
	// contestó— es la duda, y la duda registra.
	test("un fallo con un motivo que cartera no decidió sola deja fila", async () => {
		responderCartera = async () =>
			desenlace({ estado: "fallo", motivo: "timeout" });

		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			contexto(),
		);

		expect(inserts).toHaveLength(1);
		expect(inserts[0].valores.details).toMatchObject({
			estado: "fallo",
			motivo: "timeout",
		});
	});

	// ========================================================================
	// LA CONSTANCIA NO PUEDE TUMBAR LA RESPUESTA
	// ========================================================================

	// Cuando esto corre, la cuenta ya existe y el correo YA SALIÓ. Si el insert
	// tirara y el throw subiera, el navegador mostraría un rojo de "falló" sobre
	// algo que sí ocurrió y quien apretó volvería a apretar. Es el invariante al
	// revés: por perder la constancia se perdía además la verdad.
	test("si la bitácora truena, la respuesta del acto irreversible llega igual", async () => {
		fallaDelInsert = new Error(
			'invalid input value for enum investor_activity_log_action: "acceso_portal"',
		);
		const errores: unknown[][] = [];
		const consolaOriginal = console.error;
		console.error = (...args: unknown[]) => {
			errores.push(args);
		};

		try {
			const actual = await call(
				investorDocumentsRouter.darAccesoPortal,
				{ inversionistaId: 7 },
				contexto(),
			);

			expect(actual).toEqual(respuestaCartera());
		} finally {
			console.error = consolaOriginal;
		}

		// Se intentó y no quedó: entonces el log es la ÚNICA constancia, y tiene
		// que traer la fila entera para poder reconstruirla a mano.
		expect(intentos).toHaveLength(1);
		expect(inserts).toHaveLength(0);
		expect(errores).toHaveLength(1);
		const gritado = errores[0].map(String).join(" ");
		expect(gritado).toContain("investor_activity_log");
		expect(gritado).toContain("usr_operador");
		expect(gritado).toContain("ana@ejemplo.com");
	});

	// ========================================================================
	// CUANDO LA LLAMADA NI SIQUIERA VUELVE
	// ========================================================================

	// LA PRUEBA QUE IMPORTA de la duda real. El salto CRM→cartera se corta
	// mientras cartera sigue dentro de su `fetch` a auth-google: la contraseña
	// puede estar en el buzón del inversionista. Antes esto no dejaba NADA, y el
	// reintento lo enterraba —la cuenta ya existe, cartera contesta `ya_tenia` y
	// el segundo apretón sale en verde—.
	test("un tropiezo de red se propaga traducido y DEJA constancia de la duda", async () => {
		responderCartera = async () => {
			throw new Error("socket hang up");
		};

		await expect(
			call(
				investorDocumentsRouter.darAccesoPortal,
				{ inversionistaId: 7 },
				contexto(),
			),
		).rejects.toThrow("Dar acceso al portal: cartera no está respondiendo");

		expect(inserts).toHaveLength(1);
		expect(inserts[0].valores).toMatchObject({
			inversionistaId: 7,
			action: "acceso_portal",
			performedBy: "usr_operador",
			performedByName: "Operador Real",
		});
		// No se inventa un desenlace de cartera: cartera no contestó.
		expect(inserts[0].valores.details).toMatchObject({
			estado: "sin_respuesta_de_cartera",
			advertencias: ["no_se_sabe_si_la_contrasena_salio"],
			motivo: "socket hang up",
			httpStatus: null,
			correo: null,
		});
	});

	// Un 5xx tampoco descarta el efecto: cartera pudo haber entrado a
	// provisionar y caerse después.
	test("un 5xx de cartera deja constancia de la duda", async () => {
		responderCartera = async () => {
			throw new moduloReal.CarteraBackHttpError("HTTP 502: bad gateway", 502, {
				error: "bad gateway",
			});
		};

		await expect(
			call(
				investorDocumentsRouter.darAccesoPortal,
				{ inversionistaId: 7 },
				contexto(),
			),
		).rejects.toThrow();

		expect(inserts).toHaveLength(1);
		expect(inserts[0].valores.details).toMatchObject({
			estado: "sin_respuesta_de_cartera",
			httpStatus: 502,
		});
	});

	// Y si encima la bitácora truena, lo que sube es el error de CARTERA: es lo
	// que explica qué pasó. El de la base se grita al log.
	test("si la bitácora truena en la rama de falla, sube el error de cartera", async () => {
		responderCartera = async () => {
			throw new Error("socket hang up");
		};
		fallaDelInsert = new Error("no hay conexión con la base del CRM");
		const consolaOriginal = console.error;
		console.error = () => {};

		try {
			await expect(
				call(
					investorDocumentsRouter.darAccesoPortal,
					{ inversionistaId: 7 },
					contexto(),
				),
			).rejects.toThrow("Dar acceso al portal: cartera no está respondiendo");
		} finally {
			console.error = consolaOriginal;
		}

		expect(intentos).toHaveLength(1);
		expect(inserts).toHaveLength(0);
	});

	test("el rechazo de cartera llega con SU mensaje, no como 'Internal server error'", async () => {
		// Para esto existe `toCarteraOrpcError`: oRPC solo conserva el mensaje de
		// los `ORPCError`, así que sin el envoltorio el 403 de cartera —el estado
		// que `DEPLOYMENT.md:53` documenta como real y recuperable cuando
		// `CARTERA_USER` no es ADMIN— llegaba al navegador como "Internal server
		// error" y quien lo veía abría ticket en vez de corregir la variable.
		responderCartera = async () => {
			throw new moduloReal.CarteraBackHttpError(
				"forbidden: Solo un ADMIN puede abrir accesos al portal",
				403,
				{
					error: "forbidden",
					message: "Solo un ADMIN puede abrir accesos al portal",
				},
			);
		};

		await expect(
			call(
				investorDocumentsRouter.darAccesoPortal,
				{ inversionistaId: 7 },
				contexto(),
			),
		).rejects.toThrow("Solo un ADMIN puede abrir accesos al portal");

		// Y NO deja fila, al revés que el timeout: el 403 es la primera línea de
		// `otorgarAccesoPortal.ts`, así que cartera no llegó a provisionar nada.
		// Que eso siga siendo cierto depende de que el cliente no reenvíe el POST
		// reautenticado (`cartera-back-client.portalAccess.test.ts`).
		expect(intentos).toHaveLength(0);
	});

	test("rechaza un id que no es un entero positivo antes de salir a cartera", async () => {
		await expect(
			call(
				investorDocumentsRouter.darAccesoPortal,
				{ inversionistaId: 0 } as never,
				contexto(),
			),
		).rejects.toThrow();

		expect(idsEnviados).toHaveLength(0);
		expect(inserts).toHaveLength(0);
	});

	// El guard se mockea arriba (si no, cada test tendría que montar la sesión
	// contra la base), así que la suite no puede verlo. Esta verificación lee el
	// código: sin ella, cambiar el procedure por uno público pasaría en verde.
	//
	// Y exige el ESTRECHO (`investmentProcedure` →
	// `PERMISSIONS.canAccessInvestments`: ADMIN y los tres roles de
	// inversiones). Con el ancho de antes, las once familias que cubre
	// `crmCobrosOrInvestmentsProcedure` podían hacer salir una contraseña del
	// portal, y como el mismo guard cubre `editarInversionista` —que cambia el
	// `email` del inversionista— podían además elegir a qué buzón llegaba.
	test("el procedure cuelga del guard de inversiones, no del de back office", () => {
		const fuente = readFileSync(
			join(import.meta.dir, "investor-documents.ts"),
			"utf8",
		);
		expect(fuente).toContain("darAccesoPortal: investmentProcedure");
		// El negativo NO es redundante: sin él, agregar una segunda definición
		// con el guard ancho —o volver atrás dejando la línea nueva en un
		// comentario— seguiría pasando.
		expect(fuente).not.toContain(
			"darAccesoPortal: crmCobrosOrInvestmentsProcedure",
		);
	});

	// Canario: si `?real` dejara de saltarse el registro de mocks, el
	// namespace volvería a publicarse recortado y estos archivos volverían a
	// no ejecutarse en una corrida por directorio.
	test("el namespace publicado conserva los exports reales del módulo", () => {
		expect(typeof (moduloReal as any).CarteraBackHttpError).toBe("function");
		expect(typeof (moduloReal as any).CarteraBackClient).toBe("function");
	});

	// ========================================================================
	// SE APRUEBA UN CORREO, NO UN ID
	// ========================================================================
	//
	// El diálogo le enseña un correo a una persona y le pide aprobarlo. Hasta
	// que este campo existió, el clic mandaba solo el id y cartera releía la
	// fila para saber a dónde mandar la contraseña: lo aprobado y lo usado eran
	// dos lecturas distintas de algo reescribible en el medio, y quien lo
	// reescribe (`editarInversionista`, once familias de rol) no es quien
	// aprueba (este botón, cuatro).

	test("el correo aprobado llega hasta el cliente de cartera", async () => {
		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7, correoAprobado: "ana@ejemplo.com" },
			contexto(),
		);

		// La mutación que esto mata: que el procedure acepte el campo y no lo
		// pase. El diálogo se vería igual y el control no existiría.
		expect(idsEnviados).toEqual([[7]]);
		expect(correosAprobadosEnviados).toEqual(["ana@ejemplo.com"]);
	});

	// El camino de la EMPRESA sigue vivo: su diálogo no enseña correo porque la
	// cuenta es del representante legal, y cartera ya corta antes.
	test("sin correo aprobado el procedure sigue funcionando (empresa)", async () => {
		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			contexto(),
		);

		expect(idsEnviados).toEqual([[7]]);
		// Llamó, y con la llave AUSENTE. No es lo mismo que no haber llamado.
		expect(correosAprobadosEnviados).toEqual([undefined]);
	});

	test("el correo aprobado se recorta antes de salir", async () => {
		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7, correoAprobado: "  ana@ejemplo.com  " },
			contexto(),
		);

		expect(correosAprobadosEnviados).toEqual(["ana@ejemplo.com"]);
	});

	// LA PRUEBA QUE IMPORTA del campo vacío. Un diálogo que SÍ tenía que
	// enseñar un correo y llegó sin él es un front roto. Tratarlo como "no se
	// aprobó nada" provisionaría SIN aprobación — el agujero, servido por el
	// propio arreglo. Rebota acá, un escalón antes del `correo_aprobado_invalido`
	// de cartera, y `null` cae igual aunque cartera lo trate como ausente.
	test("un correo aprobado vacío rebota sin llegar a cartera y SIN dejar fila", async () => {
		for (const vacio of ["", "   ", "\t", null]) {
			idsEnviados.length = 0;
			correosAprobadosEnviados.length = 0;
			intentos.length = 0;

			await expect(
				call(
					investorDocumentsRouter.darAccesoPortal,
					{ inversionistaId: 7, correoAprobado: vacio } as never,
					contexto(),
				),
			).rejects.toThrow();

			expect(idsEnviados).toHaveLength(0);
			// Y NO deja constancia. Importa: el `catch` del handler le pregunta a
			// `exigeConstanciaPorFalla(null)`, que contesta "registrá" —es su
			// respuesta correcta para un timeout—. Si este rechazo llegara hasta
			// ahí, la bitácora diría "no se sabe si la contraseña salió" sobre una
			// petición que NUNCA salió. Lo evita zod, que corta antes del handler.
			expect(intentos).toHaveLength(0);
		}
	});

	test("un correo aprobado más largo que la columna rebota; uno de 255 pasa", async () => {
		// 256: uno más que `inversionistas.email` (varchar(255)) y que el
		// `maxLength` de cartera. El largo se afirma para que no se vuelva otra
		// cosa al editar la cadena.
		const pasado = `${"a".repeat(244)}@ejemplo.com`;
		expect(pasado).toHaveLength(256);

		await expect(
			call(
				investorDocumentsRouter.darAccesoPortal,
				{ inversionistaId: 7, correoAprobado: pasado },
				contexto(),
			),
		).rejects.toThrow();
		expect(idsEnviados).toHaveLength(0);

		// 255 exactos CON espacios alrededor: el `.trim()` corre antes del
		// `.max(255)`, así que entra —y llega a cartera midiendo 255, que es lo
		// que su `maxLength` mide—. Sin ese orden, un correo legítimo se iría en
		// 422 y quien aprueba vería un error sin causa visible.
		const alLimite = `${"a".repeat(243)}@ejemplo.com`;
		expect(alLimite).toHaveLength(255);
		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7, correoAprobado: `  ${alLimite}  ` },
			contexto(),
		);
		expect(correosAprobadosEnviados).toEqual([alLimite]);
	});

	// ========================================================================
	// EL VETO
	// ========================================================================

	// LA PRUEBA QUE IMPORTA de la bitácora. El veto no provisiona nada, así que
	// por forma se parece a los no-ops que `exigeConstancia` calla (la empresa).
	// No lo es: significa que el correo de la fila CAMBIÓ entre que el diálogo se
	// pintó y el clic llegó — el evento contra el que existe todo esto. Si se
	// callara, la única alarma de la carrera se apagaría.
	test("el VETO por correo que cambió DEJA fila en la bitácora", async () => {
		responderCartera = async () =>
			desenlace({ estado: "fallo", motivo: "correo_aprobado_no_coincide" });

		const actual = await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7, correoAprobado: "vieja@ejemplo.com" },
			contexto(),
		);

		expect(inserts).toHaveLength(1);
		expect(inserts[0].valores).toMatchObject({
			inversionistaId: 7,
			action: "acceso_portal",
			performedBy: "usr_operador",
		});
		expect(inserts[0].valores.details).toMatchObject({
			estado: "fallo",
			motivo: "correo_aprobado_no_coincide",
			// Lo que se aprobó queda escrito. Cartera NO devuelve el correo que
			// la fila tiene AHORA, así que esta es la única evidencia de lo que el
			// diálogo enseñaba; con el `investor_updated` de `editarInversionista`
			// —que sí guarda el email nuevo— se reconstruye la carrera entera.
			correoAprobado: "vieja@ejemplo.com",
		});

		// Y el veto vuelve al front tal cual: es lo que explica por qué no pasó
		// nada y por qué hay que volver a mirar la pantalla.
		expect((actual as any).resultados[0].motivo).toBe(
			"correo_aprobado_no_coincide",
		);
	});

	test("el correo aprobado queda escrito también cuando el acto SÍ ocurrió", async () => {
		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7, correoAprobado: "ana@ejemplo.com" },
			contexto(),
		);

		expect(inserts[0].valores.details).toMatchObject({
			estado: "creada",
			usuarioEmail: "ana@ejemplo.com",
			correoAprobado: "ana@ejemplo.com",
		});
	});

	// Donde MÁS vale: acá no se sabe si la contraseña salió, y `usuarioEmail`
	// viene en null porque cartera nunca contestó. El correo aprobado es el
	// único dato de a dónde habría ido a parar.
	test("un timeout deja constancia CON el correo que se había aprobado", async () => {
		responderCartera = async () => {
			throw new Error("socket hang up");
		};

		await expect(
			call(
				investorDocumentsRouter.darAccesoPortal,
				{ inversionistaId: 7, correoAprobado: "ana@ejemplo.com" },
				contexto(),
			),
		).rejects.toThrow("cartera no está respondiendo");

		expect(inserts).toHaveLength(1);
		expect(inserts[0].valores.details).toMatchObject({
			estado: "sin_respuesta_de_cartera",
			usuarioEmail: null,
			correoAprobado: "ana@ejemplo.com",
		});
	});

	// La empresa no aprueba ningún correo, y la fila lo dice en vez de callarlo:
	// una llave ausente se lee igual que una que alguien olvidó escribir.
	test("sin correo aprobado la fila lo deja en null, no omitido", async () => {
		responderCartera = async () => desenlace({ estado: "ya_tenia" });

		await call(
			investorDocumentsRouter.darAccesoPortal,
			{ inversionistaId: 7 },
			contexto(),
		);

		expect(inserts).toHaveLength(1);
		expect(inserts[0].valores.details).toHaveProperty("correoAprobado", null);
	});

	// Los dos 400 con que cartera rechaza la LLAMADA ENTERA por culpa de este
	// campo. Los dos guards corren antes del `db.select` de cartera, así que no
	// se provisionó nada y `STATUS_SIN_EFECTO` (que ya trae el 400) acierta al
	// no dejar fila. Se fija acá para que quede atado a estos motivos nuevos.
	test("los 400 de cartera por el correo aprobado no dejan fila", async () => {
		for (const codigo of [
			"correo_aprobado_invalido",
			"correo_aprobado_con_varios_inversionistas",
		]) {
			intentos.length = 0;
			responderCartera = async () => {
				throw new moduloReal.CarteraBackHttpError(`HTTP 400: ${codigo}`, 400, {
					error: codigo,
					message: "El correo aprobado viene vacío",
				});
			};

			await expect(
				call(
					investorDocumentsRouter.darAccesoPortal,
					{ inversionistaId: 7, correoAprobado: "ana@ejemplo.com" },
					contexto(),
				),
			).rejects.toThrow();

			expect(intentos).toHaveLength(0);
		}
	});
});

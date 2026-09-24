import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { call, os } from "@orpc/server";

/**
 * `estadoAccesoPortal`: la CONSULTA que decide si el botón va en gris.
 *
 * Dos cosas la separan de `darAccesoPortal`, y las dos se prueban aquí:
 *
 *  1. NO deja rastro en `investor_activity_log`. Corre en cada carga de la
 *     pantalla del inversionista; registrarla inundaría la bitácora y taparía
 *     los actos reales —quién mandó una contraseña—, que es justo lo único que
 *     esa tabla existe para conservar.
 *
 *  2. Devuelve `tieneCuentaSana` ya calculado. Si ese booleano dijera `true`
 *     sobre una cuenta rota, la persona quedaría con el botón gris y sin
 *     ninguna forma de arreglarlo desde la pantalla.
 */

const inserts: { tabla: unknown; valores: Record<string, any> }[] = [];
const idsConsultados: number[] = [];
let responderCartera: () => Promise<unknown> = async () => ({});

const procedure = os.$context<any>();

// `../lib/orpc` se publica ENTERO, con SOLO los dos procedures que este router
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
// quedan en pie: lo único sustituido son los dos procedures de este router.
const orpcReal = (await import(
	`${"../lib/orpc.ts"}?real`
)) as typeof import("../lib/orpc");

mock.module("../lib/orpc", () => ({
	...orpcReal,
	crmCobrosOrInvestmentsProcedure: procedure,
	investmentManagerProcedure: procedure,
}));

// CANARIO de `../lib/orpc` (el hermano del de `cartera-back-client`, más abajo):
// si otra suite llegó primero con un recorte y la lista quedó congelada, esto
// revienta con un mensaje que lo dice, en vez de dejar el archivo sin cargar.
const orpcPublicado: any = await import("../lib/orpc");
// Se chequean exports que NINGÚN mock de este repo sustituye y que el recorte
// histórico de `cobros.moraRecuperacion.test.ts` omitía: si el canario mirara
// los que el recorte sí traía, pasaría en verde sobre una lista rota.
for (const exportFaltante of [
	"investmentProcedure",
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
		consultarAccesoPortal: async (id: number) => {
			idsConsultados.push(id);
			return await responderCartera();
		},
		// El camino que CREA la cuenta y manda la contraseña. Una consulta que
		// lo tocara convertiría abrir una pantalla en un envío de credenciales.
		otorgarAccesoPortal: async () => {
			throw new Error(
				"ESCRITURA PROHIBIDA en una consulta: otorgarAccesoPortal",
			);
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

const respuesta = (over: Record<string, unknown> = {}) => ({
	estado: "ya_tenia",
	usuarioEmail: "ana@ejemplo.com",
	resueltoPor: "dpi",
	advertencias: [] as string[],
	motivo: null,
	...over,
});

const consultar = (inversionistaId = 7) =>
	call(
		investorDocumentsRouter.estadoAccesoPortal,
		{ inversionistaId },
		contexto(),
	) as Promise<Record<string, any>>;

describe("estadoAccesoPortal", () => {
	beforeEach(() => {
		inserts.length = 0;
		idsConsultados.length = 0;
		responderCartera = async () => respuesta();
	});

	test("consulta el id y devuelve el crudo con el booleano ya calculado", async () => {
		const actual = await consultar(7);

		expect(idsConsultados).toEqual([7]);
		expect(actual).toEqual({
			tieneCuentaSana: true,
			estado: "ya_tenia",
			usuarioEmail: "ana@ejemplo.com",
			advertencias: [],
			motivo: null,
		});
	});

	// LA PRUEBA QUE IMPORTA: la que impide encerrar a alguien tras un botón
	// gris con una cuenta que no le sirve.
	test("una cuenta sin el rol de inversionista NO se reporta sana", async () => {
		responderCartera = async () =>
			respuesta({ advertencias: ["cuenta_sin_rol_de_inversionista"] });

		const actual = await consultar(7);

		expect(actual.tieneCuentaSana).toBe(false);
		// Y la advertencia VIAJA: sin ella la pantalla no tendría con qué
		// explicar por qué el botón sigue activo sobre alguien que "ya tiene"
		// cuenta.
		expect(actual.advertencias).toEqual(["cuenta_sin_rol_de_inversionista"]);
		expect(actual.estado).toBe("ya_tenia");
	});

	test("una empresa no reporta cuenta sana: el acceso es del representante", async () => {
		responderCartera = async () =>
			respuesta({
				estado: "omitida",
				usuarioEmail: null,
				resueltoPor: null,
				motivo: "es_empresa",
			});

		const actual = await consultar(86);

		expect(actual.tieneCuentaSana).toBe(false);
		expect(actual.motivo).toBe("es_empresa");
	});

	test("NO deja rastro en la bitácora: esto corre en cada carga de pantalla", async () => {
		await consultar(7);
		await consultar(7);
		await consultar(7);

		expect(inserts).toEqual([]);
	});

	test("un fallo de cartera-back se propaga en vez de fingir 'no tiene cuenta'", async () => {
		// Tragárselo y devolver `tieneCuentaSana: false` se ve idéntico a una
		// respuesta legítima, y deja el botón activo sobre alguien que quizá ya
		// tiene cuenta.
		responderCartera = async () => {
			throw new Error("socket hang up");
		};

		await expect(consultar(7)).rejects.toThrow(
			"Consultar acceso al portal: cartera no está respondiendo",
		);
		expect(inserts).toHaveLength(0);
	});

	test("el rechazo de cartera llega con SU mensaje, no como 'Internal server error'", async () => {
		// Hermano de la prueba equivalente en `investor-documents.portalAccess.test.ts`:
		// sin `toCarteraOrpcError`, oRPC aplasta el 403 de cartera a "Internal
		// server error" y se pierde el único texto que dice qué corregir.
		responderCartera = async () => {
			throw new moduloReal.CarteraBackHttpError(
				"forbidden: Solo un ADMIN puede consultar accesos al portal",
				403,
				{
					error: "forbidden",
					message: "Solo un ADMIN puede consultar accesos al portal",
				},
			);
		};

		await expect(consultar(7)).rejects.toThrow(
			"Solo un ADMIN puede consultar accesos al portal",
		);
		expect(inserts).toHaveLength(0);
	});

	test("rechaza un id que no es un entero positivo antes de salir a cartera", async () => {
		for (const id of [0, -1, 1.5]) {
			await expect(consultar(id)).rejects.toThrow();
		}
		expect(idsConsultados).toHaveLength(0);
	});

	// El guard se mockea arriba, así que la suite no puede verlo. Esto lee el
	// código: sin ello, cambiar el procedure por uno público pasaría en verde.
	test("el procedure sigue colgado del guard de back office", () => {
		const fuente = readFileSync(
			join(import.meta.dir, "investor-documents.ts"),
			"utf8",
		);
		expect(fuente).toContain(
			"estadoAccesoPortal: crmCobrosOrInvestmentsProcedure",
		);
	});

	test("está registrado en el router raíz, si no el CRM no puede llamarlo", () => {
		const fuente = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
		expect(fuente).toContain(
			"estadoAccesoPortal: investorDocumentsRouter.estadoAccesoPortal",
		);
	});

	// Canario: si `?real` dejara de saltarse el registro de mocks, el
	// namespace volvería a publicarse recortado y estos archivos volverían a
	// no ejecutarse en una corrida por directorio.
	test("el namespace publicado conserva los exports reales del módulo", () => {
		expect(typeof (moduloReal as any).CarteraBackHttpError).toBe("function");
		expect(typeof (moduloReal as any).CarteraBackClient).toBe("function");
	});
});

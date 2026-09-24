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

const inserts: { tabla: unknown; valores: Record<string, any> }[] = [];
const idsEnviados: number[][] = [];
let responderCartera: () => Promise<unknown> = async () => ({
	message: "Procesados 1 inversionista(s)",
	resultados: [],
});

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
		otorgarAccesoPortal: async (ids: number[]) => {
			idsEnviados.push(ids);
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

describe("darAccesoPortal", () => {
	beforeEach(() => {
		inserts.length = 0;
		idsEnviados.length = 0;
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

	test("un tropiezo de red se propaga traducido y NO deja registro de éxito", async () => {
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

		expect(inserts).toHaveLength(0);
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
	test("el procedure sigue colgado del guard de back office", () => {
		const fuente = readFileSync(
			join(import.meta.dir, "investor-documents.ts"),
			"utf8",
		);
		expect(fuente).toContain(
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
});

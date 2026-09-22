import { beforeEach, describe, expect, mock, test } from "bun:test";

import { user } from "../db/schema/auth";
import { opportunities, salesStages } from "../db/schema/crm";

/**
 * Los dos caminos por los que una oportunidad avanzada podía quedar respaldada
 * por una identidad que nunca pasó las validaciones.
 *
 * 🔴 Por qué estas pruebas ejercitan el procedure y no cuentan llamadas. Los
 * "wiring tests" de este stack verifican que la LLAMADA al gate exista contando
 * el texto del fuente, y está comprobado que cambiar `if (x.rechazado)` por
 * `if (false && x.rechazado)` los deja a todos en verde: miden que el código
 * esté escrito, no que se respete. Acá se afirma sobre el EFECTO — que el
 * `update` sobre `opportunities` no ocurrió— porque es lo único que no se puede
 * satisfacer dejando el guard desconectado.
 */

type Fila = Record<string, unknown>;

/** Lo que devuelve un SELECT, por tabla. La proyección de columnas se ignora. */
const filasPorTabla = new Map<unknown, Fila[]>();

type Escritura = { tipo: "update" | "insert"; tabla: unknown; valores: Fila };
const escrituras: Escritura[] = [];

/** Lo que devuelve el `returning()` de un UPDATE, para que el handler siga. */
let filasDevueltasPorUpdate: Fila[] = [{ id: "oportunidad" }];

function constructorSelect() {
	let tabla: unknown = null;
	const filas = () => filasPorTabla.get(tabla) ?? [];
	// Drizzle encadena en cualquier orden y a veces se espera el builder
	// directamente (sin `limit`), así que el builder es thenable.
	const b: Record<string, unknown> = {
		from(t: unknown) {
			tabla = t;
			return b;
		},
		innerJoin: () => b,
		leftJoin: () => b,
		where: () => b,
		orderBy: () => b,
		groupBy: () => b,
		for: () => b,
		limit: () => b,
		// biome-ignore lint/suspicious/noThenProperty: el doble imita a Drizzle, que se espera con await sin cerrar la cadena.
		then: (ok: (v: Fila[]) => unknown, fail?: (e: unknown) => unknown) =>
			Promise.resolve(filas()).then(ok, fail),
	};
	return b;
}

function constructorUpdate(tabla: unknown) {
	let valores: Fila = {};
	const b: Record<string, unknown> = {
		set(v: Fila) {
			valores = v;
			return b;
		},
		// El registro va en `where` porque los dos usos —con `returning()` y
		// esperando el builder— pasan por acá.
		where() {
			escrituras.push({ tipo: "update", tabla, valores });
			return b;
		},
		returning: () => Promise.resolve(filasDevueltasPorUpdate),
		// biome-ignore lint/suspicious/noThenProperty: el doble imita a Drizzle, que se espera con await sin cerrar la cadena.
		then: (ok: (v: Fila[]) => unknown, fail?: (e: unknown) => unknown) =>
			Promise.resolve(filasDevueltasPorUpdate).then(ok, fail),
	};
	return b;
}

function constructorInsert(tabla: unknown) {
	const b: Record<string, unknown> = {
		values(v: Fila) {
			escrituras.push({ tipo: "insert", tabla, valores: v });
			return b;
		},
		onConflictDoNothing: () => b,
		returning: () => Promise.resolve([{ id: "fila-nueva" }]),
		// biome-ignore lint/suspicious/noThenProperty: el doble imita a Drizzle, que se espera con await sin cerrar la cadena.
		then: (ok: (v: Fila[]) => unknown, fail?: (e: unknown) => unknown) =>
			Promise.resolve([{ id: "fila-nueva" }]).then(ok, fail),
	};
	return b;
}

const dbFalso = {
	select: () => constructorSelect(),
	update: (tabla: unknown) => constructorUpdate(tabla),
	insert: (tabla: unknown) => constructorInsert(tabla),
	delete: () => ({ where: async () => [] }),
	execute: async () => [],
	transaction: async <T>(correr: (tx: unknown) => Promise<T>) =>
		await correr(dbFalso),
};

/**
 * ⚠️ `mock.module` es global al proceso y gana el ÚLTIMO que lo llama, así que
 * otro archivo de test que también doble `../db` —`reports.authorization.test.ts`
 * lo hace— le roba la conexión a este. Por eso el doble se vuelve a instalar
 * antes de cada prueba y no solo una vez al cargar el archivo.
 */
const instalarDbFalso = () => mock.module("../db", () => ({ db: dbFalso }));

instalarDbFalso();

const { crmRouter } = await import("./crm");

/**
 * Se invoca el handler del procedure, no `call(...)`.
 *
 * ⚠️ `call` corre antes los middlewares de `lib/orpc.ts`, que resuelven el rol
 * consultando la base — y el `db` que ve ESE módulo lo fijó el primer archivo de
 * test que lo cargó, no este (`mock.module` es global al proceso y no
 * re-vincula lo ya importado). La suite completa terminaba resolviendo el rol
 * contra el doble de `cobros.moraRecuperacion.test.ts` y el procedure moría en
 * el chequeo de permisos, que no es lo que estas pruebas miden. El control de
 * acceso de `approveCreditDetail` y `updateOpportunity` no cambió en este
 * arreglo; lo que se ejercita es el handler REAL, con su misma lógica y sus
 * mismas escrituras.
 */
type ProcedimientoInvocable = {
	"~orpc": { handler: (opciones: Record<string, unknown>) => Promise<unknown> };
};

const invocar = (
	procedimiento: unknown,
	input: Record<string, unknown>,
	contexto: Record<string, unknown>,
) =>
	(procedimiento as ProcedimientoInvocable)["~orpc"].handler({
		input,
		context: contexto,
		path: [],
		procedure: procedimiento,
		errors: {},
		signal: undefined,
		lastEventId: undefined,
	});

const contextoDe = (userId: string, userRole: string) => ({
	session: { user: { id: userId } },
	user: { id: userId, role: userRole },
	userId,
	userRole,
});

const escriturasSobreOportunidades = () =>
	escrituras.filter((e) => e.tabla === opportunities);

beforeEach(async () => {
	await instalarDbFalso();
	filasPorTabla.clear();
	escrituras.length = 0;
	filasDevueltasPorUpdate = [{ id: "oportunidad" }];
});

describe("approveCreditDetail: no aprueba sobre un análisis que no está vigente", () => {
	const ETAPA_FORMALIZACION = "11111111-1111-4111-8111-111111111111";
	const OPORTUNIDAD = "22222222-2222-4222-8222-222222222222";

	/**
	 * El estado exacto en que queda una oportunidad después de
	 * `parcheDeRevalidacion`: volvió a la etapa de análisis (30%), el análisis
	 * está `pending` y el detalle sin aprobar, con la marca de revalidación
	 * puesta. La evidencia de identidad que tiene es de la identidad ANTERIOR.
	 */
	const reciénRevalidada = {
		id: OPORTUNIDAD,
		title: "Crédito de prueba",
		stageId: "etapa-analisis",
		analysisStatus: "pending",
		creditDetailApproved: false,
		identityRevalidatedAt: new Date("2026-09-20T12:00:00.000Z"),
		leadId: "lead-a",
		assignedTo: "vendedor",
		status: "open",
	};

	test("una oportunidad que acaba de revalidar su identidad no llega a Formalización", async () => {
		filasPorTabla.set(user, [{ id: "supervisor", role: "sales_supervisor" }]);
		filasPorTabla.set(opportunities, [reciénRevalidada]);
		filasPorTabla.set(salesStages, [{ id: ETAPA_FORMALIZACION, order: 6 }]);

		await expect(
			invocar(
				crmRouter.approveCreditDetail,
				{ opportunityId: OPORTUNIDAD },
				contextoDe("supervisor", "sales_supervisor"),
			),
		).rejects.toThrow(/el análisis de esta oportunidad no está aprobado/);

		// Lo que de verdad importa: la oportunidad no se movió ni quedó marcada.
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("con el análisis aprobado y vigente sí avanza a Formalización", async () => {
		filasPorTabla.set(user, [{ id: "supervisor", role: "sales_supervisor" }]);
		filasPorTabla.set(opportunities, [
			{
				...reciénRevalidada,
				stageId: "etapa-cierre-propuesta",
				analysisStatus: "approved",
				identityRevalidatedAt: null,
			},
		]);
		filasPorTabla.set(salesStages, [{ id: ETAPA_FORMALIZACION, order: 6 }]);

		await expect(
			invocar(
				crmRouter.approveCreditDetail,
				{ opportunityId: OPORTUNIDAD },
				contextoDe("supervisor", "sales_supervisor"),
			),
		).resolves.toEqual({ success: true });

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores).toMatchObject({
			stageId: ETAPA_FORMALIZACION,
			creditDetailApproved: true,
		});
	});
});


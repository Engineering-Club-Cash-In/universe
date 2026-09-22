import { beforeEach, describe, expect, mock, test } from "bun:test";

import { user } from "../db/schema/auth";
import { leads, opportunities, salesStages } from "../db/schema/crm";

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

describe("updateOpportunity: reasignar el lead no cambia la identidad del expediente", () => {
	const OPORTUNIDAD = "33333333-3333-4333-8333-333333333333";
	const LEAD_A = "44444444-4444-4444-8444-444444444444";
	const LEAD_MOROSO = "55555555-5555-4555-8555-555555555555";

	/**
	 * Lead limpio que ya llegó al 40% con RENAP, buró, documentos y análisis
	 * aprobado. La fila lleva juntas las columnas de `opportunities` y las de la
	 * vista del candado (`obtenerOportunidadesParaCandadoDpi`) porque el doble de
	 * la base ignora la proyección de columnas.
	 */
	const aprobadaAl40 = {
		id: OPORTUNIDAD,
		title: "Crédito aprobado",
		leadId: LEAD_A,
		stageId: "etapa-cierre-propuesta",
		status: "open",
		assignedTo: "vendedor",
		analysisStatus: "approved",
		creditDetailApproved: true,
		vehicleId: null,
		companyId: null,
		vendorId: null,
		creditType: "autocompra",
		diaPagoMensual: 15,
		diaPagoOriginalSistema: null,
		insuranceProvider: "universales",
		updatedAt: new Date("2026-09-20T12:00:00.000Z"),
		// Vista del candado: la etapa de hoy y la más alta por la que pasó.
		stageName: "Cierre de propuesta",
		closurePercentage: 40,
		maxHistoricoClosurePercentage: 40,
	};

	test("el vendedor no puede colgar otro lead de una oportunidad que ya cruzó el 30%", async () => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [aprobadaAl40]);
		filasPorTabla.set(leads, [{ id: LEAD_MOROSO, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{ id: "etapa-cierre-propuesta", closurePercentage: 40, order: 5 },
		]);

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, leadId: LEAD_MOROSO },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/No se puede cambiar el cliente de esta oportunidad/);

		// El moroso no entró: la oportunidad sigue apuntando al lead original.
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("por debajo del 30% el lead todavía se puede corregir", async () => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [
			{
				...aprobadaAl40,
				stageId: "etapa-calificacion",
				analysisStatus: "not_applicable",
				creditDetailApproved: false,
				stageName: "Calificación",
				closurePercentage: 20,
				maxHistoricoClosurePercentage: 20,
			},
		]);
		filasPorTabla.set(leads, [{ id: LEAD_MOROSO, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{ id: "etapa-calificacion", closurePercentage: 20, order: 3 },
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_MOROSO },
			contextoDe("vendedor", "sales"),
		);

		expect(escriturasSobreOportunidades()[0]?.valores).toMatchObject({
			leadId: LEAD_MOROSO,
		});
	});
});

/**
 * 🔴 El bypass del candado, por la puerta del nacimiento.
 *
 * La maniobra completa era: crear la oportunidad DIRECTAMENTE en el 40%, armar
 * ahí todo el expediente con el lead A, bajarla al 30% —lo permite el update,
 * que solo bloquea retrocesos desde 90%— y quedarse con UNA sola fila de
 * historial, `from=40, to=30`. El máximo histórico se leía como `max(to)` = 30,
 * el candado se abría, `updateOpportunity({ leadId: B })` pasaba, y después se
 * volvía a subir.
 *
 * Se cierra por los dos lados. La lectura del historial pasó a mirar las dos
 * puntas de cada transición (`ALTURA_DE_LA_TRANSICION`, en `lead-dpi-lock.ts`),
 * que es lo que cubre a las oportunidades que YA existen. Y acá se saca la
 * precondición: por este procedure una oportunidad no nace arriba del umbral.
 */
describe("createOpportunity: una oportunidad no nace arriba del umbral del candado", () => {
	const ETAPA_PROSPECTO = "66666666-6666-4666-8666-666666666666";
	const ETAPA_CIERRE_PROPUESTA = "77777777-7777-4777-8777-777777777777";
	const LEAD = "88888888-8888-4888-8888-888888888888";

	test("nacer en una etapa candante (40%) queda rechazado y NO crea nada", async () => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		// Sin oportunidades previas: el chequeo de duplicado no se mete en el medio.
		filasPorTabla.set(opportunities, []);
		filasPorTabla.set(leads, [{ id: LEAD, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_CIERRE_PROPUESTA,
				name: "Cierre de propuesta",
				closurePercentage: 40,
				order: 5,
			},
		]);

		await expect(
			invocar(
				crmRouter.createOpportunity,
				{
					title: "Crédito nacido arriba",
					leadId: LEAD,
					creditType: "autocompra",
					stageId: ETAPA_CIERRE_PROPUESTA,
				},
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/No se puede crear una oportunidad directamente en/);

		// Lo que de verdad importa: la oportunidad no llegó a existir en el 40%,
		// así que no hay expediente que pueda bajar al 30% sin dejar rastro.
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("nacer en la etapa inicial (1%) sigue funcionando", async () => {
		// Red de seguridad: el tope no puede romper el alta normal, que es la que
		// usa el CRM (su selector "Etapa Inicial" solo ofrece de 1% a 20%).
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, []);
		filasPorTabla.set(leads, [{ id: LEAD, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_PROSPECTO,
				name: "Prospecto",
				closurePercentage: 1,
				order: 1,
			},
		]);

		await invocar(
			crmRouter.createOpportunity,
			{
				title: "Crédito normal",
				leadId: LEAD,
				creditType: "autocompra",
				stageId: ETAPA_PROSPECTO,
			},
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.tipo).toBe("insert");
		expect(escritura?.valores).toMatchObject({
			title: "Crédito normal",
			leadId: LEAD,
			stageId: ETAPA_PROSPECTO,
		});
	});
});

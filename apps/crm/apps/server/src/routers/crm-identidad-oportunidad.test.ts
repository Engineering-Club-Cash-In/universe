import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { user } from "../db/schema/auth";
import { leads, opportunities, salesStages } from "../db/schema/crm";
import { PORCENTAJE_CANDADO_DPI } from "../lib/lead-dpi-lock";

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

type Escritura = {
	tipo: "update" | "insert";
	tabla: unknown;
	valores: Fila;
	/**
	 * El WHERE con el que salió el UPDATE. Se guarda porque parte del candado no
	 * vive en un `if` sino DENTRO de la sentencia que escribe —Postgres lo
	 * re-evalúa después de esperar a la escritura rival—, y un test que sólo
	 * mire los `if` no lo ve.
	 */
	condicion?: unknown;
};
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
		where(condicion: unknown) {
			escrituras.push({ tipo: "update", tabla, valores, condicion });
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

/**
 * El WHERE del UPDATE, renderizado como se lo manda a Postgres.
 *
 * Es el mismo recurso que usa `lib/lead-dpi-lock.test.ts`: esta suite no tiene
 * un Postgres contra el cual ejecutar el predicado, así que se afirma sobre el
 * TEXTO y los parámetros que de verdad viajan, no sobre el fuente del handler.
 */
const renderizador = drizzle.mock();

/**
 * Lo que las escrituras sobre `opportunities` cambiaron de identidad, proyectado.
 * `escriturasSobreOportunidades()` entero arrastra el objeto de tabla de Drizzle
 * y un fallo se vuelve ilegible.
 */
const identidadEscrita = () =>
	escriturasSobreOportunidades().map((e) => ({
		tipo: e.tipo,
		leadId: e.valores.leadId,
		stageId: e.valores.stageId,
	}));

const sqlDeLaCondicion = (condicion: unknown) =>
	renderizador
		.select({ x: sql`1` })
		.from(opportunities)
		.where(condicion as SQL)
		.toSQL();

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

	/**
	 * 🔴 La maniobra de dos pasos, comprimida en UNO.
	 *
	 * El candado de arriba mira el estado PERSISTIDO: una oportunidad en 30% con
	 * el análisis aprobado para el lead A no canda todavía. Un solo request que
	 * mande `{ leadId: B, stageId: <etapa 40%> }` pasaba entero: el chequeo en
	 * memoria leía 30, el predicado atómico del UPDATE también leía 30 —porque
	 * el que la sube por encima del umbral es ESTE MISMO UPDATE—, y la misma
	 * sentencia reemplazaba al cliente Y cruzaba el umbral, dejando pegados la
	 * aprobación y toda la evidencia (RENAP, buró, documentos) del lead A.
	 */
	const ETAPA_40 = "99999999-9999-4999-8999-999999999999";
	const ETAPA_20 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

	/** En el 30%: hoy NO canda, y por eso el destino es lo único que decide. */
	const enAnalisisAl30 = {
		...aprobadaAl40,
		stageId: "etapa-analisis",
		vehicleId: "vehiculo-1",
		stageName: "Análisis",
		closurePercentage: 30,
		maxHistoricoClosurePercentage: 30,
	};

	test("cambiar el lead Y cruzar el umbral en el mismo request queda rechazado", async () => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [enAnalisisAl30]);
		filasPorTabla.set(leads, [{ id: LEAD_MOROSO, source: "web" }]);
		// El doble ignora el WHERE: la etapa que devuelve es la de DESTINO, que es
		// la que este request quiere aplicar.
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_40,
				name: "Cierre de propuesta",
				closurePercentage: 40,
				order: 5,
			},
		]);

		const salida = await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_MOROSO, stageId: ETAPA_40 },
			contextoDe("vendedor", "sales"),
		).then(
			() => null,
			(e: unknown) => e,
		);

		// Lo que de verdad importa, y lo primero que se afirma: el moroso no entró
		// y la oportunidad no se movió. Sin el arreglo acá hay UNA escritura con
		// `leadId: LEAD_MOROSO` y `stageId: ETAPA_40`.
		expect(identidadEscrita()).toEqual([]);
		expect((salida as Error | null)?.message).toMatch(
			/No se puede cambiar el cliente de esta oportunidad/,
		);
	});

	test("mover SOLO la etapa por encima del umbral no queda bloqueado", async () => {
		// Red de seguridad: el candado protege la identidad del expediente, no el
		// avance. Sin el lead de por medio, subir de etapa es el flujo normal.
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [enAnalisisAl30]);
		filasPorTabla.set(leads, []);
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_40,
				name: "Cierre de propuesta",
				closurePercentage: 40,
				order: 5,
			},
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, stageId: ETAPA_40 },
			contextoDe("vendedor", "sales"),
		);

		expect(escriturasSobreOportunidades()[0]?.valores).toMatchObject({
			stageId: ETAPA_40,
		});
	});

	test("el UPDATE que cambia el lead lleva la etapa de DESTINO en su propio WHERE", async () => {
		// 🔴 El chequeo en memoria leyó la fila ANTES del UPDATE. Entre la lectura
		// y la escritura otra transacción puede mover la oportunidad, así que la
		// condición tiene que viajar dentro de la misma sentencia —Postgres la
		// re-evalúa tras esperar a la escritura rival— y con la etapa de destino
		// adentro, no sólo con el estado guardado.
		//
		// Se ejercita con un destino que NO canda (20%), porque es el único caso
		// en que el UPDATE llega a salir y se le puede mirar el WHERE.
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
			{ id: ETAPA_20, name: "Calificación", closurePercentage: 20, order: 3 },
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_MOROSO, stageId: ETAPA_20 },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores).toMatchObject({ leadId: LEAD_MOROSO });

		const { sql: texto, params } = sqlDeLaCondicion(escritura?.condicion);

		// La rama de la etapa de destino existe en la sentencia que escribe.
		expect(texto.replace(/\s+/g, " ").toLowerCase()).toContain(
			"ed.closure_percentage >",
		);

		// Y usa el MISMO umbral que el resto del candado, no un 30 suelto: tres
		// veces —etapa actual, historial y destino— contra las dos de antes.
		expect(params.filter((p) => p === PORCENTAJE_CANDADO_DPI)).toHaveLength(3);

		// El destino que viaja es el del request, no el guardado.
		expect(params).toContain(ETAPA_20);
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

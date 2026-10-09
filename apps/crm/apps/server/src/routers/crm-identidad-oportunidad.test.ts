import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { user } from "../db/schema/auth";
import { infornetPersonaCache } from "../db/schema/buro";
import { creditApplications } from "../db/schema/client-forms";
import { coDebtors, leads, opportunities, salesStages } from "../db/schema/crm";
import {
	documentRequirementsByClientType,
	opportunityDocuments,
} from "../db/schema/documents";
import { otps } from "../db/schema/otp";
import { opportunityValidations } from "../db/schema/validations";
import { vehicles } from "../db/schema/vehicles";
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
let secuenciaEtapas: Fila[][] = [];
const lecturasPorTabla: unknown[] = [];
let respuestaExecute: unknown = [];
let alEjecutar: (() => void) | null = null;
let candadoBuroOcupado = false;

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
	const filas = () => (
		lecturasPorTabla.push(tabla),
		tabla === salesStages && secuenciaEtapas.length > 0
			? (secuenciaEtapas.shift() ?? [])
			: (filasPorTabla.get(tabla) ?? [])
	);
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
	execute: async (consulta?: unknown) => {
		alEjecutar?.();
		if (JSON.stringify(consulta)?.includes("pg_try_advisory_xact_lock")) {
			return { rows: [{ tomado: !candadoBuroOcupado }] };
		}
		return respuestaExecute;
	},
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
const { validationsRouter } = await import("./validations");
const { ejecutarBuroAlVeinteSiCorresponde, getValidaciones } = await import(
	"../services/opportunity-validations"
);

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

/**
 * El texto de un valor que viaja en el `.set()` de un UPDATE. Parte de la
 * invalidación de identidad no es un literal sino una expresión que resuelve la
 * fila VIVA al escribir, y desde acá lo único observable es el SQL que sale.
 */
const textoSqlDelValor = (valor: unknown) =>
	renderizador
		.select({ x: valor as SQL })
		.from(opportunities)
		.toSQL()
		.sql.replace(/\s+/g, " ")
		.toLowerCase();

/**
 * La fila como QUEDA después de una escritura.
 *
 * 🔴 Existe para que las pruebas de varios pasos encadenen el estado real en vez
 * de sembrarlo a mano: si el paso 2 se alimentara de una fila escrita por el
 * test, el test pasaría igual con el guard desconectado, que es justo lo que
 * esta suite no acepta.
 *
 * El doble de la base no ejecuta SQL, así que el único valor no literal que este
 * handler escribe —el `case` que degrada `approved`— se resuelve acá con la
 * MISMA regla que la prueba de al lado comprueba que de verdad viaja a Postgres.
 */
function aplicarEscritura(fila: Fila, escritura: Escritura | undefined): Fila {
	const valores: Fila = { ...(escritura?.valores ?? {}) };
	const analisis = valores.analysisStatus;

	if (analisis !== undefined && typeof analisis !== "string") {
		const texto = textoSqlDelValor(analisis);
		const degradaLoAprobado =
			texto.includes("case when") &&
			texto.includes("'approved'") &&
			texto.includes("'pending'");

		valores.analysisStatus =
			degradaLoAprobado && fila.analysisStatus === "approved"
				? "pending"
				: fila.analysisStatus;
	}

	return { ...fila, ...valores };
}

beforeEach(async () => {
	await instalarDbFalso();
	filasPorTabla.clear();
	lecturasPorTabla.length = 0;
	secuenciaEtapas = [];
	respuestaExecute = [];
	alEjecutar = null;
	candadoBuroOcupado = false;
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
 * 🔴 La tercera variante del bypass: partir la maniobra en DOS peticiones que,
 * una por una, son legales.
 *
 * El candado bloquea el cambio de lead a partir del 30%, pero EN el 30% lo deja
 * pasar a propósito (la comparación es `> 30`), y pasar no invalidaba nada. De
 * ahí salía:
 *
 *   1. Oportunidad en EXACTAMENTE 30% con `analysisStatus: "approved"`. Se
 *      cambia SÓLO el lead → pasa, porque 30 no canda.
 *   2. Otra petición mueve SÓLO la etapa al 40% → pasa, porque no toca el lead.
 *
 * Y el lead nuevo se quedaba con el expediente aprobado del anterior —RENAP,
 * buró, documentos, análisis de capacidad de pago— listo para que
 * `approveCreditDetail` lo empujara a Formalización.
 *
 * El arreglo no prohíbe el cambio: le pone precio. Cambiar el lead invalida la
 * validación previa en la MISMA sentencia que escribe el lead.
 */
describe("updateOpportunity: cambiar el lead cuesta revalidar, también EN el umbral", () => {
	const OPORTUNIDAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
	const LEAD_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
	const LEAD_MOROSO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
	const ETAPA_ANALISIS_30 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
	const ETAPA_40 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
	const ETAPA_FORMALIZACION = "12121212-1212-4121-8121-121212121212";
	const ETAPA_PROSPECTO_10 = "13131313-1313-4131-8131-131313131313";

	/**
	 * EXACTAMENTE en el umbral. El análisis ya está aprobado y el detalle de
	 * crédito todavía no: es el estado justo anterior a `approveCreditDetail`,
	 * que es el procedure que empuja la solicitud a Formalización (50%).
	 */
	const enElUmbralAprobada = {
		id: OPORTUNIDAD,
		title: "Crédito aprobado en análisis",
		leadId: LEAD_A,
		stageId: ETAPA_ANALISIS_30,
		status: "open",
		assignedTo: "vendedor",
		analysisStatus: "approved",
		creditDetailApproved: false,
		identityRevalidatedAt: null,
		vehicleId: "vehiculo-1",
		companyId: null,
		vendorId: null,
		creditType: "autocompra",
		diaPagoMensual: 15,
		diaPagoOriginalSistema: null,
		insuranceProvider: "universales",
		updatedAt: new Date("2026-09-20T12:00:00.000Z"),
		// Vista del candado: 30% hoy y 30% de máximo histórico. No canda.
		stageName: "Recepción de documentación y traslado a análisis",
		closurePercentage: 30,
		maxHistoricoClosurePercentage: 30,
	};

	test("el lead nuevo ya no hereda la aprobación del anterior", async () => {
		// ── Paso 1: se cambia SÓLO el lead, y SÍ pasa. El arreglo no lo prohíbe.
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [enElUmbralAprobada]);
		filasPorTabla.set(leads, [{ id: LEAD_MOROSO, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_ANALISIS_30,
				name: "Recepción de documentación y traslado a análisis",
				closurePercentage: 30,
				order: 4,
			},
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_MOROSO },
			contextoDe("vendedor", "sales"),
		);

		const [cambioDeLead] = escriturasSobreOportunidades();
		expect(cambioDeLead?.valores.leadId).toBe(LEAD_MOROSO);

		// ── Paso 2: la segunda petición, que mueve SÓLO la etapa al 40%. También
		// pasa —no toca el lead—, y tiene que seguir pasando.
		const trasElCambioDeLead = aplicarEscritura(
			enElUmbralAprobada,
			cambioDeLead,
		);
		expect(trasElCambioDeLead.leadId).toBe(LEAD_MOROSO);

		escrituras.length = 0;
		filasPorTabla.set(opportunities, [trasElCambioDeLead]);
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

		const trasSubirDeEtapa = aplicarEscritura(
			trasElCambioDeLead,
			escriturasSobreOportunidades()[0],
		);

		// ── El EFECTO, que es lo único que no se puede satisfacer dejando el guard
		// desconectado: con la maniobra completa hecha, el lead nuevo no llega a
		// Formalización con el expediente del anterior. Sin el arreglo,
		// `analysisStatus` seguía en "approved" acá y `approveCreditDetail`
		// empujaba la solicitud al 50%.
		escrituras.length = 0;
		filasPorTabla.set(user, [{ id: "supervisor", role: "sales_supervisor" }]);
		filasPorTabla.set(opportunities, [trasSubirDeEtapa]);
		filasPorTabla.set(salesStages, [{ id: ETAPA_FORMALIZACION, order: 6 }]);

		await expect(
			invocar(
				crmRouter.approveCreditDetail,
				{ opportunityId: OPORTUNIDAD },
				contextoDe("supervisor", "sales_supervisor"),
			),
		).rejects.toThrow(/el análisis de esta oportunidad no está aprobado/);

		expect(escriturasSobreOportunidades()).toEqual([]);

		// ── El mecanismo, ya sabiendo que el efecto es el correcto: el precio viaja
		// en la MISMA sentencia que escribe el lead, así que no hay una ventana en
		// la que el cliente nuevo esté puesto y la aprobación vieja siga en pie.
		expect(cambioDeLead?.valores.creditDetailApproved).toBe(false);
		expect(cambioDeLead?.valores.identityRevalidatedAt).toBeDefined();

		// Y la etapa NO se toca: está en el umbral, así que mandarla a análisis la
		// haría avanzar, no retroceder.
		expect(cambioDeLead?.valores.stageId).toBeUndefined();
	});

	test("corregir el lead en una etapa temprana no manda la oportunidad a análisis", async () => {
		// Red de seguridad. Operaciones tiene que poder arreglar un lead mal
		// asignado en etapas tempranas sin perder la oportunidad y reabrirla, y ahí
		// el parche no cuesta nada porque no hay nada aprobado que invalidar.
		//
		// Las dos afirmaciones de abajo son las que descartan las dos formas
		// equivocadas de escribir este arreglo: reusar el retroceso de etapa de
		// `parcheDeRevalidacion` tal cual (subiría una oportunidad de 10% al 30%) y
		// escribir `analysisStatus: "pending"` literal (la metería en la cola del
		// analista sin haber pasado por ventas, y en una rechazada borraría el
		// rastro del rechazo).
		const temprana = {
			...enElUmbralAprobada,
			stageId: ETAPA_PROSPECTO_10,
			analysisStatus: "not_applicable",
			// NULL como en las filas viejas, no `false`.
			creditDetailApproved: null,
			stageName: "Prospecto",
			closurePercentage: 10,
			maxHistoricoClosurePercentage: 10,
		};

		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [temprana]);
		filasPorTabla.set(leads, [{ id: LEAD_MOROSO, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_PROSPECTO_10,
				name: "Prospecto",
				closurePercentage: 10,
				order: 2,
			},
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_MOROSO },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores.leadId).toBe(LEAD_MOROSO);

		const resultante = aplicarEscritura(temprana, escritura);
		expect(resultante.stageId).toBe(ETAPA_PROSPECTO_10);
		expect(resultante.analysisStatus).toBe("not_applicable");
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

	test("nacer directamente en análisis (30%) sigue permitido y habilita Buró allí", async () => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, []);
		filasPorTabla.set(leads, [{ id: LEAD, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_CIERRE_PROPUESTA,
				name: "Recepción de documentación y traslado a análisis",
				closurePercentage: 30,
				order: 4,
			},
		]);

		await invocar(
			crmRouter.createOpportunity,
			{
				title: "Crédito directo a análisis",
				leadId: LEAD,
				creditType: "autocompra",
				stageId: ETAPA_CIERRE_PROPUESTA,
			},
			contextoDe("vendedor", "sales"),
		);
		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.tipo).toBe("insert");
		expect(escritura?.valores).toMatchObject({
			stageId: ETAPA_CIERRE_PROPUESTA,
			buroRevalidacionAl30: true,
		});
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
			buroRevalidacionAl30: false,
		});
	});
});

describe("getResumenBuroOportunidad: acceso antes de cualquier consulta", () => {
	const OPORTUNIDAD = "96969696-9696-4696-8696-969696969696";

	test.each([
		["cobros", "cobros"],
		["contabilidad", "accounting"],
		["jurídico", "juridico"],
		["asesor ajeno", "sales"],
	] as const)("rechaza a %s", async (_nombre, role) => {
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				assignedTo: "asesor-asignado",
				status: "open",
				porcentaje: 20,
			},
		]);
		await expect(
			invocar(
				validationsRouter.getResumenBuroOportunidad,
				{ opportunityId: OPORTUNIDAD },
				contextoDe("otro-usuario", role),
			),
		).rejects.toThrow(/No tienes acceso al Buró/);
		expect(escrituras).toEqual([]);
	});

	test("la acción que puede consultar Infornet rechaza a Jurídico", async () => {
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				assignedTo: "asesor-asignado",
				status: "open",
				porcentaje: 20,
			},
		]);
		await expect(
			invocar(
				validationsRouter.asegurarBuroOportunidad,
				{ opportunityId: OPORTUNIDAD },
				contextoDe("juridico", "juridico"),
			),
		).rejects.toThrow(/No tienes acceso al detalle de Buró/);
		expect(escrituras).toEqual([]);
	});

	test("ventas no puede validar manualmente Buró de una oportunidad ajena", async () => {
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				assignedTo: "asesor-asignado",
				status: "open",
				porcentaje: 20,
			},
		]);
		await expect(
			invocar(
				validationsRouter.marcarValidacionManual,
				{
					opportunityId: OPORTUNIDAD,
					tipo: "buro",
					motivo: "Verificado manualmente en Infornet",
				},
				contextoDe("asesor-ajeno", "sales"),
			),
		).rejects.toThrow(/No tienes acceso al detalle de Buró/);
		expect(escrituras).toEqual([]);
	});

	test("ventas no puede validar RENAP ni siquiera en su oportunidad", async () => {
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				assignedTo: "asesor-asignado",
				status: "open",
				porcentaje: 20,
			},
		]);
		await expect(
			invocar(
				validationsRouter.marcarValidacionManual,
				{
					opportunityId: OPORTUNIDAD,
					tipo: "renap",
					motivo: "Verificado manualmente en RENAP",
				},
				contextoDe("asesor-asignado", "sales"),
			),
		).rejects.toThrow(/No tienes acceso al detalle de Buró/);
		expect(escrituras).toEqual([]);
	});

	test("el resumen respeta la exención de WhatsApp acreditada por OTP y estudio vigente", async () => {
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				assignedTo: "asesor-asignado",
				status: "open",
				porcentaje: 20,
				source: "Whatsapp",
				leadSource: "Whatsapp",
				leadId: "10101010-1010-4010-8010-101010101010",
				leadDpi: "2978485181201",
				creditType: "autocompra",
			},
		]);
		filasPorTabla.set(otps, [{ id: "otp-validado", used: true }]);
		filasPorTabla.set(infornetPersonaCache, [
			{
				dpi: "2978485181201",
				expiraEn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			},
		]);
		filasPorTabla.set(opportunityValidations, []);
		filasPorTabla.set(documentRequirementsByClientType, [
			{ documentType: "clausula_consentimiento" },
		]);
		filasPorTabla.set(coDebtors, [
			{
				id: "30303030-3030-4030-8030-303030303030",
				opportunityId: OPORTUNIDAD,
				fullName: "Cofirmante pendiente",
				dpi: "2978485181201",
			},
		]);

		const resumen = await invocar(
			validationsRouter.getResumenBuroOportunidad,
			{ opportunityId: OPORTUNIDAD },
			contextoDe("asesor-asignado", "sales"),
		);
		expect(resumen).toMatchObject({
			exento: true,
			faltaConsentimiento: true,
			permitirValidacionManualBuro: true,
			cofirmantes: [{ nombre: "Cofirmante pendiente", estado: "pendiente" }],
		});
		expect(escrituras).toEqual([]);
	});
});

test("el lector de validaciones usa la transacción recibida, sin abrir otra conexión", async () => {
	const opportunityId = "35353535-3535-4535-8535-353535353535";
	filasPorTabla.set(opportunities, [
		{
			id: opportunityId,
			source: "web",
			leadSource: "web",
			leadDpi: "2978485181201",
			clientType: "individual",
			creditType: "autocompra",
			analysisStatus: "pending",
		},
	]);
	filasPorTabla.set(opportunityValidations, [
		{
			id: "resultado-buro",
			tipo: "buro",
			estado: "aprobado",
			dpi: "2978485181201",
			expiraEn: new Date(Date.now() + 86_400_000),
		},
	]);
	const selectOriginal = dbFalso.select;
	const lector = { select: selectOriginal } as unknown as NonNullable<
		Parameters<typeof getValidaciones>[0]["lector"]
	>;
	dbFalso.select = () => {
		throw new Error("Se usó el pool fuera de la transacción");
	};
	try {
		const estado = await getValidaciones({ opportunityId, lector });
		expect(estado.buro?.estado).toBe("aprobado");
		expect(estado.exento).toBe(false);
	} finally {
		dbFalso.select = selectOriginal;
	}
});

describe("revalidación excepcional de Buró en el 30%", () => {
	const OPORTUNIDAD = "61616161-6161-4161-8161-616161616161";
	const LEAD = "62626262-6262-4262-8262-626262626262";
	const ETAPA_30 = "63636363-6363-4363-8363-636363636363";
	const base = {
		id: OPORTUNIDAD,
		assignedTo: "vendedor",
		status: "open",
		porcentaje: 30,
		source: "web",
		leadSource: "web",
		leadId: LEAD,
		leadDpi: null,
		creditType: "autocompra",
		analysisStatus: "pending",
	};
	const DPI = "2978485181201";
	function prepararEvidenciaBot() {
		filasPorTabla.set(otps, [{ id: "otp-validado", used: true }]);
		filasPorTabla.set(infornetPersonaCache, [
			{
				dpi: DPI,
				expiraEn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			},
		]);
	}

	test("asegurarBuroOportunidad solo admite el 30% con la excepción registrada", async () => {
		filasPorTabla.set(opportunities, [
			{ ...base, buroRevalidacionAl30: false },
		]);
		await expect(
			invocar(
				validationsRouter.asegurarBuroOportunidad,
				{ opportunityId: OPORTUNIDAD },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/No tienes acceso al detalle de Buró/);

		filasPorTabla.set(opportunities, [{ ...base, buroRevalidacionAl30: true }]);
		expect(
			await invocar(
				validationsRouter.asegurarBuroOportunidad,
				{ opportunityId: OPORTUNIDAD },
				contextoDe("vendedor", "sales"),
			),
		).toEqual({ success: true });
	});

	test("el ejecutor no inicia la consulta en el 30% sin excepción", async () => {
		filasPorTabla.set(opportunities, [
			{ ...base, buroRevalidacionAl30: false },
		]);
		await ejecutarBuroAlVeinteSiCorresponde({ opportunityId: OPORTUNIDAD });
		expect(lecturasPorTabla).toEqual([opportunities]);

		lecturasPorTabla.length = 0;
		filasPorTabla.set(opportunities, [{ ...base, buroRevalidacionAl30: true }]);
		await ejecutarBuroAlVeinteSiCorresponde({ opportunityId: OPORTUNIDAD });
		expect(lecturasPorTabla.length).toBeGreaterThan(1);
	});

	test("corregir el origen de WhatsApp en 30% habilita la reconsulta en la misma escritura", async () => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [
			{
				...base,
				stageId: ETAPA_30,
				source: "Whatsapp",
				leadSource: "Whatsapp",
				analysisStatus: "pending",
			},
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, source: "referral" },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores.source).toBe("referral");
		const expresion = textoSqlDelValor(escritura?.valores.buroRevalidacionAl30);
		expect(expresion).toContain("case when");
		expect(expresion).toContain("closure_percentage");
		expect(expresion).toContain("'whatsapp'");
	});

	test("sincronizar el origen del lead también habilita la reconsulta en 30%", async () => {
		prepararEvidenciaBot();
		filasPorTabla.set(leads, [
			{ id: LEAD, dpi: DPI, source: "Whatsapp", assignedTo: "vendedor" },
		]);
		filasPorTabla.set(opportunities, [
			{
				...base,
				stageId: ETAPA_30,
				closurePercentage: 30,
				source: "Whatsapp",
				leadDpi: DPI,
			},
		]);

		await invocar(
			crmRouter.updateLead,
			{ id: LEAD, source: "referral" },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores.source).toBe("referral");
		expect(escritura?.valores.buroRevalidacionAl30).toBe(true);
	});

	test("no corrige el origen del lead después de aprobar análisis sin volver al 30%", async () => {
		prepararEvidenciaBot();
		filasPorTabla.set(leads, [
			{ id: LEAD, dpi: DPI, source: "Whatsapp", assignedTo: "vendedor" },
		]);
		filasPorTabla.set(opportunities, [
			{
				...base,
				stageId: "etapa-40",
				porcentaje: 40,
				closurePercentage: 40,
				source: "Whatsapp",
				leadDpi: DPI,
			},
		]);

		await expect(
			invocar(
				crmRouter.updateLead,
				{ id: LEAD, source: "referral" },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/Regresa la oportunidad al 30%/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("no cambia directamente el origen de una oportunidad aprobada al 40%", async () => {
		prepararEvidenciaBot();
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [
			{
				...base,
				stageId: "etapa-40",
				porcentaje: 40,
				closurePercentage: 40,
				source: "Whatsapp",
				leadDpi: DPI,
			},
		]);

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, source: "referral" },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/Regresa la oportunidad al 30%/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("un origen WhatsApp ya validado por Buró se puede corregir al 40%", async () => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [
			{
				...base,
				stageId: "etapa-40",
				porcentaje: 40,
				closurePercentage: 40,
				source: "Whatsapp",
				leadDpi: DPI,
			},
		]);
		filasPorTabla.set(opportunityValidations, [
			{
				id: "validacion-existente",
				tipo: "buro",
				estado: "aprobado",
				dpi: DPI,
				expiraEn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			},
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, source: "referral" },
			contextoDe("vendedor", "sales"),
		);
		expect(escriturasSobreOportunidades()[0]?.valores.source).toBe("referral");
	});
});

describe("corrección de DPI al 30%: solo revalida Buró", () => {
	const OPORTUNIDAD = "67676767-6767-4676-8676-676767676767";
	const LEAD = "68686868-6868-4686-8686-686868686868";
	const CODEUDOR = "69696969-6969-4696-8696-696969696969";
	const DPI_ANTERIOR = "2978485181201";
	const DPI_NUEVO = "1234567890101";
	const oportunidad = {
		id: OPORTUNIDAD,
		leadId: LEAD,
		status: "open",
		closurePercentage: 30,
		maxHistoricoClosurePercentage: 30,
		stageName: "Análisis",
		analysisStatus: "pending",
		creditDetailApproved: true,
		identityRevalidatedAt: null,
	};

	function comprobarMarcaDeBuro() {
		const marca = escriturasSobreOportunidades().find(
			(escritura) => escritura.valores.buroRevalidacionAl30 === true,
		);
		expect(marca?.valores).toEqual({ buroRevalidacionAl30: true });
		const { sql: condicion, params } = sqlDeLaCondicion(marca?.condicion);
		expect(condicion).toContain("closure_percentage");
		expect(params).toContain("on_hold");
		expect(params).toContain("lost");
	}

	test.each([
		"open",
		"on_hold",
	] as const)("editar el DPI del titular marca Buró en %s sin caducar escaneo ni aprobación", async (status) => {
		filasPorTabla.set(leads, [
			{ id: LEAD, dpi: DPI_ANTERIOR, assignedTo: "vendedor" },
		]);
		filasPorTabla.set(opportunities, [{ ...oportunidad, status }]);
		const anterior = process.env.ENABLE_CARTERA_BACK_INTEGRATION;
		process.env.ENABLE_CARTERA_BACK_INTEGRATION = "false";
		try {
			await invocar(
				crmRouter.updateLead,
				{ id: LEAD, dpi: DPI_NUEVO },
				contextoDe("vendedor", "sales"),
			);
		} finally {
			if (anterior === undefined)
				delete process.env.ENABLE_CARTERA_BACK_INTEGRATION;
			else process.env.ENABLE_CARTERA_BACK_INTEGRATION = anterior;
		}
		comprobarMarcaDeBuro();
	});

	test("crear un cofirmante marca Buró sin reiniciar análisis", async () => {
		filasPorTabla.set(opportunities, [oportunidad]);
		const anterior = process.env.ENABLE_CARTERA_BACK_INTEGRATION;
		process.env.ENABLE_CARTERA_BACK_INTEGRATION = "false";
		try {
			await invocar(
				crmRouter.createCoDebtor,
				{ opportunityId: OPORTUNIDAD, fullName: "Cofirmante", dpi: DPI_NUEVO },
				contextoDe("vendedor", "sales"),
			);
		} finally {
			if (anterior === undefined)
				delete process.env.ENABLE_CARTERA_BACK_INTEGRATION;
			else process.env.ENABLE_CARTERA_BACK_INTEGRATION = anterior;
		}
		comprobarMarcaDeBuro();
	});

	test("editar el DPI del cofirmante marca Buró sin reiniciar análisis", async () => {
		filasPorTabla.set(opportunities, [oportunidad]);
		filasPorTabla.set(coDebtors, [
			{ id: CODEUDOR, opportunityId: OPORTUNIDAD, dpi: DPI_ANTERIOR },
		]);
		const anterior = process.env.ENABLE_CARTERA_BACK_INTEGRATION;
		process.env.ENABLE_CARTERA_BACK_INTEGRATION = "false";
		try {
			await invocar(
				crmRouter.updateCoDebtor,
				{ id: CODEUDOR, dpi: DPI_NUEVO },
				contextoDe("vendedor", "sales"),
			);
		} finally {
			if (anterior === undefined)
				delete process.env.ENABLE_CARTERA_BACK_INTEGRATION;
			else process.env.ENABLE_CARTERA_BACK_INTEGRATION = anterior;
		}
		comprobarMarcaDeBuro();
	});
});

describe("primer DPI del titular al 20%", () => {
	const OPORTUNIDAD = "71717171-7171-4171-8171-717171717171";
	const LEAD = "72727272-7272-4272-8272-727272727272";
	const DPI = "2978485181201";

	test.each([
		["primer DPI", null, true],
		["DPI sin cambios", DPI, false],
	] as const)("%s: consulta Buró solo cuando corresponde", async (_caso, dpiAnterior, debeConsultar) => {
		filasDevueltasPorUpdate = [{ id: LEAD, dpi: DPI }];
		filasPorTabla.set(leads, [
			{ id: LEAD, dpi: dpiAnterior, assignedTo: "vendedor" },
		]);
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				leadId: LEAD,
				status: "open",
				porcentaje: 20,
				buroRevalidacionAl30: false,
			},
		]);
		const anterior = process.env.ENABLE_CARTERA_BACK_INTEGRATION;
		process.env.ENABLE_CARTERA_BACK_INTEGRATION = "false";
		try {
			await invocar(
				crmRouter.updateLead,
				{ id: LEAD, dpi: DPI },
				contextoDe("vendedor", "sales"),
			);
		} finally {
			if (anterior === undefined)
				delete process.env.ENABLE_CARTERA_BACK_INTEGRATION;
			else process.env.ENABLE_CARTERA_BACK_INTEGRATION = anterior;
		}
		expect(lecturasPorTabla.includes(opportunities)).toBe(debeConsultar);
	});
});

describe("approveOpportunityAnalysis: Buró al pasar de 30% a 40%", () => {
	const OPORTUNIDAD = "63636363-6363-4363-8363-636363636363";
	const ETAPA_30 = "64646464-6464-4464-8464-646464646464";
	const ETAPA_40 = "65656565-6565-4565-8565-656565656565";
	const DPI = "2978485181201";

	function prepararAprobacion(flag: boolean, expiraEn?: Date) {
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				title: "Análisis con Buró",
				stageId: ETAPA_30,
				status: "open",
				assignedTo: null,
				vehicleId: "vehiculo-nuevo",
				creditType: "autocompra",
				leadId: "66666666-6666-4666-8666-666666666666",
				leadDpi: DPI,
				dpi: DPI,
				firstName: "Pilar",
				lastName: "Mérida",
				clientType: "individual",
				source: "web",
				leadSource: "web",
				analysisStatus: "pending",
				analysisRejectionCount: 0,
				buroRevalidacionAl30: flag,
			},
		]);
		filasPorTabla.set(vehicles, [{ isNew: true }]);
		filasPorTabla.set(
			opportunityValidations,
			expiraEn
				? [
						{
							id: "resultado-buro",
							tipo: "buro",
							estado: "aprobado",
							dpi: DPI,
							expiraEn,
						},
					]
				: [],
		);
		secuenciaEtapas = [
			[{ id: ETAPA_30, closurePercentage: 30 }],
			[{ id: ETAPA_40, closurePercentage: 40 }],
			[{ id: "etapa-20", closurePercentage: 20 }],
		];
	}

	test.each([
		["sin excepción", false, /Regresa la oportunidad al 20%/],
		["con excepción", true, /en el 30% antes de aprobar/],
	] as const)("bloquea aprobación sin Buró %s", async (_caso, flag, mensaje) => {
		prepararAprobacion(flag);
		await expect(
			invocar(
				crmRouter.approveOpportunityAnalysis,
				{ opportunityId: OPORTUNIDAD, approved: true },
				contextoDe("analista", "analyst"),
			),
		).rejects.toThrow(mensaje);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("bloquea aprobación con Buró vencido incluso sin excepción", async () => {
		prepararAprobacion(false, new Date(Date.now() - 60_000));
		await expect(
			invocar(
				crmRouter.approveOpportunityAnalysis,
				{ opportunityId: OPORTUNIDAD, approved: true },
				contextoDe("analista", "analyst"),
			),
		).rejects.toThrow(/validación de Buró vigente/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("no aprueba análisis si el bot validó al titular pero falta Buró del cofirmante", async () => {
		prepararAprobacion(false);
		const [oportunidad] = filasPorTabla.get(opportunities) ?? [];
		filasPorTabla.set(opportunities, [
			{ ...oportunidad, source: "Whatsapp", leadSource: "Whatsapp" },
		]);
		filasPorTabla.set(otps, [{ id: "otp-validado", used: true }]);
		filasPorTabla.set(infornetPersonaCache, [
			{ dpi: DPI, expiraEn: new Date(Date.now() + 86_400_000) },
		]);
		filasPorTabla.set(coDebtors, [
			{
				id: "34343434-3434-4434-8434-343434343434",
				opportunityId: OPORTUNIDAD,
				fullName: "Cofirmante sin consulta",
				dpi: DPI,
			},
		]);
		await expect(
			invocar(
				crmRouter.approveOpportunityAnalysis,
				{ opportunityId: OPORTUNIDAD, approved: true },
				contextoDe("analista", "analyst"),
			),
		).rejects.toThrow(/cofirmante Cofirmante sin consulta/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test.each([
		["sin excepción", false],
		["con excepción", true],
	] as const)("aprueba con Buró vigente %s y limpia la excepción", async (_caso, flag) => {
		prepararAprobacion(flag, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
		respuestaExecute = { rows: [{ huella: "huella-vigente" }] };
		await invocar(
			crmRouter.approveOpportunityAnalysis,
			{ opportunityId: OPORTUNIDAD, approved: true },
			contextoDe("analista", "analyst"),
		);
		const aprobacion = escriturasSobreOportunidades().find(
			(escritura) => escritura.valores.analysisStatus === "approved",
		);
		expect(aprobacion?.valores).toMatchObject({
			stageId: ETAPA_40,
			buroRevalidacionAl30: false,
		});
		const { sql: condicion } = sqlDeLaCondicion(aprobacion?.condicion);
		expect(condicion).toContain("is not distinct from");
	});

	test("rechaza si una consulta de Buró cambia el veredicto mientras se aprueba", async () => {
		prepararAprobacion(true, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
		respuestaExecute = { rows: [{ huella: "huella-vigente" }] };
		let cambioAplicado = false;
		alEjecutar = () => {
			if (cambioAplicado || !lecturasPorTabla.includes(opportunityValidations))
				return;
			cambioAplicado = true;
			filasPorTabla.set(opportunityValidations, [
				{
					id: "resultado-error-nuevo",
					tipo: "buro",
					estado: "error",
					dpi: DPI,
					expiraEn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
				},
			]);
		};

		await expect(
			invocar(
				crmRouter.approveOpportunityAnalysis,
				{ opportunityId: OPORTUNIDAD, approved: true },
				contextoDe("analista", "analyst"),
			),
		).rejects.toThrow(/Buró cambió durante la revisión/);
		expect(cambioAplicado).toBe(true);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});
});

describe("updateOpportunity: Buró obligatorio antes del análisis", () => {
	const OPORTUNIDAD = "91919191-9191-4191-8191-919191919191";
	const LEAD = "92929292-9292-4292-8292-929292929292";
	const ETAPA_20 = "93939393-9393-4393-8393-939393939393";
	const ETAPA_30 = "94949494-9494-4494-8494-949494949494";
	const ETAPA_40 = "95959595-9595-4595-8595-959595959595";

	function prepararDestino(porcentaje: 30 | 40) {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [
			{
				id: OPORTUNIDAD,
				leadId: LEAD,
				stageId: ETAPA_20,
				status: "open",
				assignedTo: "vendedor",
				analysisStatus: "not_applicable",
				vehicleId: "vehiculo-1",
				creditType: "autocompra",
				source: "web",
				leadSource: "web",
				leadDpi: "2978485181201",
			},
		]);
		secuenciaEtapas = [
			[
				{
					id: porcentaje === 30 ? ETAPA_30 : ETAPA_40,
					closurePercentage: porcentaje,
				},
			],
			[{ id: ETAPA_20, closurePercentage: 20 }],
		];
	}

	test("sin DPI no puede pasar del 20% al 30%", async () => {
		prepararDestino(30);
		filasPorTabla.set(leads, [{ id: LEAD, dpi: null }]);

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, stageId: ETAPA_30 },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/ingresa el DPI del titular/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("Buró en curso bloquea el paso al 30% sin esperar una conexión", async () => {
		prepararDestino(30);
		filasPorTabla.set(leads, [{ id: LEAD, dpi: "2978485181201" }]);
		candadoBuroOcupado = true;
		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, stageId: ETAPA_30 },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/consulta de Buró sigue en curso/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("no consume la exención del bot si cambia el origen al entrar al 30%", async () => {
		prepararDestino(30);
		const [oportunidad] = filasPorTabla.get(opportunities) ?? [];
		filasPorTabla.set(opportunities, [
			{ ...oportunidad, source: "Whatsapp", leadSource: "Whatsapp" },
		]);
		filasPorTabla.set(leads, [
			{ id: LEAD, dpi: "2978485181201", source: "Whatsapp" },
		]);
		filasPorTabla.set(otps, [{ id: "otp-validado", used: true }]);
		filasPorTabla.set(infornetPersonaCache, [
			{
				dpi: "2978485181201",
				expiraEn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			},
		]);

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, stageId: ETAPA_30, source: "referral" },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/Guarda primero el cambio de origen/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("no puede saltar del 20% al 40%", async () => {
		prepararDestino(40);
		filasPorTabla.set(leads, [{ id: LEAD, dpi: null }]);

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, stageId: ETAPA_40 },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/pasa por análisis/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("la exención del bot no permite entrar al 30% sin Buró del cofirmante", async () => {
		prepararDestino(30);
		const [oportunidad] = filasPorTabla.get(opportunities) ?? [];
		filasPorTabla.set(opportunities, [
			{ ...oportunidad, source: "Whatsapp", leadSource: "Whatsapp" },
		]);
		filasPorTabla.set(leads, [
			{ id: LEAD, dpi: "2978485181201", source: "Whatsapp" },
		]);
		filasPorTabla.set(otps, [{ id: "otp-validado", used: true }]);
		filasPorTabla.set(infornetPersonaCache, [
			{ dpi: "2978485181201", expiraEn: new Date(Date.now() + 86_400_000) },
		]);
		filasPorTabla.set(coDebtors, [
			{
				id: "31313131-3131-4131-8131-313131313131",
				opportunityId: OPORTUNIDAD,
				fullName: "Cofirmante pendiente",
				dpi: "2978485181201",
			},
		]);

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, stageId: ETAPA_30 },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/cofirmante Cofirmante pendiente/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test.each([
		["pendiente", []],
		[
			"con error",
			[
				{
					id: "validacion-error",
					tipo: "buro",
					estado: "error",
					dpi: "2978485181201",
					expiraEn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
				},
			],
		],
	] as const)("con Buró %s no puede pasar al 30%", async (_caso, validaciones) => {
		prepararDestino(30);
		filasPorTabla.set(leads, [{ id: LEAD, dpi: "2978485181201" }]);
		filasPorTabla.set(opportunityValidations, [...validaciones]);

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, stageId: ETAPA_30 },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/necesita una validación de Buró vigente/);
		expect(escriturasSobreOportunidades()).toEqual([]);
	});

	test("el Buró validado manualmente permite entrar al 30%", async () => {
		prepararDestino(30);
		filasPorTabla.set(leads, [{ id: LEAD, dpi: "2978485181201" }]);
		filasPorTabla.set(salesStages, [
			{ id: ETAPA_20, closurePercentage: 20, order: 3 },
		]);
		filasPorTabla.set(opportunityValidations, [
			{
				id: "validacion-manual",
				tipo: "buro",
				estado: "sin_registro",
				dpi: "2978485181201",
				fuenteDeDatos: "manual",
				expiraEn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			},
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, stageId: ETAPA_30 },
			contextoDe("vendedor", "sales"),
		);
		expect(escriturasSobreOportunidades()[0]?.valores.stageId).toBe(ETAPA_30);
		expect(
			escriturasSobreOportunidades()[0]?.valores.buroRevalidacionAl30,
		).toBe(false);
		const { sql: predicado } = sqlDeLaCondicion(
			escriturasSobreOportunidades()[0]?.condicion,
		);
		expect(predicado).toContain("string_agg");
		expect(predicado).toContain("co_debtors");
	});

	test("al regresar de 40% a 30% con Buró vencido habilita reconsulta excepcional", async () => {
		prepararDestino(30);
		const [oportunidad] = filasPorTabla.get(opportunities) ?? [];
		filasPorTabla.set(opportunities, [
			{
				...oportunidad,
				stageId: ETAPA_40,
				analysisStatus: "approved",
			},
		]);
		filasPorTabla.set(salesStages, [
			{ id: ETAPA_40, closurePercentage: 40, order: 5 },
		]);
		secuenciaEtapas = [
			[{ id: ETAPA_30, closurePercentage: 30, order: 4 }],
			[{ id: ETAPA_40, closurePercentage: 40, order: 5 }],
			[{ id: ETAPA_30, closurePercentage: 30, order: 4 }],
			[{ id: ETAPA_40, closurePercentage: 40, order: 5 }],
		];
		filasPorTabla.set(leads, [
			{ id: LEAD, dpi: "2978485181201", source: "web" },
		]);
		filasPorTabla.set(opportunityValidations, [
			{
				id: "validacion-vencida",
				tipo: "buro",
				estado: "aprobado",
				dpi: "2978485181201",
				expiraEn: new Date(Date.now() - 24 * 60 * 60 * 1000),
			},
		]);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, stageId: ETAPA_30 },
			contextoDe("vendedor", "sales"),
		);
		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores.stageId).toBe(ETAPA_30);
		expect(escritura?.valores.buroRevalidacionAl30).toBe(true);
	});
});

/**
 * 🔴 La cuarta variante, y la que el arreglo de la invalidación NO cubría.
 *
 * `parcheDeIdentidadInvalidada` invalida la APROBACIÓN, y por el lado de los
 * documentos sólo cuenta como caducados los dos tipos de
 * `TIPOS_DOCUMENTO_IDENTIDAD` (`dpi` e `identification`). El recibo de luz, los
 * estados de cuenta, los comprobantes de ingresos, los formularios y el
 * consentimiento sobreviven.
 *
 * Entonces: se cambia el lead A por el B, se sube SÓLO el DPI de B, y
 * `approveOpportunityAnalysis` vuelve a aprobar con los ingresos y los estados
 * de cuenta de A. El expediente de una persona queda aprobado con la evidencia
 * financiera de otra.
 *
 * El arreglo acotado: el cliente sólo se corrige mientras el expediente está
 * vacío. Estas pruebas afirman sobre el EFECTO —que la escritura del `leadId`
 * NO ocurre—, no sobre que la llamada al guard exista: en esta suite está
 * comprobado que un test de cableado se traga un `if (false && ...)`.
 */
describe("updateOpportunity: con evidencia cargada, el cliente ya no se cambia", () => {
	const OPORTUNIDAD = "14141414-1414-4141-8141-141414141414";
	const LEAD_A = "15151515-1515-4151-8151-151515151515";
	const LEAD_B = "16161616-1616-4161-8161-161616161616";
	const ETAPA_ANALISIS_30 = "17171717-1717-4171-8171-171717171717";

	/**
	 * EN el umbral (30%), que es donde el candado de etapa deja pasar el cambio a
	 * propósito (la comparación es `> 30`). O sea: el camino que quedaba abierto.
	 */
	const enElUmbral = {
		id: OPORTUNIDAD,
		title: "Crédito con expediente armado",
		leadId: LEAD_A,
		stageId: ETAPA_ANALISIS_30,
		status: "open",
		assignedTo: "vendedor",
		analysisStatus: "approved",
		creditDetailApproved: false,
		identityRevalidatedAt: null,
		vehicleId: "vehiculo-1",
		companyId: null,
		vendorId: null,
		creditType: "autocompra",
		diaPagoMensual: 15,
		diaPagoOriginalSistema: null,
		insuranceProvider: "universales",
		updatedAt: new Date("2026-09-20T12:00:00.000Z"),
		stageName: "Recepción de documentación y traslado a análisis",
		closurePercentage: 30,
		maxHistoricoClosurePercentage: 30,
	};

	const sembrarElExpediente = (oportunidad: Fila) => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [oportunidad]);
		filasPorTabla.set(leads, [{ id: LEAD_B, source: "web" }]);
		filasPorTabla.set(salesStages, [
			{
				id: ETAPA_ANALISIS_30,
				name: "Recepción de documentación y traslado a análisis",
				closurePercentage: 30,
				order: 4,
			},
		]);
	};

	test("el expediente con estados de cuenta del cliente anterior rechaza el cambio", async () => {
		sembrarElExpediente(enElUmbral);
		// La evidencia que `parcheDeIdentidadInvalidada` NO caduca, y que por eso
		// volvería a aprobar el expediente bajo otra persona.
		filasPorTabla.set(opportunityDocuments, [
			{
				id: "doc-1",
				opportunityId: OPORTUNIDAD,
				documentType: "estados_cuenta_1",
			},
			{ id: "doc-2", opportunityId: OPORTUNIDAD, documentType: "recibo_luz" },
		]);

		const salida = await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_B },
			contextoDe("vendedor", "sales"),
		).then(
			() => null,
			(e: unknown) => e,
		);

		// El EFECTO, primero: el `leadId` no se escribió. Sin el arreglo acá hay
		// UNA escritura con `leadId: LEAD_B`.
		expect(identidadEscrita()).toEqual([]);
		expect((salida as Error | null)?.message).toMatch(
			/el expediente ya tiene evidencia cargada/,
		);
		// El mensaje dice qué hacer, no sólo que no se puede: y el camino ya no es
		// perder la oportunidad y reabrirla, sino crear una nueva.
		expect((salida as Error | null)?.message).toMatch(
			/creá una oportunidad nueva/,
		);
		expect((salida as Error | null)?.message).not.toMatch(/por perdida/);
	});

	test("el formulario de solicitud también cuenta como evidencia", async () => {
		sembrarElExpediente(enElUmbral);
		filasPorTabla.set(creditApplications, [
			{ id: "form-1", opportunityId: OPORTUNIDAD },
		]);

		const salida = await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_B },
			contextoDe("vendedor", "sales"),
		).then(
			() => null,
			(e: unknown) => e,
		);

		expect(identidadEscrita()).toEqual([]);
		expect((salida as Error | null)?.message).toMatch(
			/formulario de solicitud de crédito/,
		);
	});

	test("una oportunidad recién creada, sin nada colgado, se sigue pudiendo corregir", async () => {
		// 🔴 Red de seguridad. Éste es el caso real de operaciones —un lead mal
		// asignado en una oportunidad que todavía no tiene nada— y no se puede
		// romper. Verde antes y después del arreglo.
		sembrarElExpediente({
			...enElUmbral,
			analysisStatus: "not_applicable",
			creditDetailApproved: null,
			vehicleId: null,
		});
		filasPorTabla.set(opportunityDocuments, []);
		filasPorTabla.set(creditApplications, []);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_B },
			contextoDe("vendedor", "sales"),
		);

		expect(escriturasSobreOportunidades()[0]?.valores).toMatchObject({
			leadId: LEAD_B,
		});
	});

	test("la condición viaja DENTRO del WHERE del UPDATE, no sólo como chequeo previo", async () => {
		// Entre la lectura del expediente y la escritura, el analista puede subir
		// un documento: si la condición viviera sólo en el `if`, el cambio entraría
		// igual sobre un expediente que ya dejó de estar vacío.
		sembrarElExpediente({
			...enElUmbral,
			analysisStatus: "not_applicable",
			creditDetailApproved: null,
			vehicleId: null,
		});
		filasPorTabla.set(opportunityDocuments, []);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_B },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores).toMatchObject({ leadId: LEAD_B });

		const { sql: texto, params } = sqlDeLaCondicion(escritura?.condicion);
		const plano = texto.replace(/\s+/g, " ").toLowerCase();

		// Las cinco fuentes de evidencia, cada una como su propio `not exists`.
		for (const tabla of [
			"opportunity_documents",
			"credit_applications",
			"financial_statements",
			"credit_analysis",
			"opportunity_validations",
		]) {
			expect(plano).toContain(tabla);
		}
		expect(plano.match(/not exists/g)?.length).toBeGreaterThanOrEqual(6);

		// Y el id que se consulta es el de ESTA oportunidad.
		expect(params.filter((p) => p === OPORTUNIDAD).length).toBeGreaterThan(0);
	});

	test("una perdida con evidencia TAMBIÉN queda bloqueada", async () => {
		// 🔴 Esta prueba afirmaba lo contrario —que una perdida quedaba exceptuada—
		// y se invirtió a propósito: la excepción dejaba vivo el mismo agujero en
		// tres pasos. Dar por perdida, cambiar el cliente, reabrir: cuando la
		// oportunidad vuelve a análisis, los estados de cuenta, los comprobantes de
		// ingresos y los recibos del cliente anterior siguen colgados bajo el
		// nuevo, porque la marca de revalidación sólo caduca `dpi` e
		// `identification`. Si la oportunidad ya está perdida, lo limpio es crear
		// una nueva, que no arrastra la evidencia de nadie.
		//
		// ⚠️ Esto NO toca el candado por ETAPA, que sigue dejando pasar a las
		// perdidas: lo que cambia es sólo el chequeo de evidencia.
		sembrarElExpediente({ ...enElUmbral, status: "lost" });
		filasPorTabla.set(opportunityDocuments, [
			{
				id: "doc-1",
				opportunityId: OPORTUNIDAD,
				documentType: "estados_cuenta_1",
			},
		]);

		const salida = await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_B },
			contextoDe("vendedor", "sales"),
		).then(
			() => null,
			(e: unknown) => e,
		);

		// El EFECTO: el `leadId` no se escribió.
		expect(identidadEscrita()).toEqual([]);
		expect((salida as Error | null)?.message).toMatch(
			/el expediente ya tiene evidencia cargada/,
		);
	});

	test("una perdida VACÍA se sigue pudiendo corregir", async () => {
		// 🔴 Red de seguridad, verde antes y después: lo que bloquea es la
		// evidencia, no el estado. Una perdida sin nada colgado sigue siendo el
		// caso real de operaciones —el lead mal asignado— y no se puede romper.
		sembrarElExpediente({
			...enElUmbral,
			status: "lost",
			analysisStatus: "not_applicable",
			creditDetailApproved: null,
			vehicleId: null,
		});
		filasPorTabla.set(opportunityDocuments, []);
		filasPorTabla.set(creditApplications, []);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_B },
			contextoDe("vendedor", "sales"),
		);

		expect(escriturasSobreOportunidades()[0]?.valores).toMatchObject({
			leadId: LEAD_B,
		});
	});
});

/**
 * 🔴 La quinta variante: el `leadId` que llega en el input sin cambiar nada.
 *
 * `cambiaElLeadDeLaOportunidad` compara el input contra la fila LEÍDA, así que
 * un request que manda el mismo `leadId` da falso y no corre ninguna de las
 * guardas —ni la de etapa, ni la de evidencia, ni la invalidación de
 * identidad—. Si ese campo llegara al `SET`, sería el rebote:
 *
 *   1. El request A lee la oportunidad con el lead X.
 *   2. El request B se la cambia a Y pagando todas las guardas, y de paso
 *      invalida la identidad o suma evidencia.
 *   3. A aterriza y reescribe `lead = X` por un camino sin candado, sin
 *      predicado de evidencia y sin invalidación: deshace el cambio de B y deja
 *      pegada la invalidación que B pagó.
 *
 * `expectedUpdatedAt` es opcional, así que tampoco lo frena.
 *
 * ⚠️ Al escribir estas pruebas resultó que el paso 3 hoy NO ocurre, pero por
 * casualidad: `stripUnchangedFrozenFields` saca el `leadId` que no cambió
 * porque el cliente está en la lista de campos congelados de una oportunidad
 * GANADA, o sea por una razón de contratos, no de identidad. Lo que sí estaba
 * abierto —y es lo que estas pruebas ponen en rojo— son las dos caras del mismo
 * descuido: el invariante del 80% evaluándose contra el valor reenviado en vez
 * de contra la columna que de verdad va a quedar, y el cambio de cliente de
 * verdad aplicándose sobre el lead que hubiera quedado en vez de sobre el que
 * se leyó. Las afirmaciones sobre el `SET` se quedan como red: son la que
 * avisará si algún día sacan al cliente de la lista de congelados.
 *
 * Las pruebas afirman sobre el EFECTO —qué columnas viajan en el `SET` y qué
 * condiciones en el WHERE— y no sobre que el `if` exista: en esta suite está
 * comprobado que un test de cableado se traga un `if (false && ...)`.
 */
describe("updateOpportunity: reenviar el mismo cliente no lo reescribe", () => {
	const OPORTUNIDAD = "18181818-1818-4181-8181-181818181818";
	const LEAD_A = "19191919-1919-4191-8191-191919191919";
	const LEAD_B = "20202020-2020-4202-8202-202020202020";
	const ETAPA_CIERRE_40 = "21212121-2121-4212-8212-212121212121";
	const ETAPA_CALIFICACION_20 = "23232323-2323-4232-8232-232323232323";

	const conElLeadA = {
		id: OPORTUNIDAD,
		title: "Crédito del lead A",
		leadId: LEAD_A,
		stageId: ETAPA_CIERRE_40,
		status: "open",
		assignedTo: "vendedor",
		analysisStatus: "approved",
		creditDetailApproved: true,
		identityRevalidatedAt: null,
		vehicleId: "vehiculo-1",
		companyId: null,
		vendorId: null,
		creditType: "autocompra",
		diaPagoMensual: 15,
		diaPagoOriginalSistema: null,
		insuranceProvider: "universales",
		updatedAt: new Date("2026-09-20T12:00:00.000Z"),
		stageName: "Cierre de propuesta",
		closurePercentage: 40,
		maxHistoricoClosurePercentage: 40,
	};

	const sembrar = (oportunidad: Fila, etapa: Fila) => {
		filasPorTabla.set(user, [{ id: "vendedor", role: "sales" }]);
		filasPorTabla.set(opportunities, [oportunidad]);
		filasPorTabla.set(leads, [
			{ id: LEAD_A, source: "web" },
			{ id: LEAD_B, source: "web" },
		]);
		filasPorTabla.set(salesStages, [etapa]);
		filasPorTabla.set(opportunityDocuments, []);
		filasPorTabla.set(creditApplications, []);
	};

	/** Las columnas que el `SET` de un UPDATE declara escribir. */
	const columnasEscritas = (escritura: Escritura | undefined) =>
		Object.keys(escritura?.valores ?? {});

	test("el `SET` no lleva `leadId` cuando el input reenvía el que ya tenía", async () => {
		// El caso de todos los días: el formulario reenvía el objeto entero, con el
		// mismo cliente adentro, para cambiar otra cosa.
		sembrar(conElLeadA, {
			id: ETAPA_CIERRE_40,
			name: "Cierre de propuesta",
			closurePercentage: 40,
			order: 5,
		});

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_A, notes: "llamar el martes" },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();

		// La edición sí se aplica: lo que se saca es el campo que no cambia.
		expect(escritura?.valores).toMatchObject({ notes: "llamar el martes" });

		// 🔴 El EFECTO: el campo no viaja en el `SET`, así que no puede pisar al
		// cliente que otro request acaba de poner por un camino donde no corrió ni
		// el candado, ni el predicado de evidencia, ni la invalidación.
		//
		// ⚠️ Esta afirmación ya pasaba antes del arreglo, y por eso se queda: hoy
		// quien lo saca es `stripUnchangedFrozenFields` —`leadId` está en
		// `WON_OPPORTUNITY_FROZEN_FIELD_LABELS`, así que el campo se cae por ser
		// dato congelado, no por ser identidad—. Es protección prestada: el día que
		// alguien saque el cliente de esa lista (no es un término del contrato) el
		// hueco se abre solo. Ahora el handler lo saca además por su cuenta y este
		// test es el que lo mantiene cerrado pase lo que pase con la lista.
		expect(columnasEscritas(escritura)).not.toContain("leadId");

		// 🔴 Y la otra mitad: el invariante del 80% tiene que mirar la columna
		// VIVA, no el valor reenviado. Si la sentencia no escribe el campo, el
		// `leadId` con el que la fila queda es el de la base; evaluarlo contra el
		// literal del formulario daba por bueno un `stage >= 80%` sobre una
		// oportunidad que otro request acababa de dejar sin cliente.
		const { sql: texto, params } = sqlDeLaCondicion(escritura?.condicion);
		expect(texto.replace(/\s+/g, " ").toLowerCase()).toContain(
			'"opportunities"."lead_id" is not null',
		);
		expect(params).not.toContain(LEAD_A);
	});

	test("desasignado que sigue desasignado tampoco viaja en el `SET`", async () => {
		// El mismo caso con `null` de los dos lados, que es el que se escapa de las
		// comparaciones sueltas: `null !== undefined`, así que el campo entra al
		// input igual. Un `lead = NULL` escrito por acá borraría al cliente que
		// otro request acaba de colgar, sin pasar por ninguna guarda.
		sembrar(
			{
				...conElLeadA,
				leadId: null,
				stageId: ETAPA_CALIFICACION_20,
				analysisStatus: "not_applicable",
				creditDetailApproved: null,
				stageName: "Calificación",
				closurePercentage: 20,
				maxHistoricoClosurePercentage: 20,
			},
			{
				id: ETAPA_CALIFICACION_20,
				name: "Calificación",
				closurePercentage: 20,
				order: 3,
			},
		);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: null, notes: "sin cliente todavía" },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores).toMatchObject({ notes: "sin cliente todavía" });
		expect(columnasEscritas(escritura)).not.toContain("leadId");
	});

	test("el cambio de verdad se aplica SOBRE el lead que se leyó, no sobre el que quedó", async () => {
		// Red de seguridad y la otra mitad del arreglo. Un cambio real sigue
		// pasando por todas las guardas y sigue escribiendo el campo, pero el
		// UPDATE exige en su propio WHERE que el cliente vivo siga siendo el que se
		// leyó: si otro request lo cambió en el medio, son cero filas (CONFLICT) y
		// no un pisotón silencioso con una bitácora que miente sobre el anterior.
		sembrar(
			{
				...conElLeadA,
				stageId: ETAPA_CALIFICACION_20,
				analysisStatus: "not_applicable",
				creditDetailApproved: null,
				stageName: "Calificación",
				closurePercentage: 20,
				maxHistoricoClosurePercentage: 20,
			},
			{
				id: ETAPA_CALIFICACION_20,
				name: "Calificación",
				closurePercentage: 20,
				order: 3,
			},
		);

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, leadId: LEAD_B },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		// Cambiar el cliente de verdad sigue escribiendo el campo...
		expect(escritura?.valores).toMatchObject({ leadId: LEAD_B });
		// ...y sigue pagando la invalidación de identidad.
		expect(escritura?.valores.creditDetailApproved).toBe(false);

		// ...y la premisa viaja DENTRO de la sentencia: `lead_id = <el leído>`.
		const { sql: texto, params } = sqlDeLaCondicion(escritura?.condicion);
		expect(texto.replace(/\s+/g, " ").toLowerCase()).toContain('lead_id" =');
		expect(params).toContain(LEAD_A);
	});

	test("un update que no manda `leadId` no paga ninguna condición nueva", async () => {
		// Red de seguridad: el flujo normal. Sin el campo en el input no hay nada
		// que sacar del `SET` ni nada que exigir en el WHERE.
		sembrar(conElLeadA, {
			id: ETAPA_CIERRE_40,
			name: "Cierre de propuesta",
			closurePercentage: 40,
			order: 5,
		});

		await invocar(
			crmRouter.updateOpportunity,
			{ id: OPORTUNIDAD, notes: "solo una nota" },
			contextoDe("vendedor", "sales"),
		);

		const [escritura] = escriturasSobreOportunidades();
		expect(escritura?.valores).toMatchObject({ notes: "solo una nota" });
		expect(columnasEscritas(escritura)).not.toContain("leadId");

		// El WHERE no pinea el cliente: una edición que no toca la identidad no
		// tiene por qué fallar porque otro la haya corregido en paralelo.
		const { params } = sqlDeLaCondicion(escritura?.condicion);
		expect(params).not.toContain(LEAD_A);
	});

	test("cambiar el cliente arriba del umbral sigue bloqueado", async () => {
		// Red de seguridad: sacar el campo del `SET` no puede aflojar el candado
		// para el cambio de verdad.
		sembrar(conElLeadA, {
			id: ETAPA_CIERRE_40,
			name: "Cierre de propuesta",
			closurePercentage: 40,
			order: 5,
		});

		await expect(
			invocar(
				crmRouter.updateOpportunity,
				{ id: OPORTUNIDAD, leadId: LEAD_B },
				contextoDe("vendedor", "sales"),
			),
		).rejects.toThrow(/No se puede cambiar el cliente de esta oportunidad/);

		expect(escriturasSobreOportunidades()).toEqual([]);
	});
});

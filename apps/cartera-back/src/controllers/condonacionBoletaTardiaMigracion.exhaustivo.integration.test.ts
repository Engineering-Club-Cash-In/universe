import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { parseTestDatabaseUrl } from "./monto-a-cobrar-participacion-test-db";

// Pruebas exhaustivas de caja negra de la Tarea 2 (migraciones 0053-0055 + esquema drizzle).
// Contra Postgres real (TEST_DATABASE_URL = cartera-local, base descartable).

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const lee = (nombre: string) => readFileSync(new URL(`../../drizzle/${nombre}`, import.meta.url), "utf8");
const M0053 = "0053_condonacion_boleta_tardia_enum.sql";
const M0054 = "0054_condonacion_boleta_tardia_columnas.sql";
const M0055 = "0055_condonacion_boleta_tardia_indice_pagos.sql";

const ORIGENES_VIEJOS = [
	"PROCESO_AUTO",
	"API_MANUAL",
	"CONDONACION_INDIVIDUAL",
	"CONDONACION_MASIVA",
	"CONDONACION_NEXA_A_TIEMPO",
];
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
const U3 = "00000000-0000-4000-8000-0000000000a3";

let sql: ReturnType<typeof postgres>;
const codigoDe = async (fn: () => PromiseLike<unknown>): Promise<string | undefined> => {
	try {
		await fn();
		return undefined;
	} catch (error) {
		const e = error as { code?: string; cause?: { code?: string } };
		return e.code ?? e.cause?.code ?? "SIN_CODIGO";
	}
};
const aplica = async (archivo: string) => {
	await sql.unsafe(lee(archivo)).simple();
};
const insertarCond = (intento: string | null, credito = 1) =>
	sql`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, usuario_id, intento_id)
		VALUES (${credito}, 1, 'x', 1, ${intento}::uuid)`;

afterAll(async () => {
	await sql?.end();
});

describe("Tarea 2: archivos SQL (forma)", () => {
	test("0053 y 0055 son UNA sola sentencia sin transacción; 0054 sin BEGIN/COMMIT", () => {
		for (const archivo of [M0053, M0054, M0055]) {
			const sinComentarios = lee(archivo)
				.split("\n")
				.filter((l) => !l.trim().startsWith("--"))
				.join("\n");
			expect(sinComentarios).not.toMatch(/\b(BEGIN|COMMIT|START TRANSACTION)\b/i);
		}
		const cuenta = (archivo: string) =>
			lee(archivo)
				.split("\n")
				.filter((l) => !l.trim().startsWith("--"))
				.join("\n")
				.split(";")
				.filter((s) => s.trim().length > 0).length;
		expect(cuenta(M0053)).toBe(1);
		expect(cuenta(M0055)).toBe(1);
		expect(lee(M0055)).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
		expect(lee(M0053)).toMatch(/ADD VALUE IF NOT EXISTS 'CONDONACION_BOLETA_TARDIA'/);
	});

	test("las tres sentencias usan IF NOT EXISTS (idempotencia declarada) y cartera. calificado", () => {
		expect(lee(M0054).match(/IF NOT EXISTS/g)?.length).toBe(3);
		for (const a of [M0053, M0054, M0055]) expect(lee(a)).toContain("cartera.");
	});
});

describe("Tarea 2: Postgres real", () => {
	beforeAll(async () => {
		if (!testDatabaseUrl) return;
		parseTestDatabaseUrl(testDatabaseUrl);
		sql = postgres(testDatabaseUrl, { ssl: false, onnotice: () => undefined, max: 6 });
		await sql`DROP SCHEMA IF EXISTS cartera CASCADE`;
		await sql`CREATE SCHEMA cartera`;
		await sql.unsafe(
			`CREATE TYPE cartera.mora_evento_origen AS ENUM (${ORIGENES_VIEJOS.map((o) => `'${o}'`).join(",")})`,
		);
		// Estado "viejo" (antes de 0053-0055): lo mínimo de las dos tablas.
		await sql`CREATE TABLE cartera.moras_condonaciones (condonacion_id serial PRIMARY KEY,
			credito_id integer NOT NULL, mora_id integer NOT NULL, motivo text NOT NULL,
			usuario_id integer NOT NULL, anulada_at timestamptz,
			nexa_payment_event_id integer, pagos_pendientes_ids integer[])`;
		await sql`CREATE UNIQUE INDEX uq_moras_condonaciones_nexa_evento_viva ON cartera.moras_condonaciones (nexa_payment_event_id)
			WHERE nexa_payment_event_id IS NOT NULL AND anulada_at IS NULL`;
		await sql`CREATE TABLE cartera.pagos_credito (pago_id serial PRIMARY KEY, credito_id integer,
			nexa_payment_event_id integer, cuota_id integer)`;
		await sql`CREATE INDEX idx_pagos_credito_cuota ON cartera.pagos_credito (cuota_id)`;
		// Filas viejas con datos reales de forma.
		await sql`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, usuario_id, nexa_payment_event_id, pagos_pendientes_ids)
			VALUES (10, 1, 'vieja manual', 1, NULL, NULL), (10, 1, 'vieja nexa', 1, 77, ARRAY[1,2]), (11, 2, 'vieja anulada', 1, 78, NULL)`;
		await sql`UPDATE cartera.moras_condonaciones SET anulada_at = now() WHERE motivo = 'vieja anulada'`;
		await sql`INSERT INTO cartera.pagos_credito (credito_id, nexa_payment_event_id, cuota_id)
			SELECT 10, CASE WHEN g % 50 = 0 THEN g END, g % 500 FROM generate_series(1, 20000) g`;
	});

	integrationTest("0053 dentro de BEGIN: el valor no se puede usar en la misma tx (por eso va a mano, fuera de tx)", async () => {
		const codigo = await codigoDe(() =>
			sql.begin(async (tx) => {
				await tx.unsafe(lee(M0053)).simple();
				await tx.unsafe(`SELECT 'CONDONACION_BOLETA_TARDIA'::cartera.mora_evento_origen`).simple();
			}),
		);
		expect(codigo).toBe("55P04"); // unsafe_new_enum_value_usage
		const e = await sql`SELECT unnest(enum_range(NULL::cartera.mora_evento_origen))::text AS e`;
		expect(e.map((r) => r.e)).toEqual(ORIGENES_VIEJOS); // rollback: nada quedó a medias
	});

	integrationTest("0053 fuera de tx: acepta el valor nuevo, conserva los viejos en su orden, y es idempotente", async () => {
		await aplica(M0053);
		await aplica(M0053);
		await aplica(M0053);
		const e = await sql`SELECT e::text AS e FROM unnest(enum_range(NULL::cartera.mora_evento_origen)) e`;
		expect(e.map((r) => r.e)).toEqual([...ORIGENES_VIEJOS, "CONDONACION_BOLETA_TARDIA"]);
		for (const v of [...ORIGENES_VIEJOS, "CONDONACION_BOLETA_TARDIA"]) {
			const [r] = await sql.unsafe(`SELECT '${v}'::cartera.mora_evento_origen::text AS v`);
			expect(r.v).toBe(v);
		}
		expect(await codigoDe(() => sql.unsafe(`SELECT 'CONDONACION_BOLETA_TARDIA_X'::cartera.mora_evento_origen`))).toBe("22P02");
	});

	integrationTest("antes de 0054 no existen las columnas; 0054 las crea nullable sin default y respeta las filas viejas", async () => {
		const antes = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema='cartera'
			AND column_name IN ('intento_id','boleta_tardia_intento_id')`;
		expect(antes).toHaveLength(0);
		await aplica(M0054);
		const cols = await sql`SELECT table_name, column_name, udt_name, is_nullable, column_default
			FROM information_schema.columns WHERE table_schema='cartera'
			AND column_name IN ('intento_id','boleta_tardia_intento_id') ORDER BY table_name`;
		expect([...cols]).toEqual([
			{ table_name: "moras_condonaciones", column_name: "intento_id", udt_name: "uuid", is_nullable: "YES", column_default: null },
			{ table_name: "pagos_credito", column_name: "boleta_tardia_intento_id", udt_name: "uuid", is_nullable: "YES", column_default: null },
		]);
		const viejas = await sql`SELECT motivo, intento_id, nexa_payment_event_id, anulada_at IS NOT NULL AS anulada,
			pagos_pendientes_ids FROM cartera.moras_condonaciones ORDER BY condonacion_id`;
		expect(viejas.map((r) => r.intento_id)).toEqual([null, null, null]);
		expect(viejas.map((r) => r.motivo)).toEqual(["vieja manual", "vieja nexa", "vieja anulada"]);
		expect(viejas[1].nexa_payment_event_id).toBe(77);
		expect(viejas[1].pagos_pendientes_ids).toEqual([1, 2]);
		expect(viejas[2].anulada).toBe(true);
		const [p] = await sql`SELECT count(*)::int AS n, count(boleta_tardia_intento_id)::int AS con FROM cartera.pagos_credito`;
		expect(p).toEqual({ n: 20000, con: 0 });
		// Las filas viejas siguen siendo editables y consultables con los índices de Nexa intactos.
		expect(await codigoDe(() => sql`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, usuario_id, nexa_payment_event_id)
			VALUES (10, 1, 'dup nexa', 1, 77)`)).toBe("23505");
	});

	integrationTest("0055 construye el índice parcial VÁLIDO sobre tabla con filas; 0054+0055 re-aplicados no fallan ni duplican", async () => {
		await aplica(M0055);
		for (let i = 0; i < 2; i++) {
			await aplica(M0054);
			await aplica(M0055);
			await aplica(M0053);
		}
		const idx = await sql`SELECT c.relname, i.indisvalid, i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS pred,
			pg_get_indexdef(i.indexrelid) AS def
			FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname='cartera' AND c.relname IN ('pagos_credito_idx_boleta_tardia_intento','uq_moras_condonaciones_intento_viva')
			ORDER BY c.relname`;
		expect(idx).toHaveLength(2);
		const pagos = idx.find((r) => r.relname === "pagos_credito_idx_boleta_tardia_intento")!;
		const conds = idx.find((r) => r.relname === "uq_moras_condonaciones_intento_viva")!;
		expect(pagos.indisvalid).toBe(true);
		expect(pagos.indisunique).toBe(false);
		expect(pagos.pred).toBe("(boleta_tardia_intento_id IS NOT NULL)");
		expect(pagos.def).toContain("(boleta_tardia_intento_id)");
		expect(conds.indisvalid).toBe(true);
		expect(conds.indisunique).toBe(true);
		expect(conds.pred).toMatch(/intento_id IS NOT NULL/);
		expect(conds.pred).toMatch(/anulada_at IS NULL/);
		const [c] = await sql`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='cartera' AND tablename='pagos_credito'`;
		expect(c.n).toBe(3); // pkey + idx_pagos_credito_cuota + el nuevo; más sería duplicado
	});

	integrationTest("0055 dentro de una transacción falla CLARO (25001), no a medias", async () => {
		const codigo = await codigoDe(() => sql.begin((tx) => tx.unsafe(`DROP INDEX cartera.pagos_credito_idx_boleta_tardia_intento; ${lee(M0055)}`).simple()));
		expect(codigo === "25001" || codigo === "25P02" || codigo === "SIN_CODIGO").toBe(true);
		expect(codigo).toBeDefined();
		// el DROP se revirtió con el rollback: el índice sigue
		const [r] = await sql`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='pagos_credito_idx_boleta_tardia_intento'`;
		expect(r.n).toBe(1);
	});

	integrationTest("índice único parcial: vivas con mismo intento -> 23505; anulada + viva -> OK; NULL múltiples -> OK", async () => {
		await insertarCond(U1);
		expect(await codigoDe(() => insertarCond(U1))).toBe("23505");
		// mismo intento en OTRO crédito también choca (el índice es solo por intento)
		expect(await codigoDe(() => insertarCond(U1, 999))).toBe("23505");
		await sql`UPDATE cartera.moras_condonaciones SET anulada_at = now() WHERE intento_id = ${U1}::uuid`;
		await insertarCond(U1); // viva nueva sobre anulada: OK
		// varias anuladas del mismo intento conviven
		await insertarCond(U2);
		await sql`UPDATE cartera.moras_condonaciones SET anulada_at = now() WHERE intento_id = ${U2}::uuid`;
		await insertarCond(U2);
		await sql`UPDATE cartera.moras_condonaciones SET anulada_at = now() WHERE intento_id = ${U2}::uuid`;
		const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE intento_id = ${U2}::uuid AND anulada_at IS NOT NULL`;
		expect(n).toBe(2);
		// muchas sin intento
		for (let i = 0; i < 5; i++) await insertarCond(null);
		// intentos distintos coexisten
		await insertarCond(U3);
		// des-anular una anulada de U1 mientras hay una viva choca (nadie puede "revivir" un duplicado)
		const codigo = await codigoDe(() => sql`UPDATE cartera.moras_condonaciones SET anulada_at = NULL
			WHERE intento_id = ${U1}::uuid AND anulada_at IS NOT NULL`);
		expect(codigo).toBe("23505");
	});

	integrationTest("uuid inválido -> 22P02; el mismo uuid escrito distinto (mayúsculas / sin guiones) choca", async () => {
		expect(await codigoDe(() => insertarCond("no-es-un-uuid"))).toBe("22P02");
		expect(await codigoDe(() => insertarCond(""))).toBe("22P02");
		expect(await codigoDe(() => insertarCond("00000000-0000-4000-8000-0000000000a3 x"))).toBe("22P02");
		expect(await codigoDe(() => insertarCond(U3.toUpperCase()))).toBe("23505");
		expect(await codigoDe(() => insertarCond(U3.replaceAll("-", "")))).toBe("23505");
		expect(await codigoDe(() => sql`INSERT INTO cartera.pagos_credito (credito_id, boleta_tardia_intento_id) VALUES (1, 'zzz'::uuid)`)).toBe("22P02");
	});

	integrationTest("carrera: 8 inserts simultáneos del mismo intento vivo -> exactamente 1 gana, el resto 23505", async () => {
		const U = "00000000-0000-4000-8000-0000000000c1";
		const res = await Promise.all(
			Array.from({ length: 8 }, () => codigoDe(() => insertarCond(U, 5))),
		);
		expect(res.filter((c) => c === undefined)).toHaveLength(1);
		expect(res.filter((c) => c === "23505")).toHaveLength(7);
	});

	integrationTest("sin FK: pagos_credito.boleta_tardia_intento_id acepta un uuid sin condonación y viceversa", async () => {
		const U = "00000000-0000-4000-8000-0000000000d1";
		await sql`INSERT INTO cartera.pagos_credito (credito_id, boleta_tardia_intento_id) VALUES (1, ${U}::uuid)`;
		await insertarCond("00000000-0000-4000-8000-0000000000d2");
		const fks = await sql`SELECT conname FROM pg_constraint WHERE contype='f' AND connamespace = 'cartera'::regnamespace`;
		expect(fks).toHaveLength(0);
		await sql`DELETE FROM cartera.pagos_credito WHERE boleta_tardia_intento_id = ${U}::uuid`; // pago borrable sin tocar la condonación
	});

	integrationTest("EXPLAIN: la consulta por boleta_tardia_intento_id usa el índice parcial (literal y parametrizada)", async () => {
		const U = "00000000-0000-4000-8000-0000000000e1";
		await sql`INSERT INTO cartera.pagos_credito (credito_id, boleta_tardia_intento_id, cuota_id)
			SELECT 10, ${U}::uuid, 1 FROM generate_series(1, 3)`;
		await sql`INSERT INTO cartera.pagos_credito (credito_id, boleta_tardia_intento_id, cuota_id)
			SELECT 10, gen_random_uuid(), 2 FROM generate_series(1, 60)`;
		await sql`ANALYZE cartera.pagos_credito`;
		const plan = async (consulta: string, params: string[] = []) =>
			(await sql.unsafe(`EXPLAIN (FORMAT TEXT) ${consulta}`, params)).map((r) => r["QUERY PLAN"]).join("\n");
		const p1 = await plan(`SELECT pago_id FROM cartera.pagos_credito WHERE boleta_tardia_intento_id = '${U}'`);
		expect(p1).toContain("pagos_credito_idx_boleta_tardia_intento");
		expect(p1).not.toContain("Seq Scan");
		const p2 = await plan(`SELECT pago_id FROM cartera.pagos_credito WHERE boleta_tardia_intento_id = $1`, [U]);
		expect(p2).toContain("pagos_credito_idx_boleta_tardia_intento");
		// el "barrido": todas las filas marcadas
		const p3 = await plan(`SELECT pago_id FROM cartera.pagos_credito WHERE boleta_tardia_intento_id IS NOT NULL`);
		expect(p3).toContain("pagos_credito_idx_boleta_tardia_intento");
		const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.pagos_credito WHERE boleta_tardia_intento_id = ${U}::uuid`;
		expect(n).toBe(3);
		// y el índice de condonaciones lo usa la búsqueda de la viva por intento
		await sql`INSERT INTO cartera.moras_condonaciones (credito_id, mora_id, motivo, usuario_id, intento_id)
			SELECT g, 1, 'm', 1, gen_random_uuid() FROM generate_series(1000, 3000) g`;
		await sql`ANALYZE cartera.moras_condonaciones`;
		const p4 = await plan(`SELECT condonacion_id FROM cartera.moras_condonaciones WHERE intento_id = '${U}' AND anulada_at IS NULL`);
		expect(p4).toContain("uq_moras_condonaciones_intento_viva");
	});

	integrationTest("esquema drizzle: nombres exactos del brief, índices y enum alineados con la base migrada", async () => {
		const schema = await import("../database/db/schema");
		const mc = getTableConfig(schema.moras_condonaciones);
		const pc = getTableConfig(schema.pagos_credito);
		const colMc = mc.columns.find((c) => c.name === "intento_id")!;
		const colPc = pc.columns.find((c) => c.name === "boleta_tardia_intento_id")!;
		expect(colMc.getSQLType()).toBe("uuid");
		expect(colMc.notNull).toBe(false);
		expect(colMc.hasDefault).toBe(false);
		expect(colPc.getSQLType()).toBe("uuid");
		expect(colPc.notNull).toBe(false);
		expect(colPc.hasDefault).toBe(false);
		expect(Object.keys(schema.moras_condonaciones)).toContain("intento_id");
		expect(Object.keys(schema.pagos_credito)).toContain("boletaTardiaIntentoId");
		const iMc = mc.indexes.find((i) => i.config.name === "uq_moras_condonaciones_intento_viva")!;
		const iPc = pc.indexes.find((i) => i.config.name === "pagos_credito_idx_boleta_tardia_intento")!;
		expect(iMc.config.unique).toBe(true);
		expect(iPc.config.unique).toBe(false);
		expect(iMc.config.where).toBeDefined();
		expect(iPc.config.where).toBeDefined();
		// índices viejos siguen declarados
		expect(mc.indexes.some((i) => i.config.name === "uq_moras_condonaciones_nexa_evento_viva")).toBe(true);
		expect(pc.indexes.some((i) => i.config.name === "idx_pagos_credito_cuota")).toBe(true);
		// El enum de drizzle == el de la base migrada (sin deriva ni orden distinto)
		const enDb = await sql`SELECT e::text AS e FROM unnest(enum_range(NULL::cartera.mora_evento_origen)) e`;
		expect([...schema.moraEventoOrigenEnum.enumValues]).toEqual(enDb.map((r) => r.e));
		expect(schema.moraEventoOrigenEnum.enumValues).toContain("CONDONACION_BOLETA_TARDIA");
		for (const v of ORIGENES_VIEJOS) expect<readonly string[]>(schema.moraEventoOrigenEnum.enumValues).toContain(v);
	});

	integrationTest("drizzle insert/select/update reales sobre las columnas nuevas (tablas completadas con todas las columnas del esquema)", async () => {
		const schema = await import("../database/db/schema");
		// Completa las tablas de la base de pruebas con CADA columna que declara drizzle (nullable, tipo plano),
		// para que insert/select tipados de drizzle corran contra Postgres real.
		for (const tabla of [schema.moras_condonaciones, schema.pagos_credito]) {
			const cfg = getTableConfig(tabla);
			for (const c of cfg.columns) {
				const tipo = c.enumValues ? "text" : c.getSQLType();
				await sql.unsafe(`ALTER TABLE cartera.${cfg.name} ADD COLUMN IF NOT EXISTS "${c.name}" ${tipo}`);
			}
			for (const c of cfg.columns) {
				await sql.unsafe(`ALTER TABLE cartera.${cfg.name} ALTER COLUMN "${c.name}" DROP NOT NULL`).catch(() => undefined);
			}
		}
		const db = drizzle(sql, { schema });
		const U = "00000000-0000-4000-8000-0000000000f1";
		const [fila] = await db
			.insert(schema.moras_condonaciones)
			.values({ credito_id: 77, mora_id: 5, motivo: "drizzle", usuario_id: 1, intento_id: U })
			.returning();
		expect(fila.intento_id).toBe(U);
		const leida = await db.select().from(schema.moras_condonaciones).where(eq(schema.moras_condonaciones.intento_id, U));
		expect(leida).toHaveLength(1);
		expect(leida[0].condonacion_id).toBe(fila.condonacion_id);
		// sin intento: queda NULL (no undefined ni cadena)
		const [sin] = await db
			.insert(schema.moras_condonaciones)
			.values({ credito_id: 78, mora_id: 5, motivo: "sin intento", usuario_id: 1 })
			.returning();
		expect(sin.intento_id).toBeNull();
		// choque 23505 también por drizzle
		const dup = await codigoDe(() =>
			db.insert(schema.moras_condonaciones).values({ credito_id: 79, mora_id: 5, motivo: "dup", usuario_id: 1, intento_id: U }),
		);
		expect(dup).toBe("23505");
		// pagos_credito: columna nueva por nombre de propiedad, select de fila completa y por filtro
		await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id) VALUES (77, 1)`;
		const [{ pago_id }] = await sql`SELECT max(pago_id) AS pago_id FROM cartera.pagos_credito`;
		await db.update(schema.pagos_credito).set({ boletaTardiaIntentoId: U }).where(eq(schema.pagos_credito.pago_id, pago_id));
		const marcados = await db.select().from(schema.pagos_credito).where(eq(schema.pagos_credito.boletaTardiaIntentoId, U));
		expect(marcados.map((p) => p.pago_id)).toEqual([pago_id]);
		expect(marcados[0].boletaTardiaIntentoId).toBe(U);
		const noMarcado = await db.select().from(schema.pagos_credito).where(eq(schema.pagos_credito.pago_id, 1));
		expect(noMarcado[0].boletaTardiaIntentoId).toBeNull();
		// SQL generado: nombre físico exacto
		const q = db.select({ x: schema.pagos_credito.boletaTardiaIntentoId }).from(schema.pagos_credito).toSQL();
		expect(q.sql).toContain('"boleta_tardia_intento_id"');
		const q2 = db.select({ x: schema.moras_condonaciones.intento_id }).from(schema.moras_condonaciones).toSQL();
		expect(q2.sql).toContain('"intento_id"');
		// El mismo select de fila completa sobre la tabla de pagos NO se rompe (E-4)
		const todos = await db.select().from(schema.pagos_credito).limit(3);
		expect(todos).toHaveLength(3);
	});

	integrationTest("el valor nuevo del enum se puede escribir desde drizzle en una tabla que use moraEventoOrigenEnum", async () => {
		await sql`CREATE TABLE cartera.t_origen (id serial PRIMARY KEY, origen cartera.mora_evento_origen NOT NULL)`;
		const schema = await import("../database/db/schema");
		for (const v of schema.moraEventoOrigenEnum.enumValues) {
			await sql.unsafe(`INSERT INTO cartera.t_origen (origen) VALUES ('${v}')`);
		}
		const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.t_origen`;
		expect(n).toBe(schema.moraEventoOrigenEnum.enumValues.length);
		expect(n).toBe(6);
	});
});

/**
 * Integración contra Postgres REAL (el SQL de `buscarReferenciasDuplicadasLote`
 * es raw). Se salta si no hay base de pruebas. Correr con:
 *
 *   docker run -d --rm --name crm-refdpi-pg -e POSTGRES_PASSWORD=t -p 55439:5432 postgres:16-alpine
 *   DATABASE_URL=postgres://postgres:t@localhost:55439/postgres bunx drizzle-kit push --force
 *   CRM_TEST_DATABASE_URL=postgres://postgres:t@localhost:55439/postgres bun test src/lib/referencia-duplicada
 *
 * Siembra, limpia Y consulta con un cliente PROPIO creado desde
 * CRM_TEST_DATABASE_URL (solo localhost), que se le pasa a la función como
 * `cliente`. No usa el `db` compartido: otros archivos de la misma corrida lo
 * reemplazan con `mock.module("../db")` (global al proceso), y así estas
 * pruebas corren de verdad en la suite completa y nunca escriben en otra base.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { ExclusionesReferenciaDuplicada } from "./referencia-duplicada";
import {
	normalizarDpiReferencia,
	type ReferenciaComparable,
} from "./referencia-normalizacion";

const URL_PRUEBAS = process.env.CRM_TEST_DATABASE_URL ?? "";
const hostPruebas = URL_PRUEBAS ? new URL(URL_PRUEBAS).hostname : "";
const esLocal = hostPruebas === "localhost" || hostPruebas === "127.0.0.1";
if (URL_PRUEBAS && !esLocal) {
	throw new Error("CRM_TEST_DATABASE_URL debe apuntar a localhost");
}

const DPI_A = "2345678990101";
const DPI_B = "1234567030101";
const DPI_C = "3456789070101";
const DPI_D = "4567890140101";
const DPI_E = "5678901200101";

describe.skipIf(!esLocal)(
	"buscarReferenciasDuplicadasLote (Postgres real)",
	() => {
		// Cliente propio de pruebas: único que siembra y limpia.
		// biome-ignore lint/suspicious/noExplicitAny: drizzle sin esquema
		let db: any;
		let pool: Pool | undefined;
		let listo = false;
		// biome-ignore lint/suspicious/noExplicitAny: idem
		let buscarCrudo: any;
		/** Solo las listas de coincidencias (la forma que usan casi todas las pruebas). */
		const buscar = async (
			refs: unknown[],
			excl: ExclusionesReferenciaDuplicada = {},
		) =>
			// biome-ignore lint/suspicious/noExplicitAny: resultado del lote
			(await buscarCrudo(refs, excl)).map((r: any) => r.coincidencias);
		let stageId: string;
		const usuario = `u-refdpi-${Date.now()}`;

		async function crearLead(nombre: string, dpi?: string): Promise<string> {
			const r = await db.execute(sql`
			INSERT INTO leads (first_name, last_name, dpi, assigned_to, created_by)
			VALUES (${nombre}, 'Prueba', ${dpi ?? null}, ${usuario}, ${usuario}) RETURNING id::text AS id`);
			return r.rows[0].id;
		}
		async function crearOpp(leadId: string | null): Promise<string> {
			const r = await db.execute(sql`
			INSERT INTO opportunities (title, stage_id, assigned_to, created_by, lead_id)
			VALUES ('opp', ${stageId}::uuid, ${usuario}, ${usuario}, ${leadId}::uuid) RETURNING id::text AS id`);
			return r.rows[0].id;
		}
		async function solicitud(oppId: string, refs: unknown) {
			const json = refs === null ? null : JSON.stringify(refs);
			await db.execute(sql`
			INSERT INTO credit_applications (opportunity_id, referencias_personales)
			VALUES (${oppId}::uuid, ${json}::jsonb)`);
		}
		async function solicitudFamiliar(oppId: string, refs: unknown) {
			await db.execute(sql`
			INSERT INTO credit_applications (opportunity_id, referencias_crediticias)
			VALUES (${oppId}::uuid, ${refs === null ? null : JSON.stringify(refs)}::jsonb)`);
		}
		async function refLead(leadId: string, nombre: string, telefono: string) {
			await db.execute(sql`
			INSERT INTO referencias_lead (lead_id, nombre, telefono, parentesco)
			VALUES (${leadId}::uuid, ${nombre}, ${telefono}, 'amigo_a')`);
		}

		beforeAll(async () => {
			pool = new Pool({ connectionString: URL_PRUEBAS });
			db = drizzle(pool);
			const { buscarReferenciasDuplicadasLote } = await import(
				"./referencia-duplicada"
			);
			buscarCrudo = (
				refs: ReferenciaComparable[],
				excl: ExclusionesReferenciaDuplicada = {},
			) => buscarReferenciasDuplicadasLote(refs, excl, db);
			await db.execute(sql`
			INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
			VALUES (${usuario}, 'Admin Prueba', ${`${usuario}@t.test`}, true, 'admin', now(), now())`);
			const s = await db.execute(sql`
			INSERT INTO sales_stages (name, "order", closure_percentage, color)
			VALUES ('Etapa', 1, 10, '#000') RETURNING id::text AS id`);
			stageId = s.rows[0].id;
			listo = true;
		});

		afterAll(async () => {
			if (!listo || !db || !pool) return;
			await db.execute(
				sql`DELETE FROM opportunities WHERE created_by = ${usuario}`,
			);
			await db.execute(sql`DELETE FROM leads WHERE created_by = ${usuario}`);
			if (stageId)
				await db.execute(
					sql`DELETE FROM sales_stages WHERE id = ${stageId}::uuid`,
				);
			await db.execute(sql`DELETE FROM "user" WHERE id = ${usuario}`);
			await pool.end();
		});

		test("coincide por DPI contra la solicitud de otro cliente (teléfono distinto)", async () => {
			const otro = await crearLead("OtroDpi");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{
					nombre: "Maria Ref",
					relacion: "amiga",
					telefono: "41110000",
					dpi: DPI_A,
				},
			]);
			const yo = await crearLead("YoDpi");
			const oppYo = await crearOpp(yo);

			const [res] = await buscar(
				[{ dpi: "2345 67899 0101", telefono: "99990000" }],
				{
					excluirLeadIds: [yo],
					excluirOportunidadId: oppYo,
				},
			);
			expect(res).toHaveLength(1);
			expect(res[0]).toMatchObject({
				tipo: "personal",
				leadId: otro,
				clienteNombre: "OtroDpi Prueba",
				referenciaNombre: "Maria Ref",
				parentesco: "amiga",
				coincidePor: "dpi",
			});
		});

		test("coincide por teléfono con referencias_lead de otro lead (formato distinto)", async () => {
			const otro = await crearLead("OtroCobros");
			await refLead(otro, "Pedro Cobros", "55551234");
			const yo = await crearLead("YoCobros");

			const [res] = await buscar([{ telefono: "+502 5555-1234" }], {
				excluirLeadIds: [yo],
			});
			const r = res.find((x: { leadId: string }) => x.leadId === otro);
			expect(r).toMatchObject({
				tipo: "cobros",
				referenciaNombre: "Pedro Cobros",
				parentesco: "amigo_a",
				coincidePor: "telefono",
			});
		});

		test("telefono guardado con formato en referencias_lead tambien coincide", async () => {
			const otro = await crearLead("OtroCobrosFmt");
			await refLead(otro, "Ana Fmt", "+502 7777-8888");
			const [res] = await buscar([{ telefono: "77778888" }], {});
			expect(res.some((x: { leadId: string }) => x.leadId === otro)).toBe(true);
		});

		test("DPI distinto + mismo teléfono en otra solicitud -> sin coincidencia", async () => {
			const otro = await crearLead("OtroDistintoDpi");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{
					nombre: "Casa Compartida",
					relacion: "x",
					telefono: "22223333",
					dpi: DPI_B,
				},
			]);
			const [res] = await buscar([{ dpi: DPI_A, telefono: "22223333" }], {});
			expect(res.some((x: { leadId: string }) => x.leadId === otro)).toBe(
				false,
			);
		});

		test("otra solicitud sin DPI + mismo teléfono -> coincide por teléfono", async () => {
			const otro = await crearLead("OtroSinDpi");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{ nombre: "Sin Dpi", relacion: "x", telefono: "+502 3333 4444" },
			]);
			const [res] = await buscar([{ dpi: DPI_A, telefono: "33334444" }], {});
			const r = res.find((x: { leadId: string }) => x.leadId === otro);
			expect(r?.coincidePor).toBe("telefono");
		});

		test("mismo lead y misma oportunidad quedan excluidos", async () => {
			const yo = await crearLead("YoExcluido");
			const oppYo = await crearOpp(yo);
			await solicitud(oppYo, [
				{ nombre: "Propia", relacion: "x", telefono: "44445555", dpi: DPI_C },
			]);
			await refLead(yo, "Propia Cobros", "44445555");
			const sinExcluir = await buscar(
				[{ dpi: DPI_C, telefono: "44445555" }],
				{},
			);
			expect(
				sinExcluir[0].filter((x: { leadId: string }) => x.leadId === yo).length,
			).toBeGreaterThan(0);

			const [res] = await buscar([{ dpi: DPI_C, telefono: "44445555" }], {
				excluirLeadIds: [yo],
				excluirOportunidadId: oppYo,
			});
			expect(
				res.filter((x: { leadId: string }) => x.leadId === yo),
			).toHaveLength(0);

			// Solo excluir la oportunidad (otra opp del mismo lead cuenta como "otro cliente"? no: mismo lead)
			const [soloOpp] = await buscar([{ dpi: DPI_C, telefono: "44445555" }], {
				excluirOportunidadId: oppYo,
			});
			// la solicitud ya no sale, pero referencias_lead del mismo lead sí (no hay filtro por opp ahí)
			expect(
				soloOpp.filter(
					(x: { leadId: string; tipo: string }) =>
						x.leadId === yo && x.tipo === "personal",
				),
			).toHaveLength(0);
		});

		test("JSONB con basura no rompe la consulta", async () => {
			const basura = [
				null,
				[],
				"",
				{},
				"texto",
				[null],
				[{}],
				[{ nombre: "x" }],
				[{ nombre: "x", telefono: "" }],
				[{ nombre: "x", telefono: null, dpi: null }],
				[{ nombre: "x", telefono: 55551234 }],
				[[]],
				[1, "a", true],
			];
			for (const b of basura) {
				const l = await crearLead("Basura");
				const o = await crearOpp(l);
				await solicitud(o, b);
			}
			// referencias_personales NULL (columna null, no JSON null)
			const ln = await crearLead("BasuraNull");
			const on = await crearOpp(ln);
			await solicitud(on, null);
			// jsonb 'null' literal
			const lj = await crearLead("BasuraJsonNull");
			const oj = await crearOpp(lj);
			await db.execute(
				sql`INSERT INTO credit_applications (opportunity_id, referencias_personales) VALUES (${oj}::uuid, 'null'::jsonb)`,
			);

			const res = await buscar(
				[{ telefono: "55551234", dpi: DPI_A }, { telefono: "12345678" }],
				{},
			);
			expect(res).toHaveLength(2);
			// telefono numérico 55551234 en JSON: ->> lo vuelve texto, coincide (comportamiento a documentar)
			expect(Array.isArray(res[0])).toBe(true);
		});

		test("lote: resultados en el mismo orden que la entrada, con vacíos", async () => {
			const otro = await crearLead("OtroLote");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{ nombre: "Lote Uno", relacion: "x", telefono: "61610001" },
				{ nombre: "Lote Tres", relacion: "x", telefono: "61610003" },
			]);
			const res = await buscar(
				[
					{ telefono: "61610003" },
					{ telefono: "00000000" },
					{ telefono: "123" }, // inválido
					{ telefono: "+502 6161-0001" },
				],
				{},
			);
			expect(res).toHaveLength(4);
			expect(
				res[0].map((x: { referenciaNombre: string }) => x.referenciaNombre),
			).toEqual(["Lote Tres"]);
			expect(res[1]).toEqual([]);
			expect(res[2]).toEqual([]);
			expect(
				res[3].map((x: { referenciaNombre: string }) => x.referenciaNombre),
			).toEqual(["Lote Uno"]);
		});

		test("sin DPI ni teléfono válido: no consulta y devuelve vacíos", async () => {
			const res = await buscar([{}, { telefono: "12" }, { dpi: "1" }], {});
			expect(res).toEqual([[], [], []]);
		});

		test("titular y codeudor del mismo cliente -> una sola alerta aunque el nombre difiera", async () => {
			const otro = await crearLead("OtroTitCod");
			const oppOtro = await crearOpp(otro);
			const ref = {
				nombre: "Juan",
				relacion: "x",
				telefono: "71710000",
				dpi: DPI_B,
			};
			// titular
			await solicitud(oppOtro, [ref]);
			// codeudor: otra fila de credit_applications en la misma oportunidad
			await db.execute(sql`
			INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
			VALUES (${oppOtro}::uuid, 'coDebtor', gen_random_uuid(), ${JSON.stringify([{ ...ref, nombre: "Juan Perez" }])}::jsonb)`);
			const [res] = await buscar([{ dpi: DPI_B, telefono: "71710000" }], {});
			expect(
				res.filter((x: { leadId: string }) => x.leadId === otro),
			).toHaveLength(1);
		});

		test.each([
			["telefono primero", true],
			["dpi primero", false],
		])("mismo cliente con una fila solo por teléfono y otra por DPI -> una coincidencia 'dpi' (%s)", async (_orden, telefonoPrimero) => {
			const otro = await crearLead(`OtroMixto${telefonoPrimero ? "T" : "D"}`);
			const oppOtro = await crearOpp(otro);
			const soloTelefono = {
				nombre: "Mixto Tel",
				relacion: "x",
				telefono: "63630000",
			};
			const porDpi = {
				nombre: "Mixto Dpi",
				relacion: "x",
				telefono: "63639999",
				dpi: DPI_E,
			};
			const filas = telefonoPrimero
				? [soloTelefono, porDpi]
				: [porDpi, soloTelefono];
			// Cada fila en su propia solicitud (titular y codeudor), en el orden a probar.
			await solicitud(oppOtro, [filas[0]]);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
				VALUES (${oppOtro}::uuid, 'coDebtor', gen_random_uuid(), ${JSON.stringify([filas[1]])}::jsonb)`);

			const [res] = await buscar([{ dpi: DPI_E, telefono: "63630000" }], {});
			const delOtro = res.filter((x: { leadId: string }) => x.leadId === otro);
			expect(delOtro).toHaveLength(1);
			expect(delOtro[0].coincidePor).toBe("dpi");
		});

		test("el mismo lead con OTRA oportunidad no alerta en el lado solicitud", async () => {
			const yo = await crearLead("YoOtraOpp");
			const oppUno = await crearOpp(yo);
			const oppDos = await crearOpp(yo);
			await solicitud(oppUno, [
				{
					nombre: "Propia Otra Opp",
					relacion: "x",
					telefono: "52520000",
					dpi: DPI_C,
				},
			]);
			const [res] = await buscar([{ dpi: DPI_C, telefono: "52520000" }], {
				excluirLeadIds: [yo],
				excluirOportunidadId: oppDos,
			});
			expect(
				res.filter((x: { leadId: string }) => x.leadId === yo),
			).toHaveLength(0);
		});

		test("limita a 10 coincidencias por referencia", async () => {
			for (let i = 0; i < 12; i++) {
				const l = await crearLead(`Muchos${i}`);
				await refLead(l, `Ref ${i}`, "81810000");
			}
			const [r] = await buscarCrudo([{ telefono: "81810000" }], {});
			expect(r.coincidencias).toHaveLength(10);
			expect(r.total).toBe(12);
		});

		test("un cliente con la referencia en cobros Y en su solicitud sale una sola vez", async () => {
			const otro = await crearLead("OtroCobrosYSolicitud");
			await refLead(otro, "Ref Cobros", "64640001");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{ nombre: "Ref Solicitud", relacion: "x", telefono: "64640001" },
			]);
			const [r] = await buscarCrudo([{ telefono: "64640001" }], {});
			const delOtro = r.coincidencias.filter(
				(x: { leadId: string }) => x.leadId === otro,
			);
			expect(delOtro).toHaveLength(1);
			expect(r.total).toBe(1);
		});

		test("si coincide por teléfono en una fila y por DPI en otra, queda 'dpi' sin importar el orden", async () => {
			for (const dpiPrimero of [true, false]) {
				const otro = await crearLead(`OtroPrioridad${dpiPrimero}`);
				const oppOtro = await crearOpp(otro);
				const tel = dpiPrimero ? "65650001" : "65650002";
				const porTelefono = () => refLead(otro, "Por Telefono", tel);
				const porDpi = () =>
					solicitud(oppOtro, [
						{
							nombre: "Por Dpi",
							relacion: "x",
							telefono: "10203040",
							dpi: DPI_E,
						},
					]);
				if (dpiPrimero) {
					await porDpi();
					await porTelefono();
				} else {
					await porTelefono();
					await porDpi();
				}
				const [r] = await buscarCrudo([{ dpi: DPI_E, telefono: tel }], {});
				const delOtro = r.coincidencias.filter(
					(x: { leadId: string }) => x.leadId === otro,
				);
				expect(delOtro).toHaveLength(1);
				expect(delOtro[0].coincidePor).toBe("dpi");
				expect(delOtro[0].referenciaNombre).toBe("Por Dpi");
			}
		});

		test("teléfonos de relleno no coinciden aunque sean iguales", async () => {
			const otro = await crearLead("OtroRelleno");
			await refLead(otro, "Relleno Cobros", "12345678");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{ nombre: "Relleno Sol", relacion: "x", telefono: "00000000" },
			]);
			const res = await buscar(
				[{ telefono: "12345678" }, { telefono: "0000-0000" }],
				{},
			);
			expect(res).toEqual([[], []]);
		});

		test("extensión y varios números: se encuentran por cualquiera, en los dos lados", async () => {
			const otro = await crearLead("OtroExtensiones");
			await refLead(otro, "Multi Cobros", "2222-3333 ext 45 / 8585-0001");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{
					nombre: "Multi Sol",
					relacion: "x",
					telefono: "+502 8686-0001 y 7777-0002 x9",
				},
			]);
			const res = await buscar(
				[
					{ telefono: "85850001" },
					{ telefono: "86860001" },
					{ telefono: "77770002" },
					// el lado buscado también puede traer varios números y extensión
					{ telefono: "1111-1111 / 8686 0001 ext 3" },
				],
				{},
			);
			const nombres = res.map(
				(l: { leadId: string; referenciaNombre: string }[]) =>
					l.filter((x) => x.leadId === otro).map((x) => x.referenciaNombre),
			);
			expect(nombres).toEqual([
				["Multi Cobros"],
				["Multi Sol"],
				["Multi Sol"],
				["Multi Sol"],
			]);
		});

		test("números separados por espacio o con etiquetas: el prefiltro trae la fila y se encuentra cada uno", async () => {
			const otro = await crearLead("OtroEtiquetas");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{
					nombre: "Con Etiquetas",
					relacion: "x",
					telefono: "casa: 2298-7766 cel: 5432-1987",
				},
			]);
			await refLead(otro, "Cobros Espacio", "5555-1234 4444-5678");
			const res = await buscar(
				[
					{ telefono: "22987766" },
					{ telefono: "54321987" },
					{ telefono: "+502 5555 1234" },
					{ telefono: "44445678" },
				],
				{},
			);
			const nombres = res.map(
				(l: { leadId: string; referenciaNombre: string }[]) =>
					l.filter((x) => x.leadId === otro).map((x) => x.referenciaNombre),
			);
			expect(nombres).toEqual([
				["Con Etiquetas"],
				["Con Etiquetas"],
				["Cobros Espacio"],
				["Cobros Espacio"],
			]);
		});

		test("referencias familiares: contra la personal de otro cliente, contra otra familiar y contra cobros", async () => {
			const conPersonal = await crearLead("OtroConPersonal");
			await solicitud(await crearOpp(conPersonal), [
				{
					nombre: "Personal Ajena",
					relacion: "amigo",
					telefono: "69690001",
					dpi: DPI_E,
				},
			]);
			const conFamiliar = await crearLead("OtroConFamiliar");
			await solicitudFamiliar(await crearOpp(conFamiliar), [
				{ nombre: "Familiar Ajena", telefono: "69690002" },
			]);
			const conCobros = await crearLead("OtroConCobros");
			await refLead(conCobros, "Cobros Ajena", "69690003");
			const yo = await crearLead("YoFamiliar");
			const oppYo = await crearOpp(yo);
			await solicitudFamiliar(oppYo, [
				{ nombre: "Mi Familiar 1", telefono: "99990001", dpi: DPI_E },
				{ nombre: "Mi Familiar 2", telefono: "+502 6969-0002" },
				{ nombre: "Mi Familiar 3", telefono: "69690003" },
			]);
			const res = await buscarCrudo(
				[
					{ dpi: DPI_E, telefono: "99990001" },
					{ telefono: "+502 6969-0002" },
					{ telefono: "69690003" },
				],
				{ excluirLeadIds: [yo], excluirOportunidadId: oppYo },
			);
			const de = (i: number, lead: string) =>
				res[i].coincidencias.find((x: { leadId: string }) => x.leadId === lead);
			expect(de(0, conPersonal)).toMatchObject({
				tipo: "personal",
				referenciaNombre: "Personal Ajena",
				parentesco: "amigo",
				coincidePor: "dpi",
			});
			expect(de(1, conFamiliar)).toMatchObject({
				tipo: "familiar",
				referenciaNombre: "Familiar Ajena",
				parentesco: null,
				coincidePor: "telefono",
			});
			expect(de(2, conCobros)).toMatchObject({
				tipo: "cobros",
				referenciaNombre: "Cobros Ajena",
				parentesco: "amigo_a",
			});
		});

		test("la familiar de un lead también se encuentra buscando desde una personal", async () => {
			const otro = await crearLead("OtroSoloFamiliar");
			const oppOtro = await crearOpp(otro);
			await solicitudFamiliar(oppOtro, [
				{ nombre: "Tia Familiar", telefono: "casa: 2298-7766 cel: 5432-1987" },
			]);
			const [r] = await buscarCrudo([{ telefono: "54321987" }], {});
			const x = r.coincidencias.find(
				(c: { leadId: string }) => c.leadId === otro,
			);
			expect(x).toMatchObject({ tipo: "familiar", oportunidadId: oppOtro });
		});

		test("JSONB raro en referencias_crediticias no rompe la consulta", async () => {
			const basura = [
				[],
				{},
				"texto",
				5,
				true,
				[null],
				[[]],
				[1, "a", true],
				[{}],
				[{ nombre: 5, telefono: { a: 1 } }],
				[{ nombre: "x", telefono: null, dpi: null }],
				[{ nombre: "Num", telefono: 70700001 }],
			];
			for (const b of basura) {
				const l = await crearLead("BasuraFamiliar");
				await solicitudFamiliar(await crearOpp(l), b);
			}
			const ln = await crearLead("BasuraFamiliarNull");
			await solicitudFamiliar(await crearOpp(ln), null);
			const lj = await crearLead("BasuraFamiliarJsonNull");
			const oj = await crearOpp(lj);
			await db.execute(
				sql`INSERT INTO credit_applications (opportunity_id, referencias_crediticias) VALUES (${oj}::uuid, 'null'::jsonb)`,
			);
			const res = await buscarCrudo(
				[{ telefono: "70700001" }, { telefono: "12345679" }],
				{},
			);
			expect(res).toHaveLength(2);
			// el teléfono numérico del JSON sí cuenta como texto
			expect(
				res[0].coincidencias.some(
					(c: { tipo: string }) => c.tipo === "familiar",
				),
			).toBe(true);
		});

		test("la misma persona con otro lead (mismo DPI) no es «otro cliente», ni en cobros ni en solicitud", async () => {
			const DPI_PERSONA = "6789012360101";
			const yo = await crearLead("PersonaA", DPI_PERSONA);
			const repetido = await crearLead(
				"PersonaARepetida",
				`${DPI_PERSONA.slice(0, 4)} ${DPI_PERSONA.slice(4, 9)} ${DPI_PERSONA.slice(9)}`,
			);
			const ajeno = await crearLead("Ajeno", DPI_C);
			await refLead(repetido, "Cobros del repetido", "76760001");
			await solicitud(await crearOpp(repetido), [
				{
					nombre: "Solicitud del repetido",
					relacion: "x",
					telefono: "76760001",
				},
			]);
			await refLead(ajeno, "Cobros del ajeno", "76760001");

			const sinExcluir = await buscarCrudo([{ telefono: "76760001" }], {});
			expect(
				sinExcluir[0].coincidencias
					.map((x: { leadId: string }) => x.leadId)
					.sort(),
			).toEqual([repetido, ajeno].sort());
			// por el DPI dado, o por el DPI del lead propio
			for (const exclusiones of [
				{ excluirDpis: [DPI_PERSONA] },
				{ excluirLeadIds: [yo] },
			]) {
				const [con] = await buscarCrudo(
					[{ telefono: "76760001" }],
					exclusiones,
				);
				expect(
					con.coincidencias.map((x: { leadId: string }) => x.leadId),
				).toEqual([ajeno]);
				expect(con.total).toBe(1);
			}
		});

		test("un codeudor que fue titular de su propio lead no se marca a sí mismo", async () => {
			const DPI_CODEUDOR = "6789012360101";
			const titular = await crearLead("TitularReal", DPI_C);
			const suPropioLead = await crearLead("CodeudorComoTitular", DPI_CODEUDOR);
			await solicitud(await crearOpp(suPropioLead), [
				{ nombre: "Mi vieja referencia", relacion: "x", telefono: "77770001" },
			]);
			const [r] = await buscarCrudo([{ telefono: "77770001" }], {
				excluirLeadIds: [titular],
				excluirDpis: [DPI_C, DPI_CODEUDOR],
			});
			expect(r.coincidencias).toEqual([]);
			const [sin] = await buscarCrudo([{ telefono: "77770001" }], {
				excluirLeadIds: [titular],
			});
			expect(
				sin.coincidencias.map((x: { leadId: string }) => x.leadId),
			).toEqual([suPropioLead]);
		});

		test("quien fue codeudor en otro crédito y allí dio la misma referencia no se marca a sí mismo", async () => {
			const DPI_PERSONA = "6789012360101";
			const otroTitular = await crearLead("TitularDeOtroCredito", DPI_C);
			const oppOtro = await crearOpp(otroTitular);
			const suFila = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppOtro}::uuid, 'Yo Como Codeudora', '6789 01236 0101') RETURNING id::text AS id`);
			const ajeno = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppOtro}::uuid, 'Codeudor Ajeno', ${DPI_E}) RETURNING id::text AS id`);
			const insertar = (tipo: string, id: string, telefono: string) =>
				db.execute(sql`
					INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
					VALUES (${oppOtro}::uuid, ${tipo}, ${id}::uuid, ${JSON.stringify([{ nombre: "Ref", telefono }])}::jsonb)`);
			await insertar("coDebtor", suFila.rows[0].id, "79790001");
			await insertar("coDebtor", ajeno.rows[0].id, "79790002");
			await insertar("lead", otroTitular, "79790003");

			const referencias = [
				{ telefono: "79790001" },
				{ telefono: "79790002" },
				{ telefono: "79790003" },
			];
			const quienes = (r: {
				coincidencias: { dadaPor: { nombre: string } }[];
			}) => r.coincidencias.map((x) => x.dadaPor.nombre);
			const sin = await buscarCrudo(referencias, {});
			expect(sin.map(quienes)).toEqual([
				["Yo Como Codeudora"],
				["Codeudor Ajeno"],
				["TitularDeOtroCredito Prueba"],
			]);
			// excluye solo lo que ella misma dio; lo del titular y del otro codeudor sigue
			const con = await buscarCrudo(referencias, {
				excluirDpis: [DPI_PERSONA],
			});
			expect(con.map(quienes)).toEqual([
				[],
				["Codeudor Ajeno"],
				["TitularDeOtroCredito Prueba"],
			]);
		});

		test("titular cambiado: su vieja solicitud es suya, no del titular actual, y no lo alerta a él", async () => {
			const DPI_VICENTE = "6789012360101";
			const vicente = await crearLead("Vicente", DPI_VICENTE);
			const ana = await crearLead("Ana", DPI_C);
			// la oportunidad era de Vicente; hoy su titular es Ana
			const oppVieja = await crearOpp(ana);
			// sin DPI escrito en la solicitud: se lo reconoce por su registro de lead
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, primer_nombre, referencias_personales)
				VALUES (${oppVieja}::uuid, 'lead', ${vicente}::uuid, 'Vicente', ${JSON.stringify([{ nombre: "Y", telefono: "80800001" }])}::jsonb)`);
			const referencia = [{ telefono: "80800001" }];

			const [sin] = await buscarCrudo(referencia, {});
			expect(sin.coincidencias).toEqual([
				expect.objectContaining({
					leadId: vicente,
					clienteNombre: "Vicente Prueba",
					oportunidadId: oppVieja,
					dadaPor: { nombre: "Vicente Prueba", rol: "titular" },
				}),
			]);
			// Vicente revisado desde su oportunidad nueva: por su lead o por su DPI
			for (const exclusiones of [
				{ excluirLeadIds: [vicente] },
				{ excluirDpis: [DPI_VICENTE] },
			]) {
				const [con] = await buscarCrudo(referencia, exclusiones);
				expect(con.coincidencias).toEqual([]);
			}
		});

		test("codeudor borrado: se lo reconoce por el DPI de su solicitud y se nombra con ella", async () => {
			const DPI_BETO = "6789012360101";
			const otro = await crearLead("OtroConBorrado", DPI_C);
			const oppOtro = await crearOpp(otro);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, primer_nombre, primer_apellido, referencias_personales)
				VALUES (${oppOtro}::uuid, 'coDebtor', '88888888-8888-4888-8888-888888888888', ${DPI_BETO}, 'Beto', 'Borrado', ${JSON.stringify([{ nombre: "Z", telefono: "80800002" }])}::jsonb)`);
			const referencia = [{ telefono: "80800002" }];

			const [sin] = await buscarCrudo(referencia, {});
			expect(sin.coincidencias[0]).toMatchObject({
				leadId: otro,
				dadaPor: { nombre: "Beto Borrado", rol: "codeudor" },
			});
			const [con] = await buscarCrudo(referencia, { excluirDpis: [DPI_BETO] });
			expect(con.coincidencias).toEqual([]);
		});

		test("lo que dio el codeudor de una oportunidad propia no alerta: el cliente de esa fila es propio", async () => {
			const yo = await crearLead("YoConCodeudor", DPI_A);
			const oppRevisada = await crearOpp(yo);
			const oppOtra = await crearOpp(yo);
			const co = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppOtra}::uuid, 'Codeudor De Mi Otra', ${DPI_E}) RETURNING id::text AS id`);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
				VALUES (${oppOtra}::uuid, 'coDebtor', ${co.rows[0].id}::uuid, ${JSON.stringify([{ nombre: "R", telefono: "80800031" }])}::jsonb)`);
			const referencia = [{ telefono: "80800031" }];

			const [sin] = await buscarCrudo(referencia, {});
			expect(sin.coincidencias[0]).toMatchObject({
				leadId: yo,
				dadaPor: { nombre: "Codeudor De Mi Otra", rol: "codeudor" },
			});
			const [con] = await buscarCrudo(referencia, {
				excluirLeadIds: [yo],
				excluirOportunidadId: oppRevisada,
			});
			expect(con.coincidencias).toEqual([]);
		});

		test("lo que dio el titular anterior es de él: el titular actual de esa oportunidad sí lo ve", async () => {
			const ana = await crearLead("AnaActual", DPI_A);
			const vicente = await crearLead("VicenteAnterior", DPI_B);
			const oppQueEraDeVicente = await crearOpp(ana);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
				VALUES (${oppQueEraDeVicente}::uuid, 'lead', ${vicente}::uuid, ${JSON.stringify([{ nombre: "S", telefono: "80800032" }])}::jsonb)`);
			const oppDeAna = await crearOpp(ana);

			const [res] = await buscarCrudo([{ telefono: "80800032" }], {
				excluirLeadIds: [ana],
				excluirDpis: [DPI_A],
				excluirOportunidadId: oppDeAna,
			});
			expect(res.coincidencias).toEqual([
				expect.objectContaining({
					leadId: vicente,
					clienteNombre: "VicenteAnterior Prueba",
					oportunidadId: oppQueEraDeVicente,
					dadaPor: { nombre: "VicenteAnterior Prueba", rol: "titular" },
				}),
			]);
		});

		test("para excluir basta un DPI de 13 dígitos, aunque su verificador no cuadre", async () => {
			const DPI_MAL = "1234567890123";
			expect(normalizarDpiReferencia(DPI_MAL)).toBeNull();
			const otroRegistro = await crearLead("MismaPersonaDpiMal", DPI_MAL);
			await refLead(otroRegistro, "Ref", "80800033");
			const referencia = [{ telefono: "80800033" }];
			const [sin] = await buscarCrudo(referencia, {});
			expect(sin.coincidencias).toHaveLength(1);
			const [con] = await buscarCrudo(referencia, {
				excluirDpis: ["1234 56789 0123"],
			});
			expect(con.coincidencias).toEqual([]);
			// menos de 13 dígitos no excluye a nadie
			const [corto] = await buscarCrudo(referencia, { excluirDpis: ["123"] });
			expect(corto.coincidencias).toHaveLength(1);
		});

		test("el cliente de lo que dio un codeudor es el titular con toda su identidad: también el DPI escrito en sus solicitudes", async () => {
			// la misma persona con otro lead sin DPI, que sí escribió su DPI en la solicitud
			const ana = await crearLead("Ana", DPI_A);
			const anaDup = await crearLead("AnaDup");
			const oppDup = await crearOpp(anaDup);
			// otra oportunidad de la misma persona, con un formulario legado sin dueño
			const anaDup2 = await crearLead("AnaDup2");
			const oppLegada = await crearOpp(anaDup2);
			const solicitudCon = (
				opp: string,
				tipo: string | null,
				id: string | null,
				dpi: string | null,
				telefono: string | null,
			) =>
				db.execute(sql`
					INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
					VALUES (${opp}::uuid, ${tipo}, ${id}::uuid, ${dpi}, ${JSON.stringify(telefono ? [{ nombre: "T", telefono }] : [])}::jsonb)`);
			await solicitudCon(oppDup, "lead", anaDup, DPI_A, null);
			await solicitudCon(oppLegada, null, null, DPI_A, null);
			for (const opp of [oppDup, oppLegada]) {
				const co = await db.execute(sql`
					INSERT INTO co_debtors (opportunity_id, full_name, dpi)
					VALUES (${opp}::uuid, 'Vera', ${DPI_C}) RETURNING id::text AS id`);
				await solicitudCon(opp, "coDebtor", co.rows[0].id, DPI_C, "80800041");
			}
			const referencia = [{ telefono: "80800041" }];

			const [sin] = await buscarCrudo(referencia, {});
			expect(
				sin.coincidencias.map((x: { leadId: string }) => x.leadId).sort(),
			).toEqual([anaDup, anaDup2].sort());
			const [con] = await buscarCrudo(referencia, {
				excluirLeadIds: [ana],
				excluirDpis: [DPI_A],
			});
			expect(con.coincidencias).toEqual([]);
		});

		test("la identidad de un lead es una sola en toda la base: el DPI que escribió en cualquier solicitud suya cuenta en cobros y en otras oportunidades", async () => {
			const ana = await crearLead("Ana", DPI_A);
			// Ana otra vez, en un lead sin DPI: solo lo escribió en su solicitud de oppB
			const anaDup = await crearLead("AnaDup");
			const oppB = await crearOpp(anaDup);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
				VALUES (${oppB}::uuid, 'lead', ${anaDup}::uuid, ${DPI_A}, '[]'::jsonb)`);
			// su referencia de cobros, y lo que dio su codeudor en oppD, donde ella no llenó nada
			await refLead(anaDup, "Ref cobros", "80800051");
			const oppD = await crearOpp(anaDup);
			const walter = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppD}::uuid, 'Walter', ${DPI_E}) RETURNING id::text AS id`);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
				VALUES (${oppD}::uuid, 'coDebtor', ${walter.rows[0].id}::uuid, ${DPI_E}, ${JSON.stringify([{ nombre: "W", telefono: "80800052" }])}::jsonb)`);
			// y Ana, en su propia oportunidad, da las dos referencias
			const oppAna = await crearOpp(ana);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
				VALUES (${oppAna}::uuid, 'lead', ${ana}::uuid, ${DPI_A}, ${JSON.stringify(
					[
						{ nombre: "P", telefono: "80800051" },
						{ nombre: "Q", telefono: "80800052" },
					],
				)}::jsonb)`);
			const referencias = [{ telefono: "80800051" }, { telefono: "80800052" }];

			const sin = await buscarCrudo(referencias, {});
			expect(sin.map((r: { total: number }) => r.total)).toEqual([2, 2]);
			// revisada Ana: ni la cobros ni lo del codeudor de su lead duplicado
			const desdeAna = await buscarCrudo(referencias, {
				excluirOportunidadId: oppAna,
				excluirLeadIds: [ana],
				excluirDpis: [DPI_A],
			});
			expect(desdeAna.map((r: { total: number }) => r.total)).toEqual([0, 0]);
			// revisada oppD (titular AnaDup, sin DPI escrito ahí): tampoco lo de Ana
			const desdeDup = await buscarCrudo(referencias, {
				excluirOportunidadId: oppD,
				excluirLeadIds: [anaDup],
				excluirDpis: [DPI_E],
			});
			expect(desdeDup.map((r: { total: number }) => r.total)).toEqual([0, 0]);
		});

		test("sin lead, el titular de una oportunidad es quien llenó sus solicitudes legadas", async () => {
			const oppSinLead = await crearOpp(null);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, dpi, referencias_personales)
				VALUES (${oppSinLead}::uuid, ${DPI_B}, '[]'::jsonb)`);
			const co = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppSinLead}::uuid, 'Codeudor Sin Lead', ${DPI_E}) RETURNING id::text AS id`);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
				VALUES (${oppSinLead}::uuid, 'coDebtor', ${co.rows[0].id}::uuid, ${JSON.stringify([{ nombre: "R", telefono: "80800053" }])}::jsonb)`);
			const referencia = [{ telefono: "80800053" }];
			const [sin] = await buscarCrudo(referencia, {});
			expect(sin.coincidencias).toHaveLength(1);
			// quien revisa es esa misma persona (por el DPI de la legada): el cliente es propio
			const [con] = await buscarCrudo(referencia, { excluirDpis: [DPI_B] });
			expect(con.coincidencias).toEqual([]);
		});

		test("las legadas cuentan solo para el titular actual, no para un titular anterior", async () => {
			const actual = await crearLead("TitularActual");
			const anterior = await crearLead("TitularAnterior");
			const opp = await crearOpp(actual);
			// legada con el DPI de un tercero; el anterior dejó su solicitud con una referencia
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, dpi, referencias_personales)
				VALUES (${opp}::uuid, ${DPI_B}, '[]'::jsonb)`);
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
				VALUES (${opp}::uuid, 'lead', ${anterior}::uuid, ${JSON.stringify([{ nombre: "R", telefono: "80800054" }])}::jsonb)`);
			// el tercero revisa: la del anterior no es suya y sí lo alerta
			const [res] = await buscarCrudo([{ telefono: "80800054" }], {
				excluirDpis: [DPI_B],
			});
			expect(
				res.coincidencias.map((x: { leadId: string }) => x.leadId),
			).toEqual([anterior]);
		});

		test("una solicitud de una oportunidad sin lead también cuenta, y la oportunidad que se revisa se excluye", async () => {
			const oppSinLead = await crearOpp(null);
			await solicitud(oppSinLead, [
				{ nombre: "Sin Lead", relacion: "x", telefono: "78780001" },
			]);
			const yo = await crearLead("YoSinLead");
			const [con] = await buscarCrudo([{ telefono: "78780001" }], {
				excluirLeadIds: [yo],
			});
			expect(con.coincidencias).toHaveLength(1);
			expect(con.coincidencias[0]).toMatchObject({
				leadId: null,
				clienteNombre: null,
				oportunidadId: oppSinLead,
				referenciaNombre: "Sin Lead",
			});
			const [sin] = await buscarCrudo([{ telefono: "78780001" }], {
				excluirLeadIds: [yo],
				excluirOportunidadId: oppSinLead,
			});
			expect(sin.coincidencias).toEqual([]);
		});

		test("DPI inválido cuenta como sin DPI: no coincide por DPI y no tapa el teléfono", async () => {
			const otro = await crearLead("OtroDpiBasura");
			const oppOtro = await crearOpp(otro);
			await solicitud(oppOtro, [
				{
					nombre: "Basura A",
					relacion: "x",
					telefono: "66660001",
					dpi: "0000000000000",
				},
				{
					nombre: "Basura B",
					relacion: "x",
					telefono: "66660002",
					dpi: "1111111111111",
				},
			]);
			// mismo DPI basura, teléfono distinto -> nada
			const [sinTel] = await buscar(
				[{ dpi: "0000000000000", telefono: "99998888" }],
				{},
			);
			expect(sinTel.some((x: { leadId: string }) => x.leadId === otro)).toBe(
				false,
			);
			// DPI basura DISTINTO pero mismo teléfono -> por teléfono
			const [conTel] = await buscar(
				[{ dpi: "2222222222222", telefono: "66660002" }],
				{},
			);
			const r = conTel.find((x: { leadId: string }) => x.leadId === otro);
			expect(r?.coincidePor).toBe("telefono");
		});

		test("orden determinista: los más recientes primero, y total real", async () => {
			const fechas = ["2020-01-01", "2022-01-01", "2021-01-01"];
			const leads: string[] = [];
			for (const [i, fecha] of fechas.entries()) {
				const l = await crearLead(`Orden${i}`);
				await refLead(l, `Orden ${fecha}`, "67670001");
				await db.execute(
					sql`UPDATE referencias_lead SET created_at = ${fecha}::timestamp WHERE lead_id = ${l}::uuid`,
				);
				leads.push(l);
			}
			const [r] = await buscarCrudo([{ telefono: "67670001" }], {});
			expect(r.total).toBe(3);
			expect(
				r.coincidencias.map(
					(x: { referenciaNombre: string }) => x.referenciaNombre,
				),
			).toEqual(["Orden 2022-01-01", "Orden 2021-01-01", "Orden 2020-01-01"]);
		});

		test("nombra a quien dio la referencia: titular o codeudor, y a qué cliente pertenece", async () => {
			const otro = await crearLead("OtroDeCodeudor");
			// un segundo nombre vacío no deja espacios dobles
			await db.execute(
				sql`UPDATE leads SET middle_name = '' WHERE id = ${otro}::uuid`,
			);
			const oppOtro = await crearOpp(otro);
			const co = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppOtro}::uuid, ' Carlos  Codeudor ', ${DPI_B}) RETURNING id::text AS id`);
			const sinNombre = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppOtro}::uuid, '  ', ${DPI_B}) RETURNING id::text AS id`);
			const insertar = (tipo: string, id: string, refs: unknown) =>
				db.execute(sql`
					INSERT INTO credit_applications (opportunity_id, person_type, person_id, referencias_personales)
					VALUES (${oppOtro}::uuid, ${tipo}, ${id}::uuid, ${JSON.stringify(refs)}::jsonb)`);
			await insertar("lead", otro, [
				{ nombre: "Del Titular", relacion: "amigo", telefono: "68680001" },
			]);
			await insertar("coDebtor", co.rows[0].id, [
				{ nombre: "Del Codeudor", relacion: "primo", telefono: "68680002" },
			]);
			await insertar("coDebtor", sinNombre.rows[0].id, [
				{ nombre: "  ", relacion: "x", telefono: "68680003" },
			]);

			const res = await buscarCrudo(
				[
					{ telefono: "68680001" },
					{ telefono: "68680002" },
					{ telefono: "68680003" },
				],
				{},
			);
			const [titular, codeudor, anonimo] = res.map(
				(r: { coincidencias: { leadId: string }[] }) =>
					r.coincidencias.find((x) => x.leadId === otro),
			);
			expect(titular).toMatchObject({
				tipo: "personal",
				clienteNombre: "OtroDeCodeudor Prueba",
				oportunidadId: oppOtro,
				referenciaNombre: "Del Titular",
				parentesco: "amigo",
				dadaPor: { nombre: "OtroDeCodeudor Prueba", rol: "titular" },
			});
			expect(codeudor).toMatchObject({
				clienteNombre: "OtroDeCodeudor Prueba",
				oportunidadId: oppOtro,
				referenciaNombre: "Del Codeudor",
				dadaPor: { nombre: "Carlos Codeudor", rol: "codeudor" },
			});
			expect(anonimo).toMatchObject({
				referenciaNombre: null,
				dadaPor: { nombre: null, rol: "codeudor" },
			});
		});
	},
);

describe("buscarReferenciasDuplicadasLote: tope defensivo", () => {
	test("con más valores que el tope falla a la vista y no consulta la base", async () => {
		const { buscarReferenciasDuplicadasLote, MAX_VALORES_LOTE } = await import(
			"./referencia-duplicada"
		);
		let consultas = 0;
		const cliente = {
			execute: async () => {
				consultas++;
				return { rows: [] };
			},
		} as never;
		// teléfonos distintos y válidos: 2xxxxxxx sin patrón de relleno
		const telefono = (i: number) => `2${String(i * 7919 + 1000003).slice(-7)}`;
		const justo = Array.from({ length: MAX_VALORES_LOTE }, (_, i) => ({
			telefono: telefono(i),
		}));
		await buscarReferenciasDuplicadasLote(justo, {}, cliente);
		expect(consultas).toBe(1);

		const demas = [...justo, { telefono: telefono(MAX_VALORES_LOTE) }];
		await expect(
			buscarReferenciasDuplicadasLote(demas, {}, cliente),
		).rejects.toMatchObject({
			name: "DemasiadosValoresError",
			code: "REFERENCIAS_DEMASIADOS_VALORES",
		});
		expect(consultas).toBe(1);
	});
});

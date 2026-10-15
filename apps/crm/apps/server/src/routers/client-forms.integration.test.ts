/**
 * Integración contra Postgres REAL del router de formularios del cliente. Se
 * salta si no hay base de pruebas. Correr con la MISMA URL en las dos variables
 * (el código bajo prueba usa el `db` compartido de ../db, que lee DATABASE_URL
 * al cargarse):
 *
 *   docker run -d --rm --name crm-refdpi-pg -e POSTGRES_PASSWORD=t -p 55439:5432 postgres:16-alpine
 *   URL=postgres://postgres:t@localhost:55439/postgres
 *   DATABASE_URL=$URL bunx drizzle-kit push --force
 *   DATABASE_URL=$URL CRM_TEST_DATABASE_URL=$URL bun test src/routers/client-forms.integration
 *
 * La siembra y la limpieza van por un cliente PROPIO creado desde
 * CRM_TEST_DATABASE_URL (solo localhost). Antes de escribir nada se verifica que
 * el `db` compartido apunte a esa misma base; si no, la suite aborta sin tocar
 * ninguna.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import { call } from "@orpc/server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg, { Pool } from "pg";

const URL_PRUEBAS = process.env.CRM_TEST_DATABASE_URL ?? "";
const hostPruebas = URL_PRUEBAS ? new URL(URL_PRUEBAS).hostname : "";
const esLocal = hostPruebas === "localhost" || hostPruebas === "127.0.0.1";
if (URL_PRUEBAS && !esLocal) {
	throw new Error("CRM_TEST_DATABASE_URL debe apuntar a localhost");
}

// `mock.module("../db")` de otros archivos es global al proceso: si en esta corrida
// el db compartido es un mock, no hay con qué probar el router; se salta, y se avisa.
const { db: dbCompartido } = await import("../db");
async function esUnMock(): Promise<boolean> {
	if (typeof dbCompartido?.execute !== "function") return true;
	try {
		// Un mock responde cualquier cosa menos filas de Postgres.
		const r = await dbCompartido.execute(sql`SELECT 1 AS uno`);
		return !Array.isArray(r?.rows);
	} catch {
		return false; // no conecta: el beforeAll aborta y dice por qué
	}
}
const dbMockeado = esLocal && (await esUnMock());
if (esLocal && dbMockeado) {
	console.warn(
		"[client-forms.integration] SALTADA: otro archivo reemplazó ../db con un mock. Correr este archivo solo.",
	);
}

const DPI_A = "2345678990101";
const DPI_B = "1234567030101";
const DPI_C = "3456789070101";
const DPI_D = "4567890140101";
const DPI_E = "5678901200101";

describe.skipIf(!esLocal || dbMockeado)(
	"router de formularios del cliente (Postgres real)",
	() => {
		// Cliente propio de pruebas: único que siembra y limpia.
		// biome-ignore lint/suspicious/noExplicitAny: drizzle sin esquema
		let db: any;
		let pool: Pool | undefined;
		let listo = false;
		// biome-ignore lint/suspicious/noExplicitAny: router importado tras verificar la base
		let router: any;
		let stageId: string;
		const usuario = `u-cf-${Date.now()}`;
		const usuarios: string[] = [];

		/** Un usuario del CRM con ese rol, y el contexto de su sesión. */
		async function sesion(rol: string) {
			const id = `${usuario}-${rol}-${usuarios.length}`;
			usuarios.push(id);
			await db.execute(sql`
				INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
				VALUES (${id}, ${rol}, ${`${id}@t.test`}, true, ${rol}, now(), now())`);
			return { id, contexto: { context: { session: { user: { id } } } } };
		}

		async function crearLead(nombre: string, dpi?: string): Promise<string> {
			const r = await db.execute(sql`
			INSERT INTO leads (first_name, last_name, dpi, assigned_to, created_by)
			VALUES (${nombre}, 'Prueba', ${dpi ?? null}, ${usuario}, ${usuario}) RETURNING id::text AS id`);
			return r.rows[0].id;
		}
		async function crearOpp(
			leadId: string | null,
			asignadaA = usuario,
		): Promise<string> {
			const r = await db.execute(sql`
			INSERT INTO opportunities (title, stage_id, assigned_to, created_by, lead_id)
			VALUES ('opp', ${stageId}::uuid, ${asignadaA}, ${usuario}, ${leadId}::uuid) RETURNING id::text AS id`);
			return r.rows[0].id;
		}
		async function crearCodeudor(
			oppId: string,
			nombre: string,
			dpi: string,
		): Promise<string> {
			const r = await db.execute(sql`
				INSERT INTO co_debtors (opportunity_id, full_name, dpi)
				VALUES (${oppId}::uuid, ${nombre}, ${dpi}) RETURNING id::text AS id`);
			return r.rows[0].id;
		}
		async function crearEnlace(
			oppId: string,
			tipo: string | null,
			personaId: string | null,
			vence = "1 day",
		): Promise<string> {
			const r = await db.execute(sql`
				INSERT INTO client_form_tokens (opportunity_id, person_type, person_id, expires_at)
				VALUES (${oppId}::uuid, ${tipo}, ${personaId}::uuid, now() + ${vence}::interval)
				RETURNING token::text AS token`);
			return r.rows[0].token;
		}
		/** Solicitud de una persona (o sin dueño, con tipo null) y sus dos listas de referencias. */
		async function solicitudDe(
			oppId: string,
			tipo: "lead" | "coDebtor" | null,
			personaId: string | null,
			personales: unknown,
			familiares: unknown = null,
			nombre: string | null = null,
		) {
			const json = (v: unknown) => (v === null ? null : JSON.stringify(v));
			await db.execute(sql`
				INSERT INTO credit_applications (opportunity_id, person_type, person_id, primer_nombre, primer_apellido, referencias_personales, referencias_crediticias)
				VALUES (${oppId}::uuid, ${tipo}, ${personaId}::uuid, ${nombre}, ${nombre ? "Formulario" : null}, ${json(personales)}::jsonb, ${json(familiares)}::jsonb)`);
		}
		async function patrimonialDe(
			oppId: string,
			tipo: "lead" | "coDebtor" | null,
			personaId: string | null,
			nombre: string,
		) {
			await db.execute(sql`
				INSERT INTO financial_statements (opportunity_id, person_type, person_id, primer_nombre)
				VALUES (${oppId}::uuid, ${tipo}, ${personaId}::uuid, ${nombre})`);
		}

		beforeAll(async () => {
			// Antes de cualquier escritura: el `db` compartido (el que usa el código
			// bajo prueba) tiene que estar conectado a la MISMA base de pruebas. Se
			// compara la identidad del clúster (system_identifier) y el nombre de la
			// base; el puerto no sirve (tras un mapeo de docker el servidor ve 5432).
			const identidad = sql`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS cluster, current_database() AS base`;
			pool = new Pool({ connectionString: URL_PRUEBAS });
			db = drizzle(pool);
			let delCompartido: { cluster: string; base: string };
			try {
				const r = await dbCompartido.execute(identidad);
				delCompartido = r.rows[0] as typeof delCompartido;
			} catch (error) {
				await pool.end();
				throw new Error(
					`ABORTADO sin escribir: el db compartido no conecta (DATABASE_URL debe ser la misma URL de pruebas): ${error}`,
				);
			}
			const delPropio = (await db.execute(identidad)).rows[0];
			if (
				delCompartido.cluster !== delPropio.cluster ||
				delCompartido.base !== delPropio.base
			) {
				await pool.end();
				throw new Error(
					`ABORTADO sin escribir: el db compartido apunta a otra base (${delCompartido.base}) distinta de la de pruebas (${delPropio.base})`,
				);
			}
			({ clientFormsRouter: router } = await import("./client-forms"));
			await db.execute(sql`
			INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
			VALUES (${usuario}, 'Admin Prueba', ${`${usuario}@t.test`}, true, 'admin', now(), now())`);
			const s = await db.execute(sql`
			INSERT INTO sales_stages (name, "order", closure_percentage, color)
			VALUES ('Etapa', 1, 10, '#000') RETURNING id::text AS id`);
			stageId = s.rows[0].id;
			listo = true;
		});

		/** Cada prueba arranca sin los clientes de las anteriores (sus formularios caen en cascada). */
		async function borrarClientes() {
			await db.execute(
				sql`DELETE FROM opportunities WHERE created_by = ${usuario}`,
			);
			await db.execute(sql`DELETE FROM leads WHERE created_by = ${usuario}`);
		}
		afterEach(async () => {
			if (listo) await borrarClientes();
		});

		afterAll(async () => {
			if (!listo || !db || !pool) return;
			await borrarClientes();
			if (stageId)
				await db.execute(
					sql`DELETE FROM sales_stages WHERE id = ${stageId}::uuid`,
				);
			for (const id of [...usuarios, usuario]) {
				await db.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
			}
			await pool.end();
		});

		const contexto = { context: { session: { user: { id: usuario } } } };

		describe("getClientFormData: participantes", () => {
			test("titular, codeudores numerados, histórico por enlace y formulario sin dueño, en ese orden", async () => {
				const titular = await crearLead("Ana");
				const viejo = await crearLead("TitularViejo");
				const opp = await crearOpp(titular);
				const c1 = await crearCodeudor(opp, "Carlos", "1234567030101");
				const c2 = await crearCodeudor(opp, "Dora", "2345678990101");
				const borrado = "22222222-2222-4222-8222-222222222222";
				await crearEnlace(opp, "lead", viejo);
				await crearEnlace(opp, "coDebtor", borrado);
				await crearEnlace(opp, "coDebtor", c1);
				await solicitudDe(opp, "lead", viejo, [], null, "Vicente");
				await patrimonialDe(opp, "coDebtor", borrado, "Beto");
				await solicitudDe(opp, null, null, [], null, "Legado");

				const data = await call(
					router.getClientFormData,
					{ opportunityId: opp },
					contexto,
				);
				expect(
					data.participants.map(
						(p: {
							personId: string;
							displayName: string;
							roleLabel: string;
							canGenerateLink: boolean;
						}) => [p.personId, p.roleLabel, p.displayName, p.canGenerateLink],
					),
				).toEqual([
					[titular, "Titular", "Ana Prueba", true],
					[c1, "Co-firmante 1", "Carlos", true],
					[c2, "Co-firmante 2", "Dora", true],
					// enlaces del más nuevo al más viejo
					[borrado, "Co-firmante historico", "Beto", false],
					[viejo, "Titular historico", "Vicente Formulario", false],
					[`legacy:${opp}`, "Titular legacy", "Legado Formulario", false],
				]);
				const deC1 = data.participants[1];
				expect(deC1.latestToken).not.toBeNull();
				expect(data.participants[2].latestToken).toBeNull();
			});

			test("el formulario por enlace sin dueño se nombra con la solicitud, el estado patrimonial o «Titular»", async () => {
				const opp = await crearOpp(null);
				const enlace = await crearEnlace(opp, null, null);
				const nombre = async () =>
					(
						await call(
							router.validateFormToken,
							{ token: enlace },
							{ context: {} },
						)
					).personDisplayName;

				expect(await nombre()).toBe("Titular");
				await patrimonialDe(opp, null, null, " Pati ");
				expect(await nombre()).toBe("Pati");
				await solicitudDe(opp, null, null, [], null, "Sol");
				expect(await nombre()).toBe("Sol Formulario");
			});
		});

		type Alerta = {
			nivel: string;
			error: boolean;
			participantes: {
				personType: string;
				personId: string;
				nombre: string;
				etiqueta: string;
				referencias: {
					tipo: string;
					indice: number;
					nombre: string;
					dpi: string;
					total: number;
					coincidencias?: Record<string, unknown>[];
				}[];
			}[];
		} | null;
		type Contexto = typeof contexto;

		/**
		 * Los endpoints que devuelven la alerta. Las mismas pruebas corren contra
		 * cada uno: comparten el cableado (exclusiones, lote, permisos, errores).
		 */
		const endpoints: [
			string,
			(opp: string, ctx?: Contexto) => Promise<Alerta>,
		][] = [
			[
				"getClientFormData",
				async (opportunityId, ctx = contexto) =>
					(await call(router.getClientFormData, { opportunityId }, ctx))
						.alertaReferencias,
			],
			[
				"getReferenciasRepetidas",
				(opportunityId, ctx = contexto) =>
					call(router.getReferenciasRepetidas, { opportunityId }, ctx),
			],
		];

		/** Las referencias repetidas de cada participante, en el orden de la alerta. */
		const porParticipante = (alerta: Alerta) =>
			(alerta?.participantes ?? []).map((p) => p.referencias);
		const leadsDe = (referencia: {
			coincidencias?: Record<string, unknown>[];
		}) => (referencia.coincidencias ?? []).map((c) => c.leadId);

		describe.each(
			endpoints,
		)("alerta de referencias repetidas: %s", (_, alertaDe) => {
			test("por participante (titular y codeudor), con la forma esperada", async () => {
				const otro = await crearLead("OtroEndpoint");
				const oppOtro = await crearOpp(otro);
				await solicitudDe(oppOtro, null, null, [
					{
						nombre: "Compartida",
						relacion: "tio",
						telefono: "91910000",
						dpi: DPI_D,
					},
					{ nombre: "Del Codeudor Ajeno", relacion: "x", telefono: "92920000" },
				]);
				const yo = await crearLead("YoEndpoint");
				const oppYo = await crearOpp(yo);
				const co = await crearCodeudor(oppYo, "Codeudor Mio", DPI_D);
				await solicitudDe(oppYo, "lead", yo, [
					{
						nombre: "Compartida",
						relacion: "tio",
						telefono: "00001111",
						dpi: DPI_D,
					},
					{ nombre: "Limpia", relacion: "x", telefono: "13572468" },
				]);
				await solicitudDe(oppYo, "coDebtor", co, [
					{
						nombre: "Otra Compartida",
						relacion: "x",
						telefono: "+502 9292-0000",
					},
				]);

				const alerta = await alertaDe(oppYo);
				expect(alerta).toMatchObject({ nivel: "detalle", error: false });
				const [titular, codeudor] = alerta?.participantes ?? [];
				expect(titular).toMatchObject({
					personType: "lead",
					personId: yo,
					nombre: "YoEndpoint Prueba",
					etiqueta: "Titular",
				});
				expect(titular.referencias).toHaveLength(1);
				expect(titular.referencias[0]).toMatchObject({
					tipo: "personal",
					indice: 0,
					nombre: "Compartida",
					dpi: DPI_D,
					total: 1,
				});
				expect(titular.referencias[0].coincidencias?.[0]).toMatchObject({
					tipo: "personal",
					leadId: otro,
					clienteNombre: "OtroEndpoint Prueba",
					oportunidadId: oppOtro,
					referenciaNombre: "Compartida",
					parentesco: "tio",
					dadaPor: { nombre: "OtroEndpoint Prueba", rol: "titular" },
					coincidePor: "dpi",
				});
				// el reparto del lote: la referencia del codeudor llega al codeudor
				expect(codeudor).toMatchObject({
					personType: "coDebtor",
					personId: co,
					nombre: "Codeudor Mio",
					etiqueta: "Co-firmante 1",
				});
				expect(codeudor.referencias).toHaveLength(1);
				expect(codeudor.referencias[0]).toMatchObject({
					nombre: "Otra Compartida",
					total: 1,
				});
				expect(codeudor.referencias[0].coincidencias?.[0]).toMatchObject({
					leadId: otro,
					referenciaNombre: "Del Codeudor Ajeno",
					coincidePor: "telefono",
				});
			});

			test("nombre y DPI nulos o numéricos en el JSONB llegan como texto, nunca «null»", async () => {
				const otro = await crearLead("OtroNulos");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena", telefono: "93930000" },
				]);
				const yo = await crearLead("YoNulos");
				const oppYo = await crearOpp(yo);
				await solicitudDe(oppYo, "lead", yo, [
					{ nombre: null, dpi: null, telefono: "93930000" },
					{ nombre: 42, telefono: "+502 9393-0000" },
				]);
				const [titular] = porParticipante(await alertaDe(oppYo));
				expect(titular.map((r) => [r.nombre, r.dpi])).toEqual([
					["", ""],
					["42", ""],
				]);
			});

			test("reparte bien las dos listas: la familiar y la personal de cada participante, con su tipo e índice", async () => {
				const otro = await crearLead("OtroDeListas");
				await solicitudDe(
					await crearOpp(otro),
					"lead",
					otro,
					[
						{
							nombre: "Personal Ajena",
							relacion: "amiga",
							telefono: "71710001",
						},
					],
					[{ nombre: "Familiar Ajena", telefono: "71710002", dpi: DPI_E }],
				);
				const yo = await crearLead("YoDeListas");
				const oppYo = await crearOpp(yo);
				const co = await crearCodeudor(oppYo, "Codeudor Listas", DPI_E);
				// titular: la PERSONAL en la posición 1 coincide; el codeudor: la FAMILIAR en la 1
				await solicitudDe(
					oppYo,
					"lead",
					yo,
					[
						{ nombre: "Limpia P", telefono: "35792468" },
						{ nombre: "Mi Personal", telefono: "+502 7171-0001" },
					],
					[{ nombre: "Limpia F", telefono: "24681357" }],
				);
				await solicitudDe(
					oppYo,
					"coDebtor",
					co,
					[{ nombre: "Limpia P2", telefono: "36925814" }],
					[
						{ nombre: "Limpia F2", telefono: "14725836" },
						{
							nombre: "Su Familiar",
							telefono: "99990000",
							dpi: "5678 90120 0101",
						},
					],
				);
				const [titular, codeudor] = porParticipante(await alertaDe(oppYo));
				expect(titular).toHaveLength(1);
				expect(titular[0]).toMatchObject({
					tipo: "personal",
					indice: 1,
					nombre: "Mi Personal",
				});
				expect(titular[0].coincidencias?.[0]).toMatchObject({
					tipo: "personal",
					referenciaNombre: "Personal Ajena",
					coincidePor: "telefono",
				});
				expect(codeudor).toHaveLength(1);
				expect(codeudor[0]).toMatchObject({
					tipo: "familiar",
					indice: 1,
					nombre: "Su Familiar",
					total: 1,
				});
				expect(codeudor[0].coincidencias?.[0]).toMatchObject({
					tipo: "familiar",
					referenciaNombre: "Familiar Ajena",
					coincidePor: "dpi",
				});
			});

			test("un cliente con OTRA oportunidad propia no se alerta a sí mismo (excluye el lead)", async () => {
				const yo = await crearLead("YoDosOpps");
				const oppUno = await crearOpp(yo);
				const oppDos = await crearOpp(yo);
				await solicitudDe(oppUno, "lead", yo, [
					{ nombre: "De la uno", telefono: "81810101" },
				]);
				await solicitudDe(oppDos, "lead", yo, [
					{ nombre: "De la dos", telefono: "81810101" },
				]);
				expect(porParticipante(await alertaDe(oppDos))).toEqual([]);
				// control: un cliente distinto con esa referencia sí alerta
				const otro = await crearLead("OtroDosOpps");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena", relacion: "x", telefono: "81810101" },
				]);
				const [[referencia]] = porParticipante(await alertaDe(oppDos));
				expect(leadsDe(referencia)).toEqual([otro]);
			});

			test("dentro de la misma oportunidad (sin lead) titular y codeudor no se alertan entre sí (excluye la oportunidad)", async () => {
				const oppSinLead = await crearOpp(null);
				const co = await crearCodeudor(oppSinLead, "Codeudor Sin Lead", DPI_D);
				await solicitudDe(oppSinLead, null, null, [
					{ nombre: "Compartida", relacion: "x", telefono: "82820202" },
				]);
				await solicitudDe(oppSinLead, "coDebtor", co, [
					{ nombre: "Compartida", telefono: "82820202" },
				]);
				expect(await alertaDe(oppSinLead)).toEqual({
					nivel: "detalle",
					error: false,
					participantes: [],
				});
			});

			test("la misma persona con otro lead (mismo DPI) no es «otro cliente»", async () => {
				const DPI_PERSONA = "6789012360101";
				const yo = await crearLead("PersonaRouter", DPI_PERSONA);
				const oppYo = await crearOpp(yo);
				await solicitudDe(oppYo, "lead", yo, [
					{ nombre: "Mi ref", telefono: "83830303" },
				]);
				const repetido = await crearLead(
					"PersonaRouterRepetida",
					"6789 01236 0101",
				);
				await solicitudDe(await crearOpp(repetido), null, null, [
					{ nombre: "Ref repetida", relacion: "x", telefono: "83830303" },
				]);
				expect(porParticipante(await alertaDe(oppYo))).toEqual([]);
				const ajeno = await crearLead("AjenoRouter", DPI_D);
				await solicitudDe(await crearOpp(ajeno), null, null, [
					{ nombre: "Ref ajena", relacion: "x", telefono: "83830303" },
				]);
				const [[referencia]] = porParticipante(await alertaDe(oppYo));
				expect(leadsDe(referencia)).toEqual([ajeno]);
			});

			test("un codeudor que fue titular de su propio lead no se marca a sí mismo", async () => {
				const DPI_CODEUDOR = "6789012360101";
				const yo = await crearLead("TitularCodeudor", DPI_D);
				const oppYo = await crearOpp(yo);
				const co = await crearCodeudor(
					oppYo,
					"Codeudor Que Fue Titular",
					DPI_CODEUDOR,
				);
				await solicitudDe(oppYo, "coDebtor", co, [
					{ nombre: "Mi ref", telefono: "84840404" },
				]);
				const suLead = await crearLead("SuPropioLead", DPI_CODEUDOR);
				await solicitudDe(await crearOpp(suLead), null, null, [
					{ nombre: "Mi ref de antes", relacion: "x", telefono: "84840404" },
				]);
				expect(porParticipante(await alertaDe(oppYo))).toEqual([]);
			});

			test("la titular que fue codeudora en otro crédito no se alerta por lo que ella dio allí", async () => {
				const DPI_PERSONA = "6789012360101";
				const otro = await crearLead("OtroConCodeudora", DPI_C);
				const oppOtro = await crearOpp(otro);
				const ella = await crearCodeudor(
					oppOtro,
					"Ella Como Codeudora",
					"6789 01236 0101",
				);
				const ajeno = await crearCodeudor(oppOtro, "Codeudor Ajeno", DPI_E);
				await solicitudDe(oppOtro, "coDebtor", ella, [
					{ nombre: "La de ella", telefono: "85850101" },
				]);
				await solicitudDe(oppOtro, "coDebtor", ajeno, [
					{ nombre: "La del otro", telefono: "85850102" },
				]);

				const yo = await crearLead("EllaTitular", DPI_PERSONA);
				const oppYo = await crearOpp(yo);
				await solicitudDe(oppYo, "lead", yo, [
					{ nombre: "Mi ref", telefono: "85850101" },
					{ nombre: "Mi otra ref", telefono: "85850102" },
				]);
				const [titular] = porParticipante(await alertaDe(oppYo));
				// solo la que dio el otro codeudor de ese crédito
				expect(titular.map((r) => r.nombre)).toEqual(["Mi otra ref"]);
			});

			test("quien dejó su solicitud en otra oportunidad (titular cambiado o codeudor borrado) no se alerta a sí mismo", async () => {
				const DPI_VICENTE = "6789012360101";
				const vicente = await crearLead("Vicente", DPI_VICENTE);
				// la oportunidad vieja era de Vicente; hoy su titular es Ana
				const oppVieja = await crearOpp(await crearLead("Ana", DPI_C));
				await solicitudDe(oppVieja, "lead", vicente, [
					{ nombre: "Y", telefono: "81810201" },
				]);
				// en otra, Vicente fue codeudor y lo borraron; su solicitud quedó
				const oppOtra = await crearOpp(await crearLead("Otra", DPI_E));
				await db.execute(sql`
					INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
					VALUES (${oppOtra}::uuid, 'coDebtor', '99999999-9999-4999-8999-999999999999', ${DPI_VICENTE}, ${JSON.stringify([{ nombre: "Z", telefono: "81810202" }])}::jsonb)`);

				const oppNueva = await crearOpp(vicente);
				await solicitudDe(oppNueva, "lead", vicente, [
					{ nombre: "Y", telefono: "81810201" },
					{ nombre: "Z", telefono: "81810202" },
				]);
				expect(porParticipante(await alertaDe(oppNueva))).toEqual([]);
			});

			test("un histórico de la oportunidad revisada no se alerta a sí mismo (titular cambiado y codeudor borrado)", async () => {
				const ana = await crearLead("Ana", DPI_A);
				const vicente = await crearLead("Vicente", DPI_B);
				const opp1 = await crearOpp(ana);
				// Vicente era el titular de opp1 y dejó ahí su solicitud
				await solicitudDe(opp1, "lead", vicente, [
					{ nombre: "YV", telefono: "82820301" },
				]);
				// un codeudor que ya borraron dejó la suya, con su DPI escrito
				await db.execute(sql`
					INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
					VALUES (${opp1}::uuid, 'coDebtor', '77777777-7777-4777-8777-777777777771', ${DPI_E}, ${JSON.stringify([{ nombre: "ZB", telefono: "82820302" }])}::jsonb)`);
				// cada uno tiene su propia oportunidad con la misma referencia
				await solicitudDe(await crearOpp(vicente), "lead", vicente, [
					{ nombre: "YV", telefono: "82820301" },
				]);
				const elBorrado = await crearLead("ElBorradoComoTitular", DPI_E);
				await solicitudDe(await crearOpp(elBorrado), "lead", elBorrado, [
					{ nombre: "ZB", telefono: "82820302" },
				]);
				expect(porParticipante(await alertaDe(opp1))).toEqual([]);
			});

			test("la misma titular con un lead duplicado sin DPI: lo que dio su codeudora no la alerta, desde ninguna de las dos oportunidades", async () => {
				const ana = await crearLead("Ana", DPI_A);
				const opp1 = await crearOpp(ana);
				await solicitudDe(opp1, "lead", ana, [
					{ nombre: "Rosa", telefono: "82820401" },
				]);
				// Ana otra vez, en un lead sin DPI; su DPI solo está en su solicitud
				const anaDup = await crearLead("Ana Dup");
				const opp8 = await crearOpp(anaDup);
				await db.execute(sql`
					INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
					VALUES (${opp8}::uuid, 'lead', ${anaDup}::uuid, ${DPI_A}, '[]'::jsonb)`);
				const vera = await crearCodeudor(opp8, "Vera  Codeudora", DPI_C);
				await solicitudDe(opp8, "coDebtor", vera, [
					{ nombre: "Rosa por V", telefono: "82820401" },
				]);
				expect(porParticipante(await alertaDe(opp1))).toEqual([]);
				expect(porParticipante(await alertaDe(opp8))).toEqual([]);
			});

			test("un lead duplicado sin DPI es la misma persona en toda la base: ni cobros ni su codeudor alertan, desde ninguna oportunidad", async () => {
				const ana = await crearLead("Ana", DPI_A);
				const oppC = await crearOpp(ana);
				await solicitudDe(oppC, "lead", ana, [
					{ nombre: "P", telefono: "82820501" },
					{ nombre: "Q", telefono: "82820502" },
				]);
				const anaDup = await crearLead("Ana Cobros");
				const oppB = await crearOpp(anaDup);
				await db.execute(sql`
					INSERT INTO credit_applications (opportunity_id, person_type, person_id, dpi, referencias_personales)
					VALUES (${oppB}::uuid, 'lead', ${anaDup}::uuid, ${DPI_A}, ${JSON.stringify([{ nombre: "P", telefono: "82820501" }])}::jsonb)`);
				await db.execute(sql`
					INSERT INTO referencias_lead (lead_id, nombre, telefono, parentesco)
					VALUES (${anaDup}::uuid, 'Ref cobros', '82820501', 'amigo_a')`);
				const oppD = await crearOpp(anaDup);
				const walter = await crearCodeudor(oppD, "Walter", DPI_E);
				await solicitudDe(oppD, "coDebtor", walter, [
					{ nombre: "W", telefono: "82820502" },
				]);
				for (const opp of [oppC, oppB, oppD]) {
					expect(porParticipante(await alertaDe(opp))).toEqual([]);
				}
			});

			test("lo que el titular anterior dejó en una oportunidad que hoy es mía sí me alerta, a nombre de él", async () => {
				const ana = await crearLead("Ana", DPI_A);
				const vicente = await crearLead("Vicente", DPI_B);
				const opp1 = await crearOpp(ana);
				await solicitudDe(opp1, "lead", vicente, [
					{ nombre: "S", telefono: "82820303" },
				]);
				const opp7 = await crearOpp(ana);
				await solicitudDe(opp7, "lead", ana, [
					{ nombre: "S", telefono: "82820303" },
				]);
				const [[referencia]] = porParticipante(await alertaDe(opp7));
				expect(referencia.coincidencias).toEqual([
					expect.objectContaining({
						leadId: vicente,
						clienteNombre: "Vicente Prueba",
						oportunidadId: opp1,
						dadaPor: { nombre: "Vicente Prueba", rol: "titular" },
					}),
				]);
			});

			test("un DPI del revisado con verificador inválido igual lo excluye", async () => {
				const DPI_MAL = "1234567890123";
				const yo = await crearLead("YoTitular", DPI_A);
				const oppYo = await crearOpp(yo);
				const co = await crearCodeudor(oppYo, "Codeudor Dpi Mal", DPI_MAL);
				await solicitudDe(oppYo, "coDebtor", co, [
					{ nombre: "Mi", telefono: "82820304" },
				]);
				// el mismo codeudor es titular en otro lado, con su DPI escrito distinto
				const suLead = await crearLead(
					"CodeudorComoTitular",
					"1234 56789 0123",
				);
				await solicitudDe(await crearOpp(suLead), "lead", suLead, [
					{ nombre: "Mi", telefono: "82820304" },
				]);
				expect(porParticipante(await alertaDe(oppYo))).toEqual([]);
			});

			test("lo que dio el codeudor de otra oportunidad mía no me alerta: el cliente soy yo", async () => {
				const yo = await crearLead("YoConOtra", DPI_A);
				const oppYo = await crearOpp(yo);
				await solicitudDe(oppYo, "lead", yo, [
					{ nombre: "Mi", telefono: "82820305" },
				]);
				const oppOtra = await crearOpp(yo);
				const co = await crearCodeudor(oppOtra, "Codeudor De Mi Otra", DPI_E);
				await solicitudDe(oppOtra, "coDebtor", co, [
					{ nombre: "R", telefono: "82820305" },
				]);
				expect(porParticipante(await alertaDe(oppYo))).toEqual([]);
			});

			test("revisa hasta 10 referencias por lista, aunque datos viejos traigan miles", async () => {
				const otro = await crearLead("OtroTope");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena 10", telefono: "86860010" },
					{ nombre: "Ajena 11", telefono: "86860011" },
				]);
				const yo = await crearLead("YoTope");
				const oppYo = await crearOpp(yo);
				const muchas = Array.from({ length: 40_001 }, (_, i) => ({
					nombre: `Ref ${i + 1}`,
					telefono:
						i === 9
							? "86860010"
							: i === 10
								? "86860011"
								: `2${String(i).padStart(7, "1")}`,
				}));
				await solicitudDe(oppYo, "lead", yo, muchas);
				const alerta = await alertaDe(oppYo);
				expect(alerta?.error).toBe(false);
				// la décima entra; la undécima ya no se revisa
				expect(porParticipante(alerta)[0].map((r) => r.nombre)).toEqual([
					"Ref 10",
				]);
			});

			test("quien dejó solicitud y ya no figura sale como histórico, aunque no tenga enlace; titular primero y codeudores en orden", async () => {
				const otro = await crearLead("OtroHistoricos");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena", relacion: "x", telefono: "87870001" },
				]);
				const viejo = await crearLead("TitularViejo");
				const nuevo = await crearLead("TitularNuevo");
				const oppYo = await crearOpp(nuevo);
				// el segundo se guarda antes, pero se creó después: manda la fecha
				const codeudor = async (nombre: string, dpi: string, creado: string) =>
					(
						await db.execute(sql`
							INSERT INTO co_debtors (opportunity_id, full_name, dpi, created_at)
							VALUES (${oppYo}::uuid, ${nombre}, ${dpi}, ${creado}::timestamp) RETURNING id::text AS id`)
					).rows[0].id;
				const c2 = await codeudor("Segundo", DPI_B, "2026-01-02");
				const c1 = await codeudor("Primero", DPI_A, "2026-01-01");
				const borrado = "33333333-3333-4333-8333-333333333333";
				const ref = [{ nombre: "Mi ref", telefono: "87870001" }];
				// se insertan al revés del orden esperado
				await solicitudDe(oppYo, "coDebtor", borrado, ref, null, "Beto");
				await solicitudDe(oppYo, "lead", viejo, ref, null, "Vicente");
				await solicitudDe(oppYo, "coDebtor", c2, ref);
				await solicitudDe(oppYo, "coDebtor", c1, ref);
				await solicitudDe(oppYo, "lead", nuevo, ref);

				const alerta = await alertaDe(oppYo);
				expect(
					alerta?.participantes.map((p) => `${p.etiqueta}: ${p.nombre}`),
				).toEqual([
					"Titular: TitularNuevo Prueba",
					"Co-firmante 1: Primero",
					"Co-firmante 2: Segundo",
					"Co-firmante historico: Beto Formulario",
					"Titular historico: Vicente Formulario",
				]);
			});

			test("si la búsqueda falla lo dice (error), sin confundirlo con «sin coincidencias»", async () => {
				const yo = await crearLead("YoFalla");
				const oppYo = await crearOpp(yo);
				await solicitudDe(oppYo, "lead", yo, [
					{ nombre: "A", telefono: "16161617", dpi: DPI_D },
				]);
				expect(await alertaDe(oppYo)).toMatchObject({ error: false });

				const error = spyOn(console, "error").mockImplementation(() => {});
				// Como el de drizzle: el mensaje trae los parámetros de la consulta.
				const espia = spyOn(dbCompartido, "execute").mockRejectedValueOnce(
					new Error(`Failed query: SELECT ... params: ${DPI_D},16161617`),
				);
				try {
					expect(await alertaDe(oppYo)).toEqual({
						nivel: "detalle",
						error: true,
						participantes: [],
					});
					const log = Bun.inspect(error.mock.calls);
					expect(log).toContain(oppYo);
					expect(log).not.toContain(DPI_D);
					expect(log).not.toContain("16161617");
				} finally {
					espia.mockRestore();
					error.mockRestore();
				}
			});

			describe("permisos", () => {
				/** Otro cliente con la referencia, y la oportunidad que se revisa, asignada a `asignadaA`. */
				async function escenario(asignadaA: string) {
					const otro = await crearLead("ClienteAjenoSecreto");
					const oppOtro = await crearOpp(otro);
					await solicitudDe(oppOtro, null, null, [
						{
							nombre: "Ref Del Ajeno",
							relacion: "primo",
							telefono: "88880001",
						},
					]);
					const yo = await crearLead("YoPermisos");
					const oppYo = await crearOpp(yo, asignadaA);
					await solicitudDe(oppYo, "lead", yo, [
						{ nombre: "Mi ref", telefono: "88880001", dpi: DPI_A },
					]);
					return { otro, oppOtro, oppYo };
				}
				/** El aviso no deja salir NADA del otro cliente. */
				function soloAviso(
					alerta: Alerta,
					ajeno: { otro: string; oppOtro: string },
				) {
					expect(alerta).toMatchObject({ nivel: "aviso", error: false });
					expect(alerta?.participantes[0].referencias).toEqual([
						{
							tipo: "personal",
							indice: 0,
							nombre: "Mi ref",
							dpi: DPI_A,
							total: 1,
						},
					]);
					const texto = JSON.stringify(alerta);
					for (const dato of [
						ajeno.otro,
						ajeno.oppOtro,
						"ClienteAjenoSecreto",
						"Ref Del Ajeno",
						"primo",
					]) {
						expect(texto).not.toContain(dato);
					}
				}

				test.each([
					"admin",
					"analyst",
					"sales_supervisor",
				])("%s ve el detalle", async (rol) => {
					const { otro, oppYo } = await escenario(usuario);
					const { contexto: suyo } = await sesion(rol);
					const alerta = await alertaDe(oppYo, suyo);
					expect(alerta?.nivel).toBe("detalle");
					expect(
						leadsDe(alerta?.participantes[0].referencias[0] ?? {}),
					).toEqual([otro]);
				});

				test("ventas, en su oportunidad, recibe solo el aviso", async () => {
					const { id, contexto: suyo } = await sesion("sales");
					const ajeno = await escenario(id);
					soloAviso(await alertaDe(ajeno.oppYo, suyo), ajeno);
				});

				test.each([
					"cobros",
					"accounting",
					"juridico",
				])("%s recibe solo el aviso", async (rol) => {
					const ajeno = await escenario(usuario);
					const { contexto: suyo } = await sesion(rol);
					soloAviso(await alertaDe(ajeno.oppYo, suyo), ajeno);
				});

				test("ventas, en una oportunidad ajena, no recibe nada ni dispara la búsqueda", async () => {
					const { oppYo } = await escenario(usuario);
					const { contexto: suyo } = await sesion("sales");
					const espia = spyOn(dbCompartido, "execute");
					try {
						await expect(alertaDe(oppYo, suyo)).rejects.toMatchObject({
							code: "FORBIDDEN",
						});
						expect(espia).not.toHaveBeenCalled();
					} finally {
						espia.mockRestore();
					}
				});

				test("sin sesión: UNAUTHORIZED", async () => {
					const { oppYo } = await escenario(usuario);
					await expect(
						alertaDe(oppYo, { context: {} } as never),
					).rejects.toMatchObject({
						code: "UNAUTHORIZED",
					});
				});
			});
		});

		describe("ventas solo ve los formularios de sus oportunidades", () => {
			type Expediente = { titular: string; opp: string };
			/** Titular con solicitud, estado patrimonial y enlace: lo que se protege. */
			async function expediente(asignadaA: string): Promise<Expediente> {
				const titular = await crearLead("TitularPrivado", DPI_B);
				const opp = await crearOpp(titular, asignadaA);
				await crearEnlace(opp, "lead", titular);
				await solicitudDe(
					opp,
					"lead",
					titular,
					[{ nombre: "Ref Privada", telefono: "87870001", dpi: DPI_A }],
					null,
					"Privada",
				);
				await patrimonialDe(opp, "lead", titular, "Privada");
				return { titular, opp };
			}
			async function cuantasFilas(opp: string) {
				const r = await db.execute(sql`
					SELECT
						(SELECT count(*) FROM credit_applications WHERE opportunity_id = ${opp}::uuid)::int AS solicitudes,
						(SELECT count(*) FROM financial_statements WHERE opportunity_id = ${opp}::uuid)::int AS patrimoniales,
						(SELECT count(*) FROM client_form_tokens WHERE opportunity_id = ${opp}::uuid)::int AS enlaces`);
				return r.rows[0];
			}

			const pedidos: [
				string,
				(e: Expediente, ctx: Contexto) => Promise<unknown>,
			][] = [
				[
					"getClientFormData",
					(e, ctx) =>
						call(router.getClientFormData, { opportunityId: e.opp }, ctx),
				],
				[
					"getReferenciasRepetidas",
					(e, ctx) =>
						call(router.getReferenciasRepetidas, { opportunityId: e.opp }, ctx),
				],
				[
					"getFormTokenByOpportunity",
					(e, ctx) =>
						call(
							router.getFormTokenByOpportunity,
							{ opportunityId: e.opp },
							ctx,
						),
				],
				[
					"generateFormToken",
					(e, ctx) =>
						call(
							router.generateFormToken,
							{
								opportunityId: e.opp,
								personType: "lead",
								personId: e.titular,
							},
							ctx,
						),
				],
			];

			describe.each(pedidos)("%s", (_, pedir) => {
				test("ventas, en su oportunidad, puede", async () => {
					const { id, contexto: suyo } = await sesion("sales");
					expect(await pedir(await expediente(id), suyo)).not.toBeNull();
				});

				test.each([
					"admin",
					"analyst",
					"sales_supervisor",
					"cobros",
					"cobros_supervisor",
					"accounting",
					"juridico",
				])("%s sigue pudiendo en una oportunidad que no tiene asignada", async (rol) => {
					const e = await expediente(usuario);
					const { contexto: suyo } = await sesion(rol);
					expect(await pedir(e, suyo)).not.toBeNull();
				});

				test("ventas, en una oportunidad ajena: FORBIDDEN, sin leer ni tocar los formularios", async () => {
					const e = await expediente(usuario);
					const antes = await cuantasFilas(e.opp);
					const { contexto: suyo } = await sesion("sales");

					const consultas: string[] = [];
					const original = pg.Client.prototype.query;
					const espia = spyOn(pg.Client.prototype, "query").mockImplementation(
						function (this: unknown, ...args: unknown[]) {
							const texto = args[0];
							consultas.push(
								typeof texto === "string"
									? texto
									: String((texto as { text?: string })?.text ?? ""),
							);
							// biome-ignore lint/suspicious/noExplicitAny: passthrough
							return (original as any).apply(this, args);
						} as never,
					);
					try {
						await expect(pedir(e, suyo)).rejects.toMatchObject({
							code: "FORBIDDEN",
						});
					} finally {
						espia.mockRestore();
					}

					// Llegó a preguntar (la oportunidad), pero no a los datos del cliente.
					expect(consultas.join("\n")).toContain('"opportunities"');
					for (const tabla of [
						"leads",
						"co_debtors",
						"credit_applications",
						"financial_statements",
						"client_form_tokens",
					]) {
						expect(consultas.filter((c) => c.includes(`"${tabla}"`))).toEqual(
							[],
						);
					}
					expect(await cuantasFilas(e.opp)).toEqual(antes);
				});

				test("sin sesión: UNAUTHORIZED", async () => {
					const e = await expediente(usuario);
					await expect(
						pedir(e, { context: {} } as never),
					).rejects.toMatchObject({ code: "UNAUTHORIZED" });
				});
			});
		});

		describe("getClientFormData: lo que no cambia con la alerta", () => {
			test("hace UNA sola búsqueda para todos los participantes", async () => {
				const yo = await crearLead("YoUnaBusqueda");
				const oppYo = await crearOpp(yo);
				const co = await crearCodeudor(oppYo, "Codeudor Uno", DPI_D);
				await solicitudDe(oppYo, "lead", yo, [
					{ nombre: "A", telefono: "14253647" },
				]);
				await solicitudDe(oppYo, "coDebtor", co, [
					{ nombre: "B", telefono: "15263748" },
				]);

				const espia = spyOn(dbCompartido, "execute");
				try {
					await call(
						router.getClientFormData,
						{ opportunityId: oppYo },
						contexto,
					);
					expect(espia).toHaveBeenCalledTimes(1);
				} finally {
					espia.mockRestore();
				}
			});

			test("lee codeudores y solicitudes UNA vez cada uno: la alerta usa lo ya leído", async () => {
				const otro = await crearLead("OtroLecturas");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena", telefono: "89890001" },
				]);
				const yo = await crearLead("YoLecturas");
				const oppYo = await crearOpp(yo);
				await crearCodeudor(oppYo, "Codeudor Lecturas", DPI_D);
				await solicitudDe(oppYo, "lead", yo, [
					{ nombre: "Mi", telefono: "89890001" },
				]);

				const consultas: string[] = [];
				const original = pg.Client.prototype.query;
				const espia = spyOn(pg.Client.prototype, "query").mockImplementation(
					function (this: unknown, ...args: unknown[]) {
						const texto = args[0];
						consultas.push(
							typeof texto === "string"
								? texto
								: String((texto as { text?: string })?.text ?? ""),
						);
						// biome-ignore lint/suspicious/noExplicitAny: passthrough
						return (original as any).apply(this, args);
					} as never,
				);
				try {
					const data = await call(
						router.getClientFormData,
						{ opportunityId: oppYo },
						contexto,
					);
					expect(data.alertaReferencias.participantes).toHaveLength(1);
				} finally {
					espia.mockRestore();
				}
				const cuantas = (tabla: string) =>
					consultas.filter((c) => new RegExp(`from "${tabla}"`, "i").test(c))
						.length;
				expect(cuantas("co_debtors")).toBe(1);
				expect(cuantas("credit_applications")).toBe(1);
			});

			test("las tarjetas no cambian: el histórico sin enlace solo aparece en la alerta", async () => {
				const otro = await crearLead("OtroTarjetas");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena", telefono: "90900001" },
				]);
				const yo = await crearLead("YoTarjetas");
				const oppYo = await crearOpp(yo);
				const borrado = "44444444-4444-4444-8444-444444444444";
				await solicitudDe(
					oppYo,
					"coDebtor",
					borrado,
					[{ nombre: "Mi", telefono: "90900001" }],
					null,
					"Beto",
				);

				const data = await call(
					router.getClientFormData,
					{ opportunityId: oppYo },
					contexto,
				);
				expect(
					data.participants.map((p: { personId: string }) => p.personId),
				).toEqual([yo]);
				expect(
					data.alertaReferencias.participantes.map(
						(p: { personId: string; etiqueta: string }) => [
							p.personId,
							p.etiqueta,
						],
					),
				).toEqual([[borrado, "Co-firmante historico"]]);
			});

			test("el endpoint público por enlace no expone la alerta ni datos de otros clientes", async () => {
				const otro = await crearLead("OtroPublico");
				await solicitudDe(await crearOpp(otro), null, null, [
					{
						nombre: "Compartida",
						relacion: "x",
						telefono: "17171718",
						dpi: DPI_D,
					},
				]);
				const yo = await crearLead("YoPublico");
				const oppYo = await crearOpp(yo);
				await solicitudDe(oppYo, "lead", yo, [
					{
						nombre: "Compartida",
						relacion: "x",
						telefono: "18181819",
						dpi: DPI_D,
					},
				]);
				const enlace = await crearEnlace(oppYo, "lead", yo);
				const texto = JSON.stringify(
					await call(
						router.validateFormToken,
						{ token: enlace },
						{ context: {} },
					),
				);
				expect(texto).not.toContain("alertaReferencias");
				expect(texto).not.toContain("OtroPublico");
				expect(texto).not.toContain(otro);
			});
		});

		describe("getReferenciasRepetidas: la pantalla de análisis", () => {
			test("devuelve exactamente la alerta de «Formularios del Cliente»", async () => {
				const otro = await crearLead("OtroIguales");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena", relacion: "x", telefono: "72720001" },
					{
						nombre: "Ajena 2",
						relacion: "x",
						telefono: "72720002",
						dpi: DPI_C,
					},
				]);
				const yo = await crearLead("YoIguales");
				const viejo = await crearLead("ViejoIguales");
				const oppYo = await crearOpp(yo);
				const co = await crearCodeudor(oppYo, "Codeudor Iguales", DPI_D);
				const borradoConEnlace = "55555555-5555-4555-8555-555555555555";
				const borradoSinEnlace = "66666666-6666-4666-8666-666666666666";
				const ref = [{ nombre: "Mi P", telefono: "72720001" }];
				await solicitudDe(oppYo, "lead", yo, ref, [
					{ nombre: "Mi F", telefono: "1", dpi: DPI_C },
				]);
				await solicitudDe(oppYo, "coDebtor", co, ref);
				await solicitudDe(oppYo, "lead", viejo, ref, null, "Vicente");
				await solicitudDe(oppYo, "coDebtor", borradoConEnlace, ref);
				await patrimonialDe(oppYo, "coDebtor", borradoConEnlace, "Pati");
				await solicitudDe(
					oppYo,
					"coDebtor",
					borradoSinEnlace,
					ref,
					null,
					"Beto",
				);
				await solicitudDe(oppYo, null, null, ref, null, "Legado");
				await crearEnlace(oppYo, "coDebtor", borradoConEnlace);

				for (const rol of ["admin", "cobros"]) {
					const { contexto: suyo } = await sesion(rol);
					const completa = (
						await call(router.getClientFormData, { opportunityId: oppYo }, suyo)
					).alertaReferencias;
					expect(completa.participantes).toHaveLength(6);
					expect(
						await call(
							router.getReferenciasRepetidas,
							{ opportunityId: oppYo },
							suyo,
						),
					).toEqual(completa);
				}
			});

			test("no lee firmas, formularios completos ni enlaces", async () => {
				const otro = await crearLead("OtroColumnas");
				await solicitudDe(await crearOpp(otro), null, null, [
					{ nombre: "Ajena", relacion: "x", telefono: "86860001" },
				]);
				const yo = await crearLead("YoColumnas");
				const oppYo = await crearOpp(yo);
				const borrado = "77777777-7777-4777-8777-777777777777";
				// un histórico obliga a leer también los estados patrimoniales
				await solicitudDe(oppYo, "coDebtor", borrado, [
					{ nombre: "Mi", telefono: "86860001" },
				]);

				const consultas: string[] = [];
				const original = pg.Client.prototype.query;
				const espia = spyOn(pg.Client.prototype, "query").mockImplementation(
					function (this: unknown, ...args: unknown[]) {
						const texto = args[0];
						consultas.push(
							typeof texto === "string"
								? texto
								: String((texto as { text?: string })?.text ?? ""),
						);
						// biome-ignore lint/suspicious/noExplicitAny: passthrough
						return (original as any).apply(this, args);
					} as never,
				);
				try {
					const alerta = await call(
						router.getReferenciasRepetidas,
						{ opportunityId: oppYo },
						contexto,
					);
					expect(alerta.participantes).toHaveLength(1);
				} finally {
					espia.mockRestore();
				}
				const todas = consultas.join("\n");
				expect(todas).toContain('from "financial_statements"');
				expect(todas).not.toContain("firma_imagen");
				expect(todas).not.toContain("client_form_tokens");
				expect(
					consultas.some((c) => /select\s+"id",\s*"opportunity_id"/i.test(c)),
				).toBe(false);
			});

			test("sin rol de clientes: FORBIDDEN", async () => {
				const yo = await crearLead("YoSinRol");
				const oppYo = await crearOpp(yo);
				const { contexto: suyo } = await sesion("service_center_manager");
				await expect(
					call(router.getReferenciasRepetidas, { opportunityId: oppYo }, suyo),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
			});
		});
	},
);

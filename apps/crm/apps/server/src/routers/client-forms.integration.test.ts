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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call } from "@orpc/server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

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
	},
);

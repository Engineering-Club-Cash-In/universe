import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { prioridadNotificacion } from "./notificaciones-prioridad";

describe("prioridadNotificacion", () => {
	test("solo el modo agente ABIERTO va primero; sin parámetros sueltos", () => {
		const { sql, params } = new PgDialect().sqlToQuery(prioridadNotificacion);
		expect(sql).toContain("'bot_modo_agente'");
		expect(sql).toContain("'pending', 'read', 'in_progress'");
		expect(sql).toContain("THEN 0 ELSE 1");
		// Literales, no parámetros: node-postgres manda los parámetros sin tipo.
		expect(params).toEqual([]);
	});

	// Review de Codex (PR #1627): las listas cortan en 500 filas. Si alguna
	// vuelve a ordenar solo por fecha ANTES del límite, una alerta vieja de un
	// cliente esperando desaparece de la campanita aunque siga abierta.
	test("toda lista de la campanita con límite ordena primero por prioridad", () => {
		const fuente = readFileSync(
			join(import.meta.dir, "../routers/notifications.ts"),
			"utf-8",
		);
		const limites = [...fuente.matchAll(/\.limit\(500\)/g)].length;
		const ordenados = [
			...fuente.matchAll(
				/\.orderBy\(prioridadNotificacion, desc\(notifications\.createdAt\)\)\s*\.limit\(500\)/g,
			),
		].length;
		// 3 listas por rol/asignación + getAllNotifications (propias y sistema).
		expect(limites).toBe(5);
		expect(ordenados).toBe(limites);
	});
});

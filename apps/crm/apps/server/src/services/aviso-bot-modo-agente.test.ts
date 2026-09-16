import { describe, expect, it } from "bun:test";
import type { DestinoAvisoBot } from "./aviso-bot-asesor";
import {
	avisarAsesorModoAgente,
	type DependenciasModoAgente,
	llaveModoAgente,
	type OrigenModoAgente,
} from "./aviso-bot-modo-agente";

/**
 * COBROS-02 — aviso de modo agente. Lo que cuidan estas pruebas: una alerta
 * por asesor (no por crédito), dedup por asesor y conversación, enlace al
 * aviso inicial solo cuando hubo referencia, y que un fallo de cartera se
 * reporte en vez de tragarse.
 *
 * Dependencias inyectadas y no `mock.module`: los mocks de módulo de bun se
 * filtran entre archivos de prueba.
 */

const SESION = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000";
const SIFCO = "01010214119660";
const HOY = "2026-09-16";
const POR_REFERENCIA: OrigenModoAgente = {
	tipo: "referencia",
	sesionId: SESION,
};
const POR_TELEFONO: OrigenModoAgente = {
	tipo: "telefono",
	telefono8: "58446376",
};

function destino(userId: string, sifco: string): DestinoAvisoBot {
	return {
		usuarioAsesor: { id: userId, name: userId },
		quien: `Cliente de Prueba (crédito ${sifco})`,
		anclaCaso: {
			relatedEntityType: "collection_case",
			relatedEntityId: `caso-${sifco}`,
			redirectPage: "cobros_detail",
		},
	};
}

/**
 * `duenos`: SIFCO → usuario del asesor (null = sin asesor, Error = cartera
 * caída). `avisos`: `tipo|llave|usuario` → id de una alerta existente.
 * `episodios`: `base|usuario` → episodios de modo agente de ese asesor.
 */
function dependencias(opciones: {
	duenos?: Record<string, string | null | Error>;
	avisos?: Record<string, string>;
	episodios?: Record<string, { total: number; abierto: boolean }>;
	carteraHabilitada?: boolean;
}) {
	const insertadas: Record<string, unknown>[] = [];
	const deps: DependenciasModoAgente = {
		episodios: async (base, asesor) =>
			opciones.episodios?.[`${base}|${asesor}`] ?? {
				total: 0,
				abierto: false,
			},
		buscarAviso: async (tipo, llave, asesor) =>
			opciones.avisos?.[`${tipo}|${llave}|${asesor}`] ?? null,
		carteraHabilitada: () => opciones.carteraHabilitada ?? true,
		resolverDestino: async (sifco) => {
			const dueno =
				opciones.duenos && sifco in opciones.duenos
					? opciones.duenos[sifco]
					: "user-1";
			if (dueno instanceof Error) throw dueno;
			return dueno === null ? null : destino(dueno, sifco);
		},
		insertar: async (fila) => {
			insertadas.push(fila as Record<string, unknown>);
		},
		hoyGT: () => HOY,
	};
	return { deps, insertadas };
}

const LLAVE_REF = `bot:sesion:${SESION}:agente`;

describe("llaveModoAgente", () => {
	it("con referencia es la conversación; con teléfono, el número y el día", () => {
		expect(llaveModoAgente(POR_REFERENCIA, HOY)).toBe(LLAVE_REF);
		expect(llaveModoAgente(POR_TELEFONO, HOY)).toBe(
			`bot:tel:58446376:dia:${HOY}:agente`,
		);
	});
});

describe("avisarAsesorModoAgente", () => {
	it("con referencia, enlaza al 'escribió' de ese asesor en esa conversación", async () => {
		const { deps, insertadas } = dependencias({
			avisos: {
				[`bot_cliente_escribio|bot:sesion:${SESION}:credito:${SIFCO}|user-1`]:
					"notif-inicial",
			},
		});
		const r = await avisarAsesorModoAgente(
			{ origen: POR_REFERENCIA, creditos: [SIFCO] },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", asesores: 1 });
		expect(insertadas).toHaveLength(1);
		const fila = insertadas[0];
		expect(fila.cobrosTipo).toBe("bot_modo_agente");
		expect(fila.cobrosDedupKey).toBe(`${LLAVE_REF}:ep:1`);
		expect(fila.notificacionOrigenId).toBe("notif-inicial");
		expect(fila.assignedTo).toBe("user-1");
		expect(fila.relatedEntityId).toBe(`caso-${SIFCO}`);
		expect(String(fila.descripcion)).toContain(SIFCO);
	});

	it("un asesor con varios créditos del cliente recibe UNA alerta que los nombra", async () => {
		const { deps, insertadas } = dependencias({});
		const r = await avisarAsesorModoAgente(
			{ origen: POR_REFERENCIA, creditos: ["A1", "A2"] },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", asesores: 1 });
		expect(insertadas).toHaveLength(1);
		expect(String(insertadas[0].descripcion)).toContain("créditos A1, A2");
	});

	it("créditos de dos asesores: una alerta para cada uno", async () => {
		const { deps, insertadas } = dependencias({
			duenos: { A1: "user-1", B1: "user-2" },
		});
		const r = await avisarAsesorModoAgente(
			{ origen: POR_TELEFONO, creditos: ["A1", "B1"] },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", asesores: 2 });
		expect(insertadas.map((f) => f.assignedTo)).toEqual(["user-1", "user-2"]);
	});

	it("por teléfono: sin origen, y el número va en el texto para encontrar el chat", async () => {
		const { deps, insertadas } = dependencias({});
		await avisarAsesorModoAgente(
			{ origen: POR_TELEFONO, creditos: [SIFCO] },
			deps,
		);

		expect(insertadas[0].notificacionOrigenId).toBeNull();
		expect(insertadas[0].cobrosDedupKey).toBe(
			`bot:tel:58446376:dia:${HOY}:agente:ep:1`,
		);
		expect(String(insertadas[0].descripcion)).toContain("58446376");
	});

	it("no repite al mismo asesor mientras su alerta siga abierta", async () => {
		const { deps, insertadas } = dependencias({
			episodios: { [`${LLAVE_REF}|user-1`]: { total: 1, abierto: true } },
		});
		const r = await avisarAsesorModoAgente(
			{ origen: POR_REFERENCIA, creditos: [SIFCO] },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "YA_NOTIFICADO", asesores: 1 });
		expect(insertadas).toHaveLength(0);
	});

	// Review de Codex, P1 (#1628): sin referencia, dos conversaciones del mismo
	// día comparten la base. Si el asesor ya cerró la primera alerta y el
	// cliente vuelve a pedir un humano, tiene que llegarle de nuevo.
	it("si la alerta anterior ya se cerró, abre un episodio nuevo", async () => {
		const base = `bot:tel:58446376:dia:${HOY}:agente`;
		const { deps, insertadas } = dependencias({
			episodios: { [`${base}|user-1`]: { total: 1, abierto: false } },
		});
		const r = await avisarAsesorModoAgente(
			{ origen: POR_TELEFONO, creditos: [SIFCO] },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", asesores: 1 });
		expect(insertadas).toHaveLength(1);
		expect(insertadas[0].cobrosDedupKey).toBe(`${base}:ep:2`);
	});

	// Review de Codex, P1: el crédito puede cambiar de dueño dentro de la
	// ventana. Lo del asesor anterior no puede tapar al actual.
	it("si reasignaron el crédito, el dueño nuevo recibe su alerta", async () => {
		const { deps, insertadas } = dependencias({
			episodios: {
				[`${LLAVE_REF}|asesor-anterior`]: { total: 1, abierto: true },
			},
			avisos: {
				[`bot_cliente_escribio|bot:sesion:${SESION}:credito:${SIFCO}|asesor-anterior`]:
					"escribio-anterior",
			},
		});
		const r = await avisarAsesorModoAgente(
			{ origen: POR_REFERENCIA, creditos: [SIFCO] },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", asesores: 1 });
		expect(insertadas[0].assignedTo).toBe("user-1");
		expect(insertadas[0].notificacionOrigenId).toBeNull();
	});

	it("sin asesor vinculado en ningún crédito no inserta y lo dice", async () => {
		const { deps, insertadas } = dependencias({ duenos: { [SIFCO]: null } });
		const r = await avisarAsesorModoAgente(
			{ origen: POR_REFERENCIA, creditos: [SIFCO] },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "SIN_ASESOR", asesores: 0 });
		expect(insertadas).toHaveLength(0);
	});

	it("si cartera no responde lo reporta en vez de tragárselo", async () => {
		const { deps, insertadas } = dependencias({
			duenos: { [SIFCO]: new Error("timeout") },
		});
		const r = await avisarAsesorModoAgente(
			{ origen: POR_REFERENCIA, creditos: [SIFCO] },
			deps,
		);

		expect(r).toEqual({ ok: false, motivo: "CARTERA_NO_DISPONIBLE" });
		expect(insertadas).toHaveLength(0);
	});

	it("con cartera deshabilitada tampoco finge haber avisado", async () => {
		const { deps, insertadas } = dependencias({ carteraHabilitada: false });
		const r = await avisarAsesorModoAgente(
			{ origen: POR_REFERENCIA, creditos: [SIFCO] },
			deps,
		);

		expect(r).toEqual({ ok: false, motivo: "CARTERA_NO_DISPONIBLE" });
		expect(insertadas).toHaveLength(0);
	});
});

import { describe, expect, it } from "bun:test";
import type { DestinoAvisoBot } from "./aviso-bot-asesor";
import {
	avisarAsesorModoAgente,
	type DependenciasModoAgente,
} from "./aviso-bot-modo-agente";

/**
 * COBROS-02 — aviso de modo agente. Lo que cuidan estas pruebas: que quede
 * enlazado al aviso inicial de la MISMA conversación, que no se repita, y que
 * un fallo de cartera se reporte en vez de tragarse (el bot puede reintentar).
 *
 * Dependencias inyectadas y no `mock.module`: los mocks de módulo de bun se
 * filtran entre archivos de prueba.
 */

const SESION = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000";
const SIFCO = "01010214119660";
const LLAVE = `bot:sesion:${SESION}:credito:${SIFCO}`;

const DESTINO: DestinoAvisoBot = {
	usuarioAsesor: { id: "user-1", name: "Asesor" },
	quien: `Cliente de Prueba (crédito ${SIFCO})`,
	anclaCaso: {
		relatedEntityType: "collection_case",
		relatedEntityId: "caso-1",
		redirectPage: "cobros_detail",
	},
};

/** Avisos existentes como `tipo|asesorUserId` → id. */
function dependencias(opciones: {
	avisos?: Record<string, string>;
	carteraHabilitada?: boolean;
	destino?: DestinoAvisoBot | null | Error;
}) {
	const insertadas: Record<string, unknown>[] = [];
	const buscadas: { tipo: string; llave: string; asesor: string }[] = [];
	const deps: DependenciasModoAgente = {
		buscarAviso: async (tipo, llave, asesor) => {
			buscadas.push({ tipo, llave, asesor });
			return opciones.avisos?.[`${tipo}|${asesor}`] ?? null;
		},
		carteraHabilitada: () => opciones.carteraHabilitada ?? true,
		resolverDestino: async () => {
			if (opciones.destino instanceof Error) throw opciones.destino;
			return opciones.destino === undefined ? DESTINO : opciones.destino;
		},
		insertar: async (fila) => {
			insertadas.push(fila as Record<string, unknown>);
		},
	};
	return { deps, insertadas, buscadas };
}

describe("avisarAsesorModoAgente", () => {
	it("enlaza la alerta al aviso inicial de la misma conversación", async () => {
		const { deps, insertadas, buscadas } = dependencias({
			avisos: { "bot_cliente_escribio|user-1": "notif-inicial" },
		});
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", conOrigen: true });
		expect(insertadas).toHaveLength(1);
		const fila = insertadas[0];
		expect(fila.cobrosTipo).toBe("bot_modo_agente");
		expect(fila.cobrosDedupKey).toBe(LLAVE);
		expect(fila.notificacionOrigenId).toBe("notif-inicial");
		expect(fila.assignedTo).toBe("user-1");
		expect(fila.relatedEntityId).toBe("caso-1");
		expect(String(fila.descripcion)).toContain(SIFCO);
		// La inicial se busca con la MISMA llave: es lo que las hace un hilo.
		expect(buscadas).toContainEqual({
			tipo: "bot_cliente_escribio",
			llave: LLAVE,
			asesor: "user-1",
		});
	});

	it("sin aviso inicial se crea igual, sin origen: el cliente sigue esperando", async () => {
		const { deps, insertadas } = dependencias({});
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", conOrigen: false });
		expect(insertadas).toHaveLength(1);
		expect(insertadas[0].notificacionOrigenId).toBeNull();
	});

	it("no repite al mismo asesor en la misma conversación", async () => {
		const { deps, insertadas } = dependencias({
			avisos: { "bot_modo_agente|user-1": "ya-existe" },
		});
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "YA_NOTIFICADO" });
		expect(insertadas).toHaveLength(0);
	});

	// Review de Codex, P1: la referencia vale 24 h y el crédito puede cambiar
	// de dueño en ese rato. Lo del asesor anterior no puede tapar al actual.
	it("si reasignaron el crédito, el dueño nuevo recibe su alerta", async () => {
		const { deps, insertadas } = dependencias({
			avisos: {
				"bot_modo_agente|asesor-anterior": "del-anterior",
				"bot_cliente_escribio|asesor-anterior": "escribio-anterior",
			},
		});
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "NOTIFICADO", conOrigen: false });
		expect(insertadas).toHaveLength(1);
		expect(insertadas[0].assignedTo).toBe("user-1");
		// El "escribió" del anterior no es su hilo.
		expect(insertadas[0].notificacionOrigenId).toBeNull();
	});

	it("sin asesor vinculado no inserta y lo dice", async () => {
		const { deps, insertadas } = dependencias({ destino: null });
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "SIN_ASESOR" });
		expect(insertadas).toHaveLength(0);
	});

	it("si cartera no responde lo reporta en vez de tragárselo", async () => {
		const { deps, insertadas } = dependencias({
			destino: new Error("timeout"),
		});
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: false, motivo: "CARTERA_NO_DISPONIBLE" });
		expect(insertadas).toHaveLength(0);
	});

	it("con cartera deshabilitada tampoco finge haber avisado", async () => {
		const { deps, insertadas } = dependencias({ carteraHabilitada: false });
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: false, motivo: "CARTERA_NO_DISPONIBLE" });
		expect(insertadas).toHaveLength(0);
	});
});

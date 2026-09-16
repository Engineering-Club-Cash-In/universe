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

function dependencias(opciones: {
	avisos?: Partial<Record<"bot_cliente_escribio" | "bot_modo_agente", string>>;
	carteraHabilitada?: boolean;
	destino?: DestinoAvisoBot | null | Error;
}) {
	const insertadas: Record<string, unknown>[] = [];
	const buscadas: { tipo: string; llave: string }[] = [];
	let resolvio = 0;
	const deps: DependenciasModoAgente = {
		buscarAviso: async (tipo, llave) => {
			buscadas.push({ tipo, llave });
			return opciones.avisos?.[tipo] ?? null;
		},
		carteraHabilitada: () => opciones.carteraHabilitada ?? true,
		resolverDestino: async () => {
			resolvio++;
			if (opciones.destino instanceof Error) throw opciones.destino;
			return opciones.destino === undefined ? DESTINO : opciones.destino;
		},
		insertar: async (fila) => {
			insertadas.push(fila as Record<string, unknown>);
		},
	};
	return { deps, insertadas, buscadas, resueltos: () => resolvio };
}

describe("avisarAsesorModoAgente", () => {
	it("enlaza la alerta al aviso inicial de la misma conversación", async () => {
		const { deps, insertadas, buscadas } = dependencias({
			avisos: { bot_cliente_escribio: "notif-inicial" },
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

	it("no repite en la misma conversación, y ni siquiera va a cartera", async () => {
		const { deps, insertadas, resueltos } = dependencias({
			avisos: { bot_modo_agente: "ya-existe" },
		});
		const r = await avisarAsesorModoAgente(
			{ sesionId: SESION, numeroSifco: SIFCO },
			deps,
		);

		expect(r).toEqual({ ok: true, motivo: "YA_NOTIFICADO" });
		expect(insertadas).toHaveLength(0);
		expect(resueltos()).toBe(0);
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

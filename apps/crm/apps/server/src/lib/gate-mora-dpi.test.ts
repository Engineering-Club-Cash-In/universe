import { describe, expect, test } from "bun:test";
import {
	ConsultaMoraNoDisponibleError,
	type ConsultaMoraResponse,
} from "../types/cartera-back";
import type { AuditEntry } from "./audit";
import {
	esDpiEnBlanco,
	evaluarGateMoraDpi,
	MENSAJE_CORRECCION_POR_ADMINISTRADOR,
	MENSAJE_DPI_EN_BLANCO,
	MENSAJE_GATE_APAGADO,
	mensajeRechazoGateMora,
	type ResolucionEdicionConMora,
	requiereConsultaDeMora,
	resolverEdicionConMora,
} from "./gate-mora-dpi";
import { unirNumerosSifco } from "./numeros-sifco-por-dpi";

/**
 * El gate de mora aplicado a los seis puntos de alta y edición por DPI.
 *
 * Lo que se prueba acá es lo que decide si una persona entra o no: el rechazo
 * de quien está en mora, el fail-closed por los dos caminos que tiene, y —la
 * parte más fácil de romper— que una edición que NO toca el DPI ni siquiera
 * llame a cartera. Si se consultara en toda edición, los clientes morosos
 * quedarían imposibles de editar y cobranza no podría ni corregirles el
 * teléfono.
 *
 * Sin `mock.module` a propósito: en bun reemplazar un módulo es global al
 * proceso y envenena a los otros setenta archivos de test. Las dependencias
 * entran por parámetro, así que alcanzan funciones comunes.
 */

const DPI = "3460666380101";

const SIN_MORA: ConsultaMoraResponse = {
	encontrado: true,
	tieneMoraActiva: false,
	puedeContinuar: true,
	motivo: "SIN_MORA",
	cliente: { codigoClienteSifco: "CL-1", nombre: "Ana López" },
	creditos: [],
	historialMora: [],
	consultadoEn: "2026-09-17T10:00:00.000Z",
};

const CON_MORA: ConsultaMoraResponse = {
	...SIN_MORA,
	tieneMoraActiva: true,
	puedeContinuar: false,
	motivo: "MORA_ACTIVA",
	creditos: [
		{
			numeroCreditoSifco: "0101",
			estado: "MOROSO",
			moraActiva: { monto: "1200.00", cuotasAtrasadas: 3 },
		},
	],
};

const EN_CONVENIO: ConsultaMoraResponse = {
	...SIN_MORA,
	puedeContinuar: false,
	motivo: "EN_CONVENIO",
};

/**
 * Cartera contesta 200 —el HTTP salió bien— pero avisa en el cuerpo que no
 * pudo averiguarlo. Ojo `tieneMoraActiva: false`: acá significa "no consta",
 * no "está al día".
 */
const SERVICIO_CAIDO_200: ConsultaMoraResponse = {
	encontrado: false,
	tieneMoraActiva: false,
	puedeContinuar: false,
	motivo: "SERVICIO_NO_DISPONIBLE",
	cliente: null,
	creditos: [],
	historialMora: [],
	consultadoEn: "2026-09-17T10:00:00.000Z",
};

/** Banco de pruebas: registra a quién se consultó y qué quedó anotado. */
function banco(responder: (dpi: string) => Promise<ConsultaMoraResponse>) {
	const consultados: string[] = [];
	const anotaciones: AuditEntry[] = [];
	return {
		consultados,
		anotaciones,
		deps: {
			consultar: (dpi: string) => {
				consultados.push(dpi);
				return responder(dpi);
			},
			anotar: (entrada: AuditEntry) => {
				anotaciones.push(entrada);
			},
		},
	};
}

describe("gate de mora: altas", () => {
	test("un DPI con mora activa no pasa, y el mensaje dice que no se puede continuar", async () => {
		const { deps, consultados } = banco(async () => CON_MORA);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("MORA_ACTIVA");
		expect(veredicto.mensaje).toContain("saldo en mora");
		expect(veredicto.mensaje).toContain("No se puede continuar");
		expect(consultados).toEqual([DPI]);
	});

	test("un DPI sin mora pasa", async () => {
		const { deps, consultados } = banco(async () => SIN_MORA);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(false);
		expect(consultados).toEqual([DPI]);
	});

	test("un convenio vigente bloquea con su propio mensaje, distinto al de mora", async () => {
		const conConvenio = await evaluarGateMoraDpi(
			DPI,
			banco(async () => EN_CONVENIO).deps,
		);
		const conMora = await evaluarGateMoraDpi(
			DPI,
			banco(async () => CON_MORA).deps,
		);

		expect(conConvenio.rechazado).toBe(true);
		expect(conConvenio.motivo).toBe("EN_CONVENIO");
		expect(conConvenio.mensaje).toContain("convenio de pago vigente");
		// El asesor tiene que poder distinguir un caso del otro por el texto.
		expect(conConvenio.mensaje).not.toBe(conMora.mensaje);
	});
});

describe("gate de mora: fail-closed", () => {
	test("si el cliente lanza ConsultaMoraNoDisponibleError, no pasa nadie", async () => {
		const { deps } = banco(async () => {
			throw new ConsultaMoraNoDisponibleError(
				"timeout de SIFCO",
				new Error("ETIMEDOUT"),
			);
		});

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("SERVICIO_NO_DISPONIBLE");
	});

	test("un HTTP 200 con motivo SERVICIO_NO_DISPONIBLE también bloquea", async () => {
		// El camino que se pierde si uno mira solo el status: cartera contestó
		// bien, pero lo que contestó es "no sé".
		const { deps } = banco(async () => SERVICIO_CAIDO_200);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("SERVICIO_NO_DISPONIBLE");
	});

	test("el servicio caído se lee distinto de un rechazo real: dice que no se pudo verificar", async () => {
		const caido = await evaluarGateMoraDpi(
			DPI,
			banco(async () => SERVICIO_CAIDO_200).deps,
		);
		const moroso = await evaluarGateMoraDpi(
			DPI,
			banco(async () => CON_MORA).deps,
		);

		expect(caido.mensaje).toContain("No se pudo verificar");
		expect(caido.mensaje).toContain("intenta de nuevo");
		// Y sobre todo: no acusa al cliente de tener mora.
		expect(caido.mensaje).not.toContain("saldo en mora");
		expect(caido.mensaje).not.toBe(moroso.mensaje);
	});
});

describe("gate de mora: ediciones (solo si el DPI es nuevo o cambia)", () => {
	test("el mismo DPI guardado no se vuelve a consultar", () => {
		expect(requiereConsultaDeMora(DPI, DPI)).toBe(false);
	});

	test("el mismo DPI guardado con espacios tampoco se consulta", () => {
		// Los DPI viejos quedaron con espacios; comparar en crudo vería un cambio
		// donde no lo hay y trabaría la edición de un moroso.
		expect(requiereConsultaDeMora(DPI, "3460 66638 0101")).toBe(false);
	});

	test("cambiar el DPI sí se consulta, y si está en mora se rechaza", async () => {
		const OTRO = "1234567890101";
		expect(requiereConsultaDeMora(OTRO, DPI)).toBe(true);

		const { deps, consultados } = banco(async () => CON_MORA);
		const veredicto = await evaluarGateMoraDpi(OTRO, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(consultados).toEqual([OTRO]);
	});

	test("un registro sin DPI al que se le pone uno cuenta como nuevo", () => {
		expect(requiereConsultaDeMora(DPI, null)).toBe(true);
		expect(requiereConsultaDeMora(DPI, undefined)).toBe(true);
		expect(requiereConsultaDeMora(DPI, "")).toBe(true);
		expect(requiereConsultaDeMora(DPI, "   ")).toBe(true);
	});

	/**
	 * 🔴 `dpi: ""` pasaba de largo por todos lados: la validación se saltaba por
	 * falsy, el gate también, y el `.set` lo escribía igual. Blanquear el DPI de
	 * un moroso lo volvía invisible para siempre, porque el CRM llega a sus
	 * créditos `CRM-<uuid>` e `insoluto-N` por el DPI del lead. Se rechaza.
	 */
	test("dejar el DPI en blanco se reconoce para poder rechazarlo", () => {
		expect(esDpiEnBlanco("")).toBe(true);
		expect(esDpiEnBlanco("   ")).toBe(true);
		expect(esDpiEnBlanco("\t\n")).toBe(true);
	});

	test("no confunde 'en blanco' con 'no me mandaron el campo'", () => {
		// `undefined` es una edición que no toca el DPI —el caso más común de
		// todos— y no puede salir con un error de validación.
		expect(esDpiEnBlanco(undefined)).toBe(false);
		expect(esDpiEnBlanco(null)).toBe(false);
		expect(esDpiEnBlanco(DPI)).toBe(false);
		expect(esDpiEnBlanco("3460 66638 0101")).toBe(false);
	});

	test("el mensaje dice qué hacer, no solo que no se puede", () => {
		expect(MENSAJE_DPI_EN_BLANCO).toContain("escribir el correcto");
	});

	test("🔴 borrar el DPI no consulta: cartera no sabe qué hacer con uno vacío", async () => {
		// Un `dpi: ""` con el candado abierto (≤30%) es un borrado legítimo. Si se
		// consultara, cartera revienta con el DPI vacío, el fail-closed lo traduce
		// a SERVICIO_NO_DISPONIBLE y el borrado queda bloqueado por un error
		// nuestro. El candado SÍ sigue viendo el borrado; eso no cambia.
		expect(requiereConsultaDeMora("", DPI)).toBe(false);
		expect(requiereConsultaDeMora("   ", DPI)).toBe(false);

		const { deps, consultados } = banco(async () => CON_MORA);

		if (requiereConsultaDeMora("", DPI)) {
			await evaluarGateMoraDpi("", deps);
		}

		expect(consultados).toEqual([]);
	});

	test("una edición que no toca el DPI no llega a llamar a cartera", async () => {
		// La prueba que protege la operación: el gate no se ejecuta, así que el
		// cliente ni se toca. Un moroso se sigue pudiendo editar.
		const { deps, consultados } = banco(async () => CON_MORA);

		if (requiereConsultaDeMora(DPI, "3460 66638 0101")) {
			await evaluarGateMoraDpi(DPI, deps);
		}

		expect(consultados).toEqual([]);
	});
});

describe("gate de mora: bitácora", () => {
	test("el bloqueo, el paso limpio y el servicio caído quedan en filas distintas", async () => {
		const bloqueado = banco(async () => CON_MORA);
		await evaluarGateMoraDpi(DPI, bloqueado.deps);

		const limpio = banco(async () => SIN_MORA);
		await evaluarGateMoraDpi(DPI, limpio.deps);

		const caido = banco(async () => SERVICIO_CAIDO_200);
		await evaluarGateMoraDpi(DPI, caido.deps);

		expect(bloqueado.anotaciones[0]?.action).toBe("validar_mora_dpi_bloqueado");
		expect(limpio.anotaciones[0]?.action).toBe("validar_mora_dpi_sin_bloqueo");
		// Media hora de SIFCO caído no puede verse como cuarenta clientes morosos.
		expect(caido.anotaciones[0]?.action).toBe("validar_mora_dpi_no_disponible");
		expect(caido.anotaciones[0]?.ok).toBe(false);
	});
});

describe("gate de mora: crédito insoluto", () => {
	const CON_INSOLUTO: ConsultaMoraResponse = {
		...SIN_MORA,
		// Ojo: cartera bloquea SIN mora activa. Leer `tieneMoraActiva` para decidir
		// dejaría pasar justamente a este.
		tieneMoraActiva: false,
		puedeContinuar: false,
		motivo: "CREDITO_INSOLUTO",
		creditos: [
			{
				numeroCreditoSifco: "insoluto-3",
				estado: "CANCELADO",
				moraActiva: null,
			},
		],
	};

	test("🔴 rechaza aunque no haya mora activa y el insoluto esté CANCELADO", async () => {
		const { deps } = banco(async () => CON_INSOLUTO);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("CREDITO_INSOLUTO");
	});

	test("el mensaje nombra al insoluto y no promete ponerse al día", async () => {
		const { deps } = banco(async () => CON_INSOLUTO);

		const { mensaje } = await evaluarGateMoraDpi(DPI, deps);

		expect(mensaje).toBe(
			"El DPI corresponde a un cliente con un crédito insoluto en cartera. No se puede continuar.",
		);
		// Distinto del de mora: el insoluto no se arregla pagando la mora, así que
		// mandar al asesor a pedir eso sería mandarlo a una gestión imposible.
		expect(mensaje).not.toContain("se ponga al día");
	});

	test("queda en la bitácora como bloqueo, con su motivo", async () => {
		const bloqueado = banco(async () => CON_INSOLUTO);

		await evaluarGateMoraDpi(DPI, bloqueado.deps);

		expect(bloqueado.anotaciones[0]?.action).toBe("validar_mora_dpi_bloqueado");
		expect(
			(bloqueado.anotaciones[0]?.data as { motivo?: string } | undefined)
				?.motivo,
		).toBe("CREDITO_INSOLUTO");
	});
});

describe("gate de mora: números de crédito que aporta el CRM", () => {
	/**
	 * El caso que el gate no veía: los créditos nacidos en el CRM
	 * (`CRM-<uuid>`) y los insolutos (`insoluto-N`) no tienen número de SIFCO,
	 * así que preguntar solo por el DPI dejaba fuera cartera entera.
	 */
	function bancoConNumeros(
		responder: (
			dpi: string,
			numeros?: string[],
		) => Promise<ConsultaMoraResponse>,
		numerosCreditoConocidos?: (dpi: string) => Promise<string[]>,
	) {
		const recibidos: Array<{ dpi: string; numeros?: string[] }> = [];
		const anotaciones: AuditEntry[] = [];
		return {
			recibidos,
			anotaciones,
			deps: {
				consultar: (dpi: string, numeros?: string[]) => {
					recibidos.push({ dpi, numeros });
					return responder(dpi, numeros);
				},
				numerosCreditoConocidos,
				anotar: (entrada: AuditEntry) => {
					anotaciones.push(entrada);
				},
			},
		};
	}

	test("los números que el CRM conoce viajan a cartera junto al DPI", async () => {
		const { deps, recibidos } = bancoConNumeros(
			async () => SIN_MORA,
			async () => ["CRM-abc", "insoluto-3"],
		);

		await evaluarGateMoraDpi(DPI, deps);

		expect(recibidos).toEqual([
			{ dpi: DPI, numeros: ["CRM-abc", "insoluto-3"] },
		]);
	});

	test("sin la dependencia el gate sigue funcionando sobre lo que SIFCO ve", async () => {
		const { deps, recibidos } = bancoConNumeros(async () => CON_MORA);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(recibidos).toEqual([{ dpi: DPI, numeros: [] }]);
	});

	test("🔴 si la búsqueda de números falla, el gate corta y NO consulta a medias", async () => {
		// Fail-closed: consultar sin esos números vería menos cartera de la que
		// hay, y un "sin mora" armado sobre media cartera es el falso negativo que
		// este gate existe para evitar.
		const { deps, recibidos, anotaciones } = bancoConNumeros(
			async () => SIN_MORA,
			async () => {
				throw new Error("la base del CRM no respondió");
			},
		);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("SERVICIO_NO_DISPONIBLE");
		expect(recibidos).toEqual([]);
		expect(anotaciones[0]?.action).toBe("validar_mora_dpi_no_disponible");
		expect(anotaciones[0]?.ok).toBe(false);
	});

	test("el veredicto que llega gracias a esos números bloquea igual", async () => {
		// Cliente sin ficha en SIFCO: cartera lo encuentra SOLO por los números del
		// CRM, y por eso `cliente` viene en null pero `encontrado` en true.
		const { deps } = bancoConNumeros(
			async (_dpi, numeros) =>
				numeros?.includes("insoluto-3")
					? {
							...SIN_MORA,
							cliente: null,
							puedeContinuar: false,
							motivo: "CREDITO_INSOLUTO",
						}
					: SIN_MORA,
			async () => ["insoluto-3"],
		);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("CREDITO_INSOLUTO");
	});

	/**
	 * 🔴 El agujero del CAMBIO de DPI. Los números se buscaban SOLO por el DPI
	 * NUEVO. Un lead con su propio crédito moroso —`CRM-<uuid>` o `insoluto-N`,
	 * invisibles para SIFCO— tecleaba un DPI virgen, cartera contestaba
	 * CLIENTE_NO_ENCONTRADO → `puedeContinuar`, y el cambio pasaba para un
	 * no-admin: su propia deuda quedaba fuera de su propia evaluación.
	 *
	 * El arreglo vive en el armado de `numerosCreditoConocidos` del sitio que
	 * edita (`numerosSifcoDelDpiYDelLead`); acá se prueba que la unión llega
	 * hasta cartera y que el veredicto cambia por ella.
	 */
	test("🔴 en un cambio de DPI viajan también los números del lead editado", async () => {
		const numerosPorDpiNuevo: string[] = []; // el DPI nuevo no registra nada
		const numerosDelLeadEditado = ["CRM-8f14e45f", "insoluto-3"];

		const { deps, recibidos } = bancoConNumeros(
			async (_dpi, numeros) =>
				numeros?.includes("insoluto-3")
					? {
							...SIN_MORA,
							cliente: null,
							puedeContinuar: false,
							motivo: "CREDITO_INSOLUTO",
						}
					: // Sin los números del lead, cartera no lo reconoce y lo deja pasar.
						{
							...SIN_MORA,
							encontrado: false,
							motivo: "CLIENTE_NO_ENCONTRADO",
						},
			// Así lo arma el sitio que edita: unión de las dos fuentes.
			async () => unirNumerosSifco(numerosPorDpiNuevo, numerosDelLeadEditado),
		);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(recibidos).toEqual([{ dpi: DPI, numeros: numerosDelLeadEditado }]);
		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("CREDITO_INSOLUTO");
	});

	test("sin la unión, el mismo caso pasaba limpio (la regresión que se tapa)", async () => {
		const { deps } = bancoConNumeros(
			async (_dpi, numeros) =>
				numeros?.includes("insoluto-3")
					? { ...SIN_MORA, puedeContinuar: false, motivo: "CREDITO_INSOLUTO" }
					: { ...SIN_MORA, encontrado: false, motivo: "CLIENTE_NO_ENCONTRADO" },
			async () => [], // solo el DPI nuevo, que no registra nada
		);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(false);
	});
});

describe("gate de mora: kill switch (ENABLE_CARTERA_BACK_INTEGRATION)", () => {
	test("apagado, deja pasar SIN consultar a cartera", async () => {
		// Fail-OPEN deliberado, y el único del gate: lo activa una persona tocando
		// una variable de entorno, no una excepción. Si SIFCO queda caído horas,
		// sin esta palanca no habría cómo seguir dando de alta clientes salvo
		// desplegando código.
		const { deps, consultados } = banco(async () => CON_MORA);

		const veredicto = await evaluarGateMoraDpi(DPI, {
			...deps,
			habilitado: () => false,
		});

		expect(veredicto.rechazado).toBe(false);
		expect(veredicto.motivo).toBe("SIN_MORA");
		// La prueba que importa: ni siquiera se preguntó. Un cliente CON mora pasa.
		expect(consultados).toEqual([]);
	});

	test("apagado, ni la búsqueda de números del CRM llega a salir", async () => {
		// El corto va ANTES que todo: `numerosCreditoConocidos` toca la base y no
		// tiene sentido pagarlo si no se va a consultar nada.
		let busquedas = 0;
		const { deps } = banco(async () => SIN_MORA);

		await evaluarGateMoraDpi(DPI, {
			...deps,
			numerosCreditoConocidos: async () => {
				busquedas += 1;
				return [];
			},
			habilitado: () => false,
		});

		expect(busquedas).toBe(0);
	});

	test("apagado, queda su propia fila en la bitácora", async () => {
		// Mientras la bandera esté abajo entra gente sin validar; después hay que
		// poder saber quiénes fueron, y que NO se confunda con un paso limpio.
		const { deps, anotaciones } = banco(async () => CON_MORA);

		await evaluarGateMoraDpi(DPI, { ...deps, habilitado: () => false });

		expect(anotaciones).toHaveLength(1);
		expect(anotaciones[0]?.action).toBe("validar_mora_dpi_apagado");
		expect(anotaciones[0]?.action).not.toBe("validar_mora_dpi_sin_bloqueo");
		expect(anotaciones[0]?.data).toMatchObject({ dpi: DPI });
	});

	test("el mensaje dice que no se consultó, no que el cliente esté limpio", async () => {
		const { deps } = banco(async () => CON_MORA);

		const veredicto = await evaluarGateMoraDpi(DPI, {
			...deps,
			habilitado: () => false,
		});

		expect(veredicto.mensaje).toBe(MENSAJE_GATE_APAGADO);
		expect(veredicto.mensaje).toContain("desactivada por configuración");
		expect(veredicto.mensaje).toContain("no se consultó");
	});

	test("prendido, todo sigue exactamente igual que antes", async () => {
		const bloqueado = banco(async () => CON_MORA);

		const veredicto = await evaluarGateMoraDpi(DPI, {
			...bloqueado.deps,
			habilitado: () => true,
		});

		expect(veredicto.rechazado).toBe(true);
		expect(veredicto.motivo).toBe("MORA_ACTIVA");
		expect(bloqueado.consultados).toEqual([DPI]);
		expect(bloqueado.anotaciones[0]?.action).toBe("validar_mora_dpi_bloqueado");
	});

	test("sin la dependencia el gate consulta siempre", async () => {
		// Omitirla no puede significar "apagado": los seis puntos de producción la
		// cablean, pero un llamador nuevo que la olvide tiene que quedar validando.
		const { deps, consultados } = banco(async () => CON_MORA);

		const veredicto = await evaluarGateMoraDpi(DPI, deps);

		expect(veredicto.rechazado).toBe(true);
		expect(consultados).toEqual([DPI]);
	});
});

describe("gate de mora: corrección de un DPI mal capturado (solo ediciones)", () => {
	const RECHAZO = {
		rechazado: true as const,
		motivo: "MORA_ACTIVA" as const,
		mensaje: mensajeRechazoGateMora("MORA_ACTIVA"),
	};

	/** La fila que el llamador va a anotar, o null si no hay override. */
	const pendiente = (
		resolucion: ResolucionEdicionConMora,
	): AuditEntry | null =>
		resolucion.permitir ? resolucion.anotacionPendiente : null;

	test("un asesor de ventas sigue bloqueado", () => {
		const resolucion = resolverEdicionConMora(RECHAZO, "sales", {
			entity: "lead",
			id: "lead-1",
			dpi: DPI,
		});

		expect(resolucion.permitir).toBe(false);
		// Bloqueado no deja rastro de override: no hubo ninguno.
		expect(pendiente(resolucion)).toBeNull();
	});

	test("el mensaje del bloqueado le dice a dónde ir: a un administrador", () => {
		const resolucion = resolverEdicionConMora(RECHAZO, "sales", {
			entity: "lead",
			id: "lead-1",
			dpi: DPI,
		});

		expect(resolucion.permitir).toBe(false);
		if (resolucion.permitir) return;
		// Sigue diciendo POR QUÉ se bloqueó...
		expect(resolucion.mensaje).toContain("saldo en mora");
		// ...y ahora también qué hacer si el DPI simplemente estaba mal tecleado.
		expect(resolucion.mensaje).toContain("administrador");
		expect(resolucion.mensaje).toContain(MENSAJE_CORRECCION_POR_ADMINISTRADOR);
	});

	test("los roles intermedios NO abren la válvula, aunque editen cualquier lead", () => {
		// `canUpdateAnyLead` es `!== "sales"`, así que estos tres pueden editar el
		// lead de cualquiera. Saltarse el gate de mora es otra cosa: es exactamente
		// el favor que un asesor con presión de cuota le pediría a su supervisor.
		for (const rol of ["sales_supervisor", "analyst", "juridico"]) {
			const resolucion = resolverEdicionConMora(RECHAZO, rol, {
				entity: "lead",
				id: "lead-1",
				dpi: DPI,
			});

			expect(resolucion.permitir, `${rol} no debería poder`).toBe(false);
			expect(pendiente(resolucion)).toBeNull();
		}
	});

	test("un administrador sí puede corregir, y deja rastro con el motivo del gate", () => {
		const resolucion = resolverEdicionConMora(RECHAZO, "admin", {
			entity: "lead",
			id: "lead-1",
			dpi: DPI,
		});

		expect(resolucion.permitir).toBe(true);
		const fila = pendiente(resolucion);
		expect(fila?.action).toBe("validar_mora_dpi_override_admin");
		expect(fila?.id).toBe("lead-1");
		// Sin el motivo, la fila diría que alguien pasó pero no por encima de qué.
		expect(fila?.data).toMatchObject({ dpi: DPI, motivo: "MORA_ACTIVA" });
	});

	/**
	 * 🔴 La fila es una INTENCIÓN y la escribe el llamador después de confirmar
	 * el UPDATE. Anotándola acá —antes del UPDATE— un lead inexistente o
	 * cualquier fallo posterior dejaba en la bitácora un override `ok: true` que
	 * nunca ocurrió: el DPI seguía siendo el viejo y la revisión leía que un
	 * administrador había forzado un cambio inexistente. Justo al revés de para
	 * qué existe esa fila.
	 *
	 * La función ya no recibe con qué anotar, así que no PUEDE escribir; esto fija
	 * esa forma para que nadie se la devuelva sin darse cuenta.
	 */
	test("🔴 la resolución no escribe la bitácora: la devuelve para después", () => {
		expect(resolverEdicionConMora).toHaveLength(3);
	});

	test("el co-deudor viaja en el detalle porque la bitácora no conoce esa entidad", () => {
		const resolucion = resolverEdicionConMora(RECHAZO, "admin", {
			entity: "lead",
			id: null,
			dpi: DPI,
			datosExtra: { coDebtorId: "codeudor-9" },
		});

		expect(pendiente(resolucion)?.id).toBeNull();
		expect(pendiente(resolucion)?.data).toMatchObject({
			coDebtorId: "codeudor-9",
		});
	});

	test("si el gate no rechazó, no se anota override de nadie", () => {
		const resolucion = resolverEdicionConMora(
			{ rechazado: false, motivo: "SIN_MORA", mensaje: "" },
			"admin",
			{ entity: "lead", id: "lead-1", dpi: DPI },
		);

		expect(resolucion.permitir).toBe(true);
		expect(pendiente(resolucion)).toBeNull();
	});

	test("un rol ausente no abre la válvula", () => {
		for (const rol of [undefined, null, ""]) {
			expect(
				resolverEdicionConMora(RECHAZO, rol, {
					entity: "lead",
					id: "lead-1",
					dpi: DPI,
				}).permitir,
			).toBe(false);
		}
	});

	/**
	 * 🔴 La válvula es para los motivos de NEGOCIO, no para las caídas. Ante la
	 * mora el admin decide con el dato en la mano; con cartera caída NADIE sabe
	 * si ese DPI tiene mora, y dejarlo pasar a ciegas mientras dura la caída
	 * convierte el fail-closed en una sugerencia. Para las emergencias está el
	 * kill switch, que lo baja alguien a propósito y deja su propia fila.
	 */
	test("con cartera caída el administrador queda bloqueado como todos", () => {
		const caida = {
			rechazado: true as const,
			motivo: "SERVICIO_NO_DISPONIBLE" as const,
			mensaje: mensajeRechazoGateMora("SERVICIO_NO_DISPONIBLE"),
		};

		const resolucion = resolverEdicionConMora(caida, "admin", {
			entity: "lead",
			id: "lead-1",
			dpi: DPI,
		});

		expect(resolucion.permitir).toBe(false);
		// Y no hay override que anotar: nadie pasó.
		expect(pendiente(resolucion)).toBeNull();
	});

	test("al admin bloqueado por la caída se le habla de la caída, no de buscar un admin", () => {
		const resolucion = resolverEdicionConMora(
			{
				rechazado: true,
				motivo: "SERVICIO_NO_DISPONIBLE",
				mensaje: mensajeRechazoGateMora("SERVICIO_NO_DISPONIBLE"),
			},
			"admin",
			{ entity: "lead", id: "lead-1", dpi: DPI },
		);

		expect(resolucion.permitir).toBe(false);
		if (resolucion.permitir) return;
		expect(resolucion.mensaje).toContain("no está disponible");
		// Mandar a "pedirle a un administrador" a quien YA lo es no ayuda, y el
		// administrador al que mandaría tampoco puede.
		expect(resolucion.mensaje).not.toContain(
			MENSAJE_CORRECCION_POR_ADMINISTRADOR,
		);
	});

	test("los otros dos motivos de negocio sí abren la válvula del admin", () => {
		for (const motivo of ["EN_CONVENIO", "CREDITO_INSOLUTO"] as const) {
			const resolucion = resolverEdicionConMora(
				{ rechazado: true, motivo, mensaje: mensajeRechazoGateMora(motivo) },
				"admin",
				{ entity: "lead", id: "lead-1", dpi: DPI },
			);

			expect(resolucion.permitir, `${motivo} debería poder corregirse`).toBe(
				true,
			);
			expect(pendiente(resolucion)?.data).toMatchObject({ motivo });
		}
	});

	/**
	 * Si cartera estrena un motivo que bloquea, el admin NO lo hereda: la lista
	 * de motivos de negocio es explícita justamente para que un motivo nuevo
	 * empiece cerrado y alguien tenga que decidir a mano si abrirlo.
	 */
	test("un motivo desconocido que bloquea no abre la válvula", () => {
		const resolucion = resolverEdicionConMora(
			{
				rechazado: true,
				motivo: "CLIENTE_NO_ENCONTRADO",
				mensaje: mensajeRechazoGateMora("CLIENTE_NO_ENCONTRADO"),
			},
			"admin",
			{ entity: "lead", id: "lead-1", dpi: DPI },
		);

		expect(resolucion.permitir).toBe(false);
		expect(pendiente(resolucion)).toBeNull();
	});
});

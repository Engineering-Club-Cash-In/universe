import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	avisoAccesoPortal,
	type AccesoPortal,
	valorDeTabla,
} from "./acceso-portal";

const acceso = (over: Partial<AccesoPortal> = {}): AccesoPortal => ({
	estado: "creada",
	usuarioEmail: "ana@example.com",
	correo: {
		enviado: true,
		plantilla: "bienvenida",
		redirigido: false,
		destinatarioReal: null,
	},
	advertencias: [],
	motivo: null,
	...over,
});

describe("avisoAccesoPortal", () => {
	it("sin acceso que reportar no dice nada", () => {
		expect(avisoAccesoPortal(null)).toBeNull();
		expect(avisoAccesoPortal(undefined)).toBeNull();
	});

	it("el alta limpia confirma que el correo salió", () => {
		const aviso = avisoAccesoPortal(acceso())!;
		expect(aviso.tono).toBe("exito");
		expect(aviso.texto).toContain("portal");
	});

	it("la contraseña que no salió es ADVERTENCIA y dice qué hacer", () => {
		// El peor desenlace: la cuenta existe, su dueño no lo sabe y no puede
		// entrar. Conta tiene que enterarse con el inversionista todavía al
		// teléfono, no en el resumen del día siguiente.
		const aviso = avisoAccesoPortal(
			acceso({
				correo: {
					enviado: false,
					plantilla: "bienvenida",
					redirigido: false,
					destinatarioReal: null,
				},
				advertencias: [
					"correo_no_enviado",
					"cuenta_creada_sin_contrasena_entregada",
				],
			}),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("contraseña");
		expect(aviso.texto.toLowerCase()).toContain("restablecer");
		// Sin jerga: conta no sabe qué es SERVER, PROD ni un código interno.
		expect(aviso.texto).not.toContain("_");
	});

	it("el correo desviado nombra la bandeja a la que se fue", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				correo: {
					enviado: true,
					plantilla: "bienvenida",
					redirigido: true,
					destinatarioReal: "pruebas@clubcashin.com",
				},
				advertencias: ["correo_redirigido_por_modo_no_prod"],
			}),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("pruebas@clubcashin.com");
		expect(aviso.texto).not.toContain("PROD");
		expect(aviso.texto).not.toContain("SERVER");
	});

	it("cuando ya tenía cuenta con otro correo, dice con cuál entra", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "ya_tenia",
				usuarioEmail: "ana.vieja@example.com",
				advertencias: ["correo_de_cartera_distinto_al_de_la_cuenta"],
			}),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("ana.vieja@example.com");
	});

	it("un fallo del portal no se confunde con un alta fallida", () => {
		const aviso = avisoAccesoPortal(
			acceso({ estado: "fallo", motivo: "http_500", advertencias: [] }),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("sí quedó creado");
		expect(aviso.texto).toContain("Dar acceso al portal");
		expect(aviso.texto).not.toContain("http_500");
	});

	// El timeout NO es "no se pudo": es "no sabemos". Abortamos la espera y
	// del otro lado la cuenta pudo quedar creada, así que el consejo de
	// siempre —volver a apretar "Dar acceso al portal"— es justo el que no
	// sirve: el reintento contesta "ya tenía" y no manda ninguna contraseña.
	it("el timeout dice que no se sabe, y que reintentar no va a servir", () => {
		const aviso = avisoAccesoPortal(
			acceso({ estado: "fallo", motivo: "timeout", advertencias: [] }),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("No sabemos");
		expect(aviso.texto).toContain("NO le des acceso de nuevo");
		expect(aviso.texto).not.toContain("timeout");
	});

	it("sin correo capturado se dice qué falta para que tenga acceso", () => {
		const aviso = avisoAccesoPortal(
			acceso({ estado: "omitida", motivo: "sin_correo" }),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("correo");
		expect(aviso.texto).not.toContain("sin_correo");
	});

	it("la empresa que entra con su representante no es una advertencia", () => {
		expect(avisoAccesoPortal(acceso({ estado: "avisada" }))!.tono).toBe("exito");
	});

	it("junta las advertencias cuando hay más de una", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "ya_tenia",
				advertencias: ["rol_no_promovido", "cuenta_anclada_solo_por_correo"],
			}),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("permiso");
		expect(aviso.texto).toContain("segunda cuenta");
	});
});

describe("lo que se le promete a quien captura el alta", () => {
  /**
   * La reconciliación diaria DEJÓ de crear cuentas: ahora detecta y reporta, y
   * abrir la cuenta lo dispara una persona (POST /investor/portal-access).
   *
   * Estos textos decían "el sistema lo reintenta mañana a las 7:00 a.m.".
   * Dejarlos así sería peor que no decir nada: conta cerraría el modal creyendo
   * que el acceso se resuelve solo, nadie apretaría el botón, y el
   * inversionista se quedaría sin portal indefinidamente esperando un
   * automatismo que ya no existe.
   */
  it("un fallo del portal manda a abrir el acceso a mano, no a esperar", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "http_500", advertencias: [] }),
    )!;

    expect(aviso.texto).toContain("sí quedó creado");
    expect(aviso.texto).toContain("Dar acceso al portal");
    expect(aviso.texto).not.toMatch(/reintenta|7:00/);
  });

  it("sin correo, primero se captura el correo y DESPUÉS se aprieta el botón", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "omitida", motivo: "sin_correo", advertencias: [] }),
    )!;

    expect(aviso.texto).toContain("Dar acceso al portal");
    expect(aviso.texto).not.toMatch(/7:00/);
  });

  it("un alta que no pidió acceso tampoco promete que llegue solo", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "omitida", motivo: "no_solicitado", advertencias: [] }),
    )!;

    expect(aviso.texto).toContain("Dar acceso al portal");
    expect(aviso.texto).not.toMatch(/7:00/);
  });

  /**
   * El botón "Dar acceso al portal" YA existe en el CRM: está en la pantalla
   * del inversionista (`liquidaciones.$inversionistaId.tsx`). ANTES vivía solo
   * en carteraFront y estos avisos mandaban a "pedírselo a cartera"; ese
   * consejo quedó obsoleto y dejaría a conta esperando por algo que puede
   * hacer ella misma, con el inversionista sin portal mientras tanto.
   *
   * NO volver a poner "pedile a cartera" sin borrar antes ese botón.
   */
  it.each([
    ["fallo", "http_500"],
    ["omitida", "sin_correo"],
    ["omitida", "sin_nombre"],
    ["omitida", "no_solicitado"],
  ])("desde el CRM el aviso (%s/%s) manda al botón que esta aplicación ya tiene", (estado, motivo) => {
    const aviso = avisoAccesoPortal(
      acceso({ estado, motivo, advertencias: [] }),
    )!;

    expect(aviso.texto).toContain('opción "Dar acceso al portal"');
    expect(aviso.texto).not.toMatch(/pedile a cartera/);
  });
	/**
	 * El botón "Dar acceso al portal" apretado sobre una fila de EMPRESA.
	 *
	 * Cartera contesta con este motivo, y el diálogo del CRM promete que va a
	 * decir a qué fila ir. Sin traducción, lo que se enseñaba era el código
	 * crudo.
	 */
	it("la empresa manda a la fila del representante, no enseña el código", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "fallo",
				motivo: "es_empresa_el_acceso_es_del_representante",
				advertencias: [],
			}),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("representante legal");
		// Sin jerga: el código del backend no se le enseña a nadie.
		expect(aviso.texto).not.toContain("_");
		// Y NO manda a apretar otra vez el mismo botón sobre la misma fila.
		expect(aviso.texto).not.toContain("Dar acceso al portal");
	});

	/**
	 * El caso que el `onSuccess` escrito a mano mostraba en VERDE: la cuenta se
	 * creó, pero la contraseña no salió. Decirle "listo" a conta es lo que deja
	 * a la persona con una cuenta que no sabe que tiene y no puede usar.
	 */
	it("creada CON la contraseña sin entregar nunca es éxito", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "creada",
				correo: {
					enviado: false,
					plantilla: "bienvenida",
					redirigido: false,
					destinatarioReal: null,
				},
				advertencias: [
					"cuenta_creada_sin_contrasena_entregada",
					"correo_no_enviado",
				],
			}),
		)!;

		expect(aviso.tono).not.toBe("exito");
		expect(aviso.texto).not.toContain("Se le mandó");
	});
});

/**
 * El consejo de siempre —"volvé a intentarlo" desde el botón, "abrile el acceso
 * desde la pantalla del inversionista" desde el alta— apunta las dos veces a la
 * MISMA acción. Sobre estos motivos esa acción vuelve a caer en el mismo corte,
 * así que aconsejarla es mandar a alguien a dar vueltas en círculo mientras el
 * inversionista sigue sin portal.
 */
describe("los motivos que reintentar NO arregla", () => {
	const DESDE_EL_BOTON = "volvé a intentarlo con este mismo botón";
	const DESDE_EL_ALTA = 'opción "Dar acceso al portal"';

	it.each([
		"representante_no_encontrado_en_cartera",
		"correo_de_cartera_distinto_al_de_la_cuenta",
		"provisionamiento_no_configurado",
		"cuenta_anclada_solo_por_correo",
		"inversionista_no_encontrado",
		"correo_aprobado_no_coincide",
	])("%s no manda a apretar el botón otra vez, desde ningún lado", (motivo) => {
		const desdeElBoton = avisoAccesoPortal(
			acceso({ estado: "fallo", motivo, advertencias: [] }),
			"boton",
		)!;
		const desdeElAlta = avisoAccesoPortal(
			acceso({ estado: "fallo", motivo, advertencias: [] }),
			"alta",
		)!;

		expect(desdeElBoton.tono).toBe("advertencia");
		expect(desdeElBoton.texto).not.toContain(DESDE_EL_BOTON);
		expect(desdeElAlta.texto).not.toContain(DESDE_EL_ALTA);
		// Y ninguno enseña el código crudo del backend.
		expect(desdeElBoton.texto).not.toContain(motivo);
		expect(desdeElAlta.texto).not.toContain(motivo);
		// El alta sigue diciendo lo suyo: el inversionista SÍ quedó creado.
		expect(desdeElAlta.texto).toContain("sí quedó creado");
	});

	/**
	 * El peor de los cuatro: el texto se contradecía dentro de la misma línea
	 * —"hasta cuadrarlos no vería sus inversiones. Si querés, volvé a intentarlo
	 * con este mismo botón"—.
	 */
	it("el correo distinto manda a sistemas a cuadrarlos, no a reintentar", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "fallo",
				motivo: "correo_de_cartera_distinto_al_de_la_cuenta",
				advertencias: [],
			}),
			"boton",
		)!;

		expect(aviso.texto).toContain("hasta cuadrarlos no vería sus inversiones");
		expect(aviso.texto).toContain("sistemas");
		expect(aviso.texto).not.toContain("Si querés");
	});

	/**
	 * El representante ya está capturado: lo que pasa es que ese DPI no existe
	 * en cartera. El arreglo está en Editar, y el aviso nunca lo nombraba.
	 */
	it("el representante que cartera no encuentra manda a Editar", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "fallo",
				motivo: "representante_no_encontrado_en_cartera",
				advertencias: [],
			}),
			"boton",
		)!;

		expect(aviso.texto).toContain("no se encontró a su representante legal");
		expect(aviso.texto).toContain("Editar");
		expect(aviso.texto).toContain("DPI");
	});

	/**
	 * `cuenta_anclada_solo_por_correo` no estaba en la tabla de causas: el aviso
	 * salía como un "No se le pudo dar acceso al portal." pelado, sin decir por
	 * qué, y encima aconsejando reintentar — y el provisionamiento se niega
	 * ESTRUCTURALMENTE a promover una cuenta que solo el correo respalda, así
	 * que el reintento devuelve exactamente lo mismo, para siempre.
	 */
	it("la cuenta anclada solo por correo dice la causa y nombra el DPI", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "fallo",
				motivo: "cuenta_anclada_solo_por_correo",
				advertencias: ["cuenta_anclada_solo_por_correo"],
			}),
			"boton",
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("solo se la reconoce por el correo");
		expect(aviso.texto).toContain("DPI");
		expect(aviso.texto).not.toContain("Si querés");
	});

	/**
	 * El veto del correo aprobado. Es el ÚNICO de la lista que no describe una
	 * falla: describe el control funcionando —cartera vio que el correo de la
	 * fila ya no era el que el diálogo enseñó y cortó antes de provisionar—, y
	 * es justo el que más necesita explicarse, porque quien lee acaba de
	 * aprobar un correo y no tiene forma de saber que alguien más lo movió.
	 *
	 * Sin estas dos entradas el aviso salía como "No se le pudo dar acceso al
	 * portal." pelado —sin causa, porque el motivo no estaba en la tabla— y
	 * encima mandando a apretar otra vez el mismo botón, que con el mismo
	 * correo aprobado vuelve a caer en el mismo corte.
	 */
	it("el correo que cambió mientras revisaba se explica y NO manda a reintentar", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "fallo",
				motivo: "correo_aprobado_no_coincide",
				advertencias: [],
			}),
			"boton",
		)!;

		expect(aviso.tono).toBe("advertencia");
		// 1. QUÉ pasó: el correo se movió entre que lo enseñamos y que confirmó.
		expect(aviso.texto).toContain("el correo cambió mientras lo revisabas");
		// 2. Lo que hay que poder decirle al inversionista por teléfono: NO salió
		//    ninguna contraseña. Cartera corta antes de provisionar.
		expect(aviso.texto).toContain("No salió ninguna contraseña");
		// 3. QUÉ hacer: volver a abrir y mirar el correo nuevo.
		expect(aviso.texto).toContain("abrí de nuevo el acceso");
		expect(aviso.texto).toContain("el correo NUEVO");
		// 4. Y no se promete un reintento que vuelve a fallar.
		expect(aviso.texto).toContain("Volver a confirmar el mismo no sirve");
		expect(aviso.texto).not.toContain("Si querés");
	});

	/**
	 * El contrapeso: el motivo que SÍ se arregla reintentando tiene que seguir
	 * aconsejándolo. `no_se_pudo_marcar_password_provisionada` SIN la
	 * advertencia de "no se pudo deshacer" significa que la cuenta a medias se
	 * deshizo, y ahí el reintento la crea limpia.
	 */
	it("la cuenta a medias que SÍ se deshizo sigue mandando a reintentar", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "fallo",
				motivo: "no_se_pudo_marcar_password_provisionada",
				advertencias: [],
			}),
			"boton",
		)!;

		expect(aviso.texto).toContain("la cuenta quedó a medias al crearla");
		expect(aviso.texto).toContain(DESDE_EL_BOTON);
	});

	it("y la que NO se pudo deshacer no aconseja nada, porque no sirve", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "fallo",
				motivo: "no_se_pudo_marcar_password_provisionada",
				advertencias: ["cuenta_creada_sin_marca_de_password"],
			}),
			"boton",
		)!;

		expect(aviso.texto).not.toContain(DESDE_EL_BOTON);
		expect(aviso.texto).toContain("Avisa a sistemas");
	});
});

/**
 * La advertencia que solo emite el camino de SOLO LECTURA. Por el alta no
 * llega, pero si llegara sin traducir el aviso se quedaría con el `ya_tenia`
 * pelado —"Ya tenía acceso al portal", en VERDE— sobre una cuenta que entra y
 * no ve ninguna inversión.
 */
describe("la cuenta sin el rol de inversionista", () => {
	it("nunca sale en verde, ni siquiera sobre un ya_tenia", () => {
		const aviso = avisoAccesoPortal(
			acceso({
				estado: "ya_tenia",
				advertencias: ["cuenta_sin_rol_de_inversionista"],
			}),
			"boton",
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).not.toContain("Ya tenía acceso al portal");
		expect(aviso.texto).toContain("permiso de inversionista");
		expect(aviso.texto).not.toContain("_");
	});
});

/**
 * 🔴 LA REGLA QUE SOSTIENE EL LLAMADOR.
 *
 * `liquidaciones.$inversionistaId.tsx` decidía el toast con `if (!aviso)
 * toast.success("Listo.")`. O sea que `null` se estaba leyendo como "salió
 * bien", y `null` es "no sé qué pasó": resultado vacío, estado desconocido,
 * `omitida` con un motivo que no está en la lista. En verde, quien lee cuelga
 * el teléfono prometiendo una contraseña que nunca salió — exactamente el bug
 * que este traductor existe para cerrar, colado por la puerta de atrás.
 *
 * Lo que este archivo garantiza es la mitad de acá: un desenlace que no se
 * reconoce NUNCA vuelve con `tono: "exito"`. La otra mitad —que el llamador
 * pinte el `null` de amarillo y no de verde— vive en el `onSuccess` de ese
 * archivo, donde hoy sale un `toast.warning`.
 */
describe("un desenlace desconocido nunca sale en verde", () => {
	const desconocidos: Array<
		[string, Partial<AccesoPortal> | null | undefined]
	> = [
		["no vino ningún resultado", undefined],
		["vino nulo", null],
		// El camino de solo lectura ya emite `candidata`, y el traductor no lo
		// conoce.
		["un estado que el traductor no conoce", { estado: "candidata" }],
		["un estado inventado", { estado: "loquesea", motivo: "loquesea" }],
		[
			"omitida con un motivo fuera de la lista",
			{ estado: "omitida", motivo: "motivo_que_nadie_tradujo" },
		],
		["omitida sin motivo", { estado: "omitida", motivo: null }],
	];

	it.each(desconocidos)("%s", (_caso, over) => {
		const entrada = over === null || over === undefined ? over : acceso(over);

		for (const origen of ["alta", "boton"] as const) {
			const aviso = avisoAccesoPortal(entrada, origen);
			// O no dice nada (y el llamador lo pinta de amarillo), o dice que algo
			// pasa. Lo que no puede es afirmar que salió bien.
			expect(aviso?.tono).not.toBe("exito");
		}
	});

	/**
	 * El contrapeso: los desenlaces que SÍ se reconocen como buenos tienen que
	 * seguir saliendo en verde, o la prueba de arriba se cumpliría apagando todo.
	 */
	it.each([
		["creada"],
		["ya_tenia"],
		["avisada"],
	])("pero %s sigue siendo verde", (estado) => {
		expect(avisoAccesoPortal(acceso({ estado }), "boton")?.tono).toBe("exito");
	});
});

/**
 * La forma que llega NO es la que dice el tipo.
 *
 * Los dos llamadores le pasan JSON crudo de una respuesta (`data.accesoPortal`
 * en el alta, `data?.resultados?.[0]` en el botón), los dos `any`. Sus cuatro
 * comentarios dan por hecho que "ante otra forma vuelve `null`", y de eso
 * cuelga el toast amarillo de "no se pudo confirmar".
 *
 * Tirar acá no se parece en nada a devolver `null`: el throw cae dentro del
 * `onSuccess`, TanStack lo desvía al `onError`, y quien lee ve un rojo
 * genérico con el diálogo abierto y el botón habilitado DESPUÉS de que la
 * contraseña ya salió — o sea, invitándola a apretar otra vez.
 */
describe("cualquier forma que llegue tiene respuesta, nunca una excepción", () => {
	const formas: Array<[string, unknown]> = [
		// El caso comprobado: cartera contestó un fallo sin `advertencias`.
		["un fallo sin advertencias", { estado: "fallo", motivo: "http_500" }],
		["un objeto vacío", {}],
		["creada pelada, sin correo ni advertencias", { estado: "creada" }],
		[
			"el correo desviado sin el bloque `correo`",
			{
				estado: "creada",
				advertencias: ["correo_redirigido_por_modo_no_prod"],
			},
		],
		[
			"advertencias que no son un arreglo",
			{ estado: "creada", advertencias: "correo_no_enviado" },
		],
		[
			"advertencias con cosas que no son cadenas",
			{ estado: "fallo", advertencias: [null, 7, {}, ["x"]] },
		],
		["un motivo que no es cadena", { estado: "fallo", motivo: 500 }],
		["un estado que no es cadena", { estado: 7 }],
		["un arreglo", []],
		["una cadena", "fallo"],
		["un número", 7],
	];

	it.each(formas)("%s", (_caso, entrada) => {
		for (const origen of ["alta", "boton"] as const) {
			const aviso = avisoAccesoPortal(entrada, origen);
			// Lo que se exige es que CONTESTE. Y que si contesta algo, no sea verde
			// sobre una forma que nadie pudo leer.
			if (aviso) {
				expect(typeof aviso.texto).toBe("string");
				expect(aviso.texto.length).toBeGreaterThan(0);
			}
		}
	});

	it("el fallo sin advertencias dice que no se pudo, en vez de tirar", () => {
		const aviso = avisoAccesoPortal(
			{ estado: "fallo", motivo: "http_500" },
			"boton",
		)!;
		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("No se le pudo dar acceso");
		// `http_*` sí tiene causa en palabras, y se sigue diciendo.
		expect(aviso.texto).toContain("el portal respondió con un error");
	});

	it("sin el bloque `correo`, el desvío nombra la bandeja genérica", () => {
		const aviso = avisoAccesoPortal({
			estado: "creada",
			advertencias: ["correo_redirigido_por_modo_no_prod"],
		})!;
		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("una sola bandeja de pruebas");
		expect(aviso.texto).not.toContain("undefined");
	});
});

/**
 * Las tablas se indexan con CADENAS DEL SERVIDOR.
 *
 * `advertencias` viaja verbatim desde auth-google, y por el camino de escritura
 * el `motivo` puede ser cualquier cadena (`String(error?.message ?? error)`,
 * portalProvisioning.ts). Un objeto literal contesta a `constructor`,
 * `toString`, `valueOf`… con algo truthy que viene de `Object.prototype`, y eso
 * termina interpolado en el aviso que lee una persona:
 * `function Object() { [native code] }`.
 */
describe("una clave del prototipo no pinta basura en el aviso", () => {
	const delPrototipo = [
		"constructor",
		"toString",
		"valueOf",
		"hasOwnProperty",
		"__proto__",
		"isPrototypeOf",
	];

	const basura = (texto: string) => {
		expect(texto).not.toContain("native code");
		expect(texto).not.toContain("function ");
		expect(texto).not.toContain("[object");
		expect(texto).not.toContain("undefined");
	};

	it.each(delPrototipo)(
		"el motivo `%s` no saca ni la causa ni el consejo del prototipo",
		(clave) => {
			for (const origen of ["alta", "boton"] as const) {
				const aviso = avisoAccesoPortal(
					acceso({ estado: "fallo", motivo: clave }),
					origen,
				)!;
				expect(aviso.tono).toBe("advertencia");
				basura(aviso.texto);
				// Y como no es un motivo conocido, el consejo genérico sigue ahí.
				expect(aviso.texto).toContain("No se le pudo dar acceso al portal");
			}
		},
	);

	it.each(delPrototipo)(
		"la advertencia `%s` no se traduce a nada",
		(clave) => {
			const aviso = avisoAccesoPortal(
				acceso({ estado: "creada", advertencias: [clave] }),
			);
			// Sin advertencias traducibles, `creada` vuelve a su verde de siempre.
			expect(aviso?.tono).toBe("exito");
			basura(aviso!.texto);
		},
	);

	it("un origen del prototipo cae en el del alta y no en una función", () => {
		const aviso = avisoAccesoPortal(
			acceso({ estado: "omitida", motivo: "sin_correo" }),
			"constructor" as unknown as "alta",
		)!;
		basura(aviso.texto);
		expect(aviso.texto).toContain("Dar acceso al portal");
	});
});

/**
 * El ayudante que cierra lo de arriba. Se prueba solo porque lo reusa la
 * pantalla del inversionista (`ESTADOS_ACCESO_PORTAL`,
 * `MOTIVOS_CUENTA_PORTAL_ROTA`, `ACTION_LABELS`), que no tiene arnés de
 * componentes: acá es donde esa garantía queda escrita.
 */
describe("valorDeTabla", () => {
	const tabla: Record<string, string> = { creada: "Cuenta creada" };

	it("devuelve lo que sí está escrito en la tabla", () => {
		expect(valorDeTabla(tabla, "creada")).toBe("Cuenta creada");
	});

	it("no devuelve nada de `Object.prototype`", () => {
		for (const clave of [
			"constructor",
			"toString",
			"valueOf",
			"hasOwnProperty",
			"__proto__",
			"isPrototypeOf",
			"propertyIsEnumerable",
		]) {
			expect(valorDeTabla(tabla, clave)).toBeUndefined();
		}
	});

	it("una clave que no es cadena tampoco encuentra nada", () => {
		expect(valorDeTabla(tabla, null)).toBeUndefined();
		expect(valorDeTabla(tabla, undefined)).toBeUndefined();
		expect(valorDeTabla(tabla, 0)).toBeUndefined();
		expect(valorDeTabla(tabla, {})).toBeUndefined();
	});
});

/**
 * LO QUE NO SE PUEDE PROBAR EJECUTANDO.
 *
 * La pantalla del inversionista es un `.tsx` de 2.700 líneas y este repo no
 * tiene arnés de componentes: no hay forma de montar el diálogo, navegar y
 * apretar el botón desde una prueba. Lo que sí se puede es fijar por escrito
 * las cuatro decisiones de las que depende que no salga una contraseña al
 * destinatario equivocado, para que volver a romperlas cueste un rojo y no una
 * revisión con suerte.
 *
 * Son pruebas de FUENTE, y se sabe: no prueban comportamiento, prueban que la
 * decisión sigue escrita. Lo mismo que hace `investor-documents.portalAccessStatus.test.ts`
 * con el guard de sus procedures.
 */
describe("la pantalla del inversionista no vuelve a los defectos de siempre", () => {
	const fuente = readFileSync(
		join(import.meta.dir, "../routes/inversiones/liquidaciones.$inversionistaId.tsx"),
		"utf8",
	);
	// Las afirmaciones EN NEGATIVO se hacen sobre el código sin comentarios: los
	// comentarios de ese archivo citan a propósito el código viejo para explicar
	// por qué se cambió, y contarlos como uso haría que la prueba fallara por la
	// explicación en vez de por el defecto.
	const codigo = fuente
		.split("\n")
		.filter((l) => {
			const t = l.trim();
			return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
		})
		.join("\n");

	it("el correo del diálogo NO sale de la fila cacheada", () => {
		// `getInversionistas` se sirve de la caché en proceso del servidor (TTL 5
		// minutos, sin un solo llamador de `invalidateCache`). El correo que se
		// aprueba sale de `identidadInversionista`, que va sin caché por las dos
		// puntas, y solo se acepta si la fila que volvió es ESTA.
		expect(fuente).toContain(
			"const accesoPortalEmail = (destinoFresco?.email ?? \"\").trim()",
		);
		expect(fuente).toContain(
			"identidadFresca.inversionista_id === investorIdNum",
		);
		expect(codigo).not.toContain(
			"const accesoPortalEmail = ((investor?.email ?? \"\") as string).trim()",
		);
	});

	/**
	 * El defecto que cierra este cambio: la mutación mandaba SOLO el id, y
	 * cartera releía la fila para saber a dónde mandar la contraseña. Entre lo
	 * que la persona aprobó y lo que se usó había una ventana del tamaño de lo
	 * que tarde en leer el diálogo, y quien puede mover ese correo
	 * (`editarInversionista`) no es quien lo aprueba (este botón).
	 */
	it("la mutación manda el correo que el diálogo ENSEÑÓ, no solo el id", () => {
		expect(fuente).toContain("correoAprobado: accesoPortalEmail,");
		// Y es la misma expresión que se pinta arriba, en el recuadro celeste:
		// si mañana el correo del diálogo sale de otra variable, esta prueba
		// deja de cubrir nada, así que se ancla también el render.
		expect(fuente).toContain('{accesoPortalEmail || "— sin correo capturado —"}');
		// Nunca de la fila cacheada ni de una relectura al momento del clic.
		expect(codigo).not.toContain("correoAprobado: investor?.email");
		expect(codigo).not.toContain("correoAprobado: accesoPortalPistaEmail");
	});

	/**
	 * Sobre una empresa el diálogo NO enseña ningún correo —la cuenta es del
	 * representante—, así que no hay nada aprobado que mandar. La llave AUSENTE
	 * es el único camino sin aprobación que el servidor acepta: `""` rebota con
	 * 400 (`z.string().trim().min(1)`).
	 */
	it("sobre una empresa la llave va ausente, nunca vacía", () => {
		const bloque = fuente.slice(
			fuente.indexOf("if (accesoPortalEsEmpresa) {\n\t\t\t\t\t\t\t\t\tdarAccesoPortalMutation.mutate({"),
		);
		// La rama de empresa manda el id pelado y corta.
		expect(bloque.slice(0, 300)).toContain("inversionistaId: investorIdNum,");
		expect(bloque.slice(0, 300)).not.toContain("correoAprobado");
		// Y sin correo confirmado no se dispara nada.
		expect(fuente).toContain("if (!accesoPortalEmail) return;");
		expect(codigo).not.toContain('correoAprobado: ""');
		expect(codigo).not.toContain("correoAprobado: accesoPortalEmail ?? null");
	});

	it("«es empresa» lo decide la consulta sin caché, no `dpi_rep_legal`", () => {
		expect(fuente).toContain('estadoAccesoPortal?.motivo === "es_empresa"');
		expect(codigo).not.toContain(
			"const accesoPortalEsEmpresa = esEmpresaInicial(",
		);
	});

	it("el diálogo se cierra al cambiar de inversionista", () => {
		// Sin esto el diálogo sobrevive al botón Atrás y se repinta con los datos
		// de OTRO inversionista, con el botón vivo y la revisión hecha sobre el
		// anterior.
		const efecto = fuente.slice(
			fuente.indexOf("useEffect(() => {\n\t\tsetAccesoPortalOpen(false);"),
		);
		expect(efecto.slice(0, 600)).toContain("}, [investorIdNum]);");
	});

	it("la consulta de estado no reintenta", () => {
		// Con `CARTERA_USER` mal configurado cartera contesta 403 siempre: los 3
		// reintentos por defecto son 4 llamadas por vista, y cada una renueva el
		// token de servicio que comparte todo el CRM.
		const bloque = fuente.slice(
			fuente.indexOf("const estadoAccesoPortalQuery = useQuery({"),
		);
		expect(bloque.slice(0, bloque.indexOf("\n\t});"))).toContain("retry: false");
	});

	it("la bitácora traduce el estado que escribe el servidor cuando cartera no contesta", () => {
		// `investor-documents.ts` escribe `estado: "sin_respuesta_de_cartera"` con
		// la advertencia `no_se_sabe_si_la_contrasena_salio`. Sin esta entrada esa
		// fila salía SIN insignia: indistinguible de una normal, siendo la única
		// que significa "puede que haya salido una contraseña y nadie sabe".
		expect(fuente).toContain("sin_respuesta_de_cartera:");
		expect(fuente).toContain("No se sabe si salió la contraseña");
		// Y lo desconocido tampoco se calla.
		expect(fuente).toContain("ESTADO_ACCESO_DESCONOCIDO");
		expect(codigo).not.toContain("ESTADOS_ACCESO_PORTAL[details.estado]");
	});

	it("ninguna tabla se indexa con la clave del servidor a pelo", () => {
		for (const tabla of [
			"MOTIVOS_CUENTA_PORTAL_ROTA[",
			"ESTADOS_ACCESO_PORTAL[",
			"ACTION_LABELS[",
			"ACTION_COLORS[",
			"ETIQUETAS_REINVERSION[",
		]) {
			// La única indexación permitida es la del TIPO
			// (`(typeof MOTIVOS_CUENTA_PORTAL_ROTA)[string]`), que no lee nada en
			// tiempo de ejecución.
			const usos = codigo
				.split("\n")
				.filter((l) => l.includes(tabla) && !l.includes("typeof "));
			expect(usos).toEqual([]);
		}
	});
});

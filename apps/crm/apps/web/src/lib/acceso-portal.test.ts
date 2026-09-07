import { describe, expect, it } from "bun:test";
import { avisoAccesoPortal, type AccesoPortal } from "./acceso-portal";

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
			acceso({ estado: "fallo", motivo: "timeout", advertencias: [] }),
		)!;

		expect(aviso.tono).toBe("advertencia");
		expect(aviso.texto).toContain("sí quedó creado");
		expect(aviso.texto).toContain("Dar acceso al portal");
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
      acceso({ estado: "fallo", motivo: "timeout", advertencias: [] }),
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
   * El botón "Dar acceso al portal" NO existe en el CRM: vive solo en
   * carteraFront (tableInvestors.tsx:1583), y la ruta está cerrada a ADMIN de
   * cartera a propósito (otorgarAccesoPortal.ts:50-53). En el CRM ni siquiera
   * hay menú por fila donde buscarlo.
   *
   * Sin esta prueba el texto vuelve a mandar a conta a apretar un botón que en
   * su aplicación no existe: se pone a buscarlo, no lo encuentra, y el
   * inversionista queda sin portal — el mismo fallo silencioso que este PR vino
   * a cerrar, movido de "nadie avisa" a "se avisa y no se puede ejecutar".
   *
   * NO copiar esta prueba al gemelo de carteraFront: ahí el botón SÍ está en la
   * misma pantalla y mandar a pedírselo a otro sería falso.
   */
  it.each([
    ["fallo", "timeout"],
    ["omitida", "sin_correo"],
    ["omitida", "sin_nombre"],
    ["omitida", "no_solicitado"],
  ])("desde el CRM el aviso (%s/%s) manda a pedírselo a cartera, no a apretar un botón que aquí no existe", (estado, motivo) => {
    const aviso = avisoAccesoPortal(
      acceso({ estado, motivo, advertencias: [] }),
    )!;

    expect(aviso.texto).toContain("cartera");
  });
});

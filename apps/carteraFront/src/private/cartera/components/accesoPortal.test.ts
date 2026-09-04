import { describe, expect, it } from "bun:test";
import { avisoAccesoPortal, type AccesoPortal } from "./accesoPortal";

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
    expect(aviso.texto).toContain("7:00");
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

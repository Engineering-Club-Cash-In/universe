import { describe, expect, it } from "bun:test";
import { resumirProvisionamiento } from "./resumenProvisionamiento";

const r = (over: any = {}) => ({
  inversionistaId: 1,
  estado: "ya_tenia",
  usuarioEmail: "a@b.com",
  resueltoPor: "dpi",
  correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
  advertencias: [],
  motivo: null,
  ...over,
});

const nombres = new Map<number, string>([
  [1, "Ana Pérez"],
  [140, "PLT LOPEZ SANCHEZ, SOCIEDAD ANONIMA"],
  [43, "Joel Escobedo"],
]);

describe("resumirProvisionamiento", () => {
  it("calla cuando no hay nada que hacer", () => {
    const res = resumirProvisionamiento([r(), r({ inversionistaId: 2 })], nombres);
    expect(res.hayQueReportar).toBe(false);
    expect(res.yaTenian).toBe(2);
  });

  it("reporta las cuentas creadas", () => {
    const res = resumirProvisionamiento(
      [r({ estado: "creada", correo: { enviado: true, plantilla: "bienvenida", redirigido: false, destinatarioReal: null } })],
      nombres,
    );
    expect(res.hayQueReportar).toBe(true);
    expect(res.creadas).toHaveLength(1);
    expect(res.creadas[0]).toMatchObject({ inversionistaId: 1, nombre: "Ana Pérez" });
  });

  it("reporta los fallos con su motivo", () => {
    const res = resumirProvisionamiento([r({ estado: "fallo", motivo: "timeout" })], nombres);
    expect(res.hayQueReportar).toBe(true);
    expect(res.fallos[0]).toMatchObject({ inversionistaId: 1, motivo: "timeout" });
  });

  it("delata el modo DEV: la contraseña se fue a una sola bandeja", () => {
    const res = resumirProvisionamiento(
      [r({
        estado: "creada",
        correo: { enviado: true, plantilla: "bienvenida", redirigido: true, destinatarioReal: "jalvarado@clubcashin.com" },
        advertencias: ["correo_redirigido_por_modo_no_prod"],
      })],
      nombres,
    );
    expect(res.hayQueReportar).toBe(true);
    expect(res.correosRedirigidos).toHaveLength(1);
  });

  it("marca como dudosa la sociedad que recibió cuenta PROPIA", () => {
    // PLT LOPEZ SANCHEZ (140) es sociedad por el nombre pero no tiene
    // dpi_rep_legal capturado, así que la regla le da cuenta propia. No se
    // corrige por heurística: se reporta para que alguien capture el
    // representante que falta.
    const res = resumirProvisionamiento([r({ inversionistaId: 140, estado: "creada" })], nombres);
    expect(res.dudosas.map((d: any) => d.inversionistaId)).toEqual([140]);
  });

  it("NO marca como dudosa a la sociedad que solo ya tenía cuenta", () => {
    // Las once sociedades que ya tienen cuenta hoy son el estado normal del
    // sistema. Reportarlas cada día sería ruido, no trabajo.
    const res = resumirProvisionamiento([r({ inversionistaId: 140, estado: "ya_tenia" })], nombres);
    expect(res.dudosas).toEqual([]);
    expect(res.hayQueReportar).toBe(false);
  });

  it("lista a los sin correo pero NO manda el correo solo por ellos", () => {
    // Son 6 filas crónicas. Si dispararan el resumen, llegaría un correo
    // idéntico todos los días para siempre y nadie lo volvería a leer. Se
    // listan cuando el resumen sale por otra razón; nunca se ocultan.
    const soloCronicos = resumirProvisionamiento(
      [r({ inversionistaId: 43, estado: "omitida", motivo: "sin_correo" })],
      nombres,
    );
    expect(soloCronicos.sinCorreo).toHaveLength(1);
    expect(soloCronicos.hayQueReportar).toBe(false);

    const conAlgoMas = resumirProvisionamiento(
      [
        r({ inversionistaId: 43, estado: "omitida", motivo: "sin_correo" }),
        r({ estado: "creada" }),
      ],
      nombres,
    );
    expect(conAlgoMas.hayQueReportar).toBe(true);
    expect(conAlgoMas.sinCorreo).toHaveLength(1);
  });

  it("reporta cuando el correo de cartera no es el de la cuenta", () => {
    const res = resumirProvisionamiento(
      [r({ advertencias: ["correo_de_cartera_distinto_al_de_la_cuenta"] })],
      nombres,
    );
    expect(res.hayQueReportar).toBe(true);
    expect(res.correoDistinto).toHaveLength(1);
  });

  it("cuenta las empresas aparte: su aviso solo sale en el alta", () => {
    const res = resumirProvisionamiento([r({ estado: "omitida", motivo: "es_empresa" })], nombres);
    expect(res.empresas).toBe(1);
    expect(res.hayQueReportar).toBe(false);
  });
});

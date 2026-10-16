import { describe, expect, it } from "bun:test";
import { EMISORES, emisorPorClave, emisorPorNit, emisoresParaSelector } from "./emisores";
import {
  AMJK_CONFIG,
  AMJK_SAT_CONFIG,
  AUTOCASH_CONFIG,
  AUTOCASH_SAT_CONFIG,
  CLUB_CASHIN_CONFIG,
  CREACION_IMAGEN_CONFIG,
  CREACION_IMAGEN_SAT_CONFIG,
  GRUPO_BATRO_CONFIG,
  GRUPO_BATRO_SAT_CONFIG,
  SAT_CONFIG,
  SE_PRESTA_CONFIG,
  SE_PRESTA_SAT_CONFIG,
  INVERSIONISTAS_FACTURADORES,
} from "../utils/functions/const";
import { leyendaISREmisor } from "./functions";

describe("EMISORES registro", () => {
  it("contiene las 6 empresas en el orden exacto", () => {
    const claves = EMISORES.map((e) => e.clave);
    expect(claves).toEqual([
      "CUBE",
      "SE_PRESTA",
      "AMJK",
      "CREACION_IMAGEN",
      "GRUPO_BATRO",
      "AUTOCASH",
    ]);
  });

  it("CUBE apunta a CLUB_CASHIN_CONFIG y SAT_CONFIG (identidad)", () => {
    const cube = EMISORES[0];
    expect(cube.config).toBe(CLUB_CASHIN_CONFIG);
    expect(cube.satConfig).toBe(SAT_CONFIG);
  });

  it("SE_PRESTA apunta a SE_PRESTA_CONFIG y SE_PRESTA_SAT_CONFIG (identidad)", () => {
    const sePresta = EMISORES[1];
    expect(sePresta.config).toBe(SE_PRESTA_CONFIG);
    expect(sePresta.satConfig).toBe(SE_PRESTA_SAT_CONFIG);
  });

  it("AMJK apunta a AMJK_CONFIG y AMJK_SAT_CONFIG (identidad)", () => {
    const amjk = EMISORES[2];
    expect(amjk.config).toBe(AMJK_CONFIG);
    expect(amjk.satConfig).toBe(AMJK_SAT_CONFIG);
  });

  it("CREACION_IMAGEN apunta a CREACION_IMAGEN_CONFIG y CREACION_IMAGEN_SAT_CONFIG (identidad)", () => {
    const ci = EMISORES[3];
    expect(ci.config).toBe(CREACION_IMAGEN_CONFIG);
    expect(ci.satConfig).toBe(CREACION_IMAGEN_SAT_CONFIG);
  });

  it("GRUPO_BATRO apunta a GRUPO_BATRO_CONFIG y GRUPO_BATRO_SAT_CONFIG (identidad)", () => {
    const gb = EMISORES[4];
    expect(gb.config).toBe(GRUPO_BATRO_CONFIG);
    expect(gb.satConfig).toBe(GRUPO_BATRO_SAT_CONFIG);
  });

  it("AUTOCASH apunta a AUTOCASH_CONFIG y AUTOCASH_SAT_CONFIG (identidad)", () => {
    const ac = EMISORES[5];
    expect(ac.config).toBe(AUTOCASH_CONFIG);
    expect(ac.satConfig).toBe(AUTOCASH_SAT_CONFIG);
  });
});

describe("emisorPorNit", () => {
  it("devuelve CUBE para NIT 98766430", () => {
    const emisor = emisorPorNit("98766430");
    expect(emisor?.clave).toBe("CUBE");
  });

  it("devuelve SE_PRESTA para NIT 52956032", () => {
    const emisor = emisorPorNit("52956032");
    expect(emisor?.clave).toBe("SE_PRESTA");
  });

  it("devuelve AMJK para NIT 100691455", () => {
    const emisor = emisorPorNit("100691455");
    expect(emisor?.clave).toBe("AMJK");
  });

  it("devuelve CREACION_IMAGEN para NIT 2694247K", () => {
    const emisor = emisorPorNit("2694247K");
    expect(emisor?.clave).toBe("CREACION_IMAGEN");
  });

  it("devuelve GRUPO_BATRO para NIT 54603064", () => {
    const emisor = emisorPorNit("54603064");
    expect(emisor?.clave).toBe("GRUPO_BATRO");
  });

  it("devuelve AUTOCASH para NIT 96896035", () => {
    const emisor = emisorPorNit("96896035");
    expect(emisor?.clave).toBe("AUTOCASH");
  });

  it("devuelve undefined para NIT no registrado", () => {
    expect(emisorPorNit("123")).toBeUndefined();
  });

  it("devuelve undefined para cadena vacía", () => {
    expect(emisorPorNit("")).toBeUndefined();
  });

  it("devuelve undefined para null", () => {
    expect(emisorPorNit(null)).toBeUndefined();
  });

  it("devuelve undefined para undefined", () => {
    expect(emisorPorNit(undefined)).toBeUndefined();
  });
});

describe("emisorPorClave", () => {
  it('emisorPorClave("AMJK") devuelve la entrada AMJK con nombre AMJK', () => {
    const emisor = emisorPorClave("AMJK");
    expect(emisor?.clave).toBe("AMJK");
    expect(emisor?.nombre).toBe("AMJK");
  });

  it('emisorPorClave("NO_EXISTE") devuelve undefined', () => {
    expect(emisorPorClave("NO_EXISTE")).toBeUndefined();
  });

  it('emisorPorClave("CUBE") devuelve la entrada CUBE', () => {
    const emisor = emisorPorClave("CUBE");
    expect(emisor?.clave).toBe("CUBE");
  });
});

describe("emisoresParaSelector", () => {
  it("devuelve exactamente [CUBE, Se Presta, AMJK, Creación Imagen, Grupo Batro, AutoCash]", () => {
    const resultado = emisoresParaSelector();
    expect(resultado).toEqual([
      { clave: "CUBE", nombre: "CUBE" },
      { clave: "SE_PRESTA", nombre: "Se Presta" },
      { clave: "AMJK", nombre: "AMJK" },
      { clave: "CREACION_IMAGEN", nombre: "Creación Imagen" },
      { clave: "GRUPO_BATRO", nombre: "Grupo Batro" },
      { clave: "AUTOCASH", nombre: "AutoCash" },
    ]);
  });
});

describe("INVERSIONISTAS_FACTURADORES", () => {
  it("todas las configs están en EMISORES (identidad)", () => {
    for (const inversionista of INVERSIONISTAS_FACTURADORES) {
      const found = EMISORES.find((e) => e.config === inversionista.config);
      expect(found).toBeDefined();
      expect(found!.config).toBe(inversionista.config);
      expect(found!.satConfig).toBe(inversionista.satConfig);
    }
  });
});

describe("leyendaISREmisor", () => {
  it("para el NIT de AMJK devuelve texto con numeroResolucion", () => {
    const nit = AMJK_CONFIG.emisor.nit;
    const leyenda = leyendaISREmisor(nit);
    expect(leyenda).toContain("Sujeto a pago directo ISR");
    expect(leyenda).toContain("6155219202612561719");
  });

  it('para NIT "000" devuelve lo mismo que para CUBE NIT', () => {
    const nit000 = leyendaISREmisor("000");
    const nitCube = leyendaISREmisor(CLUB_CASHIN_CONFIG.emisor.nit);
    expect(nit000).toBe(nitCube);
  });
});

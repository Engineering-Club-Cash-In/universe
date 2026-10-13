import { describe, expect, it } from "bun:test";
import { EMISORES, emisorPorClave, emisorPorNit, emisoresParaSelector, complementosFacturaGenerica, emisorTieneCredenciales, logoUrlEmisor } from "./emisores";
import {
  AMJK_CONFIG,
  AMJK_SAT_CONFIG,
  AUTOCASH_CONFIG,
  AUTOCASH_SAT_CONFIG,
  CHECKIN_CONFIG,
  CHECKIN_SAT_CONFIG,
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
  it("contiene las 6 + CHECKIN empresas en el orden exacto", () => {
    const claves = EMISORES.map((e) => e.clave);
    expect(claves).toEqual([
      "CUBE",
      "SE_PRESTA",
      "AMJK",
      "CREACION_IMAGEN",
      "GRUPO_BATRO",
      "AUTOCASH",
      "CHECKIN",
    ]);
  });

  it("CUBE apunta a CLUB_CASHIN_CONFIG y SAT_CONFIG (identidad)", () => {
    const cube = EMISORES[0];
    expect(cube.config).toBe(CLUB_CASHIN_CONFIG);
    expect(cube.satConfig).toBe(SAT_CONFIG);
    expect(cube.bienOServicio).toBe("B");
  });

  it("SE_PRESTA apunta a SE_PRESTA_CONFIG y SE_PRESTA_SAT_CONFIG (identidad)", () => {
    const sePresta = EMISORES[1];
    expect(sePresta.config).toBe(SE_PRESTA_CONFIG);
    expect(sePresta.satConfig).toBe(SE_PRESTA_SAT_CONFIG);
    expect(sePresta.bienOServicio).toBe("B");
  });

  it("AMJK apunta a AMJK_CONFIG y AMJK_SAT_CONFIG (identidad)", () => {
    const amjk = EMISORES[2];
    expect(amjk.config).toBe(AMJK_CONFIG);
    expect(amjk.satConfig).toBe(AMJK_SAT_CONFIG);
    expect(amjk.bienOServicio).toBe("B");
  });

  it("CREACION_IMAGEN apunta a CREACION_IMAGEN_CONFIG y CREACION_IMAGEN_SAT_CONFIG (identidad)", () => {
    const ci = EMISORES[3];
    expect(ci.config).toBe(CREACION_IMAGEN_CONFIG);
    expect(ci.satConfig).toBe(CREACION_IMAGEN_SAT_CONFIG);
    expect(ci.bienOServicio).toBe("B");
  });

  it("GRUPO_BATRO apunta a GRUPO_BATRO_CONFIG y GRUPO_BATRO_SAT_CONFIG (identidad)", () => {
    const gb = EMISORES[4];
    expect(gb.config).toBe(GRUPO_BATRO_CONFIG);
    expect(gb.satConfig).toBe(GRUPO_BATRO_SAT_CONFIG);
    expect(gb.bienOServicio).toBe("B");
  });

  it("AUTOCASH apunta a AUTOCASH_CONFIG y AUTOCASH_SAT_CONFIG (identidad)", () => {
    const ac = EMISORES[5];
    expect(ac.config).toBe(AUTOCASH_CONFIG);
    expect(ac.satConfig).toBe(AUTOCASH_SAT_CONFIG);
    expect(ac.bienOServicio).toBe("B");
  });

  it("CHECKIN apunta a CHECKIN_CONFIG y CHECKIN_SAT_CONFIG con bienOServicio S", () => {
    const checkin = EMISORES[6];
    expect(checkin.clave).toBe("CHECKIN");
    expect(checkin.nombre).toBe("Checkin (MotorLab)");
    expect(checkin.config).toBe(CHECKIN_CONFIG);
    expect(checkin.satConfig).toBe(CHECKIN_SAT_CONFIG);
    expect(checkin.bienOServicio).toBe("S");
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

  it("devuelve CHECKIN para NIT 120310546", () => {
    const emisor = emisorPorNit("120310546");
    expect(emisor?.clave).toBe("CHECKIN");
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
  it("devuelve las 6 + CHECKIN en el orden exacto", () => {
    const resultado = emisoresParaSelector();
    expect(resultado).toEqual([
      { clave: "CUBE", nombre: "CUBE" },
      { clave: "SE_PRESTA", nombre: "Se Presta" },
      { clave: "AMJK", nombre: "AMJK" },
      { clave: "CREACION_IMAGEN", nombre: "Creación Imagen" },
      { clave: "GRUPO_BATRO", nombre: "Grupo Batro" },
      { clave: "AUTOCASH", nombre: "AutoCash" },
      { clave: "CHECKIN", nombre: "Checkin (MotorLab)" },
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

  it("CHECKIN NO está en INVERSIONISTAS_FACTURADORES (solo factura por /facturar-generico)", () => {
    const checkinNit = CHECKIN_CONFIG.emisor.nit;
    const checkinEntry = INVERSIONISTAS_FACTURADORES.find(
      (inv) => inv.config.emisor.nit === checkinNit
    );
    expect(checkinEntry).toBeUndefined();
  });
});

describe("leyendaISREmisor", () => {
  it("para el NIT de AMJK devuelve texto con numeroResolucion", () => {
    const nit = AMJK_CONFIG.emisor.nit;
    const leyenda = leyendaISREmisor(nit);
    expect(leyenda).toContain("Sujeto a pago directo ISR");
    expect(leyenda).toContain("6155219202612561719");
  });

  it("para el NIT de CHECKIN devuelve texto con numeroResolucion CHECKIN", () => {
    const nit = CHECKIN_CONFIG.emisor.nit;
    const leyenda = leyendaISREmisor(nit);
    expect(leyenda).toContain("4846128202615264321");
    expect(leyenda).toContain("12/08/2026");
  });

  it('para NIT "000" devuelve lo mismo que para CUBE NIT', () => {
    const nit000 = leyendaISREmisor("000");
    const nitCube = leyendaISREmisor(CLUB_CASHIN_CONFIG.emisor.nit);
    expect(nit000).toBe(nitCube);
  });
});

describe("complementosFacturaGenerica", () => {
  it("para FCAM devuelve un complemento cambiario con 1 abono", () => {
    const resultado = complementosFacturaGenerica("FCAM", 112, "2026-10-12");
    expect(resultado).toEqual([
      {
        tipo: "cambiario",
        abonos: [
          {
            numeroAbono: 1,
            fechaVencimiento: "2026-10-12",
            montoAbono: 112,
          },
        ],
      },
    ]);
  });

  it("para FACT devuelve un array vacío (CHECKIN no lleva complemento)", () => {
    const resultado = complementosFacturaGenerica("FACT", 112, "2026-10-12");
    expect(resultado).toEqual([]);
  });
});

describe("emisorTieneCredenciales", () => {
  it("devuelve true si requestor y endpointUrl están presentes", () => {
    const testEmisor: any = {
      clave: "TEST",
      config: {},
      satConfig: { requestor: "req", endpointUrl: "https://test.com" },
      bienOServicio: "B",
    };
    expect(emisorTieneCredenciales(testEmisor)).toBe(true);
  });

  it("devuelve false si requestor es vacío", () => {
    const testEmisor: any = {
      clave: "TEST",
      config: {},
      satConfig: { requestor: "", endpointUrl: "https://test.com" },
      bienOServicio: "B",
    };
    expect(emisorTieneCredenciales(testEmisor)).toBe(false);
  });

  it("devuelve false si endpointUrl es vacío", () => {
    const testEmisor: any = {
      clave: "TEST",
      config: {},
      satConfig: { requestor: "req", endpointUrl: "" },
      bienOServicio: "B",
    };
    expect(emisorTieneCredenciales(testEmisor)).toBe(false);
  });

  it("devuelve false si ambos están vacíos", () => {
    const testEmisor: any = {
      clave: "TEST",
      config: {},
      satConfig: { requestor: "", endpointUrl: "" },
      bienOServicio: "B",
    };
    expect(emisorTieneCredenciales(testEmisor)).toBe(false);
  });
});

describe("logoUrlEmisor", () => {
  it("devuelve el logo propio de CHECKIN si la env está puesta", () => {
    const resultado = logoUrlEmisor("120310546", "def", { CHECKIN_LOGO_URL: "https://x/motorlab.png" });
    expect(resultado).toBe("https://x/motorlab.png");
  });

  it("devuelve el default si CHECKIN no tiene la env puesta", () => {
    const resultado = logoUrlEmisor("120310546", "def", {});
    expect(resultado).toBe("def");
  });

  it("devuelve el default si CHECKIN tiene la env pero vacía", () => {
    const resultado = logoUrlEmisor("120310546", "def", { CHECKIN_LOGO_URL: "" });
    expect(resultado).toBe("def");
  });

  it("devuelve el default para emisores que NO tienen logoEnv", () => {
    const resultado = logoUrlEmisor("100691455", "def", { CHECKIN_LOGO_URL: "https://x/motorlab.png" });
    expect(resultado).toBe("def");
  });

  it("devuelve el default para NIT undefined", () => {
    const resultado = logoUrlEmisor(undefined, "def", { CHECKIN_LOGO_URL: "https://x/motorlab.png" });
    expect(resultado).toBe("def");
  });

  it("devuelve el default para NIT null", () => {
    const resultado = logoUrlEmisor(null, "def", { CHECKIN_LOGO_URL: "https://x/motorlab.png" });
    expect(resultado).toBe("def");
  });

  it("devuelve el default para NIT no registrado", () => {
    const resultado = logoUrlEmisor("999", "def", { CHECKIN_LOGO_URL: "https://x/motorlab.png" });
    expect(resultado).toBe("def");
  });

  it("las 6 de siempre tienen logoEnv === null", () => {
    const nits = ["98766430", "52956032", "100691455", "2694247K", "54603064", "96896035"];
    for (const nit of nits) {
      const emisor = emisorPorNit(nit);
      expect(emisor?.logoEnv).toBe(null);
    }
  });

  it("CHECKIN tiene logoEnv === 'CHECKIN_LOGO_URL'", () => {
    const checkin = emisorPorNit("120310546");
    expect(checkin?.logoEnv).toBe("CHECKIN_LOGO_URL");
  });
});

import { describe, expect, it } from "bun:test";
import { destinatarioDeLiquidacion } from "./destinatarioLiquidacion";

describe("destinatarioDeLiquidacion", () => {
  it("una sociedad cuyo representante tiene correo se liquida al buzón del representante", () => {
    // El caso que motiva el cambio: Richard Kachler representa 4 sociedades
    // repartidas en 3 buzones. Los 4 correos tienen que caer en el suyo.
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "contabilidad@cube.com" },
      { nombre: "Richard Kachler", email: "richard@ejemplo.com" },
    );

    expect(destino.email).toBe("richard@ejemplo.com");
    expect(destino.via).toBe("representante");
    expect(destino.nombreRepresentante).toBe("Richard Kachler");
  });

  it("si el representante no tiene correo cae al de la fila, como hoy", () => {
    // INVERSIONES DELFINA (34): Ana Lucrecia López Porres no tiene correo en
    // cartera. Perder el correo de liquidación es peor que mandarlo al buzón
    // de siempre.
    const destino = destinatarioDeLiquidacion(
      { nombre: "INVERSIONES DELFINA", email: "delfina@ejemplo.com" },
      { nombre: "Ana Lucrecia López Porres", email: null },
    );

    expect(destino.email).toBe("delfina@ejemplo.com");
    expect(destino.via).toBe("fila");
    expect(destino.nombreRepresentante).toBeNull();
  });

  it("si el representante no aparece en cartera cae al de la fila", () => {
    const destino = destinatarioDeLiquidacion(
      { nombre: "SOCIEDAD SIN REP EN CARTERA", email: "socia@ejemplo.com" },
      null,
    );

    expect(destino.email).toBe("socia@ejemplo.com");
    expect(destino.via).toBe("fila");
  });

  it("una persona sin representante se liquida a su propio correo", () => {
    const destino = destinatarioDeLiquidacion(
      { nombre: "Ana Pérez", email: "ana@ejemplo.com" },
      null,
    );

    expect(destino.email).toBe("ana@ejemplo.com");
    expect(destino.via).toBe("fila");
    expect(destino.nombreRepresentante).toBeNull();
  });

  it("el que se representa a sí mismo se manda a sí mismo, y eso está bien", () => {
    // Inversionista 187 (Javier Camilo Kafie): dpi=4036613 y
    // dpi_rep_legal='04036613'. El resolutor normaliza los ceros, así que
    // devuelve su propia fila; el correo termina en el mismo buzón de siempre.
    const destino = destinatarioDeLiquidacion(
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com" },
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com" },
    );

    expect(destino.email).toBe("javier@ejemplo.com");
    expect(destino.via).toBe("representante");
  });

  it("una fila sin correo y sin representante utilizable queda sin destinatario", () => {
    const destino = destinatarioDeLiquidacion(
      { nombre: "SIN CORREO", email: "   " },
      { nombre: "Rep sin correo", email: null },
    );

    expect(destino.email).toBeNull();
    expect(destino.via).toBe("fila");
  });

  // ── Hallazgo de Codex: la política de fallo no se cumplía con un correo
  // malformado. `sendLiquidationEmail` valida con `emailSchema.parse(to)` y
  // TIRA; el llamador (investor.ts) solo registra ese error, no reintenta con
  // el correo de la entidad. Elegir un correo inválido no degrada el envío:
  // lo PIERDE. La política declarada es caer al comportamiento de hoy.
  const correosInvalidosDelRepresentante = [
    ["con un espacio en medio", "richard ejemplo@correo.com"],
    ["sin arroba", "richard.ejemplo.com"],
    ["con dos arrobas", "richard@ejemplo@correo.com"],
    ["sin dominio", "richard@"],
    ["sin punto en el dominio", "richard@correo"],
    ["que es solo una arroba", "@"],
  ] as const;

  for (const [caso, correo] of correosInvalidosDelRepresentante) {
    it(`un correo de representante ${caso} no se elige: cae al de la fila`, () => {
      const destino = destinatarioDeLiquidacion(
        { nombre: "CUBE, S.A.", email: "contabilidad@cube.com" },
        { nombre: "Richard Kachler", email: correo },
      );

      expect(destino.email).toBe("contabilidad@cube.com");
      expect(destino.via).toBe("fila");
      expect(destino.nombreRepresentante).toBeNull();
      expect(destino.motivo).toBe("representante_con_correo_invalido");
    });
  }

  it("un correo de representante inválido no arrastra al de la fila", () => {
    // La fila conserva su correo tal cual: la validación nueva decide a QUIÉN
    // se elige, no reescribe el camino de siempre.
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "  contabilidad@cube.com " },
      { nombre: "Richard Kachler", email: "richard@@ejemplo.com" },
    );

    expect(destino.email).toBe("contabilidad@cube.com");
    expect(destino.via).toBe("fila");
  });

  it("recorta los espacios del correo de la fila antes de mandarlo", () => {
    // `emailSchema.parse` en @cci/email tira si el correo trae espacios, y esa
    // excepción aborta el envío de esa iteración.
    const destino = destinatarioDeLiquidacion(
      { nombre: "Ana Pérez", email: "  ana@ejemplo.com " },
      null,
    );

    expect(destino.email).toBe("ana@ejemplo.com");
  });
});

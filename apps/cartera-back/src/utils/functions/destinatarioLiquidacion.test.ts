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
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: 4036613 },
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: "04036613" },
    );

    expect(destino.email).toBe("javier@ejemplo.com");
    expect(destino.via).toBe("representante");
  });

  it("el que se representa a sí mismo conserva el TEXTO personal del correo", () => {
    // Hallazgo de Codex: el destino ya estaba bien —su propio buzón— pero el
    // texto no. `nombreRepresentante` es lo que hace que la plantilla
    // (packages/email/src/templates/LiquidationTemplate.tsx:99) cambie al
    // cuerpo de empresa y le diga a Kafie que la liquidación es de "una entidad
    // que usted representa". La entidad es él.
    const destino = destinatarioDeLiquidacion(
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: 4036613 },
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: "04036613" },
    );

    expect(destino.nombreRepresentante).toBeNull();
    expect(destino.motivo).toBe("autorrepresentado");
  });

  it("la autorrepresentación se detecta con la misma normalización de DPI que el resto", () => {
    // Ceros a la izquierda y espacios: `dpi` es bigint (nunca los trae) y
    // `dpi_rep_legal` es varchar (sí). Si la comparación fuera literal, Kafie
    // volvería a caer en el texto de empresa por un cero.
    for (const [dpiFila, dpiRepresentante] of [
      [4036613, "04036613"],
      ["4036613", "  04036613 "],
      ["04036613", "4036613"],
    ] as const) {
      const destino = destinatarioDeLiquidacion(
        { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: dpiFila },
        { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: dpiRepresentante },
      );

      expect(destino.nombreRepresentante).toBeNull();
    }
  });

  it("una sociedad de verdad sigue llevando el nombre del representante en el cuerpo", () => {
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "contabilidad@cube.com", dpi: 999 },
      { nombre: "Richard Kachler", email: "richard@ejemplo.com", dpi: "1573661970101" },
    );

    expect(destino.nombreRepresentante).toBe("Richard Kachler");
    expect(destino.motivo).toBe("representante_con_correo");
  });

  it("dos DPI ausentes no son el mismo DPI: no es autorrepresentación", () => {
    // Si la fila no tiene `dpi` capturado, `null === null` NO puede leerse como
    // "es él mismo": sería quitarle el saludo al representante de verdad.
    const destino = destinatarioDeLiquidacion(
      { nombre: "SOCIEDAD SIN DPI", email: "socia@ejemplo.com", dpi: null },
      { nombre: "Rep Legal", email: "rep@ejemplo.com", dpi: null },
    );

    expect(destino.nombreRepresentante).toBe("Rep Legal");
    expect(destino.motivo).toBe("representante_con_correo");
  });

  it("la sociedad conserva su copia: su buzón va en cc", () => {
    // El buzón de la sociedad lo lee su contador o su asistente, y hoy recibe
    // la liquidación. Desviarla al representante sin copia se la quita en
    // silencio a alguien que ni se entera.
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "  Contabilidad@Cube.com " },
      { nombre: "Richard Kachler", email: "richard@ejemplo.com" },
    );

    expect(destino.email).toBe("richard@ejemplo.com");
    expect(destino.emailCopia).toBe("Contabilidad@Cube.com");
  });

  it("no se manda copia a sí mismo cuando el buzón es el mismo", () => {
    // Da igual la caja: `inversionistas.email` no está normalizado y
    // `buscarRepresentanteEnCartera` sí baja el suyo a minúsculas.
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "Richard@Ejemplo.com" },
      { nombre: "Richard Kachler", email: "richard@ejemplo.com" },
    );

    expect(destino.email).toBe("richard@ejemplo.com");
    expect(destino.emailCopia).toBeNull();
  });

  it("el autorrepresentado no se copia a sí mismo", () => {
    const destino = destinatarioDeLiquidacion(
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: 4036613 },
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: "04036613" },
    );

    expect(destino.emailCopia).toBeNull();
  });

  it("un correo de fila malformado NO se manda en copia", () => {
    // Una copia inválida haría que Resend rechace el envío ENTERO: la mejora
    // del representante se pagaría perdiendo el correo. La copia es un extra y
    // se comporta como tal.
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "contabilidad cube.com" },
      { nombre: "Richard Kachler", email: "richard@ejemplo.com" },
    );

    expect(destino.email).toBe("richard@ejemplo.com");
    expect(destino.emailCopia).toBeNull();
  });

  it("cuando el correo sale por la fila no hay copia que mandar", () => {
    const destino = destinatarioDeLiquidacion(
      { nombre: "Ana Pérez", email: "ana@ejemplo.com" },
      null,
    );

    expect(destino.emailCopia).toBeNull();
  });

  it("un representante sin nombre no se lleva el correo: cae al de la fila", () => {
    // Lo peor de los dos mundos era mandarlo al buzón del representante y
    // dirigir el cuerpo a la entidad. Sin nombre no hay a quién saludar, y un
    // saludo genérico a un buzón desviado es un cambio de identidad silencioso:
    // mejor el buzón de siempre, que es la política de fallo de esta rama.
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "contabilidad@cube.com" },
      { nombre: null, email: "rep@ejemplo.com" },
    );

    expect(destino.email).toBe("contabilidad@cube.com");
    expect(destino.via).toBe("fila");
    expect(destino.nombreRepresentante).toBeNull();
    expect(destino.motivo).toBe("representante_sin_nombre");
  });

  it("un nombre de representante que es solo espacios tampoco cuenta", () => {
    const destino = destinatarioDeLiquidacion(
      { nombre: "CUBE, S.A.", email: "contabilidad@cube.com" },
      { nombre: "   ", email: "rep@ejemplo.com" },
    );

    expect(destino.via).toBe("fila");
    expect(destino.motivo).toBe("representante_sin_nombre");
  });

  it("al autorrepresentado no le hace falta nombre: el saludo no lo usa", () => {
    // El id 187 va sin `nombreRepresentante` por definición, así que la falta
    // de nombre no genera ninguna incoherencia y no hay por qué desviarlo del
    // buzón que ya era el suyo.
    const destino = destinatarioDeLiquidacion(
      { nombre: "Javier Camilo Kafie", email: "javier@ejemplo.com", dpi: 4036613 },
      { nombre: null, email: "javier@ejemplo.com", dpi: "04036613" },
    );

    expect(destino.email).toBe("javier@ejemplo.com");
    expect(destino.via).toBe("representante");
    expect(destino.motivo).toBe("autorrepresentado");
    expect(destino.nombreRepresentante).toBeNull();
  });

  it("una fila sin correo propio SÍ se envía si el representante tiene buzón", () => {
    // AUMENTO DE VOLUMEN DELIBERADO, fijado acá para que no se cuele sin
    // querer. El guard de envío era `if (inversionista.email && excelBuffer)`:
    // una sociedad sin correo capturado no le llegaba a NADIE. Ahora sale por
    // el buzón del representante. Es la mejora, no un efecto colateral: esa
    // liquidación antes se perdía en silencio.
    const destino = destinatarioDeLiquidacion(
      { nombre: "SOCIEDAD SIN CORREO", email: null },
      { nombre: "Rep Legal", email: "rep@ejemplo.com" },
    );

    expect(destino.email).toBe("rep@ejemplo.com");
    expect(destino.via).toBe("representante");
    expect(destino.motivo).toBe("representante_con_correo");
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

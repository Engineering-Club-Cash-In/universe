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
});

/**
 * El botón "Dar acceso al portal" apretado sobre una fila de EMPRESA.
 *
 * El acceso no es de la empresa: es de su representante legal, y la
 * contraseña aterriza en el buzón de ÉL. El diálogo de confirmación enseña el
 * correo de la EMPRESA —que es el único control que tiene todo este botón: un
 * humano mirando a dónde va a caer una contraseña—, así que abrirlo desde aquí
 * mandaría la contraseña a una dirección que nadie revisó. Se manda al operador
 * a la fila del representante, donde el diálogo sí enseña el correo correcto.
 */
describe("avisoAccesoPortal — el botón sobre una empresa", () => {
  it("no se pinta de verde: dice a quién hay que abrírselo", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "es_empresa_el_acceso_es_del_representante" }),
    )!;

    expect(aviso.tono).toBe("advertencia");
    expect(aviso.texto).toContain("representante legal");
  });

  it("el representante que no está en cartera también se explica", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "representante_no_encontrado_en_cartera" }),
    )!;

    expect(aviso.tono).toBe("advertencia");
    expect(aviso.texto).toContain("representante legal");
  });
});

/**
 * El aviso leído DESDE el botón del menú de la fila (`tableInvestors.tsx`), no
 * desde el alta del modal.
 *
 * Los dos defectos que se arreglan aquí: el consejo en bucle —mandar a apretar
 * el botón que la persona acaba de apretar— y afirmar un alta que desde este
 * camino nunca ocurrió: el botón no crea ningún inversionista, la fila ya
 * existía.
 */
describe("avisoAccesoPortal — leído desde el botón del menú de la fila", () => {
  it("no afirma un alta que no pasó ni manda al botón que ya se apretó", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "http_500", advertencias: [] }),
      "boton",
    )!;

    expect(aviso.tono).toBe("advertencia");
    expect(aviso.texto).not.toContain("sí quedó creado");
    expect(aviso.texto).not.toContain("no lo vuelvas a crear");
    expect(aviso.texto).not.toContain("Dar acceso al portal");
    expect(aviso.texto).toContain("esta misma opción del menú de su fila");
  });

  it("con la cuenta a medias NO aconseja reintentar: la advertencia ya dice que no sirve", () => {
    const aviso = avisoAccesoPortal(
      acceso({
        estado: "fallo",
        motivo: "http_500",
        advertencias: ["cuenta_creada_sin_marca_de_password"],
      }),
      "boton",
    )!;

    expect(aviso.texto).not.toContain("volvé a intentarlo");
    expect(aviso.texto).toContain("Volver a intentarlo NO la arregla");
  });

  it("sin correo capturado manda a capturarlo y volver a ESTA misma opción", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "omitida", motivo: "sin_correo", advertencias: [] }),
      "boton",
    )!;

    expect(aviso.texto).toContain("correo");
    expect(aviso.texto).toContain("esta misma opción del menú de su fila");
    expect(aviso.texto).not.toContain("Dar acceso al portal");
  });

  it("el permiso que le falta al servidor no se arregla reintentando", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "omitida", motivo: "origen_no_autorizado", advertencias: [] }),
      "boton",
    )!;

    expect(aviso.texto).toContain("Volver a intentarlo no lo arregla");
    expect(aviso.texto).not.toContain("Dar acceso al portal");
  });

  it("el pedido perdido no le habla de un alta que quien lee no hizo", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "omitida", motivo: "no_solicitado", advertencias: [] }),
      "boton",
    )!;

    expect(aviso.texto).not.toContain("Este alta");
    expect(aviso.texto).toContain("no registró el pedido");
  });

  it("el timeout y la empresa no cambian: su texto ya no manda al botón", () => {
    const timeout = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "timeout", advertencias: [] }),
      "boton",
    )!;
    const empresa = avisoAccesoPortal(
      acceso({
        estado: "fallo",
        motivo: "es_empresa_el_acceso_es_del_representante",
      }),
      "boton",
    )!;

    expect(timeout.texto).toContain("NO le des acceso de nuevo");
    expect(empresa.texto).toContain("Abrile el acceso desde la fila del representante");
  });

  // El default es `alta`: el llamador del alta (`modalInvestor.tsx`) no pasa
  // origen y tiene que seguir leyendo exactamente lo mismo de antes.
  it("sin origen explícito sigue hablando como el alta", () => {
    const aviso = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "http_500", advertencias: [] }),
    )!;

    expect(aviso.texto).toContain("sí quedó creado");
    expect(aviso.texto).toContain("Dar acceso al portal");
  });
});

/**
 * La forma que llega NO es `AccesoPortal` por estar tipada así: los dos
 * llamadores le pasan JSON crudo (`any`) de una respuesta HTTP.
 *
 * Y acá tirar no es devolver `null`: en `tableInvestors.tsx` la llamada vive
 * dentro del `try` del botón, así que un `TypeError` cae en el `catch` y pinta
 * "No se pudo abrir el acceso al portal" en ROJO sobre un envío que SÍ salió —
 * y quien lee lo vuelve a apretar.
 */
describe("avisoAccesoPortal — formas que el servidor puede devolver", () => {
  it("un resultado sin `advertencias` NO tira: lo traduce igual", () => {
    const crudo = { estado: "fallo", motivo: "http_500" };

    expect(() => avisoAccesoPortal(crudo)).not.toThrow();
    const aviso = avisoAccesoPortal(crudo)!;
    expect(aviso.tono).toBe("advertencia");
    expect(aviso.texto).toContain("sí quedó creado");
  });

  it("desde el botón, tampoco: ese throw era un rojo sobre un envío que salió", () => {
    const crudo = { estado: "fallo", motivo: "http_500" };

    expect(() => avisoAccesoPortal(crudo, "boton")).not.toThrow();
    expect(avisoAccesoPortal(crudo, "boton")!.texto).not.toContain(
      "sí quedó creado",
    );
  });

  it("una forma que no se reconoce sigue cayendo en `null`, no en verde", () => {
    // Es de lo que depende el toast de "no se pudo confirmar" de los dos
    // llamadores: `null` significa "no sé", nunca "salió bien".
    expect(avisoAccesoPortal({})).toBeNull();
    expect(avisoAccesoPortal({ estado: 7 })).toBeNull();
    expect(avisoAccesoPortal("fallo")).toBeNull();
    expect(avisoAccesoPortal(0)).toBeNull();
  });

  it("sin el bloque `correo` nombra la bandeja genérica en vez de tirar", () => {
    const aviso = avisoAccesoPortal({
      estado: "creada",
      advertencias: ["correo_redirigido_por_modo_no_prod"],
    })!;

    expect(aviso.tono).toBe("advertencia");
    expect(aviso.texto).toContain("una sola bandeja de pruebas");
  });

  it("una advertencia que no es cadena se descarta, no se interpola", () => {
    const aviso = avisoAccesoPortal({
      estado: "ya_tenia",
      advertencias: [{ codigo: "x" }, "rol_no_promovido"],
    })!;

    expect(aviso.texto).toContain("permiso");
    expect(aviso.texto).not.toContain("object Object");
  });
});

/**
 * Las tablas de traducción se indexan CON LA CLAVE DEL SERVIDOR, y el `motivo`
 * puede ser una cadena arbitraria (`String(error?.message ?? error)`,
 * portalProvisioning.ts:160). Sobre un objeto literal, `constructor` y
 * compañía devuelven algo truthy del prototipo, y eso se interpolaba en el
 * aviso que lee una persona.
 */
describe("avisoAccesoPortal — claves del prototipo", () => {
  it("un motivo `constructor` no pinta la función en el aviso", () => {
    for (const origen of ["alta", "boton"] as const) {
      const aviso = avisoAccesoPortal(
        { estado: "fallo", motivo: "constructor", advertencias: [] },
        origen,
      )!;

      expect(aviso.texto).not.toContain("native code");
      expect(aviso.texto).not.toContain("function Object");
      expect(aviso.texto).not.toContain("constructor");
    }
  });

  it("un motivo `toString` tampoco se cuela como causa ni como consejo", () => {
    const aviso = avisoAccesoPortal(
      { estado: "fallo", motivo: "toString", advertencias: [] },
      "boton",
    )!;

    expect(aviso.texto).toBe(
      "No se le pudo dar acceso al portal. Si querés, volvé a intentarlo con esta misma opción del menú de su fila; si vuelve a fallar, avisa a sistemas.",
    );
  });

  it("un origen que no es ninguno de los dos cae en el del alta", () => {
    // `OrigenAviso` no existe en tiempo de ejecución y el valor indexa la
    // tabla de consejos igual que un código del servidor.
    const aviso = avisoAccesoPortal(
      { estado: "omitida", motivo: "sin_correo", advertencias: [] },
      "constructor" as never,
    )!;

    expect(aviso.texto).not.toContain("native code");
    expect(aviso.texto).toContain("Dar acceso al portal");
  });
});

/**
 * Motivos que son permanentes POR DISEÑO: el backend los devuelve después de
 * un corte que un reintento vuelve a encontrar idéntico. El aviso mandaba a
 * apretar otra vez, y con `correo_de_cartera_distinto_al_de_la_cuenta` se
 * contradecía dentro de la misma línea.
 *
 * Los cinco salen de leer el backend: `representante_no_encontrado_en_cartera`
 * y `provisionamiento_no_configurado` de portalProvisioning.ts (228, 118),
 * `inversionista_no_encontrado` de otorgarAccesoPortal.ts:104, y
 * `correo_de_cartera_distinto_al_de_la_cuenta` y
 * `cuenta_anclada_solo_por_correo` de ensureInvestorAccount.ts (581/759 y
 * 609/780).
 */
const PERMANENTES = [
  "representante_no_encontrado_en_cartera",
  "correo_de_cartera_distinto_al_de_la_cuenta",
  "provisionamiento_no_configurado",
  "cuenta_anclada_solo_por_correo",
  "inversionista_no_encontrado",
] as const;

describe("avisoAccesoPortal — lo que reintentar no arregla", () => {
  for (const motivo of PERMANENTES) {
    it(`${motivo}: desde el botón no manda a apretar de nuevo`, () => {
      const aviso = avisoAccesoPortal(
        acceso({ estado: "fallo", motivo, advertencias: [] }),
        "boton",
      )!;

      expect(aviso.tono).toBe("advertencia");
      expect(aviso.texto).toContain("no lo arregla");
      expect(aviso.texto).not.toContain("volvé a intentarlo");
      expect(aviso.texto).not.toContain("si vuelve a fallar");
      // Sin jerga: el código crudo no sale nunca.
      expect(aviso.texto).not.toContain(motivo);
    });

    it(`${motivo}: desde el alta tampoco manda al menú, y sí dice que el alta salió`, () => {
      const aviso = avisoAccesoPortal(
        acceso({ estado: "fallo", motivo, advertencias: [] }),
      )!;

      expect(aviso.texto).toContain("sí quedó creado");
      expect(aviso.texto).toContain("no lo arregla");
      expect(aviso.texto).not.toContain("Cuando quieras");
      expect(aviso.texto).not.toContain("Dar acceso al portal");
    });
  }

  it("los motivos que se arreglan reintentando SIGUEN aconsejándolo", () => {
    // El hermano del cambio: `http_500` no está en la tabla y tiene que
    // conservar el consejo de siempre por los dos caminos.
    const boton = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "http_500", advertencias: [] }),
      "boton",
    )!;
    const alta = avisoAccesoPortal(
      acceso({ estado: "fallo", motivo: "http_500", advertencias: [] }),
    )!;

    expect(boton.texto).toContain("esta misma opción del menú de su fila");
    expect(alta.texto).toContain("Dar acceso al portal");
  });

  it("el correo distinto ya no se contradice en la misma línea", () => {
    // Antes decía "hasta cuadrarlos no vería sus inversiones. Si querés,
    // volvé a intentarlo…": la causa y el consejo, peleados.
    const aviso = avisoAccesoPortal(
      acceso({
        estado: "fallo",
        motivo: "correo_de_cartera_distinto_al_de_la_cuenta",
        advertencias: [],
      }),
      "boton",
    )!;

    expect(aviso.texto).toContain("hasta cuadrarlos no vería sus inversiones");
    expect(aviso.texto).toContain("cuadrarle los dos correos");
    expect(aviso.texto).not.toContain("volvé a intentarlo");
  });

  it("la cuenta a medias trae su causa en palabras, no el código", () => {
    const aviso = avisoAccesoPortal(
      acceso({
        estado: "fallo",
        motivo: "no_se_pudo_marcar_password_provisionada",
        advertencias: [],
      }),
      "boton",
    )!;

    expect(aviso.texto).toContain("la cuenta quedó a medias al crearla");
    expect(aviso.texto).not.toContain("_");
    // Deshecha por el backend, reintentar SÍ sirve: el consejo se conserva.
    expect(aviso.texto).toContain("esta misma opción del menú de su fila");
  });
});

/**
 * `cuenta_creada_sin_marca_de_password` se consultaba solo dentro de la rama
 * del botón, así que el alta seguía aconsejando abrir el acceso desde el menú
 * —justo encima de la advertencia que dice "Volver a intentarlo NO la
 * arregla. Avisa a sistemas."—, contradiciéndola en la misma línea.
 */
describe("avisoAccesoPortal — la cuenta a medias, leída desde el ALTA", () => {
  it("no aconseja abrir el acceso, pero sí dice que el alta salió", () => {
    const aviso = avisoAccesoPortal(
      acceso({
        estado: "fallo",
        motivo: "http_500",
        advertencias: ["cuenta_creada_sin_marca_de_password"],
      }),
    )!;

    expect(aviso.texto).toContain("sí quedó creado");
    expect(aviso.texto).toContain("no lo vuelvas a crear");
    expect(aviso.texto).not.toContain("Cuando quieras");
    expect(aviso.texto).not.toContain("Dar acceso al portal");
    // La advertencia que sí manda a sistemas sigue pegada abajo.
    expect(aviso.texto).toContain("Volver a intentarlo NO la arregla");
  });
});

/**
 * La divergencia con el gemelo del CRM está documentada en la cabecera de
 * `accesoPortal.ts` y tiene que seguir siendo cierta: acá el botón vive en el
 * menú de tres puntos de CADA FILA, no en una pantalla de detalle.
 */
describe("avisoAccesoPortal — el lugar que nombran los textos", () => {
  it("ningún consejo manda a la pantalla de detalle del gemelo", () => {
    const todos = [
      ...PERMANENTES.flatMap((motivo) =>
        (["alta", "boton"] as const).map(
          (origen) =>
            avisoAccesoPortal(
              acceso({ estado: "fallo", motivo, advertencias: [] }),
              origen,
            )!.texto,
        ),
      ),
      avisoAccesoPortal(
        acceso({ estado: "omitida", motivo: "sin_correo", advertencias: [] }),
        "boton",
      )!.texto,
    ];

    for (const texto of todos) {
      expect(texto).not.toContain("pantalla del inversionista");
      expect(texto).not.toContain("este mismo botón");
    }
  });

  it("la fila que no existe manda a revisar la FILA, no la ficha", () => {
    const aviso = avisoAccesoPortal(
      acceso({
        estado: "fallo",
        motivo: "inversionista_no_encontrado",
        advertencias: [],
      }),
      "boton",
    )!;

    expect(aviso.texto).toContain("la fila correcta");
    expect(aviso.texto).not.toContain("ficha");
  });
});

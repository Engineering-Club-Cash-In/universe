// ─────────────────────────────────────────────────────────────────────────────
// El gate de mora del CRM sin la pasarela de SIFCO.
//
// 🔴 Por qué existe este archivo: la pasarela (`http://localhost:9500`) NUNCA se
// desplegó en producción y no se va a desplegar. Mientras el endpoint la
// consultaba SIEMPRE, toda alta de lead con DPI terminaba en
// SERVICIO_NO_DISPONIBLE —fail-closed sobre un servicio que no existe— y el
// gate dejó de gatear: o rebotaba a todo el mundo, o el CRM tenía que ignorarlo.
//
// Los números de crédito ya viajan en la petición (`numerosCreditoConocidos`):
// el CRM los resuelve con su propio join `leads.dpi` ↔ `opportunities.numeroSifco`.
// Esa es la fuente ahora.
//
// Las aserciones son sobre el VEREDICTO devuelto, no sobre qué se llamó. La
// pasarela se vigila aparte con un doble que registra cualquier golpe (ver
// `pasarelaGolpeada`) y con el guardia estático del final: lo que importa es
// que ningún camino la toque, no que un camino puntual no la tocó.
// ─────────────────────────────────────────────────────────────────────────────
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

// `../database` revienta al cargarse sin esta variable (ver `database/index.ts`)
// y `consultaMora.ts` la arrastra por la cadena de imports. El Pool de `pg` no
// conecta al construirse, y de todos modos las pruebas inyectan su propia base:
// esta URL no se usa para hablar con nadie.
process.env.SUPABASE_DB_URL ??=
  "postgres://nadie:nadie@127.0.0.1:1/consulta-mora-tests";

const { consultarMoraPorDpi } = await import("./consultaMora");
const { creditos, moras_credito, moras_historial, convenios_pago } =
  await import("../database/db/schema");

const DPI = "3460666380101";

// ─── El doble de la pasarela ────────────────────────────────────────────────
//
// Un servidor de verdad en el puerto de la pasarela (`sifcoIntegrations.ts`
// apunta a `http://localhost:9500`). No devuelve nada utilizable: si alguien lo
// llama, queda registrado y el test falla. Es un doble y no un spy de módulo a
// propósito —`mock.module` es GLOBAL en bun test y envenenaría los otros
// archivos que mockean `sifcoIntegrations`—.
let pasarelaGolpeada: string[] = [];
let pasarela: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
  pasarela = Bun.serve({
    port: 9500,
    hostname: "127.0.0.1",
    fetch(peticion) {
      pasarelaGolpeada.push(new URL(peticion.url).pathname);
      return new Response("la pasarela no existe en producción", { status: 500 });
    },
  });
});

afterAll(() => {
  pasarela?.stop(true);
});

beforeEach(() => {
  pasarelaGolpeada = [];
});

// ─── La base de cartera, falsa ──────────────────────────────────────────────
//
// Emula lo justo del builder de drizzle que usa el controlador:
// `select(...).from(tabla)[.leftJoin(...)].where(...)`. Se distingue por TABLA,
// no por contador, salvo las dos pasadas sobre `creditos` (por número y por
// dueño), que sí son la primera y la segunda.
interface FilaFalsa {
  credito_id: number;
  usuario_id: number | null;
  numeroCreditoSifco: string;
  estado: string;
  moraMonto: string | null;
  moraCuotas: number | null;
}

function baseDeCarteraFalsa(opciones: {
  porNumero?: FilaFalsa[];
  porUsuario?: FilaFalsa[];
  eventos?: unknown[];
  morasCerradas?: unknown[];
  convenios?: unknown[];
  fallar?: Error;
  demoraMs?: number;
}) {
  let pasadasSobreCreditos = 0;

  const filasDe = (tabla: unknown): unknown[] => {
    if (tabla === creditos) {
      pasadasSobreCreditos += 1;
      return pasadasSobreCreditos === 1
        ? (opciones.porNumero ?? [])
        : (opciones.porUsuario ?? []);
    }
    if (tabla === moras_historial) return opciones.eventos ?? [];
    if (tabla === moras_credito) return opciones.morasCerradas ?? [];
    if (tabla === convenios_pago) return opciones.convenios ?? [];
    throw new Error("la prueba no esperaba una lectura de esta tabla");
  };

  const ejecutor = {
    execute: async () => undefined,
    select: () => ({
      from: (tabla: unknown) => {
        const paso: any = {
          leftJoin: () => paso,
          where: async () => filasDe(tabla),
        };
        return paso;
      },
    }),
  };

  return {
    transaction: async (correr: (ejecutor: unknown) => Promise<unknown>) => {
      if (opciones.demoraMs) {
        await new Promise((seguir) => setTimeout(seguir, opciones.demoraMs));
      }
      if (opciones.fallar) throw opciones.fallar;
      return correr(ejecutor);
    },
  } as any;
}

const alDia = (numero: string, credito_id: number): FilaFalsa => ({
  credito_id,
  usuario_id: 77,
  numeroCreditoSifco: numero,
  estado: "ACTIVO",
  moraMonto: null,
  moraCuotas: null,
});

const enMora = (numero: string, credito_id: number): FilaFalsa => ({
  credito_id,
  usuario_id: 77,
  numeroCreditoSifco: numero,
  estado: "MOROSO",
  moraMonto: "1500.00",
  moraCuotas: 3,
});

describe("consultarMoraPorDpi sin la pasarela de SIFCO", () => {
  it("bloquea con los números que manda el CRM cuando uno está en mora, sin tocar la pasarela", async () => {
    const respuesta = await consultarMoraPorDpi(
      DPI,
      ["8801", "CRM-abc"],
      undefined,
      {
        baseDeCartera: baseDeCarteraFalsa({
          porNumero: [alDia("8801", 1), enMora("CRM-abc", 2)],
          porUsuario: [alDia("8801", 1), enMora("CRM-abc", 2)],
        }),
      }
    );

    expect(respuesta.motivo).toBe("MORA_ACTIVA");
    expect(respuesta.puedeContinuar).toBe(false);
    expect(respuesta.tieneMoraActiva).toBe(true);
    expect(respuesta.encontrado).toBe(true);
    expect(pasarelaGolpeada).toEqual([]);
  });

  it("bloquea por convenio con los números del CRM", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, ["9001"], undefined, {
      baseDeCartera: baseDeCarteraFalsa({
        porNumero: [{ ...alDia("9001", 5), estado: "EN_CONVENIO" }],
        porUsuario: [{ ...alDia("9001", 5), estado: "EN_CONVENIO" }],
      }),
    });

    expect(respuesta.motivo).toBe("EN_CONVENIO");
    expect(respuesta.puedeContinuar).toBe(false);
    expect(pasarelaGolpeada).toEqual([]);
  });

  it("bloquea por crédito insoluto aunque el número venga del CRM", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, ["insoluto-4"], undefined, {
      baseDeCartera: baseDeCarteraFalsa({
        porNumero: [{ ...alDia("insoluto-4", 9), estado: "CANCELADO" }],
        porUsuario: [{ ...alDia("insoluto-4", 9), estado: "CANCELADO" }],
      }),
    });

    expect(respuesta.motivo).toBe("CREDITO_INSOLUTO");
    expect(respuesta.puedeContinuar).toBe(false);
    expect(pasarelaGolpeada).toEqual([]);
  });

  it("bloquea por el crédito que el DPI AFIANZÓ, aunque no traiga números propios", async () => {
    // Los garantizados también los resuelve el CRM. Si se los dejara fuera,
    // afianzar un crédito en mora dejaría de bloquear: sería aflojar el gate
    // en el mismo cambio que lo destraba.
    const respuesta = await consultarMoraPorDpi(DPI, [], ["7777"], {
      baseDeCartera: baseDeCarteraFalsa({
        porNumero: [enMora("7777", 12)],
      }),
    });

    expect(respuesta.motivo).toBe("MORA_ACTIVA");
    expect(respuesta.puedeContinuar).toBe(false);
    expect(pasarelaGolpeada).toEqual([]);
  });

  it("deja pasar cuando todos los créditos del CRM están al día", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, ["8801", "8802"], undefined, {
      baseDeCartera: baseDeCarteraFalsa({
        porNumero: [alDia("8801", 1), alDia("8802", 2)],
        porUsuario: [alDia("8801", 1), alDia("8802", 2)],
      }),
    });

    expect(respuesta.motivo).toBe("SIN_MORA");
    expect(respuesta.puedeContinuar).toBe(true);
    expect(respuesta.tieneMoraActiva).toBe(false);
    expect(respuesta.encontrado).toBe(true);
    expect(respuesta.creditos).toHaveLength(2);
    expect(pasarelaGolpeada).toEqual([]);
  });

  it("con la lista vacía responde CLIENTE_NO_ENCONTRADO y deja pasar, sin leer la base ni la pasarela", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, [], undefined, {
      // Si el endpoint leyera la base con la lista vacía, esta base reventaría
      // y el veredicto saldría SERVICIO_NO_DISPONIBLE.
      baseDeCartera: baseDeCarteraFalsa({
        fallar: new Error("no se debe consultar la base sin números"),
      }),
    });

    expect(respuesta.motivo).toBe("CLIENTE_NO_ENCONTRADO");
    expect(respuesta.puedeContinuar).toBe(true);
    expect(respuesta.encontrado).toBe(false);
    expect(respuesta.creditos).toEqual([]);
    expect(pasarelaGolpeada).toEqual([]);
  });

  it("sin `numerosCreditoConocidos` en el cuerpo tampoco consulta a nadie", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, undefined, undefined, {
      baseDeCartera: baseDeCarteraFalsa({
        fallar: new Error("no se debe consultar la base sin números"),
      }),
    });

    expect(respuesta.motivo).toBe("CLIENTE_NO_ENCONTRADO");
    expect(respuesta.puedeContinuar).toBe(true);
    expect(pasarelaGolpeada).toEqual([]);
  });

  it("con números pero sin crédito en cartera responde CLIENTE_NO_ENCONTRADO", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, ["no-existe"], undefined, {
      baseDeCartera: baseDeCarteraFalsa({ porNumero: [] }),
    });

    expect(respuesta.motivo).toBe("CLIENTE_NO_ENCONTRADO");
    expect(respuesta.puedeContinuar).toBe(true);
    expect(pasarelaGolpeada).toEqual([]);
  });

  // ─── Lo que SIGUE siendo fail-closed ──────────────────────────────────────
  //
  // SERVICIO_NO_DISPONIBLE queda para los fallos REALES de cartera. Si estos
  // dos dejaran de darlo, el cambio habría convertido el gate en un sello.

  it("con la base de cartera caída sigue siendo SERVICIO_NO_DISPONIBLE", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, ["8801"], undefined, {
      baseDeCartera: baseDeCarteraFalsa({
        fallar: new Error("la base de cartera no responde"),
      }),
    });

    expect(respuesta.motivo).toBe("SERVICIO_NO_DISPONIBLE");
    expect(respuesta.puedeContinuar).toBe(false);
    expect(respuesta.tieneMoraActiva).toBe(false);
  });

  it("con el presupuesto vencido sigue siendo SERVICIO_NO_DISPONIBLE", async () => {
    const respuesta = await consultarMoraPorDpi(DPI, ["8801"], undefined, {
      presupuestoMs: 30,
      baseDeCartera: baseDeCarteraFalsa({
        porNumero: [alDia("8801", 1)],
        demoraMs: 300,
      }),
    });

    expect(respuesta.motivo).toBe("SERVICIO_NO_DISPONIBLE");
    expect(respuesta.puedeContinuar).toBe(false);
  });

  // 🔴 El presupuesto puede estar vencido ANTES del primer paso, no solo
  // durante. Ese caso tenía una trampa de orden: `conRelojDePostgres(...)` se
  // evaluaba como ARGUMENTO de `bajoPlazo`, así que la promesa de la
  // transacción nacía —y podía rechazar— antes de que `bajoPlazo` corriera su
  // propio `cotaODesistir`; ese throw salía ANTES de que `Promise.race` le
  // enganchara un manejador y dejaba un rechazo huérfano. El veredicto salía
  // bien igual, pero el proceso se quedaba con un `unhandledRejection`, que
  // según cómo esté configurado el runtime lo tumba. Por eso esta prueba mira
  // las DOS cosas: el veredicto y que no quede ningún rechazo sin manejar.
  it("con el presupuesto ya vencido antes del primer paso no deja rechazos sin manejar", async () => {
    const huerfanos: unknown[] = [];
    const anotar = (motivo: unknown) => {
      huerfanos.push(motivo);
    };
    process.on("unhandledRejection", anotar);

    try {
      // `presupuestoMs: 0` deja `venceEn === ahora`: el presupuesto ya está
      // vencido cuando se llega a la primera lectura de cartera.
      const respuesta = await consultarMoraPorDpi(DPI, ["8801"], undefined, {
        presupuestoMs: 0,
        baseDeCartera: baseDeCarteraFalsa({
          porNumero: [alDia("8801", 1)],
        }),
      });

      expect(respuesta.motivo).toBe("SERVICIO_NO_DISPONIBLE");
      expect(respuesta.puedeContinuar).toBe(false);
      expect(respuesta.tieneMoraActiva).toBe(false);

      // El `unhandledRejection` no es síncrono: se reporta cuando el runtime
      // ve que el turno terminó sin manejador. Hay que dejarlo pasar.
      await Bun.sleep(50);

      expect(huerfanos).toEqual([]);
    } finally {
      process.off("unhandledRejection", anotar);
    }
  });

  // ─── El guardia estático ──────────────────────────────────────────────────
  //
  // Vale más que cualquier spy: cubre TODOS los caminos del módulo, incluidos
  // los que ninguna prueba ejercita. Si mañana alguien vuelve a colgar la
  // pasarela —o el espejo `SIFCO_DB_URL`— de este endpoint, esto se pone rojo
  // antes de que nadie lo despliegue.
  it("el módulo del endpoint no importa la pasarela ni el espejo de SIFCO", async () => {
    const fuente = await Bun.file(
      new URL("./consultaMora.ts", import.meta.url)
    ).text();

    // Se miran los ESPECIFICADORES de módulo, no el texto: los comentarios del
    // archivo nombran la pasarela a propósito —explican por qué ya no se usa—
    // y un `toInclude` sobre la fuente cruda se pondría rojo por la prosa.
    const modulosImportados = [
      ...fuente.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g),
    ].map((coincidencia) => coincidencia[1]);

    expect(modulosImportados.length).toBeGreaterThan(0);
    expect(
      modulosImportados.filter((modulo) => /sifco/i.test(modulo))
    ).toEqual([]);

    // Y ninguna llamada al helper del espejo, que es el otro camino que tocaba
    // la base `SIFCO_DB_URL`.
    expect(fuente).not.toInclude("numerosEspejoConPresupuesto(");
  });
});

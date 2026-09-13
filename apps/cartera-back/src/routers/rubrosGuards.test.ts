import { describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { lockPoolMock } from "../utils/testMocks";

// ─────────────────────────────────────────────────────────────────────────────
// Gates de rol del módulo de rubros — y la atribución del rol.
//
// El cableado no tenía NINGÚN test: `authMiddleware` sólo valida la firma del
// JWT, así que todo lo que impide que un INVESTOR del portal le cargue cobros a
// un crédito ajeno es el `requireRole` que cada handler llama a mano. Una ruta
// nueva sin esa línea —o con ella puesta después de la validación— dejaba la
// suite verde igual.
//
// Mismo montaje que `moraGuards.test.ts`: no se mockean los controladores
// (`mock.module` es global en bun test y envenenaría otros archivos), sólo
// "../database". Las rutas bloqueadas nunca llegan a la BD; las que SÍ dejan
// pasar al rol mueren más adelante con el 400/500 propio del handler, y afirmar
// ESA respuesta concreta —y no un `not.toBe(403)`— es lo que prueba que el rol
// cruzó el gate: un `not.toBe(403)` pelado también pasaría con el 404 de una
// ruta inexistente.
// ─────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

/**
 * Motor de base falso, manejado por una COLA de resultados.
 *
 * Cada `await` de una consulta drizzle consume el siguiente resultado de la
 * cola, en el orden en que el controlador las hace. Alcanza porque lo que se
 * prueba acá es el cableado —quién pasa, con qué rol queda atribuida la
 * acción—, no el SQL: las reglas de negocio ya viven probadas y sin base en
 * `rubrosPolicy.test.ts`.
 *
 * Con la cola AGOTADA la consulta RECHAZA (no devuelve `[]`): así el handler
 * cae en su propio catch y responde 500, que es la señal inequívoca de "cruzó
 * el gate y llegó al controlador". Devolviendo `[]` cada ruta inventaba una
 * respuesta distinta —200 con lista vacía, 404 de "no existe", y hasta el 403
 * de "no se pudo identificar al usuario", indistinguible del 403 del gate de
 * rol, que es justo lo que estos tests tienen que poder distinguir.
 */
const motorConCola = (...resultados: any[][]) => {
  const cola = [...resultados];
  /** Todo lo que el controlador mandó a escribir, en orden. */
  const valores: any[] = [];
  const eslabon: any = new Proxy(
    {},
    {
      get: (_t, prop) => {
        // `await` sobre la cadena: entrega el siguiente resultado encolado.
        if (prop === "then") {
          return (ok: any, err: any) =>
            (cola.length
              ? Promise.resolve(cola.shift())
              : Promise.reject(new Error("sin BD en tests"))
            ).then(ok, err);
        }
        // `.from()`, `.where()`, `.limit()`, `.for("update")`, `.values()`,
        // `.returning()`… todas devuelven la misma cadena. De paso se anotan
        // los `values()`, que es por donde se puede mirar QUÉ se escribió (el
        // `origen` del historial, o sea con qué rol quedó atribuido el cobro).
        return (...args: any[]) => {
          if (prop === "values" || prop === "set") valores.push(args[0]);
          return eslabon;
        };
      },
    }
  );

  const motor: any = {
    select: () => eslabon,
    insert: () => eslabon,
    update: () => eslabon,
    delete: () => eslabon,
    // `execute` DEBE devolver una promesa RECHAZADA y no faltar: una promesa
    // rechazada se engancha a su catch, mientras que un método ausente revienta
    // de forma síncrona y deja rejections huérfanas que bun le carga al test que
    // esté corriendo.
    execute: () => Promise.reject(new Error("sin BD en tests")),
    valoresEscritos: valores,
  };
  // La transacción corre contra el MISMO motor: el controlador no distingue.
  motor.transaction = (cb: any) => cb(motor);
  return motor;
};

/** Sin cola: cualquier ruta que llegue al controlador muere y responde 500. */
const SIN_BD = () => motorConCola();

let dbImpl: any = SIN_BD();

/**
 * El `lockPool` también es intercambiable, por la misma razón que `dbImpl`:
 * `mock.module` corre UNA vez al cargar el archivo, así que el test que quiera
 * MIRAR el lock no puede re-mockear el módulo (envenenaría a los demás). El
 * default sigue siendo el stub mudo de `testMocks`; sólo el test del candado
 * lo cambia por un espía, y lo devuelve en su `finally`.
 */
let lockImpl: any = lockPoolMock;

mock.module("../database", () => ({
  db: new Proxy({}, { get: (_t, p) => dbImpl[p] }),
  client: {},
  // `lockPool` es obligatorio desde que `editarRubro`/`anularRubro` toman el
  // advisory lock por crédito (el mismo que `insertPayment`) para no dejar que
  // una corrección se cuele en la ventana en que una boleta ya decidió su
  // reparto de rubros pero todavía no escribió el reclamo. Sin esta clave el
  // mock no exporta lo que `paymentAdvisoryLock.ts` importa y el ARCHIVO
  // ENTERO revienta al cargarse. El lock acá es un no-op: lo que estos tests
  // prueban es el cableado de roles, no la serialización.
  lockPool: new Proxy({}, { get: (_t, p) => lockImpl[p] }),
}));

const { rubrosRouter } = await import("./rubros");

const app = new Elysia().use(rubrosRouter);

const token = (role: string) =>
  jwt.sign({ id: 1, email: "quien@clubcashin.com", role }, JWT_SECRET);

const pedir = (metodo: string, path: string, role: string, body?: any) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token(role)}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  );

const get = (path: string, role: string) => pedir("GET", path, role);
const post = (path: string, role: string, body?: any) =>
  pedir("POST", path, role, body);
const put = (path: string, role: string, body?: any) =>
  pedir("PUT", path, role, body);
const del = (path: string, role: string) => pedir("DELETE", path, role);

// Cuerpos VÁLIDOS a propósito: el esquema TypeBox corre antes del handler, así
// que un body malformado devolvería el 400 de validación y el test no llegaría
// a ejercitar el gate de rol que dice estar probando.
const TIPO_NUEVO = { nombre: "Tarjeta de circulación" };
const RUBRO_NUEVO = {
  credito_id: 1,
  tipo_id: 1,
  monto: 500,
  descripcion: "Tarjeta de circulación 2026",
};
const EDICION = { monto: 400, motivo: "corrección" };
const ANULACION = { motivo: "cargado por error" };

// Roles que NO tocan rubros. INVESTOR es el que importa: tiene token vivo del
// portal y ningún motivo para ver —ni menos crear— cobros de un crédito.
const AJENOS = ["INVESTOR", "CONTA"];

describe("Rubros — las 9 rutas rechazan al rol ajeno", () => {
  const rutas: Array<[string, () => Promise<Response>]> = [];
  for (const role of AJENOS) {
    rutas.push(
      [`GET /rubros/tipos (${role})`, () => get("/rubros/tipos", role)],
      [`POST /rubros/tipos (${role})`, () => post("/rubros/tipos", role, TIPO_NUEVO)],
      [`PUT /rubros/tipos/:id (${role})`, () => put("/rubros/tipos/1", role, TIPO_NUEVO)],
      [`DELETE /rubros/tipos/:id (${role})`, () => del("/rubros/tipos/1", role)],
      [`GET /rubros/credito/:id (${role})`, () => get("/rubros/credito/1", role)],
      [`POST /rubros (${role})`, () => post("/rubros", role, RUBRO_NUEVO)],
      [`PUT /rubros/:id (${role})`, () => put("/rubros/1", role, EDICION)],
      [`POST /rubros/:id/anular (${role})`, () => post("/rubros/1/anular", role, ANULACION)],
      [`GET /rubros/:id/historial (${role})`, () => get("/rubros/1/historial", role)]
    );
  }

  for (const [nombre, ejecutar] of rutas) {
    it(`403 en ${nombre}`, async () => {
      const res = await ejecutar();
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).message).toContain("No autorizado");
    });
  }
});

describe("Rubros — el catálogo y la corrección de un cobro son de ADMIN", () => {
  // Escribir el catálogo define la NATURALEZA de los cobros (qué tipo se salta
  // los frenos de mora), y editar o anular un rubro toca un cobro ya hecho:
  // decisiones de negocio, no operación diaria del asesor.
  const soloAdmin: Array<[string, (role: string) => Promise<Response>]> = [
    ["POST /rubros/tipos", (r) => post("/rubros/tipos", r, TIPO_NUEVO)],
    ["PUT /rubros/tipos/:id", (r) => put("/rubros/tipos/1", r, TIPO_NUEVO)],
    ["DELETE /rubros/tipos/:id", (r) => del("/rubros/tipos/1", r)],
    ["PUT /rubros/:id", (r) => put("/rubros/1", r, EDICION)],
    ["POST /rubros/:id/anular", (r) => post("/rubros/1/anular", r, ANULACION)],
  ];

  for (const [nombre, ejecutar] of soloAdmin) {
    it(`403 para ASESOR en ${nombre}`, async () => {
      const res = await ejecutar("ASESOR");
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).message).toContain("requiere ADMIN");
    });

    it(`ADMIN cruza el gate en ${nombre} y llega al handler (500 sin BD)`, async () => {
      const res = await ejecutar("ADMIN");
      expect(res.status).toBe(500);
    });
  }
});

describe("Rubros — consultar y dar de alta también los hace el ASESOR", () => {
  // El alta se le abre al ASESOR, pero `puedeCrearRubro` le niega los tipos
  // OBLIGATORIOS: ese gate fino necesita saber qué tipo se pidió, y eso es una
  // consulta a la base que no le toca al router.
  it("ASESOR lista tipos y llega al handler", async () => {
    const res = await get("/rubros/tipos", "ASESOR");
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).message).toContain(
      "Error al listar los tipos de rubro"
    );
  });

  it("ASESOR consulta los rubros de un crédito y llega al handler", async () => {
    const res = await get("/rubros/credito/1", "ASESOR");
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).message).toContain(
      "Error al listar los rubros del crédito"
    );
  });

  it("ASESOR consulta el historial de un rubro y llega al handler", async () => {
    const res = await get("/rubros/1/historial", "ASESOR");
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).message).toContain(
      "Error al obtener el historial del rubro"
    );
  });

  it("ASESOR da de alta un rubro y llega al handler", async () => {
    const res = await post("/rubros", "ASESOR", RUBRO_NUEVO);
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).message).toContain("Error al crear el rubro");
  });
});

describe("Rubros — el gate corre ANTES de validar el id de la URL", () => {
  // Control del otro lado: si el `requireRole` se cayera de estos handlers, el
  // 403 se volvería el 400 del id inválido, que es una respuesta del handler.
  it("ADMIN con rubro_id inválido recibe el 400 del handler", async () => {
    const res = await put("/rubros/abc", "ADMIN", EDICION);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toContain("rubro_id inválido");
  });

  it("INVESTOR con el MISMO id inválido se queda en 403", async () => {
    const res = await put("/rubros/abc", "INVESTOR", EDICION);
    expect(res.status).toBe(403);
  });

  it("ADMIN con rubro_id inválido en /anular recibe el 400 del handler", async () => {
    const res = await post("/rubros/abc/anular", "ADMIN", ANULACION);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toContain("rubro_id inválido");
  });
});

describe("Rubros — `1e3` y `0x10` no son ids", () => {
  // `Number("1e3")` es 1000: `GET /rubros/credito/1e3` devolvía los rubros del
  // crédito 1000 con 200, o sea acceso silencioso a un registro que nadie pidió.
  for (const id of ["1e3", "0x10", "+1", " 1", "1.0", "1n"]) {
    it(`400 para credito_id "${id}"`, async () => {
      const res = await get(`/rubros/credito/${encodeURIComponent(id)}`, "ADMIN");
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).message).toContain("credito_id inválido");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// El rol sale del TOKEN, no del body.
//
// El rol con el que se decide y se atribuye un alta tiene que ser el del JWT.
// Hoy lo garantizan DOS defensas independientes, y estos tests fijan el
// resultado observable —no una de las dos—, que es lo que importa cuando
// cualquiera de ellas se mueva:
//
//   1. El esquema TypeBox del POST no declara `role`, y Elysia DESCARTA las
//      propiedades que no declara: el `role: "ADMIN"` del JSON ni siquiera
//      llega al handler.
//   2. `crearRubro({ ...body, usuario_id, role: user?.role })` pone el rol del
//      token DESPUÉS del spread, así que aunque llegara no pisaría nada.
//
// Cada una sola alcanza, y por eso invertir el spread hoy no rompe la suite.
// Lo que estos tests sí atrapan es el escenario que de verdad abre la escalada:
// que el esquema del body empiece a aceptar campos libres (o un `role`
// explícito) mientras el spread quedó al revés — un ASESOR cargando rubros
// OBLIGATORIOS, los que se saltan los frenos de mora, y un historial que se lo
// atribuye a "admin".
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rubros/:id/anular — la única salida del cobro cargado por error", () => {
  const RUBRO_VIVO = {
    rubro_id: 3,
    credito_id: 1,
    tipo_id: 1,
    monto_original: "500.00",
    saldo_pendiente: "500.00",
    completado: false,
  };

  // Orden de `anularRubro`: resolver al usuario, AVERIGUAR A QUÉ CRÉDITO
  // pertenece el rubro (lectura sin bloqueo, sólo para saber qué advisory lock
  // tomar), la fila del rubro (FOR UPDATE, ya bajo el lock), los reclamos
  // VIVOS de boletas registradas sobre ese rubro, el UPDATE y el evento de
  // historial. Sin reclamos (`[]`) la anulación procede.
  const colaDeAnulacion = (rubro: any, reclamos: any[] = []) =>
    motorConCola(
      [{ id: 1 }],
      [{ credito_id: rubro.credito_id }],
      [rubro],
      reclamos,
      [{ ...rubro }],
      []
    );

  it("anula el rubro vivo: saldo 0, completado y fuera del índice — sin tocar el monto", async () => {
    dbImpl = colaDeAnulacion(RUBRO_VIVO);
    try {
      const res = await post("/rubros/3/anular", "ADMIN", ANULACION);
      expect(res.status).toBe(200);

      const cambios = dbImpl.valoresEscritos[0];
      expect(cambios.saldo_pendiente).toBe("0.00");
      expect(cambios.completado).toBe(true);
      expect(cambios.activo).toBe(false);
      // El monto_original es el rastro de cuánto se había llegado a cobrar:
      // ponerlo en 0 borraría la evidencia del error que la anulación
      // documenta.
      expect(cambios.monto_original).toBeUndefined();
    } finally {
      dbImpl = SIN_BD();
    }
  });

  it("deja el evento `anulacion` con el saldo que dejó de cobrarse y el motivo", async () => {
    dbImpl = colaDeAnulacion(RUBRO_VIVO);
    try {
      await post("/rubros/3/anular", "ADMIN", { motivo: "  cargado por error  " });

      const evento = dbImpl.valoresEscritos.find(
        (v: any) => v?.tipo_evento === "anulacion"
      );
      expect(evento).toBeDefined();
      expect(evento.saldo_anterior).toBe("500.00");
      expect(evento.saldo_nuevo).toBe("0.00");
      // Recortado: es el texto que se guarda.
      expect(evento.motivo).toBe("cargado por error");
      expect(evento.usuario_id).toBe(1);
    } finally {
      dbImpl = SIN_BD();
    }
  });

  it("400 si el motivo viene vacío o en blanco (el historial quedaría mudo)", async () => {
    for (const motivo of ["", "   "]) {
      dbImpl = colaDeAnulacion(RUBRO_VIVO);
      try {
        const res = await post("/rubros/3/anular", "ADMIN", { motivo });
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).message).toContain(
          "motivo es obligatorio"
        );
      } finally {
        dbImpl = SIN_BD();
      }
    }
  });

  it("409 al anular dos veces: el rubro completado ya salió del índice", async () => {
    dbImpl = colaDeAnulacion({
      ...RUBRO_VIVO,
      saldo_pendiente: "0.00",
      completado: true,
    });
    try {
      const res = await post("/rubros/3/anular", "ADMIN", ANULACION);
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).message).toContain("ya está completado");
    } finally {
      dbImpl = SIN_BD();
    }
  });

  it("409 con una boleta registrada encima: primero se resuelve esa boleta", async () => {
    // Una boleta ya apartó Q150 de este rubro y espera a contabilidad. Anular
    // dejaría el saldo en 0 y al validarla no alcanzaría — este 409 es lo que
    // vuelve imposible ese descuadre.
    dbImpl = colaDeAnulacion(RUBRO_VIVO, [
      { rubro_id: 3, pago_id: 77, monto: "150.00" },
    ]);
    try {
      const res = await post("/rubros/3/anular", "ADMIN", ANULACION);
      expect(res.status).toBe(409);
      const mensaje = ((await res.json()) as any).message;
      expect(mensaje).toContain("150.00");
      expect(mensaje).toContain("77");
      // Y NADA se escribió: el rubro queda como estaba.
      expect(dbImpl.valoresEscritos).toEqual([]);
    } finally {
      dbImpl = SIN_BD();
    }
  });

  it("404 cuando el rubro no existe", async () => {
    dbImpl = motorConCola([{ id: 1 }], []);
    try {
      const res = await post("/rubros/3/anular", "ADMIN", ANULACION);
      expect(res.status).toBe(404);
    } finally {
      dbImpl = SIN_BD();
    }
  });
});

describe("POST /rubros — el rol del body no pisa al del token", () => {
  // Orden de las consultas de `crearRubro`: resolver al usuario, el crédito
  // (FOR UPDATE), el tipo y la mora activa.
  const colaDeAlta = (tipo: any, extra: any[][] = []) =>
    motorConCola(
      [{ id: 1 }], // platform_users: el autor existe
      [{ statusCredit: "ACTIVO" }], // crédito vivo: no lo frena el status
      [tipo],
      [{ monto: "0" }], // sin mora activa
      ...extra
    );

  const OBLIGATORIO = { tipo_id: 1, obligatorio: true, activo: true };
  const OPCIONAL = { tipo_id: 1, obligatorio: false, activo: true };

  it("un ASESOR con role:'ADMIN' en el body sigue sin poder cobrar un tipo obligatorio", async () => {
    dbImpl = colaDeAlta(OBLIGATORIO);
    try {
      const res = await post("/rubros", "ASESOR", {
        ...RUBRO_NUEVO,
        role: "ADMIN",
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).message).toContain(
        "Solo un administrador"
      );
    } finally {
      dbImpl = SIN_BD();
    }
  });

  it("control: con el token de un ADMIN ese MISMO alta obligatoria sí pasa (201)", async () => {
    // Sin este control, el test de arriba también pasaría si el endpoint
    // estuviera roto y rechazara todo.
    dbImpl = colaDeAlta(OBLIGATORIO, [
      [{ rubro_id: 7 }], // insert del rubro
      [], // insert del historial
    ]);
    try {
      const res = await post("/rubros", "ADMIN", RUBRO_NUEVO);
      expect(res.status).toBe(201);
      expect(((await res.json()) as any).rubro.rubro_id).toBe(7);
    } finally {
      dbImpl = SIN_BD();
    }
  });

  it("el historial atribuye el alta al ASESOR aunque el body diga role:'ADMIN'", async () => {
    // El tipo acá es OPCIONAL para que el alta llegue hasta la escritura: lo
    // que se mira es el `origen` del evento, o sea la respuesta que este módulo
    // existe para dar — "¿quién le cobró esto al cliente?". Si el rol del body
    // llegara a pisar al del token, este cobro quedaría firmado como "admin".
    dbImpl = colaDeAlta(OPCIONAL, [[{ rubro_id: 9 }], []]);
    try {
      const res = await post("/rubros", "ASESOR", {
        ...RUBRO_NUEVO,
        role: "ADMIN",
      });
      expect(res.status).toBe(201);

      const evento = dbImpl.valoresEscritos.find(
        (v: any) => v?.tipo_evento === "creacion"
      );
      expect(evento).toBeDefined();
      expect(evento.origen).toBe("asesor");
    } finally {
      dbImpl = SIN_BD();
    }
  });
});

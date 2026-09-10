import { describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";

// ─────────────────────────────────────────────────────────────────────────────
// Gates de rol y motivo obligatorio del módulo de moras.
//
// No mockeamos los controladores (mock.module es global en bun test y envenenaría
// otros archivos): mockeamos solo "../database" — con `client: {}`, obligatorio —
// de modo que las rutas bloqueadas nunca llegan a la BD, y la ruta que SÍ debe
// dejar pasar al ASESOR falla más adelante con 500, lo que prueba que pasó el gate.
// ─────────────────────────────────────────────────────────────────────────────

// NO mutamos process.env.JWT_SECRET: midleware.ts lo captura al cargarse y en la
// suite completa ese módulo puede haber cargado ya (otro archivo de tests importó
// un router). Firmamos con exactamente la misma expresión que usa el middleware.
const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// `db` se expone tras un Proxy para poder sustituirlo SOLO en el test de atribución
// (ver más abajo). Por defecto `dbImpl` es {}, o sea exactamente el comportamiento
// anterior: cualquier ruta que llegue al controlador revienta y devuelve 500.
// `execute` DEBE existir y devolver una promesa rechazada, no faltar. Con `{}`
// pelado, `datosDelCredito` (moraHistorial.ts) —que NO es async: devuelve
// `db.execute(...)` directo— revienta de forma SÍNCRONA al armar el array de
// `Promise.all`, y la promesa ya rechazada de `getMoraHistorialCredito` queda
// huérfana: unhandled rejection. Bun se la carga al test que corre en ese momento
// y lo marca como fallo aunque todos sus `expect` hayan pasado. Rechazando desde
// una promesa, `Promise.all` engancha handler a las dos y la ruta cae limpia en
// su catch → 500 (que es justo lo que estos tests quieren: pasó el gate de rol).
const SIN_BD = () => ({
  execute: () => Promise.reject(new Error("sin BD en tests")),
});

let dbImpl: any = SIN_BD();
mock.module("../database", () => ({
  db: new Proxy({}, { get: (_t, p) => dbImpl[p] }),
  client: {},
}));

const { morasRouter } = await import("./latefee");

const app = new Elysia().use(morasRouter);

const EMAIL_DEL_TOKEN = "quien@clubcashin.com";

const token = (role: string) =>
  jwt.sign({ id: 1, email: EMAIL_DEL_TOKEN, role }, JWT_SECRET);

const post = (path: string, role: string, body: any) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token(role)}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const get = (path: string, role: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: { Authorization: `Bearer ${token(role)}` },
    }),
  );

describe("POST /mora/update — motivo obligatorio", () => {
  const base = { credito_id: 1, monto_cambio: 100, tipo: "DECREMENTO" as const };

  it("rechaza con 400 cuando el motivo viene vacío", async () => {
    const res = await post("/mora/update", "ADMIN", { ...base, motivo: "" });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain("motivo es obligatorio");
  });

  it("rechaza con 400 cuando el motivo es solo espacios", async () => {
    const res = await post("/mora/update", "ADMIN", { ...base, motivo: "    " });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.message).toContain("motivo es obligatorio");
  });

  it("rechaza cuando el motivo ni siquiera viene en el body (schema lo exige)", async () => {
    const res = await post("/mora/update", "ADMIN", base);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("con motivo válido pasa la validación y sigue al controlador", async () => {
    const res = await post("/mora/update", "ADMIN", { ...base, motivo: "Ajuste acordado con el cliente" });
    const json: any = await res.json();
    // Sin BD real el controlador falla, pero el mensaje ya NO es el de motivo.
    expect(json.message ?? "").not.toContain("motivo es obligatorio");
  });
});

describe("Condonación de mora — requiere ADMIN", () => {
  it("403 para ASESOR en /mora/condonar", async () => {
    const res = await post("/mora/condonar", "ASESOR", { credito_id: 1, motivo: "x" });
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.message).toContain("ADMIN");
  });

  it("403 para CONTA en /mora/condonar", async () => {
    const res = await post("/mora/condonar", "CONTA", { credito_id: 1, motivo: "x" });
    expect(res.status).toBe(403);
  });

  it("403 para ASESOR en /moras/condonar-masivo", async () => {
    const res = await post("/moras/condonar-masivo", "ASESOR", {
      motivo: "x",
      usuario_email: "quien@clubcashin.com",
    });
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.message).toContain("ADMIN");
  });

  it("ADMIN pasa el gate de condonación (ya no es 403)", async () => {
    const res = await post("/mora/condonar", "ADMIN", { credito_id: 1, motivo: "x" });
    expect(res.status).not.toBe(403);
  });
});

describe("GET /moras/historial/credito/:id — abierto a ASESOR", () => {
  // Se afirma la respuesta CONCRETA de después del gate, no un `not.toBe(403)`:
  // ese 500 lo produce el catch del handler al no haber BD, así que llegar a él
  // prueba que el ASESOR entró. Un `not.toBe(403)` pelado también pasaría con el
  // 404 de una ruta que ni existe.
  it("ASESOR pasa el gate y llega al handler (muere en la BD con 500, no en 403)", async () => {
    const res = await get("/moras/historial/credito/1", "ASESOR");
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).message).toContain(
      "No se pudo obtener el historial del crédito"
    );
  });

  it("un rol ajeno (INVESTOR) sigue recibiendo 403", async () => {
    const res = await get("/moras/historial/credito/1", "INVESTOR");
    expect(res.status).toBe(403);
  });

  it("las vistas agregadas del historial siguen cerradas a ASESOR", async () => {
    const res = await get("/moras/historial?fecha=2026-09-01", "ASESOR");
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gates agregados al cerrar los huecos del review adversarial.
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /mora/update — requiere ADMIN", () => {
  // Un DECREMENTO suficientemente grande deja la mora en 0 y activa=false: es
  // equivalente a condonar, así que se gatea igual que /mora/condonar.
  const base = { credito_id: 1, monto_cambio: 100, tipo: "DECREMENTO" as const, motivo: "x" };

  it("403 para ASESOR", async () => {
    const res = await post("/mora/update", "ASESOR", base);
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.message).toContain("ADMIN");
  });

  it("403 para INVESTOR", async () => {
    const res = await post("/mora/update", "INVESTOR", base);
    expect(res.status).toBe(403);
  });

  it("403 para CONTA (ajustar mora no es lectura contable)", async () => {
    const res = await post("/mora/update", "CONTA", base);
    expect(res.status).toBe(403);
  });

  it("ADMIN pasa el gate (ya no es 403)", async () => {
    const res = await post("/mora/update", "ADMIN", base);
    expect(res.status).not.toBe(403);
  });

  it("el gate corre ANTES que la validación de motivo (no filtra por 400)", async () => {
    const res = await post("/mora/update", "ASESOR", { ...base, motivo: "" });
    expect(res.status).toBe(403);
  });
});

describe("POST /mora (crear) — cerrado a los roles que la crean de verdad", () => {
  // Crear una mora sube la deuda exigible de un cliente. Se abre a ASESOR porque el
  // botón "➕ Mora" de la ficha del crédito lo ve un asesor en la vista móvil; lo que
  // se cierra es cualquier otro rol, que antes también podía crearla.
  const cuerpo = { credito_id: 1, monto_mora: 100, cuotas_atrasadas: 1 };

  it("403 para INVESTOR (antes podía inflar la deuda de cualquier crédito)", async () => {
    const res = await post("/mora", "INVESTOR", cuerpo);
    expect(res.status).toBe(403);
  });

  for (const role of ["ADMIN", "CONTA", "ASESOR"]) {
    it(`${role} pasa el gate`, async () => {
      const res = await post("/mora", role, cuerpo);
      expect(res.status).not.toBe(403);
    });
  }

  it("el 'override' sigue siendo solo de ADMIN/CONTA aunque ASESOR pase el gate", async () => {
    const res = await post("/mora", "ASESOR", { ...cuerpo, override: true });
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.message).toContain("override");
  });
});

describe("POST /moras/procesar y su alias /procesar — requieren ADMIN", () => {
  for (const path of ["/moras/procesar", "/procesar"]) {
    it(`403 para ASESOR en ${path}`, async () => {
      const res = await post(path, "ASESOR", {});
      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.message).toContain("ADMIN");
    });

    it(`403 para INVESTOR en ${path}`, async () => {
      const res = await post(path, "INVESTOR", {});
      expect(res.status).toBe(403);
    });

    it(`403 para CONTA en ${path}`, async () => {
      const res = await post(path, "CONTA", {});
      expect(res.status).toBe(403);
    });

    it(`ADMIN pasa el gate en ${path}`, async () => {
      const res = await post(path, "ADMIN", {});
      expect(res.status).not.toBe(403);
    });
  }
});

describe("GET /moras/creditos y /moras/condonaciones — requieren ADMIN o CONTA", () => {
  // Exponen TODA la cartera morosa (nombre, NIT, capital, asesor, observaciones)
  // y con excel=true suben ese Excel a una URL pública de R2.
  for (const path of ["/moras/creditos", "/moras/condonaciones"]) {
    it(`403 para INVESTOR en ${path}`, async () => {
      const res = await get(path, "INVESTOR");
      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.message).toContain("ADMIN");
    });

    it(`403 para ASESOR en ${path}`, async () => {
      const res = await get(path, "ASESOR");
      expect(res.status).toBe(403);
    });

    it(`403 para INVESTOR aunque pida el Excel en ${path}`, async () => {
      const res = await get(`${path}?excel=true`, "INVESTOR");
      expect(res.status).toBe(403);
    });

    it(`ADMIN pasa el gate en ${path}`, async () => {
      const res = await get(path, "ADMIN");
      expect(res.status).not.toBe(403);
    });

    it(`CONTA pasa el gate en ${path}`, async () => {
      const res = await get(path, "CONTA");
      expect(res.status).not.toBe(403);
    });
  }
});

describe("POST /moras/condonar-masivo — la atribución sale del token, no del body", () => {
  // Recolecta todos los strings dentro del predicado drizzle que arma el
  // controlador (`eq(platform_users.email, usuario_email)`) para ver con qué
  // email se buscó al usuario que queda estampado como "quien condonó".
  const stringsDe = (valor: any, vistos = new Set<any>()): string[] => {
    if (typeof valor === "string") return [valor];
    if (!valor || typeof valor !== "object" || vistos.has(valor)) return [];
    vistos.add(valor);
    return Object.values(valor).flatMap((v) => stringsDe(v, vistos));
  };

  it("usa el email del JWT e ignora el usuario_email del body", async () => {
    let predicado: any;
    dbImpl = {
      ...SIN_BD(),
      select: () => ({
        from: () => ({
          where: (cond: any) => {
            predicado = cond;
            return Promise.resolve([]); // usuario no encontrado → corta ahí
          },
        }),
      }),
    };
    try {
      const res = await post("/moras/condonar-masivo", "ADMIN", {
        motivo: "condonación de prueba",
        usuario_email: "victima-suplantada@clubcashin.com",
      });
      expect(res.status).not.toBe(403);

      const emails = stringsDe(predicado);
      expect(emails).toContain(EMAIL_DEL_TOKEN);
      expect(emails).not.toContain("victima-suplantada@clubcashin.com");
    } finally {
      dbImpl = SIN_BD();
    }
  });

  it("403 para INVESTOR", async () => {
    const res = await post("/moras/condonar-masivo", "INVESTOR", {
      motivo: "x",
      usuario_email: EMAIL_DEL_TOKEN,
    });
    expect(res.status).toBe(403);
  });

  it("403 para CONTA", async () => {
    const res = await post("/moras/condonar-masivo", "CONTA", {
      motivo: "x",
      usuario_email: EMAIL_DEL_TOKEN,
    });
    expect(res.status).toBe(403);
  });

  it("ADMIN ya no necesita mandar usuario_email en el body", async () => {
    const res = await post("/moras/condonar-masivo", "ADMIN", { motivo: "x" });
    // El schema ya no lo exige y el email sale del token: ni 403 ni 422 de schema,
    // y tampoco el 400 de "faltan parámetros" (llega al controlador, que sin BD falla).
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(422);
    const json: any = await res.json();
    expect(json.message ?? "").not.toContain("Faltan parámetros requeridos");
  });
});

describe("Rutas que NO se cerraron (decisión explícita del dueño del producto)", () => {
  // ⚠️ Acá vivía un test contra `/moras/historial/credito/1/excel`, ruta que en
  // ESTA rama no existe todavía (nace con el PR de listados y Excel): el 404 del
  // ruteo hacía pasar el `not.toBe(403)` sin ejercitar gate alguno — se ponía
  // verde hasta para un INVESTOR. La cobertura del `/excel` vive donde nace la
  // ruta. Acá queda la validación de la ruta que SÍ existe, afirmando la
  // respuesta concreta de después del gate: ese 400 lo redacta el handler, así
  // que llegar a él prueba que el ASESOR entró.
  it("ASESOR llega al handler del historial de UN crédito (400 propio, no 403)", async () => {
    const res = await get("/moras/historial/credito/abc", "ASESOR");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toContain("credito_id inválido");
  });

  it("INVESTOR se queda en el 403 antes de ese mismo handler", async () => {
    const res = await get("/moras/historial/credito/abc", "INVESTOR");
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).message).toContain(
      "requiere ADMIN, CONTA o ASESOR"
    );
  });

  it("CONTA sigue entrando al timeline agregado", async () => {
    const res = await get("/moras/historial/timeline?desde=2026-09-01", "CONTA");
    expect(res.status).not.toBe(403);
  });

  it("INVESTOR no entra al timeline agregado", async () => {
    const res = await get("/moras/historial/timeline?desde=2026-09-01", "INVESTOR");
    expect(res.status).toBe(403);
  });

  it("INVESTOR no entra al Excel agregado", async () => {
    const res = await get("/moras/historial/excel", "INVESTOR");
    expect(res.status).toBe(403);
  });
});

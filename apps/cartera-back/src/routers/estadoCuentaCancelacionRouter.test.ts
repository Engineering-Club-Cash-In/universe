import { beforeEach, describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";
import { Elysia } from "elysia";
import {
  createEnlacePublicoEstadoCuentaRouter,
  createEstadoCuentaCancelacionRouter,
  crearLimitador,
} from "./estadoCuentaCancelacionRouter";
import {
  mensajeWhatsappEstadoCuenta,
  sha256Hex,
  sha256Texto,
  type ContactoTelefono,
  type CreditoParaEstadoCuenta,
  type DocumentoEstadoCuenta,
  type EnlaceEstadoCuenta,
  type EnvioEstadoCuenta,
  type EstadoCuentaCancelacionDeps,
  type ResultadoProveedorWhatsapp,
  type WhatsappEstadoCuentaParams,
} from "../controllers/estadoCuentaCancelacionService";

// ─────────────────────────────────────────────────────────────────────────────
// Rutas del estado de cuenta de cancelación con BD, R2, Puppeteer y CRM
// SIMULADOS en memoria. Ningún test llega a WhatsApp: `enviarWhatsapp` es un
// espía que solo anota la llamada.
// ─────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";
const token = (role: string, id = 7) => jwt.sign({ id, email: "op@cashin.test", role }, JWT_SECRET);

const CREDITO_ID = 101;
const OTRO_CREDITO_ID = 202;
const BASE_ENLACE = "https://cartera.example";
const AHORA = new Date("2026-10-02T18:30:00Z");

interface Fake {
  deps: EstadoCuentaCancelacionDeps;
  creditos: Map<number, CreditoParaEstadoCuenta>;
  historialVacio: boolean;
  r2: Map<string, Buffer>;
  documentos: Map<string, DocumentoEstadoCuenta>;
  envios: Map<string, EnvioEstadoCuenta>;
  enlaces: Map<string, EnlaceEstadoCuenta>;
  contactos: ContactoTelefono[];
  fallarContactos: boolean;
  whatsapps: WhatsappEstadoCuentaParams[];
  respuestaWhatsapp: () => Promise<ResultadoProveedorWhatsapp>;
  baseUrl: string | null;
  ahora: Date;
  fallarSubida: boolean;
  fallarInsert: boolean;
  ultimoCodigo: string;
}

let seq = 0;
const crearFake = (): Fake => {
  const f: Fake = {
    creditos: new Map([
      [
        CREDITO_ID,
        {
          creditoId: CREDITO_ID,
          numeroCreditoSifco: "01020304",
          clienteNombre: "Cliente Prueba",
          statusCredit: "ACTIVO",
          montos: { capital: "1000.00", interes: "10.00", iva: "1.20", membresias: "0", seguro: "0", gps: "0", mora: "5.00" },
        },
      ],
      [
        OTRO_CREDITO_ID,
        {
          creditoId: OTRO_CREDITO_ID,
          numeroCreditoSifco: "09090909",
          clienteNombre: "Otro",
          statusCredit: "PENDIENTE_CANCELACION",
          montos: { capital: "1", interes: "0", iva: "0", membresias: "0", seguro: "0", gps: "0", mora: null },
        },
      ],
    ]),
    historialVacio: true,
    r2: new Map(),
    documentos: new Map(),
    envios: new Map(),
    enlaces: new Map(),
    contactos: [
      { telefono: "+50235219722", fuente: "CASO_COBROS", sugerido: true },
      { telefono: "+50247705027", fuente: "LEAD", sugerido: false },
    ],
    fallarContactos: false,
    whatsapps: [],
    respuestaWhatsapp: async () => ({ resultado: "ENVIADO", proveedor: "SimpleTech", mensajeId: "tm-1", modoPrueba: false }),
    baseUrl: BASE_ENLACE,
    ahora: AHORA,
    fallarSubida: false,
    fallarInsert: false,
    ultimoCodigo: "",
    deps: null as unknown as EstadoCuentaCancelacionDeps,
  };
  f.deps = {
    cargarCredito: async (id) => f.creditos.get(id) ?? null,
    cargarHistorial: async () => ({
      encabezadoHtml: "<tr><th>No.</th></tr>",
      filasHtml: f.historialVacio ? [] : ["<tr><td>1</td></tr>"],
      totales: { capital: "0.00", interes: "0.00", iva: "0.00", servicios: "0.00", mora: "0.00", montoAplicado: "0.00" },
    }),
    // "PDF" = el HTML en bytes: así se puede inspeccionar el contenido.
    generarPdf: async (html) => Buffer.from(html, "utf8"),
    subirPdf: async (key, bytes) => {
      if (f.fallarSubida) throw new Error("R2 caído");
      f.r2.set(key, bytes);
    },
    borrarPdf: async (key) => {
      f.r2.delete(key);
    },
    descargarPdf: async (key) => {
      const b = f.r2.get(key);
      if (!b) throw new Error("NoSuchKey");
      return b;
    },
    insertarDocumento: async (doc) => {
      if (f.fallarInsert) throw new Error("insert falló");
      f.documentos.set(doc.id, doc);
    },
    buscarDocumento: async (id, creditoId) => {
      const d = f.documentos.get(id);
      return d && d.creditoId === creditoId ? d : null;
    },
    buscarEnvio: async (id) => f.envios.get(id) ?? null,
    crearEnvio: async (e) => {
      if (f.envios.has(e.id)) return false;
      f.envios.set(e.id, { ...e });
      return true;
    },
    finalizarEnvio: async (id, cambios) => {
      f.envios.set(id, { ...f.envios.get(id)!, ...cambios });
    },
    obtenerContactos: async () => {
      if (f.fallarContactos) throw new Error("CRM caído");
      return f.contactos;
    },
    enviarWhatsapp: async (p) => {
      f.whatsapps.push(p);
      return f.respuestaWhatsapp();
    },
    crearEnlace: async (e) => {
      f.enlaces.set(e.id, { ...e });
    },
    buscarEnlacePorHash: async (hash) => {
      const enlace = [...f.enlaces.values()].find((e) => e.codigoSha256 === hash);
      if (!enlace) return null;
      return { enlace, documento: f.documentos.get(enlace.documentoId)! };
    },
    registrarApertura: async (id) => {
      const e = f.enlaces.get(id)!;
      e.aperturas += 1;
    },
    enlaceBaseUrl: () => f.baseUrl,
    vigenciaEnlaceDias: () => 3,
    generarCodigo: () => {
      f.ultimoCodigo = `codigo${String(++seq).padStart(16, "0")}`;
      return f.ultimoCodigo;
    },
    ahora: () => f.ahora,
    nuevoId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    logoUrl: () => "https://logo.example/l.png",
  };
  return f;
};

let fake: Fake;
let app: ReturnType<typeof createEstadoCuentaCancelacionRouter>;
let publico: ReturnType<typeof createEnlacePublicoEstadoCuentaRouter>;
beforeEach(() => {
  fake = crearFake();
  app = createEstadoCuentaCancelacionRouter(fake.deps);
  publico = createEnlacePublicoEstadoCuentaRouter(fake.deps, { bloqueado: () => false, registrarFallo: () => {} });
});

const BODY = {
  cuotasRestantes: 1,
  traspaso: 0,
  garantiaMobiliaria: 0,
  otros: 0,
  montosAdicionales: [],
  motivo: "Pago total",
};

const llamar = (method: string, path: string, opts: { role?: string | null; body?: unknown } = {}) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.role !== null) headers.Authorization = `Bearer ${token(opts.role ?? "ADMIN")}`;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  );
};

const preview = (role = "ADMIN", creditoId = CREDITO_ID, body: unknown = BODY) =>
  llamar("POST", `/credit/${creditoId}/cancelacion/estado-cuenta/preview`, { role, body });

const intento = () => crypto.randomUUID();

describe("permisos (401 / 403)", () => {
  it("sin sesión → 401 en las rutas internas", async () => {
    const doc = "00000000-0000-4000-8000-000000000001";
    const rutas: [string, string][] = [
      ["POST", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/preview`],
      ["GET", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${doc}/pdf`],
      ["GET", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/contactos`],
      ["POST", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${doc}/enviar`],
    ];
    for (const [method, path] of rutas) {
      const res = await llamar(method, path, { role: null, body: method === "POST" ? {} : undefined });
      expect(res.status).toBe(401);
    }
  });

  it("CONTA y roles desconocidos → 403 sin tocar nada", async () => {
    for (const role of ["CONTA", "INVESTOR"]) {
      const res = await preview(role);
      expect(res.status).toBe(403);
    }
    expect(fake.documentos.size).toBe(0);
    expect(fake.r2.size).toBe(0);
  });

  it("ADMIN y ASESOR pueden generar", async () => {
    expect((await preview("ADMIN")).status).toBe(200);
    expect((await preview("ASESOR")).status).toBe(200);
    expect(fake.documentos.size).toBe(2);
  });

  it("el actor sale del JWT, no del body", async () => {
    const res = await preview("ADMIN", CREDITO_ID, { ...BODY });
    const { documentoId } = await res.json();
    expect(fake.documentos.get(documentoId)!.generadoPorId).toBe(7);
  });
});

describe("POST preview", () => {
  it("genera un documento nuevo por clic, guarda el PDF y su hash", async () => {
    const r1 = await (await preview()).json();
    const r2 = await (await preview()).json();
    expect(r1.documentoId).not.toBe(r2.documentoId);
    const doc = fake.documentos.get(r1.documentoId)!;
    expect(fake.r2.get(doc.pdfKey)).toBeDefined();
    expect(sha256Hex(fake.r2.get(doc.pdfKey)!)).toBe(doc.pdfSha256);
    expect(r1.montoCancelacion).toBe("1016.20"); // 1000 + 1×(10+1.20) + 5
    expect(r1.desglose.montoCancelacion).toBe(r1.montoCancelacion);
    expect(r1.fechaCorteGT).toBe("2026-10-02");
    expect(r1.pdfUrl).toBe(`/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${r1.documentoId}/pdf`);
  });

  it("no cambia el estado del crédito ni crea pagos/cancelaciones", async () => {
    await preview();
    // Las deps no exponen ninguna operación sobre el crédito: el estado sigue igual.
    expect(fake.creditos.get(CREDITO_ID)!.statusCredit).toBe("ACTIVO");
  });

  it("crédito sin pagos elegibles → 200 con «Sin pagos realizados»", async () => {
    fake.historialVacio = true;
    const { documentoId } = await (await preview()).json();
    const pdf = fake.r2.get(fake.documentos.get(documentoId)!.pdfKey)!.toString("utf8");
    expect(pdf).toContain("Sin pagos realizados");
    expect(pdf).toContain("TOTAL PARA CANCELAR");
  });

  it("rechaza capital/mora/monto enviados por el navegador → 400", async () => {
    const res = await preview("ADMIN", CREDITO_ID, { ...BODY, capital: 1, monto_cancelacion: 2 });
    expect(res.status).toBe(400);
    expect(fake.documentos.size).toBe(0);
  });

  it("crédito inexistente → 404; estado fuera de ACTIVO/MOROSO → 409", async () => {
    expect((await preview("ADMIN", 999)).status).toBe(404);
    expect((await preview("ADMIN", OTRO_CREDITO_ID)).status).toBe(409);
  });

  it("si falla el upload no devuelve documento utilizable", async () => {
    fake.fallarSubida = true;
    const res = await preview();
    expect(res.status).toBe(502);
    expect(fake.documentos.size).toBe(0);
  });

  it("si falla la inserción limpia el objeto recién subido", async () => {
    fake.fallarInsert = true;
    const res = await preview();
    expect(res.status).toBe(500);
    expect(fake.r2.size).toBe(0);
  });
});

describe("GET pdf", () => {
  it("sirve exactamente los bytes almacenados (inline, application/pdf)", async () => {
    const { documentoId } = await (await preview()).json();
    const res = await llamar("GET", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${documentoId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toStartWith("inline");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(sha256Hex(bytes)).toBe(fake.documentos.get(documentoId)!.pdfSha256);
  });

  it("sigue accesible aunque el crédito ya no esté ACTIVO", async () => {
    const { documentoId } = await (await preview()).json();
    fake.creditos.get(CREDITO_ID)!.statusCredit = "CANCELADO";
    const res = await llamar("GET", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${documentoId}/pdf`);
    expect(res.status).toBe(200);
  });

  it("documento de otro crédito → 404", async () => {
    const { documentoId } = await (await preview()).json();
    const res = await llamar("GET", `/credit/${OTRO_CREDITO_ID}/cancelacion/estado-cuenta/${documentoId}/pdf`);
    expect(res.status).toBe(404);
  });

  it("archivo alterado en R2 → 500 por integridad", async () => {
    const { documentoId } = await (await preview()).json();
    fake.r2.set(fake.documentos.get(documentoId)!.pdfKey, Buffer.from("alterado"));
    const res = await llamar("GET", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${documentoId}/pdf`);
    expect(res.status).toBe(500);
  });

  it("CONTA → 403", async () => {
    const { documentoId } = await (await preview()).json();
    const res = await llamar("GET", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${documentoId}/pdf`, { role: "CONTA" });
    expect(res.status).toBe(403);
  });
});

describe("GET contactos", () => {
  const contactos = (creditoId = CREDITO_ID, role = "ADMIN") =>
    llamar("GET", `/credit/${creditoId}/cancelacion/estado-cuenta/contactos`, { role });

  it("devuelve los celulares del CRM con su fuente", async () => {
    const res = await contactos();
    expect(res.status).toBe(200);
    expect((await res.json()).contactos).toEqual(fake.contactos);
  });

  it("CRM caído → 502; crédito inexistente → 404; CONTA → 403", async () => {
    fake.fallarContactos = true;
    expect((await contactos()).status).toBe(502);
    fake.fallarContactos = false;
    expect((await contactos(999)).status).toBe(404);
    expect((await contactos(CREDITO_ID, "CONTA")).status).toBe(403);
  });
});

describe("POST enviar (WhatsApp vía CRM)", () => {
  const enviar = (documentoId: string, body: unknown, creditoId = CREDITO_ID, role = "ADMIN") =>
    llamar("POST", `/credit/${creditoId}/cancelacion/estado-cuenta/${documentoId}/enviar`, { role, body });
  const cuerpo = (extra: Record<string, unknown> = {}) => ({ destinatarioTelefono: "+50235219722", intentoId: intento(), ...extra });

  it("sin base pública del enlace configurada → 503", async () => {
    const { documentoId } = await (await preview()).json();
    fake.baseUrl = null;
    expect((await enviar(documentoId, cuerpo())).status).toBe(503);
    expect(fake.whatsapps.length).toBe(0);
  });

  it("envía un enlace de 3 días al PDF guardado y registra ENVIADO", async () => {
    const { documentoId } = await (await preview()).json();
    const res = await enviar(documentoId, cuerpo());
    expect(res.status).toBe(200);
    const { envio } = await res.json();
    expect(envio.estado).toBe("ENVIADO");
    expect(envio.proveedorMensajeId).toBe("tm-1");
    expect(envio.destinatarioTelefono).toBe("+50235219722");
    expect(envio.destinatarioFuente).toBe("CASO_COBROS");
    expect(envio.enlaceVenceAt).toBe("2026-10-05T18:30:00.000Z");

    expect(fake.whatsapps.length).toBe(1);
    const enviado = fake.whatsapps[0];
    expect(enviado.telefono).toBe("+50235219722");
    expect(enviado.numeroCreditoSifco).toBe("01020304");
    expect(enviado.mensaje).toContain(`${BASE_ENLACE}/ec/${fake.ultimoCodigo}`);

    // En la base solo queda la huella del código, nunca el código.
    const [enlace] = [...fake.enlaces.values()];
    expect(enlace.codigoSha256).toBe(sha256Texto(fake.ultimoCodigo));
    expect(JSON.stringify(enlace)).not.toContain(fake.ultimoCodigo);
    expect(fake.envios.get(envio.intentoId)!.enlaceId).toBe(enlace.id);
  });

  it("acepta el número en otros formatos si es uno registrado (8 dígitos)", async () => {
    const { documentoId } = await (await preview()).json();
    const { envio } = await (await enviar(documentoId, cuerpo({ destinatarioTelefono: "4770-5027" }))).json();
    expect(envio.destinatarioTelefono).toBe("+50247705027");
    expect(envio.destinatarioFuente).toBe("LEAD");
  });

  it("número que no está en el CRM → 422 sin enviar ni registrar", async () => {
    const { documentoId } = await (await preview()).json();
    const res = await enviar(documentoId, cuerpo({ destinatarioTelefono: "+50255555123" }));
    expect(res.status).toBe(422);
    expect(fake.whatsapps.length).toBe(0);
    expect(fake.envios.size).toBe(0);
  });

  it("CRM caído al verificar teléfonos → 424 sin enviar", async () => {
    const { documentoId } = await (await preview()).json();
    fake.fallarContactos = true;
    expect((await enviar(documentoId, cuerpo())).status).toBe(424);
    expect(fake.whatsapps.length).toBe(0);
  });

  it("mismo intentoId no manda dos mensajes (idempotencia)", async () => {
    const { documentoId } = await (await preview()).json();
    const body = cuerpo();
    const a = await (await enviar(documentoId, body)).json();
    const b = await (await enviar(documentoId, body)).json();
    expect(fake.whatsapps.length).toBe(1);
    expect(a.envio.repetido).toBe(false);
    expect(b.envio.repetido).toBe(true);
    expect(b.envio.estado).toBe("ENVIADO");
  });

  it("un intentoId nuevo reenvía con un enlace nuevo", async () => {
    const { documentoId } = await (await preview()).json();
    await enviar(documentoId, cuerpo());
    await enviar(documentoId, cuerpo());
    expect(fake.whatsapps.length).toBe(2);
    expect(fake.enlaces.size).toBe(2);
  });

  it("rechazo del proveedor → ERROR reintentable", async () => {
    fake.respuestaWhatsapp = async () => ({ resultado: "NO_ENVIADO", proveedor: "SimpleTech", error: "número inválido" });
    const { documentoId } = await (await preview()).json();
    const { envio } = await (await enviar(documentoId, cuerpo())).json();
    expect(envio.estado).toBe("ERROR");
    expect(envio.reintentable).toBe(true);
    expect(envio.errorResumen).toStartWith("NO_ENVIADO: ");
  });

  it("resultado incierto (timeout / excepción) → ERROR NO reintentable", async () => {
    fake.respuestaWhatsapp = async () => {
      throw new Error("socket hang up");
    };
    const { documentoId } = await (await preview()).json();
    const { envio } = await (await enviar(documentoId, cuerpo())).json();
    expect(envio.estado).toBe("ERROR");
    expect(envio.reintentable).toBe(false);
    expect(envio.errorResumen).toStartWith("INCIERTO: ");
  });

  it("modo prueba del CRM queda registrado", async () => {
    fake.respuestaWhatsapp = async () => ({ resultado: "ENVIADO", proveedor: "SimpleTech", mensajeId: "tm-2", modoPrueba: true });
    const { documentoId } = await (await preview()).json();
    const { envio } = await (await enviar(documentoId, cuerpo())).json();
    expect(envio.modoPrueba).toBe(true);
    expect(fake.envios.get(envio.intentoId)!.proveedor).toBe("SimpleTech (prueba)");
  });

  it("PDF alterado → no se envía; ERROR reintentable", async () => {
    const { documentoId } = await (await preview()).json();
    fake.r2.set(fake.documentos.get(documentoId)!.pdfKey, Buffer.from("alterado"));
    const { envio } = await (await enviar(documentoId, cuerpo())).json();
    expect(fake.whatsapps.length).toBe(0);
    expect(envio.estado).toBe("ERROR");
    expect(envio.reintentable).toBe(true);
  });

  it("body inválido (sin teléfono, intentoId no UUID, campos extra) → 400", async () => {
    const { documentoId } = await (await preview()).json();
    expect((await enviar(documentoId, { intentoId: intento() })).status).toBe(400);
    expect((await enviar(documentoId, cuerpo({ intentoId: "abc" }))).status).toBe(400);
    expect((await enviar(documentoId, cuerpo({ destinatarioEmail: "c@x.com" }))).status).toBe(400);
    expect(fake.whatsapps.length).toBe(0);
  });

  it("documento de otro crédito → 404; CONTA → 403", async () => {
    const { documentoId } = await (await preview()).json();
    expect((await enviar(documentoId, cuerpo(), OTRO_CREDITO_ID)).status).toBe(404);
    expect((await enviar(documentoId, cuerpo(), CREDITO_ID, "CONTA")).status).toBe(403);
    expect(fake.whatsapps.length).toBe(0);
  });
});

describe("enlace público /ec/:codigo (sin sesión)", () => {
  const abrir = (codigo: string, server = publico) => server.handle(new Request(`http://localhost/ec/${codigo}`));
  const enviarYCodigo = async () => {
    const { documentoId } = await (await preview()).json();
    await llamar("POST", `/credit/${CREDITO_ID}/cancelacion/estado-cuenta/${documentoId}/enviar`, {
      body: { destinatarioTelefono: "+50235219722", intentoId: intento() },
    });
    return { documentoId, codigo: fake.ultimoCodigo };
  };

  it("abre el MISMO PDF sin sesión y cuenta la apertura", async () => {
    const { documentoId, codigo } = await enviarYCodigo();
    const res = await abrir(codigo);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toStartWith("inline");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(sha256Hex(Buffer.from(await res.arrayBuffer()))).toBe(fake.documentos.get(documentoId)!.pdfSha256);
    expect([...fake.enlaces.values()][0].aperturas).toBe(1);
  });

  it("vencido (después de 3 días) → 410 con página, sin PDF", async () => {
    const { codigo } = await enviarYCodigo();
    fake.ahora = new Date("2026-10-05T18:30:00Z");
    const res = await abrir(codigo);
    expect(res.status).toBe(410);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Enlace vencido");
  });

  it("anulado → 410", async () => {
    const { codigo } = await enviarYCodigo();
    [...fake.enlaces.values()][0].revocadoAt = AHORA;
    expect((await abrir(codigo)).status).toBe(410);
  });

  it("código inexistente o con formato inválido → 404", async () => {
    expect((await abrir("AAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await abrir("corto")).status).toBe(404);
  });

  it("PDF alterado en R2 → 500, no entrega el archivo", async () => {
    const { documentoId, codigo } = await enviarYCodigo();
    fake.r2.set(fake.documentos.get(documentoId)!.pdfKey, Buffer.from("alterado"));
    const res = await abrir(codigo);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("límite por IP: códigos inexistentes repetidos → 429", async () => {
    const limitado = createEnlacePublicoEstadoCuentaRouter(fake.deps, crearLimitador({ intentos: 2, ventanaMs: 60_000 }));
    expect((await abrir("AAAAAAAAAAAAAAAAAAAAAA", limitado)).status).toBe(404);
    expect((await abrir("AAAAAAAAAAAAAAAAAAAAAA", limitado)).status).toBe(404);
    expect((await abrir("AAAAAAAAAAAAAAAAAAAAAA", limitado)).status).toBe(429);
  });

  it("con la IP bloqueada, un enlace válido sigue abriendo y uno vencido sigue diciendo 410", async () => {
    const { codigo } = await enviarYCodigo();
    const limitado = createEnlacePublicoEstadoCuentaRouter(fake.deps, crearLimitador({ intentos: 2, ventanaMs: 60_000 }));
    // Alguien detrás de la misma IP agota el cupo con códigos inexistentes.
    await abrir("AAAAAAAAAAAAAAAAAAAAAA", limitado);
    await abrir("BBBBBBBBBBBBBBBBBBBBBB", limitado);
    expect((await abrir("CCCCCCCCCCCCCCCCCCCCCC", limitado)).status).toBe(429);
    // El cliente con su enlace real no se ve afectado.
    expect((await abrir(codigo, limitado)).status).toBe(200);
    fake.ahora = new Date("2026-10-05T18:30:00Z");
    expect((await abrir(codigo, limitado)).status).toBe(410);
    // Y los códigos inexistentes siguen bloqueados.
    expect((await abrir("DDDDDDDDDDDDDDDDDDDDDD", limitado)).status).toBe(429);
  });

  it("abrir un enlace válido no consume el cupo de la IP", async () => {
    const { codigo } = await enviarYCodigo();
    const limitado = createEnlacePublicoEstadoCuentaRouter(fake.deps, crearLimitador({ intentos: 2, ventanaMs: 60_000 }));
    for (let i = 0; i < 5; i++) expect((await abrir(codigo, limitado)).status).toBe(200);
  });

  it("la IP es la última de X-Forwarded-For (la que agrega nuestro proxy)", async () => {
    const limitado = createEnlacePublicoEstadoCuentaRouter(fake.deps, crearLimitador({ intentos: 1, ventanaMs: 60_000 }));
    const pedir = (xff: string) =>
      limitado.handle(new Request("http://localhost/ec/AAAAAAAAAAAAAAAAAAAAAA", { headers: { "x-forwarded-for": xff } }));
    expect((await pedir("1.1.1.1, 10.0.0.9")).status).toBe(404);
    // Cambiar la primera IP (la que escribe el cliente) no evade el límite.
    expect((await pedir("2.2.2.2, 10.0.0.9")).status).toBe(429);
    // Otra IP real (otra última IP) tiene su propio cupo.
    expect((await pedir("1.1.1.1, 10.0.0.8")).status).toBe(404);
  });

  it("montado junto a las rutas con sesión, sigue sin pedir sesión", async () => {
    const { codigo } = await enviarYCodigo();
    const servidor = new Elysia().use(app).use(publico);
    const res = await servidor.handle(new Request(`http://localhost/ec/${codigo}`));
    expect(res.status).toBe(200);
  });
});

describe("mensajeWhatsappEstadoCuenta", () => {
  it("tres párrafos (mensaje3parametro) con el texto acordado", () => {
    const m = mensajeWhatsappEstadoCuenta({
      clienteNombre: "Juan  Pérez\nLópez",
      numeroCredito: "01020304",
      venceAt: new Date("2026-10-05T21:30:00Z"),
      enlace: "https://cartera.example/ec/abc",
    });
    const parrafos = m.split("\n\n");
    expect(parrafos).toHaveLength(3);
    expect(parrafos[0]).toBe(
      "Hola Juan Pérez López, el estado de cuenta de tu crédito 01020304 para tu solicitud de cancelación ya está disponible."
    );
    expect(parrafos[1]).toStartWith("Puedes verlo aquí (disponible hasta el 5 de octubre de 2026 a las 15:30): ");
    expect(parrafos[1]).toEndWith("https://cartera.example/ec/abc");
    expect(parrafos[2]).toBe("Si tienes alguna duda, no dudes en contactarnos.");
    // Ningún parámetro lleva saltos de línea internos.
    for (const p of parrafos) expect(p).not.toContain("\n");
  });
});

import { beforeEach, describe, expect, it } from "bun:test";
import {
  asegurarCuentaInversionista,
  avisarEmpresaAgregada,
  type DependenciasProvisionamiento,
  type UsuarioPortal,
} from "./ensureInvestorAccount";

const PORTAL = "https://portal.clubcashin.com";

let usuarios: UsuarioPortal[];
let bienvenidas: any[];
let avisos: any[];
let creados: any[];
let actualizaciones: any[];
let fallarCreacion: null | (() => void);
let modo: { server: string; redirige: boolean; destinatarioUnico: string | null };

const deps = (): DependenciasProvisionamiento => ({
  portalUrl: PORTAL,
  modoEnvio: () => modo,
  generarPassword: () => "PASSWORD-FIJA",
  buscarPorDpi: async (dpi) =>
    usuarios.find((u) => u.dpi && u.dpi.replace(/[\s.\-]/g, "").replace(/^0+/, "") === dpi) ?? null,
  buscarPorEmail: async (email) =>
    usuarios.find((u) => u.email.toLowerCase() === email) ?? null,
  crearUsuario: async ({ nombre, email, password }) => {
    fallarCreacion?.();
    const u: UsuarioPortal = { id: `u${usuarios.length + 1}`, email, nombre, role: "CLIENT", dpi: null };
    usuarios.push(u);
    creados.push({ nombre, email, password });
    return { id: u.id };
  },
  actualizarUsuario: async (id, cambios) => {
    actualizaciones.push({ id, ...cambios });
    const u = usuarios.find((x) => x.id === id)!;
    if (cambios.role) u.role = cambios.role;
    if (cambios.dpi !== undefined) u.dpi = cambios.dpi;
  },
  enviarBienvenida: async (p) => { bienvenidas.push(p); return { success: true }; },
  enviarEmpresaAgregada: async (p) => { avisos.push(p); return { success: true }; },
});

beforeEach(() => {
  usuarios = [];
  bienvenidas = [];
  avisos = [];
  creados = [];
  actualizaciones = [];
  fallarCreacion = null;
  modo = { server: "PROD", redirige: false, destinatarioUnico: null };
});

const entrada = (over: any = {}) => ({
  email: "ana@example.com",
  dpi: "1234567890101",
  nombre: "Ana Pérez",
  inversionistaId: 1,
  inversionistaNombre: "Ana Pérez",
  ...over,
});

describe("asegurarCuentaInversionista — cuenta nueva", () => {
  it("crea la cuenta y manda la bienvenida CON la contraseña", () => {
    return asegurarCuentaInversionista(entrada(), deps()).then((r) => {
      expect(r.estado).toBe("creada");
      expect(creados).toEqual([
        { nombre: "Ana Pérez", email: "ana@example.com", password: "PASSWORD-FIJA" },
      ]);
      expect(bienvenidas[0]).toMatchObject({
        to: "ana@example.com",
        password: "PASSWORD-FIJA",
        portalUrl: PORTAL,
      });
      expect(r.correo).toMatchObject({ enviado: true, plantilla: "bienvenida" });
    });
  });

  it("promueve a INVESTOR y guarda el DPI de 13 dígitos", async () => {
    await asegurarCuentaInversionista(entrada(), deps());
    expect(actualizaciones[0]).toMatchObject({ role: "INVESTOR", dpi: "1234567890101" });
  });

  it("un DPI que no son 13 dígitos se guarda como NULL, jamás como ''", async () => {
    // El slot del '' en users.dpi (UNIQUE) YA está ocupado en producción.
    await asegurarCuentaInversionista(entrada({ dpi: "4036613" }), deps());
    expect(actualizaciones[0]).toMatchObject({ dpi: null });
  });

  it("NUNCA devuelve la contraseña: la respuesta queda en audit_logs", async () => {
    const r = await asegurarCuentaInversionista(entrada(), deps());
    expect(JSON.stringify(r)).not.toContain("PASSWORD-FIJA");
  });
});

describe("asegurarCuentaInversionista — ya tenía cuenta", () => {
  it("resuelve por DPI ANTES que por correo", async () => {
    // Las 3 colisiones reales son la misma persona con dos correos. Buscar por
    // correo primero las estrellaría contra users_dpi_key; por DPI son ya_tenia.
    usuarios.push({ id: "u1", email: "esdras@gmail.com", nombre: "Esdras", role: "INVESTOR", dpi: "1234567890101" });
    const r = await asegurarCuentaInversionista(entrada({ email: "esdrasgamboa8@gmail.com" }), deps());
    expect(r).toMatchObject({ estado: "ya_tenia", resueltoPor: "dpi", usuarioEmail: "esdras@gmail.com" });
    expect(creados).toEqual([]);
  });

  it("avisa cuando el correo de cartera no es el de la cuenta, y NO lo reescribe", async () => {
    usuarios.push({ id: "u1", email: "esdras@gmail.com", nombre: "Esdras", role: "INVESTOR", dpi: "1234567890101" });
    const r = await asegurarCuentaInversionista(entrada({ email: "esdrasgamboa8@gmail.com" }), deps());
    expect(r.advertencias).toContain("correo_de_cartera_distinto_al_de_la_cuenta");
    // Reescribir users.email le rompería el login a esa persona.
    expect(actualizaciones.some((a) => "email" in a)).toBe(false);
  });

  it("encuentra los DPI sucios que ya están en producción", async () => {
    usuarios.push({ id: "u1", email: "inmonaco@gmail.com", nombre: "Monaco", role: "INVESTOR", dpi: "1852752810101." });
    const r = await asegurarCuentaInversionista(entrada({ dpi: "1852752810101" }), deps());
    expect(r).toMatchObject({ estado: "ya_tenia", resueltoPor: "dpi" });
  });

  it("cae a la búsqueda por correo cuando no hay DPI", async () => {
    usuarios.push({ id: "u1", email: "ana@example.com", nombre: "Ana", role: "CLIENT", dpi: null });
    const r = await asegurarCuentaInversionista(entrada({ dpi: null }), deps());
    expect(r).toMatchObject({ estado: "ya_tenia", resueltoPor: "email" });
  });

  it("NO manda correo a quien ya tenía cuenta", async () => {
    // El registro del portal crea la cuenta primero y el inversionista después:
    // mandarle "bienvenida" o "ahora representas a Ana Pérez" a Ana sería
    // absurdo. El aviso de empresa es de la otra rama.
    usuarios.push({ id: "u1", email: "ana@example.com", nombre: "Ana", role: "CLIENT", dpi: null });
    const r = await asegurarCuentaInversionista(entrada({ dpi: null }), deps());
    expect(bienvenidas).toEqual([]);
    expect(avisos).toEqual([]);
    expect(r.correo.enviado).toBe(false);
  });

  it("promueve CLIENT a INVESTOR pero no toca un ADMIN", async () => {
    usuarios.push({ id: "u1", email: "ana@example.com", nombre: "Ana", role: "CLIENT", dpi: null });
    usuarios.push({ id: "u2", email: "jefe@example.com", nombre: "Jefe", role: "ADMIN", dpi: null });

    await asegurarCuentaInversionista(entrada({ dpi: null }), deps());
    expect(actualizaciones).toContainEqual({ id: "u1", role: "INVESTOR" });

    actualizaciones.length = 0;
    await asegurarCuentaInversionista(entrada({ dpi: null, email: "jefe@example.com" }), deps());
    expect(actualizaciones).toEqual([]);
  });

  it("es idempotente: la segunda corrida no crea ni manda nada", async () => {
    const d = deps();
    await asegurarCuentaInversionista(entrada(), d);
    await asegurarCuentaInversionista(entrada(), d);
    expect(creados).toHaveLength(1);
    expect(bienvenidas).toHaveLength(1);
  });

  it("una carrera de dos altas simultáneas termina en ya_tenia, sin pisar la contraseña", async () => {
    const d = deps();
    fallarCreacion = () => {
      // Simula el 23505: otro proceso creó la cuenta entre la búsqueda y el insert.
      usuarios.push({ id: "u9", email: "ana@example.com", nombre: "Ana", role: "CLIENT", dpi: null });
      throw new Error("duplicate key value violates unique constraint users_email_key");
    };
    const r = await asegurarCuentaInversionista(entrada(), d);
    expect(r.estado).toBe("ya_tenia");
    // Pisar la contraseña de una cuenta viva le sacaría a alguien su acceso.
    expect(bienvenidas).toEqual([]);
    expect(actualizaciones.some((a) => "password" in a)).toBe(false);
  });
});

describe("asegurarCuentaInversionista — el correo puede fallar sin tumbar la cuenta", () => {
  it("reporta el fallo de envío pero deja la cuenta creada", async () => {
    const d = { ...deps(), enviarBienvenida: async () => ({ success: false, error: "resend caído" }) };
    const r = await asegurarCuentaInversionista(entrada(), d);
    expect(r.estado).toBe("creada");
    expect(r.correo).toMatchObject({ enviado: false });
    expect(r.advertencias).toContain("correo_no_enviado");
  });

  it("delata el modo DEV: la contraseña se fue a una sola bandeja", async () => {
    modo = { server: "DEV", redirige: true, destinatarioUnico: "jalvarado@clubcashin.com" };
    const r = await asegurarCuentaInversionista(entrada(), deps());
    expect(r.correo).toMatchObject({
      enviado: true,
      redirigido: true,
      destinatarioReal: "jalvarado@clubcashin.com",
    });
    expect(r.advertencias).toContain("correo_redirigido_por_modo_no_prod");
  });
});

describe("avisarEmpresaAgregada", () => {
  const empresa = (over: any = {}) => ({
    representanteEmail: "richard@example.com",
    representanteDpi: "1573661970101",
    representanteNombre: "Richard Kachler",
    inversionistaId: 86,
    inversionistaNombre: "Cube Investments S.A.",
    ...over,
  });

  it("manda el aviso al correo de la CUENTA del representante", async () => {
    usuarios.push({ id: "u1", email: "richardkachler93@gmail.com", nombre: "Richard", role: "INVESTOR", dpi: "1573661970101" });
    const r = await avisarEmpresaAgregada(empresa(), deps());
    expect(r).toMatchObject({ estado: "avisada", resueltoPor: "dpi" });
    expect(avisos[0]).toMatchObject({
      to: "richardkachler93@gmail.com",
      companyName: "Cube Investments S.A.",
      portalUrl: PORTAL,
    });
  });

  it("nunca crea una cuenta: si el representante no tiene, lo reporta", async () => {
    const r = await avisarEmpresaAgregada(empresa(), deps());
    expect(r).toMatchObject({ estado: "fallo", motivo: "representante_sin_cuenta" });
    expect(creados).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it("sin correo ni cuenta del representante, lo dice explícito", async () => {
    const r = await avisarEmpresaAgregada(empresa({ representanteEmail: null, representanteDpi: null }), deps());
    expect(r).toMatchObject({ estado: "fallo", motivo: "representante_sin_cuenta" });
  });
});

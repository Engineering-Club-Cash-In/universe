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

  it("promueve a INVESTOR y guarda el DPI", async () => {
    await asegurarCuentaInversionista(entrada(), deps());
    expect(actualizaciones[0]).toMatchObject({ role: "INVESTOR", dpi: "1234567890101" });
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

// El escenario que producía la cuenta duplicada. Cartera manda el DPI sin ceros
// a la izquierda ("4036613"); el normalizador de ESCRITURA exigía 13 dígitos
// exactos y guardaba NULL, así que a esa persona solo se la encontraba por
// correo. En cuanto alguien corrige el correo en cartera —cosa que este mismo
// sistema PIDE con `correo_de_cartera_distinto_al_de_la_cuenta`— la corrida
// siguiente no la encuentra ni por DPI (es NULL) ni por correo (cambió), y le
// crea otra cuenta: dos cuentas, un humano, dos contraseñas.
describe("asegurarCuentaInversionista — lo que se guarda es lo que se busca", () => {
  it("guarda el DPI corto, y por eso sobrevive a que le corrijan el correo", async () => {
    const d = deps();

    const primera = await asegurarCuentaInversionista(
      entrada({ dpi: "4036613", email: "jckafie@gmail.com" }),
      d,
    );
    expect(primera.estado).toBe("creada");
    expect(actualizaciones[0]).toMatchObject({ dpi: "4036613" });

    // Operación corrige el correo en cartera y el job vuelve a correr.
    const segunda = await asegurarCuentaInversionista(
      entrada({ dpi: "4036613", email: "jckafie@outlook.com" }),
      d,
    );

    expect(segunda).toMatchObject({ estado: "ya_tenia", resueltoPor: "dpi" });
    expect(usuarios).toHaveLength(1);
    expect(creados).toHaveLength(1);
  });

  it("guarda el DPI en la MISMA forma con la que después se busca", async () => {
    // Guardarlo con ceros a la izquierda o con basura de captura sería guardar
    // algo que la búsqueda normalizada no vuelve a encontrar tal cual.
    await asegurarCuentaInversionista(entrada({ dpi: "04036613" }), deps());
    expect(actualizaciones[0]).toMatchObject({ dpi: "4036613" });
  });

  it("lo que no es un DPI sigue quedando en NULL, jamás en cadena vacía", async () => {
    // El slot del '' en users.dpi (UNIQUE) YA está ocupado en producción.
    for (const basura of ["", "   ", "no-aplica", "000"]) {
      actualizaciones.length = 0;
      usuarios.length = 0;
      await asegurarCuentaInversionista(
        entrada({ dpi: basura, email: `x${basura.length}@example.com` }),
        deps(),
      );
      expect(actualizaciones[0]).toMatchObject({ dpi: null });
    }
  });
});

// A partir de que `crearUsuario` devuelve, la cuenta EXISTE y la contraseña
// solo vive en una variable local: no se persiste, no se devuelve (a propósito,
// para que no acabe en audit_logs) y no hay ninguna ruta de reenvío en todo el
// sistema. Cualquier throw después de ese punto deja a una persona con una
// cuenta que no sabe que tiene y a la que no puede entrar.
describe("asegurarCuentaInversionista — nada puede tirar después de crear la cuenta", () => {
  it("si el UPDATE de rol/DPI falla, igual manda la contraseña y lo reporta", async () => {
    const d = {
      ...deps(),
      actualizarUsuario: async () => {
        // Real: 23505 sobre users_dpi_key contra una fila sucia, o una carrera.
        throw new Error("duplicate key value violates unique constraint users_dpi_key");
      },
    };

    const r = await asegurarCuentaInversionista(entrada(), d);

    expect(r.estado).toBe("creada");
    expect(bienvenidas).toHaveLength(1);
    expect(r.advertencias).toContain("cuenta_creada_sin_rol_ni_dpi");
  });

  it("si el envío TIRA, no se traga la cuenta creada: la reporta como acceso perdido", async () => {
    const d = {
      ...deps(),
      enviarBienvenida: async () => {
        // Real: `emailSchema.parse(to)` de @cci/email tira fuera de su try.
        throw new Error("Invalid email");
      },
    };

    const r = await asegurarCuentaInversionista(entrada(), d);

    expect(r.estado).toBe("creada");
    expect(r.correo.enviado).toBe(false);
    expect(r.advertencias).toContain("correo_no_enviado");
    expect(r.advertencias).toContain("cuenta_creada_sin_contrasena_entregada");
  });

  it("un envío que devuelve success:false también es un acceso perdido", async () => {
    // Distinto de `correo_no_enviado` a secas: en `avisarEmpresaAgregada` un
    // correo que no sale es un aviso perdido, aquí es un ACCESO perdido.
    const d = { ...deps(), enviarBienvenida: async () => ({ success: false, error: "resend caído" }) };

    const r = await asegurarCuentaInversionista(entrada(), d);

    expect(r.advertencias).toContain("cuenta_creada_sin_contrasena_entregada");
  });

  it("el aviso de empresa que falla NO se marca como acceso perdido", async () => {
    usuarios.push({ id: "u1", email: "r@example.com", nombre: "R", role: "INVESTOR", dpi: "1573661970101" });
    const d = { ...deps(), enviarEmpresaAgregada: async () => { throw new Error("resend caído"); } };

    const r = await avisarEmpresaAgregada(
      {
        representanteEmail: "r@example.com",
        representanteDpi: "1573661970101",
        representanteNombre: "R",
        inversionistaId: 86,
        inversionistaNombre: "Cube Investments S.A.",
      },
      d,
    );

    expect(r.advertencias).toContain("correo_no_enviado");
    expect(r.advertencias).not.toContain("cuenta_creada_sin_contrasena_entregada");
  });
});

describe("vínculo frágil: la cuenta se encontró solo por el correo", () => {
  it("lo reporta y NO escribe el DPI", async () => {
    usuarios.push({
      id: "u1",
      email: "ana@example.com",
      nombre: "Ana",
      role: "CLIENT",
      dpi: null,
    });

    const r = await asegurarCuentaInversionista(entrada(), deps());

    expect(r.estado).toBe("ya_tenia");
    expect(r.resueltoPor).toBe("email");
    expect(r.advertencias).toContain("cuenta_anclada_solo_por_correo");
    // NO se escribe el DPI: `resolverUsuario` busca por DPI PRIMERO, así que
    // escribirlo dejaría esta cuenta ganando para siempre y corregir el correo
    // en cartera —el remedio que el propio sistema pide con
    // `correo_de_cartera_distinto_al_de_la_cuenta`— dejaría de servir. Además
    // `users.dpi` es UNIQUE y es llave de ESCRITURA contra cartera
    // (POST /api/cartera/investor resuelve la fila por DPI y aplica
    // numero_cuenta): afirmar identidad sobre la evidencia más débil del
    // módulo (un correo sin verificar) es peor que el duplicado que evita.
    expect(actualizaciones).toEqual([{ id: "u1", role: "INVESTOR" }]);
    expect(usuarios[0].dpi).toBeNull();
  });

  it("no lo reporta cuando la cuenta se resolvió por DPI", async () => {
    usuarios.push({
      id: "u1",
      email: "otro@example.com",
      nombre: "Ana",
      role: "INVESTOR",
      dpi: "1234567890101",
    });

    const r = await asegurarCuentaInversionista(entrada(), deps());

    expect(r.resueltoPor).toBe("dpi");
    expect(r.advertencias).not.toContain("cuenta_anclada_solo_por_correo");
  });

  it("reporta también cuando el DPI de la cuenta NO es el que tiene cartera", async () => {
    // Por correo se llegó a una cuenta con OTRO DPI: el vínculo tampoco se
    // sostiene, y aquí escribir sería pisar un dato de identidad ajeno.
    usuarios.push({
      id: "u1",
      email: "ana@example.com",
      nombre: "Ana",
      role: "INVESTOR",
      dpi: "9999999999999",
    });

    const r = await asegurarCuentaInversionista(entrada(), deps());

    expect(r.resueltoPor).toBe("email");
    expect(r.advertencias).toContain("cuenta_anclada_solo_por_correo");
    expect(usuarios[0].dpi).toBe("9999999999999");
  });

  it("no lo reporta cuando el DPI de la cuenta ya es el de cartera", async () => {
    usuarios.push({
      id: "u1",
      email: "ana@example.com",
      nombre: "Ana",
      role: "INVESTOR",
      // Mismo DPI, escrito con ceros a la izquierda: es el MISMO vínculo.
      dpi: "01234567890101",
    });

    const r = await asegurarCuentaInversionista(entrada(), deps());

    expect(r.advertencias).not.toContain("cuenta_anclada_solo_por_correo");
  });
});

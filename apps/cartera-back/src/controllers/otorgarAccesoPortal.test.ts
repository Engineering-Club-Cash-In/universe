import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El acto humano que la reconciliación diaria dejó de hacer sola.
 *
 * El cron detecta y reporta; abrir la cuenta —crear el usuario y mandar la
 * contraseña— pasa por aquí, que exige ADMIN de back office y no está en el
 * proxy que `auth-google` expone al portal. Ese es todo el arreglo: el sistema
 * perdió la información de quién escribió la fila, así que la decisión la toma
 * quien SÍ puede ver que "cuenta para VICTIMA S.A. → atacante@evil.com" no
 * cuadra, antes de que salga la contraseña.
 */

let filas: any[] = [];
let filtro: unknown = null;

mock.module("../database/index", () => ({
  client: {},
  lockPool: {},
  db: {
    select: () => ({
      from: () => ({
        where: (cond: any) => {
          filtro = cond;
          return Promise.resolve(filas);
        },
      }),
    }),
  },
}));

const provisionarSpy = mock(async (fila: any, _op: any) => ({
  inversionistaId: fila.inversionista_id,
  estado: "creada",
  usuarioEmail: fila.email,
  resueltoPor: null,
  correo: { enviado: true, plantilla: "bienvenida", redirigido: false, destinatarioReal: null },
  advertencias: [],
  motivo: null,
}));

mock.module("../services/portalProvisioning", () => ({
  provisionarInversionista: provisionarSpy,
}));

const { otorgarAccesoPortal } = await import("./otorgarAccesoPortal");

const ADMIN = { role: "ADMIN" };

const ctx = (over: any = {}) => ({
  body: { inversionista_ids: [7] },
  user: ADMIN,
  set: {} as { status?: number },
  ...over,
});

describe("otorgarAccesoPortal", () => {
  it("provisiona al inversionista pedido y devuelve qué pasó con su correo", async () => {
    filas = [
      {
        inversionista_id: 7,
        nombre: "Ana Pérez",
        email: "ana@example.com",
        dpi: 1234567890101,
        dpi_rep_legal: null,
      },
    ];
    provisionarSpy.mockClear();

    // Persona con correo: sin `correo_aprobado` no se provisiona
    // (`correo_aprobado_requerido`, ver el bloque de abajo).
    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: "ana@example.com" },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    // La consulta va ACOTADA a los ids pedidos: nunca se recorre la tabla.
    expect(filtro).not.toBeNull();
    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    // `soloAsegurarCuenta` para no repetirle a un representante el aviso de
    // "ahora representas a X" cada vez que alguien toca este botón.
    expect(provisionarSpy.mock.calls[0][1]).toMatchObject({ soloAsegurarCuenta: true });
    expect(r.resultados[0]).toMatchObject({ inversionistaId: 7, estado: "creada" });
  });

  it("a quien no sea ADMIN le responde 403 y NO provisiona a nadie", async () => {
    // Un asesor no reparte accesos al portal. Es la misma línea que ya trazan
    // aseguradoras.ts:16 y facturacionSnapshot.ts:137.
    filas = [];
    provisionarSpy.mockClear();

    const c = ctx({ user: { role: "ASESOR" } });
    await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBe(403);
    expect(provisionarSpy).toHaveBeenCalledTimes(0);
  });

  it("un id que no existe se reporta, no se inventa", async () => {
    filas = [];
    provisionarSpy.mockClear();

    const c = ctx({ body: { inversionista_ids: [999] } });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({
      inversionistaId: 999,
      estado: "fallo",
      motivo: "inversionista_no_encontrado",
    });
  });

  it("sin ids no hace nada y lo dice", async () => {
    filas = [];
    provisionarSpy.mockClear();

    const c = ctx({ body: { inversionista_ids: [] } });
    await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBe(400);
    expect(provisionarSpy).toHaveBeenCalledTimes(0);
  });
});

/**
 * EL CORREO APROBADO.
 *
 * Quien confirma no aprueba un id: aprueba UNA DIRECCIÓN, la que el diálogo le
 * enseñó. Entre que ese diálogo se pinta y el clic llega, el correo de la fila
 * se puede cambiar desde el CRM —y por gente de otras áreas: `editarInversionista`
 * cuelga de un guard de once familias de rol y este botón de cuatro—, así que
 * volver a leer la tabla al recibir el clic mandaba la contraseña a una
 * dirección que nadie miró. Como el único control de este botón ES ese vistazo,
 * eso lo anulaba entero.
 */
const persona = (over: any = {}) => ({
  inversionista_id: 7,
  nombre: "Ana Pérez",
  email: "ana@example.com",
  dpi: 1234567890101,
  dpi_rep_legal: null,
  ...over,
});

describe("otorgarAccesoPortal — el correo aprobado se revalida contra la fila", () => {
  it("si la fila sigue con el correo aprobado, provisiona", async () => {
    filas = [persona()];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: "ana@example.com" },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    // Y lo que viaja a provisionar es LA FILA, no el correo del cuerpo: el
    // correo aprobado solo tiene poder de veto. Si mandara él, el cuerpo de la
    // petición sería la fuente de verdad del destinatario.
    expect(provisionarSpy.mock.calls[0][0]).toMatchObject({
      inversionista_id: 7,
      email: "ana@example.com",
    });
    expect(r.resultados[0]).toMatchObject({ estado: "creada" });
  });

  it("si el correo de la fila CAMBIÓ, no provisiona nada y lo nombra", async () => {
    // La carrera, exactamente: se aprobó `ana@example.com` y para cuando llega
    // el clic la fila apunta a otro buzón.
    filas = [persona({ email: "atacante@evil.com" })];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: "ana@example.com" },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({
      inversionistaId: 7,
      estado: "fallo",
      // Código ESTABLE: lo traduce el front. Si alguien lo renombra, esto se
      // pone rojo antes de que el CRM empiece a mostrar un caso sin texto.
      motivo: "correo_aprobado_no_coincide",
    });
    // Y no se filtra a dónde apunta ahora: el motivo dice qué pasó, el CRM es
    // donde se va a mirar.
    expect(JSON.stringify(r)).not.toContain("atacante@evil.com");
  });

  it("la caja y los espacios del cuerpo NO cuentan como un cambio", async () => {
    // El repo guarda el correo con `.trim().toLowerCase()` (investor.ts:1253) y
    // `decidirProvisionamiento` normaliza igual. Comparar exacto daría un
    // "cambió" falso y dejaría a gente legítima sin acceso.
    filas = [persona({ email: "ana@example.com" })];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: "  Ana@Example.COM  " },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    expect(r.resultados[0]).toMatchObject({ estado: "creada" });
  });

  it("ni la caja y los espacios de LA FILA", async () => {
    // El otro lado de la asimetría, y el que de verdad existe en la base:
    // `inversionistas.email` es un varchar sin normalización propia, y el repo
    // no da por hecho que lo guardado venga en minúsculas —su propio lookup
    // aplica `lower()` A LA COLUMNA (investor.ts:551)—. Normalizar solo el lado
    // del cuerpo dejaría fuera a toda fila vieja capturada con mayúsculas: el
    // veto diría "cambió" sobre un correo que nadie tocó.
    filas = [persona({ email: "  Ana@Example.COM " })];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: "ana@example.com" },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    expect(r.resultados[0]).toMatchObject({ estado: "creada" });
  });

  it("una fila que se quedó SIN correo tampoco coincide", async () => {
    filas = [persona({ email: null })];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: "ana@example.com" },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({
      motivo: "correo_aprobado_no_coincide",
    });
  });

  it("SIN correo aprobado el camino de siempre queda intacto (la EMPRESA)", async () => {
    // La fila de empresa no lleva correo aprobado porque su diálogo no enseña
    // ninguno: al portal entra su REPRESENTANTE. Ese camino corta más abajo, en
    // `provisionarInversionista` (`es_empresa_el_acceso_es_del_representante`),
    // así que lo que hay que probar aquí es que el veto no se le adelanta.
    filas = [
      persona({ email: "empresa@example.com", dpi_rep_legal: "04036613" }),
    ];
    provisionarSpy.mockClear();

    const c = ctx({ body: { inversionista_ids: [7] } });
    await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBeUndefined();
    expect(provisionarSpy).toHaveBeenCalledTimes(1);
  });

  it("`correo_aprobado: null` se lee como 'no se aprobó ninguno', no como error", async () => {
    // El schema de la ruta lo admite (t.Nullable) porque un front que arma
    // `correo_aprobado: inv.email ?? null` es normal; devolverle 422 ahí solo
    // rompería el camino de empresa sin cerrar nada. Ese `?? null` es justo la
    // fila SIN correo, que no tiene nada que aprobar: con correo en la fila,
    // `null` es "no se aprobó" y corta con `correo_aprobado_requerido` (abajo).
    filas = [persona({ email: null })];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: null },
    });
    await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBeUndefined();
    expect(provisionarSpy).toHaveBeenCalledTimes(1);
  });

  it("un correo aprobado VACÍO es un llamador roto: 400, no 'no se aprobó nada'", async () => {
    filas = [persona()];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: "   " },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBe(400);
    expect(r).toMatchObject({ error: "correo_aprobado_invalido" });
    expect(provisionarSpy).toHaveBeenCalledTimes(0);
  });

  it("un correo aprobado con VARIOS ids se rechaza entero", async () => {
    // Aplicárselo a uno dejaría pasar a los otros sin aprobación; aplicárselo a
    // todos rechazaría a los que legítimamente tienen otro correo.
    filas = [persona(), persona({ inversionista_id: 8 })];
    provisionarSpy.mockClear();

    const c = ctx({
      body: {
        inversionista_ids: [7, 8],
        correo_aprobado: "ana@example.com",
      },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBe(400);
    expect(r).toMatchObject({
      error: "correo_aprobado_con_varios_inversionistas",
    });
    expect(provisionarSpy).toHaveBeenCalledTimes(0);
  });

  it("el mismo id repetido sigue siendo UN inversionista", async () => {
    // El doble clic manda `[7, 7]`. Los ids se deduplican antes de contarlos,
    // así que eso NO es "varios inversionistas" y no se le niega el acceso a
    // nadie por haber apretado dos veces.
    filas = [persona()];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7, 7], correo_aprobado: "ana@example.com" },
    });
    await otorgarAccesoPortal(c as any);

    expect(c.set.status).toBeUndefined();
    expect(provisionarSpy).toHaveBeenCalledTimes(1);
  });

  it("reenviar el MISMO cuerpo después de que la fila cambió ya no provisiona", async () => {
    // ¿Y si corre dos veces? El veto no gasta un token ni deja estado: vuelve a
    // comparar contra la fila de ESE momento. La primera corrida pasa; la
    // segunda, con la fila ya envenenada, corta. Lo importante es que reenviar
    // una aprobación vieja no vale como permiso sobre un correo nuevo.
    const cuerpo = { inversionista_ids: [7], correo_aprobado: "ana@example.com" };

    filas = [persona()];
    provisionarSpy.mockClear();
    await otorgarAccesoPortal(ctx({ body: cuerpo }) as any);
    expect(provisionarSpy).toHaveBeenCalledTimes(1);

    filas = [persona({ email: "atacante@evil.com" })];
    provisionarSpy.mockClear();
    const r: any = await otorgarAccesoPortal(ctx({ body: cuerpo }) as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({
      motivo: "correo_aprobado_no_coincide",
    });
  });

  // El veto del controller no vale nada si el schema de la ruta rechaza el
  // campo con 422 antes de llegar: `t.Object` de Elysia valida el cuerpo, y un
  // campo no declarado es un cuerpo inválido. Esto protege esa mitad, que los
  // mocks de arriba no pueden ver porque llaman al controller a mano.
  it("el schema de la ruta declara `correo_aprobado` en el cuerpo", () => {
    const fuente = readFileSync(
      join(import.meta.dir, "..", "routers", "investor.ts"),
      "utf8",
    );

    const desde = fuente.indexOf('"/investor/portal-access"');
    const hasta = fuente.indexOf('"/investor/portal-access-status"');
    expect(desde).toBeGreaterThan(-1);
    expect(hasta).toBeGreaterThan(desde);

    const bloque = fuente.slice(desde, hasta);
    expect(bloque).toContain("correo_aprobado");
    // Opcional: el camino de la EMPRESA no manda ninguno.
    expect(bloque).toContain("t.Optional(");
  });
});

/**
 * EL CORREO APROBADO ES OBLIGATORIO PARA LA PERSONA.
 *
 * El front decide "es empresa → no mando correo" al PINTAR el diálogo; cartera
 * decide empresa/persona con la fila del CLIC (`esEmpresaRepresentada`). Como
 * `editarInversionista` del CRM cambia `dpi_rep_legal` y `email` a la vez, el
 * diálogo podía abrir sobre una empresa y el clic llegar sobre una persona con
 * el correo de otro, sin nada que vetar. Por eso el control se EXIGE aquí: una
 * persona con correo y sin `correo_aprobado` no se provisiona.
 */
describe("otorgarAccesoPortal — la persona con correo necesita correo aprobado", () => {
  it("persona con correo y SIN correo aprobado: no provisiona y lo nombra", async () => {
    filas = [persona()];
    provisionarSpy.mockClear();

    const c = ctx({ body: { inversionista_ids: [7] } });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    // No es un 400: el cuerpo es válido, lo que falta es la aprobación de ESTA
    // fila, y se reporta por id como el resto de los desenlaces.
    expect(c.set.status).toBeUndefined();
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0]).toMatchObject({
      inversionistaId: 7,
      estado: "fallo",
      usuarioEmail: null,
      // Código ESTABLE: lo traduce el front.
      motivo: "correo_aprobado_requerido",
    });
    expect(r.resultados[0].correo.enviado).toBe(false);
  });

  it("la carrera: el diálogo la vio EMPRESA, al clic es PERSONA con otro correo", async () => {
    // El diálogo se pintó con `dpi_rep_legal` lleno —empresa, sin correo que
    // aprobar— y por eso el cuerpo no trae `correo_aprobado`. Entre el diálogo
    // y el clic alguien borró el representante y puso su correo: la fila que
    // se lee AHORA es una persona. Sin este control la contraseña salía a ese
    // buzón sin que nadie lo mirara.
    filas = [persona({ email: "atacante@evil.com", dpi_rep_legal: null })];
    provisionarSpy.mockClear();

    const c = ctx({ body: { inversionista_ids: [7] } });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({
      inversionistaId: 7,
      estado: "fallo",
      motivo: "correo_aprobado_requerido",
    });
    // Y no se filtra el correo nuevo en la respuesta.
    expect(JSON.stringify(r)).not.toContain("atacante@evil.com");
  });

  it("`correo_aprobado: null` sobre una persona CON correo tampoco alcanza", async () => {
    filas = [persona()];
    provisionarSpy.mockClear();

    const c = ctx({
      body: { inversionista_ids: [7], correo_aprobado: null },
    });
    const r: any = await otorgarAccesoPortal(c as any);

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({ motivo: "correo_aprobado_requerido" });
  });

  it("persona SIN correo en la fila queda exenta: sigue al camino de siempre", async () => {
    // No hay buzón al que mandar contraseña: `decidirProvisionamiento` la deja
    // en `omitida/sin_correo` sin crear cuenta. Exigirle aprobación sería
    // pedir que se apruebe un correo que no existe.
    for (const email of [null, "", "   "]) {
      filas = [persona({ email })];
      provisionarSpy.mockClear();

      const c = ctx({ body: { inversionista_ids: [7] } });
      const r: any = await otorgarAccesoPortal(c as any);

      expect(provisionarSpy).toHaveBeenCalledTimes(1);
      expect(r.resultados[0].motivo).not.toBe("correo_aprobado_requerido");
    }
  });

  it("EMPRESA sin correo aprobado: sigue a `es_empresa_el_acceso_es_del_representante`", async () => {
    // `dpi_rep_legal` distinto del propio `dpi`: empresa representada. Su
    // diálogo no enseña correo y no hay nada que aprobar; el corte lo hace
    // `provisionarInversionista` (portalProvisioning.test.ts lo prueba con la
    // implementación real). Aquí: que el requerido no se le adelante, tenga o
    // no correo la fila, y que lo que devuelve el servicio llegue tal cual.
    // NO `mockImplementationOnce`: si el controller no llamara al servicio, esa
    // respuesta quedaría encolada y se la comería la prueba siguiente. Se
    // cambia la implementación y se restaura en el `finally`, pase lo que pase.
    const original = provisionarSpy.getMockImplementation();
    // `as any`: el doble de arriba se tipó con la forma de "creada".
    provisionarSpy.mockImplementation((async (fila: any) => ({
      inversionistaId: fila.inversionista_id,
      estado: "fallo",
      usuarioEmail: null,
      resueltoPor: null,
      correo: { enviado: false, plantilla: null, redirigido: false, destinatarioReal: null },
      advertencias: [],
      motivo: "es_empresa_el_acceso_es_del_representante",
    })) as any);

    try {
      for (const email of ["empresa@example.com", null]) {
        filas = [persona({ email, dpi: 9876543210101, dpi_rep_legal: "04036613" })];
        provisionarSpy.mockClear();

        const c = ctx({ body: { inversionista_ids: [7] } });
        const r: any = await otorgarAccesoPortal(c as any);

        expect(provisionarSpy).toHaveBeenCalledTimes(1);
        expect(provisionarSpy.mock.calls[0][1]).toMatchObject({ soloAsegurarCuenta: true });
        expect(r.resultados[0]).toMatchObject({
          motivo: "es_empresa_el_acceso_es_del_representante",
        });
      }
    } finally {
      provisionarSpy.mockImplementation(original as any);
    }
  });

  it("quien se representa a SÍ MISMO (cero a la izquierda) es PERSONA: requiere aprobación", async () => {
    // El inversionista 187: `dpi=4036613`, `dpi_rep_legal='04036613'`. Leer
    // "tiene dpi_rep_legal ⇒ empresa" lo dejaría pasar sin aprobación.
    filas = [
      persona({ email: "javier@example.com", dpi: 4036613, dpi_rep_legal: "04036613" }),
    ];
    provisionarSpy.mockClear();

    const r: any = await otorgarAccesoPortal(
      ctx({ body: { inversionista_ids: [7] } }) as any,
    );

    expect(provisionarSpy).toHaveBeenCalledTimes(0);
    expect(r.resultados[0]).toMatchObject({ motivo: "correo_aprobado_requerido" });

    // Y con su correo aprobado, provisiona.
    provisionarSpy.mockClear();
    const r2: any = await otorgarAccesoPortal(
      ctx({
        body: { inversionista_ids: [7], correo_aprobado: "javier@example.com" },
      }) as any,
    );
    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    expect(r2.resultados[0]).toMatchObject({ estado: "creada" });
  });

  it("persona con su correo aprobado: provisiona como antes", async () => {
    filas = [persona()];
    provisionarSpy.mockClear();

    const r: any = await otorgarAccesoPortal(
      ctx({
        body: { inversionista_ids: [7], correo_aprobado: "ana@example.com" },
      }) as any,
    );

    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    expect(provisionarSpy.mock.calls[0][0]).toMatchObject({
      inversionista_id: 7,
      email: "ana@example.com",
    });
    expect(r.resultados[0]).toMatchObject({ estado: "creada", motivo: null });
  });

  it("con varios ids sin correo aprobado, se decide por fila: la persona se corta, la empresa sigue", async () => {
    filas = [
      persona({ inversionista_id: 7 }),
      persona({
        inversionista_id: 8,
        email: "empresa@example.com",
        dpi: 9876543210101,
        dpi_rep_legal: "04036613",
      }),
    ];
    provisionarSpy.mockClear();

    const r: any = await otorgarAccesoPortal(
      ctx({ body: { inversionista_ids: [7, 8] } }) as any,
    );

    expect(provisionarSpy).toHaveBeenCalledTimes(1);
    expect(provisionarSpy.mock.calls[0][0]).toMatchObject({ inversionista_id: 8 });
    expect(r.resultados[0]).toMatchObject({
      inversionistaId: 7,
      motivo: "correo_aprobado_requerido",
    });
    expect(r.resultados[1]).toMatchObject({ inversionistaId: 8 });
  });
});

import type { Browser, Frame, Page } from "puppeteer";
import { launchBrowser } from "../utils/functions/browser";

const URL_LOGIN = "https://agenciavirtual.sat.gob.gt/";
// SAT muestra "Procesando Información" bastante tiempo; con menos margen el
// login parece fallar cuando en realidad sigue cargando.
const TIMEOUT_NAV = 120000;

const SEL = {
  usuario: "#formContent\\:username",
  password: "#formContent\\:password",
  ingresar: "#formContent\\:cmdbtnIngresar",
  codigoVerificacion: "#formContent\\:inMaskVerifyCode",
  comprobarCodigo: "#formContent\\:cmdbtnVerifyCode",
  tablaVehiculos: "#frmAcciones\\:dtListadoVehiculos",
} as const;

export interface CredencialesSat {
  usuario: string;
  password: string;
}

export interface VehiculoSat {
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  estado: string;
}

export class SatLoginError extends Error {}
export class SatRequiereCodigoError extends SatLoginError {}

async function esperar(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Cloudflare resuelve su desafío solo; hay que darle tiempo antes de tocar el DOM. */
async function abrirLogin(page: Page) {
  await page.goto(URL_LOGIN, { waitUntil: "domcontentloaded", timeout: TIMEOUT_NAV });
  await esperar(6000);
  await page.waitForSelector(SEL.usuario, { timeout: 20000 });
}

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }, selector);
}

export async function iniciarSesion(page: Page, credenciales: CredencialesSat) {
  await abrirLogin(page);

  await page.type(SEL.usuario, credenciales.usuario, { delay: 60 });
  await page.type(SEL.password, credenciales.password, { delay: 60 });

  await page.click(SEL.ingresar);

  // SAT muestra "Procesando Información" un buen rato: se espera a que la URL
  // cambie o a que aparezca el campo de código, en vez de dormir un fijo.
  await page
    .waitForFunction(
      (selCodigo) => {
        if (!location.href.includes("login.jsf")) return true;
        const el = document.querySelector(selCodigo) as HTMLElement | null;
        return !!el && el.offsetParent !== null;
      },
      { timeout: TIMEOUT_NAV, polling: 500 },
      // El selector va con la barra invertida: sin ella el `:` del id JSF se
      // lee como pseudo-clase y querySelector lanza SyntaxError.
      SEL.codigoVerificacion,
    )
    .catch(() => null);

  if (await visible(page, SEL.codigoVerificacion)) {
    throw new SatRequiereCodigoError(
      "SAT solicitó código de verificación. El acceso desatendido no es posible en esta sesión.",
    );
  }

  const url = page.url();
  if (url.includes("login.jsf")) {
    throw new SatLoginError(`El login no avanzó. URL actual: ${url}`);
  }

  return url;
}

/** Mapea los enlaces del menú tras el login para ubicar la ruta a Vehículos Propios. */
export async function explorarMenu(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("a, button, span[onclick]")]
      .map((el) => ({
        texto: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        id: (el as HTMLElement).id || null,
        href: (el as HTMLAnchorElement).href || null,
        onclick: el.getAttribute("onclick") || null,
      }))
      .filter((e) => e.texto.length > 0),
  );
}

/** El listado se renderiza dentro del iframe `iframeContent` de la portada. */
async function esperarFrameListado(page: Page, timeout = 30000): Promise<Frame> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeout) {
    const frame = page.frames().find((f) => f.url().includes("listadoVehiculos"));
    if (frame) return frame;
    await esperar(500);
  }
  throw new SatLoginError("No apareció el iframe del listado de vehículos.");
}

/**
 * Navega a Vehículos Propios haciendo clic en el menú. No se replican los
 * parámetros de PrimeFaces porque `ses` cambia en cada sesión.
 */
export async function irAVehiculosPropios(page: Page): Promise<Frame> {
  // El menú se renderiza después de la portada; hay que esperarlo.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("a, span, li, div")].some(
          (el) =>
            (el.getAttribute("onclick") || "").includes("listadoVehiculos") ||
            (el.textContent || "").trim() === "Vehículos Propios",
        ),
      { timeout: 30000, polling: 500 },
    )
    .catch(() => null);

  // Hay varios nodos con el texto "Vehículos Propios"; solo uno lleva el
  // manejador que dispara la navegación.
  const clicado = await page.evaluate(() => {
    const todos = [...document.querySelectorAll<HTMLElement>("a, span, li, div")];
    const conHandler = todos.find((el) =>
      (el.getAttribute("onclick") || "").includes("listadoVehiculos"),
    );
    const objetivo =
      conHandler ??
      todos.find((el) => (el.textContent || "").trim() === "Vehículos Propios" && el.tagName === "A");
    if (!objetivo) return false;
    objetivo.click();
    return true;
  });

  if (!clicado) {
    throw new SatLoginError("No se encontró la opción 'Vehículos Propios' en el menú.");
  }

  const frame = await esperarFrameListado(page);
  await frame.waitForSelector(SEL.tablaVehiculos, { timeout: 30000 }).catch(() => null);
  return frame;
}

/** El listado arranca vacío: hay que pedir explícitamente todos los vehículos. */
export async function verTodosLosVehiculos(frame: Frame) {
  const clicado = await frame.evaluate(() => {
    const enlace = [...document.querySelectorAll("a")].find((a) =>
      /ver todos mis vehiculos/i.test(a.getAttribute("title") || a.textContent || ""),
    );
    if (!enlace) return false;
    (enlace as HTMLElement).click();
    return true;
  });

  if (!clicado) return false;
  await esperar(5000);
  return true;
}

export async function leerTablaVehiculos(frame: Frame): Promise<VehiculoSat[]> {
  await frame.waitForSelector(SEL.tablaVehiculos, { timeout: 20000 });

  return frame.evaluate((sel) => {
    const tabla = document.querySelector(sel);
    if (!tabla) return [];

    const filas = [...tabla.querySelectorAll("tbody tr")];
    return filas
      .map((fila) => {
        const celdas = [...fila.querySelectorAll("td")].map((td) =>
          (td.textContent || "").trim().replace(/\s+/g, " "),
        );
        return {
          placa: celdas[0] ?? "",
          tipo: celdas[1] ?? "",
          marca: celdas[2] ?? "",
          modelo: celdas[3] ?? "",
          color: celdas[4] ?? "",
          estado: celdas[5] ?? "",
        };
      })
      .filter((v) => v.placa.length > 0);
  }, SEL.tablaVehiculos);
}

export async function conNavegador<T>(fn: (page: Page, browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    return await fn(page, browser);
  } finally {
    await browser.close();
  }
}

// ── Punto de entrada ──
// Cartera solo raspa y devuelve. La persistencia y el cruce viven en el CRM,
// que es donde está la tabla `vehicles`.

export type EstadoConsultaSat = "OK" | "ERROR" | "CODIGO_REQUERIDO" | "BLOQUEADO";

export interface ResultadoScrapeSat {
  nit: string;
  estado: EstadoConsultaSat;
  vehiculos: VehiculoSat[];
  mensajeError?: string;
  /** HTML recortado de la página al fallar, para diagnosticar sin escribir a disco. */
  evidencia?: string;
}

const MAX_EVIDENCIA = 20000;

/**
 * Hoy es una sola cuenta (CUBE INVESTMENTS). Para sumar sociedades, esta
 * función pasa a devolver una lista y el resto del flujo no cambia.
 */
function credencialesDelEntorno(): CredencialesSat & { nit: string } {
  const usuario = process.env.SAT_AV_USUARIO;
  const password = process.env.SAT_AV_PASSWORD;

  if (!usuario || !password) {
    throw new Error("Faltan SAT_AV_USUARIO y/o SAT_AV_PASSWORD en el entorno.");
  }

  // En Agencia Virtual el usuario es el NIT.
  return { usuario, password, nit: usuario };
}

function clasificarError(error: unknown, evidencia?: string): EstadoConsultaSat {
  if (error instanceof SatRequiereCodigoError) return "CODIGO_REQUERIDO";

  const texto = (evidencia || "").toLowerCase();
  if (texto.includes("cf-browser-verification") || texto.includes("cf-error-details")) {
    return "BLOQUEADO";
  }

  return "ERROR";
}

export async function obtenerVehiculosPropios(): Promise<ResultadoScrapeSat> {
  const credenciales = credencialesDelEntorno();

  try {
    const vehiculos = await conNavegador(async (page) => {
      try {
        await iniciarSesion(page, credenciales);
        const listado = await irAVehiculosPropios(page);
        await verTodosLosVehiculos(listado);
        return await leerTablaVehiculos(listado);
      } catch (error) {
        const evidencia = await page.content().catch(() => "");
        throw Object.assign(error as Error, { evidencia: evidencia.slice(0, MAX_EVIDENCIA) });
      }
    });

    return { nit: credenciales.nit, estado: "OK", vehiculos };
  } catch (error) {
    const evidencia = (error as { evidencia?: string }).evidencia;
    return {
      nit: credenciales.nit,
      estado: clasificarError(error, evidencia),
      vehiculos: [],
      mensajeError: error instanceof Error ? error.message : String(error),
      evidencia,
    };
  }
}

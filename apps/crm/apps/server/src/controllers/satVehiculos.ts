import type { Browser, Frame, Page } from "puppeteer";
import { launchBrowser } from "../lib/browser";

const URL_LOGIN = "https://agenciavirtual.sat.gob.gt/";
const TIMEOUT_NAV = 120000;

const SEL = {
	usuario: "#formContent\\:username",
	password: "#formContent\\:password",
	ingresar: "#formContent\\:cmdbtnIngresar",
	codigoVerificacion: "#formContent\\:inMaskVerifyCode",
	tablaVehiculos: "#frmAcciones\\:dtListadoVehiculos",
} as const;

export interface CredencialesSat {
	usuario: string;
	password: string;
}

export interface SenalesSatVehiculo {
	impuestoCirculacionPagado: boolean | null;
	puedeAutorizarTraspaso: boolean | null;
	puedeImprimirTarjeta: boolean | null;
	puedeImprimirCertificado: boolean | null;
}

export interface VehiculoSatPropio extends SenalesSatVehiculo {
	placa: string;
	tipo: string;
	marca: string;
	modelo: string;
	color: string;
	estado: string;
}

export type EstadoConsultaSat = "OK" | "ERROR" | "CODIGO_REQUERIDO" | "BLOQUEADO";

export interface SatVehiculosPropiosResponse {
	nit: string;
	estado: EstadoConsultaSat;
	vehiculos: VehiculoSatPropio[];
	/** Solo es true cuando el paginador de SAT quedó agotado. */
	listadoCompleto: boolean;
	mensajeError?: string;
	evidencia?: string;
}

export class SatLoginError extends Error {}
export class SatRequiereCodigoError extends SatLoginError {}
export class SatScrapeError extends Error {}

async function esperar(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function abrirLogin(page: Page) {
	await page.goto(URL_LOGIN, {
		waitUntil: "domcontentloaded",
		timeout: TIMEOUT_NAV,
	});
	await esperar(6000);
	await page.waitForSelector(SEL.usuario, { timeout: 20000 });
}

async function visible(page: Page, selector: string): Promise<boolean> {
	return page.evaluate((sel) => {
		const element = document.querySelector(sel) as HTMLElement | null;
		if (!element) return false;
		const style = window.getComputedStyle(element);
		return (
			style.display !== "none" &&
			style.visibility !== "hidden" &&
			element.offsetParent !== null
		);
	}, selector);
}

export async function iniciarSesion(
	page: Page,
	credenciales: CredencialesSat,
) {
	await abrirLogin(page);
	await page.type(SEL.usuario, credenciales.usuario, { delay: 60 });
	await page.type(SEL.password, credenciales.password, { delay: 60 });
	await page.click(SEL.ingresar);

	await page
		.waitForFunction(
			(selCodigo) => {
				if (!location.href.includes("login.jsf")) return true;
				const element = document.querySelector(selCodigo) as HTMLElement | null;
				return !!element && element.offsetParent !== null;
			},
			{ timeout: TIMEOUT_NAV, polling: 500 },
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

export async function explorarMenu(page: Page) {
	return page.evaluate(() =>
		[...document.querySelectorAll("a, button, span[onclick]")]
			.map((element) => ({
				texto: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
				id: (element as HTMLElement).id || null,
				href: (element as HTMLAnchorElement).href || null,
				onclick: element.getAttribute("onclick") || null,
			}))
			.filter((element) => element.texto.length > 0),
	);
}

async function esperarFrameListado(page: Page, timeout = 90000): Promise<Frame> {
	const inicio = Date.now();
	while (Date.now() - inicio < timeout) {
		const frame = page.frames().find((item) => item.url().includes("listadoVehiculos"));
		if (frame) return frame;
		await esperar(500);
	}
	throw new SatLoginError("No apareció el iframe del listado de vehículos.");
}

export async function irAVehiculosPropios(page: Page): Promise<Frame> {
	await page
		.waitForFunction(
			() =>
				[...document.querySelectorAll("a, span, li, div")].some(
					(element) =>
						(element.getAttribute("onclick") || "").includes("listadoVehiculos") ||
						(element.textContent || "").trim() === "Vehículos Propios",
				),
			{ timeout: 30000, polling: 500 },
		)
		.catch(() => null);

	const clicado = await page.evaluate(() => {
		const elementos = [...document.querySelectorAll<HTMLElement>("a, span, li, div")];
		const conHandler = elementos.find((element) =>
			(element.getAttribute("onclick") || "").includes("listadoVehiculos"),
		);
		const objetivo =
			conHandler ??
			elementos.find(
				(element) =>
					(element.textContent || "").trim() === "Vehículos Propios" &&
					element.tagName === "A",
			);
		if (!objetivo) return false;
		objetivo.click();
		return true;
	});

	if (!clicado) {
		throw new SatLoginError("No se encontró la opción 'Vehículos Propios' en el menú.");
	}

	const frame = await esperarFrameListado(page);
	await frame.waitForSelector(SEL.tablaVehiculos, { timeout: 90000 }).catch(() => null);
	return frame;
}

export async function verTodosLosVehiculos(frame: Frame) {
	await frame
		.waitForFunction(
			() =>
				[...document.querySelectorAll("a")].some((anchor) =>
					/ver todos mis vehiculos/i.test(
						anchor.getAttribute("title") || anchor.textContent || "",
					),
				),
			{ timeout: 15000, polling: 250 },
		)
		.catch(() => null);

	const clicado = await frame.evaluate(() => {
		const enlace = [...document.querySelectorAll("a")].find((anchor) =>
			/ver todos mis vehiculos/i.test(
				anchor.getAttribute("title") || anchor.textContent || "",
			),
		);
		if (!enlace) return false;
		(enlace as HTMLElement).click();
		return true;
	});

	if (!clicado) return false;
	await esperar(5000);
	return true;
}

/**
 * `Ver todos mis vehiculos` debería dejar el paginador sin páginas pendientes.
 * Si SAT conserva un botón Siguiente habilitado, no se debe tratar la tabla
 * parcial como si fuera el listado completo.
 */
export async function listadoSatCompleto(frame: Frame): Promise<boolean> {
	return frame.evaluate((selector) => {
		const tabla = document.querySelector(selector);
		if (!tabla) return false;

		const paginadores = [
			document.getElementById(`${tabla.id}_paginator_top`),
			document.getElementById(`${tabla.id}_paginator_bottom`),
		].filter((element): element is HTMLElement => element !== null);
		const candidatos = paginadores.length
			? paginadores.flatMap((paginador) =>
					[...paginador.querySelectorAll<HTMLElement>(
						".ui-paginator-next, [title*='Next'], [title*='Siguiente']",
					)],
			  )
			: [];
		const siguiente = candidatos[0];

		if (!siguiente) return true;
		return (
			siguiente.classList.contains("ui-state-disabled") ||
			siguiente.getAttribute("aria-disabled") === "true" ||
			(siguiente as HTMLButtonElement).disabled
		);
	}, SEL.tablaVehiculos);
}

export async function leerTablaVehiculos(frame: Frame): Promise<VehiculoSatPropio[]> {
	await frame.waitForSelector(SEL.tablaVehiculos, { timeout: 20000 });

	return frame.evaluate((selector) => {
		const tabla = document.querySelector(selector);
		if (!tabla) return [];

		const controlesActivos = (celda: Element | undefined) => {
			if (!celda) return [];
			return [...celda.querySelectorAll<HTMLElement>("a, button, input, img")].filter(
				(element) => {
					const deshabilitado = element.closest(
						"[disabled], [aria-disabled='true'], .ui-state-disabled, .disabled",
					);
					return !deshabilitado;
				},
			);
		};

		const leerImpresiones = (celda: Element | undefined) => {
			const controles = controlesActivos(celda);
			if (controles.length === 0) {
				return {
					puedeImprimirTarjeta: false,
					puedeImprimirCertificado: false,
				};
			}

			const descripcion = (element: HTMLElement) =>
				[
					element.getAttribute("title"),
					element.getAttribute("alt"),
					element.getAttribute("src"),
					element.getAttribute("href"),
					element.getAttribute("onclick"),
				]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
			const tarjeta = controles.filter((element) =>
				descripcion(element).includes("tarjeta") ||
				descripcion(element).includes("circulacion"),
			);
			const certificado = controles.filter((element) =>
				descripcion(element).includes("certificado") ||
				descripcion(element).includes("propiedad"),
			);

			if (tarjeta.length > 0 || certificado.length > 0) {
				return {
					puedeImprimirTarjeta: tarjeta.length > 0,
					puedeImprimirCertificado: certificado.length > 0,
				};
			}

			// SAT puede renderizar solo los iconos sin texto ni atributos. En ese
			// caso, dos controles activos representan los dos documentos.
			return {
				puedeImprimirTarjeta: controles.length >= 2 ? true : null,
				puedeImprimirCertificado: controles.length >= 2 ? true : null,
			};
		};

		return [...tabla.querySelectorAll("tbody tr")]
			.filter((fila) => {
				const celdas = [...fila.querySelectorAll("td")];
				const texto = (fila.textContent || "").trim().replace(/\s+/g, " ");

				// PrimeFaces renderiza una fila especial para estados vacíos o de
				// carga. No tiene las diez columnas del registro real y no debe
				// convertirse en un vehículo con la frase de la interfaz como placa.
				return (
					celdas.length >= 10 &&
					!fila.classList.contains("ui-datatable-empty-message") &&
					!fila.querySelector(".ui-datatable-empty-message") &&
					!fila.querySelector("[colspan]") &&
					!/no se encontraron registros|no hay registros|no records found/i.test(texto)
				);
			})
			.map((fila) => {
				const celdas = [...fila.querySelectorAll("td")];
				const textos = celdas.map((celda) =>
					(celda.textContent || "").trim().replace(/\s+/g, " "),
				);
				const puedeAutorizarTraspaso =
					controlesActivos(celdas[6]).length > 0;
				const impresiones = leerImpresiones(celdas[9]);
				const estado = textos[5] ?? "";
				const estadoActivo = estado.trim().toLowerCase() === "activo";
				const impuestoCirculacionPagado = estadoActivo
					? puedeAutorizarTraspaso === true &&
						impresiones.puedeImprimirTarjeta === true &&
						impresiones.puedeImprimirCertificado === true
						? true
						: puedeAutorizarTraspaso === false ||
								impresiones.puedeImprimirTarjeta === false ||
								impresiones.puedeImprimirCertificado === false
							? false
							: null
					: null;

				return {
					placa: textos[0] ?? "",
					tipo: textos[1] ?? "",
					marca: textos[2] ?? "",
					modelo: textos[3] ?? "",
					color: textos[4] ?? "",
					estado: estado,
					impuestoCirculacionPagado,
					puedeAutorizarTraspaso,
					puedeImprimirTarjeta: impresiones.puedeImprimirTarjeta,
					puedeImprimirCertificado: impresiones.puedeImprimirCertificado,
				};
			})
			.filter((vehiculo) => vehiculo.placa.length > 0);
	}, SEL.tablaVehiculos);
}

export async function conNavegador<T>(
	fn: (page: Page, browser: Browser) => Promise<T>,
): Promise<T> {
	const browser = await launchBrowser();
	try {
		const page = await browser.newPage();
		await page.setViewport({ width: 1400, height: 900 });
		return await fn(page, browser);
	} finally {
		await browser.close();
	}
}

const MAX_EVIDENCIA = 20000;
const CHALLENGE_TITLES = [
	"just a moment",
	"attention required",
	"access denied",
	"un momento",
];
const CHALLENGE_MARKERS = [
	"cf-browser-verification",
	"cf-error-details",
	"challenge-platform",
	"__cf_chl_",
	"cf-chl-",
];

function credencialesDelEntorno(): CredencialesSat & { nit: string } {
	const usuario = process.env.SAT_AV_USUARIO;
	const password = process.env.SAT_AV_PASSWORD;

	if (!usuario || !password) {
		throw new Error("Faltan SAT_AV_USUARIO y/o SAT_AV_PASSWORD en el entorno.");
	}

	return { usuario, password, nit: usuario };
}

function clasificarError(error: unknown, evidencia?: string): EstadoConsultaSat {
	if (error instanceof SatRequiereCodigoError) return "CODIGO_REQUERIDO";

	const texto = (evidencia || "").toLowerCase();
	if (
		CHALLENGE_TITLES.some((titulo) => texto.includes(titulo)) ||
		CHALLENGE_MARKERS.some((marcador) => texto.includes(marcador))
	) {
		return "BLOQUEADO";
	}

	return "ERROR";
}

export async function obtenerVehiculosPropios(): Promise<SatVehiculosPropiosResponse> {
	const nit = process.env.SAT_AV_USUARIO ?? "";

	try {
		const credenciales = credencialesDelEntorno();
		const vehiculos = await conNavegador(async (page) => {
			try {
				await iniciarSesion(page, credenciales);
				const listado = await irAVehiculosPropios(page);

				if (!(await verTodosLosVehiculos(listado))) {
					throw new SatScrapeError(
						"No se encontró el enlace 'Ver todos mis vehiculos'; la página cambió.",
					);
				}
				if (!(await listadoSatCompleto(listado))) {
					throw new SatScrapeError(
						"El listado de vehículos de SAT quedó incompleto; se cancela la verificación para evitar alertas falsas.",
					);
				}

				return await leerTablaVehiculos(listado);
			} catch (error) {
				const evidencia = await page.content().catch(() => "");
				throw Object.assign(error as Error, {
					evidencia: evidencia.slice(0, MAX_EVIDENCIA),
				});
			}
		});

		if (vehiculos.length === 0) {
			throw new SatScrapeError(
				"SAT devolvió un listado vacío; se cancela la verificación para evitar alertas falsas.",
			);
		}

		return { nit, estado: "OK", vehiculos, listadoCompleto: true };
	} catch (error) {
		const evidencia = (error as { evidencia?: string }).evidencia;
		return {
			nit,
			estado: clasificarError(error, evidencia),
			vehiculos: [],
			listadoCompleto: false,
			mensajeError: error instanceof Error ? error.message : String(error),
			evidencia,
		};
	}
}

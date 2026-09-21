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

export type EstadoConsultaSat =
	| "OK"
	| "ERROR"
	| "CODIGO_REQUERIDO"
	| "BLOQUEADO";

export interface SatVehiculosPropiosResponse {
	nit: string;
	estado: EstadoConsultaSat;
	vehiculos: VehiculoSatPropio[];
	/** Solo es true cuando el paginador de SAT quedó agotado. */
	listadoCompleto: boolean;
	mensajeError?: string;
	evidencia?: string;
}

export interface SatTitularObjetivo {
	nit: string;
	nombre: string;
}

export interface SatVehiculosTitularResponse extends SatTitularObjetivo {
	estado: EstadoConsultaSat;
	vehiculos: VehiculoSatPropio[];
	/** Solo es true cuando se recorrieron todas las páginas del titular. */
	listadoCompleto: boolean;
	mensajeError?: string;
	evidencia?: string;
}

export interface SatVehiculosDelegadosResponse {
	cuentaNit: string;
	estado: EstadoConsultaSat;
	titulares: SatVehiculosTitularResponse[];
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

async function marcarPermisosDelegados(page: Page) {
	const marcado = await page.evaluate(() => {
		const normalizar = (value: string | null | undefined) =>
			(value || "")
				.normalize("NFD")
				.replace(/[\u0300-\u036f]/g, "")
				.toLowerCase()
				.replace(/\s+/g, " ")
				.trim();

		const candidatos = [
			...document.querySelectorAll<HTMLInputElement>(
				"input[type='checkbox'], input[type='radio']",
			),
		];
		const checkbox = candidatos.find((element) => {
			const etiquetaAria = normalizar(element.getAttribute("aria-label"));
			if (etiquetaAria.includes("permisos delegados")) return true;

			const etiqueta = element.id
				? document.querySelector<HTMLLabelElement>(
						`label[for='${CSS.escape(element.id)}']`,
					)
				: null;
			if (normalizar(etiqueta?.textContent).includes("permisos delegados")) {
				return true;
			}

			const contenedor = element.closest(
				".ui-selectbooleancheckbox, label, fieldset, td, .login-field",
			);
			return normalizar(contenedor?.textContent).includes("permisos delegados");
		});

		if (!checkbox) return false;
		if (!checkbox.checked) checkbox.click();
		return checkbox.checked;
	});

	if (!marcado) {
		throw new SatLoginError(
			"No se encontró o no se pudo activar 'Permisos delegados' en el login de SAT.",
		);
	}
}

export async function iniciarSesion(
	page: Page,
	credenciales: CredencialesSat,
	opciones: { permisosDelegados?: boolean } = {},
) {
	await abrirLogin(page);
	if (opciones.permisosDelegados) await marcarPermisosDelegados(page);
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

export async function seleccionarTitular(
	page: Page,
	titular: SatTitularObjetivo,
) {
	const nitObjetivo = normalizarNitTitular(titular.nit);
	await page.waitForSelector("#contribButton", { timeout: 30000 });
	await page.click("#contribButton");
	await page.waitForFunction(
		(nit) =>
			[
				...document.querySelectorAll<HTMLElement>(
					".menu-contrib a.ui-menuitem-link",
				),
			].some((element) => {
				const style = window.getComputedStyle(element);
				return (
					(element.textContent || "")
						.toUpperCase()
						.replace(/[^A-Z0-9]/g, "")
						.includes(nit) &&
					style.display !== "none" &&
					style.visibility !== "hidden" &&
					element.offsetParent !== null
				);
			}),
		{ timeout: 30000, polling: 300 },
		nitObjetivo,
	);

	const seleccionado = await page.evaluate((nit) => {
		const enlace = [
			...document.querySelectorAll<HTMLElement>(
				".menu-contrib a.ui-menuitem-link",
			),
		].find((element) =>
			(element.textContent || "")
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, "")
				.includes(nit),
		);
		if (!enlace) return false;
		enlace.click();
		return true;
	}, nitObjetivo);

	if (!seleccionado) {
		throw new SatLoginError(
			`No se encontró el titular delegado ${titular.nit} (${titular.nombre}).`,
		);
	}

	await page.waitForFunction(
		(nit) =>
			(document.querySelector("#lblUserTop")?.textContent || "")
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, "")
				.includes(nit),
		{ timeout: 30000, polling: 300 },
		nitObjetivo,
	);
	await esperar(1500);
}

export async function explorarMenu(page: Page) {
	return page.evaluate(() =>
		[...document.querySelectorAll("a, button, span[onclick]")]
			.map((element) => ({
				texto: (element.textContent || "")
					.trim()
					.replace(/\s+/g, " ")
					.slice(0, 80),
				id: (element as HTMLElement).id || null,
				href: (element as HTMLAnchorElement).href || null,
				onclick: element.getAttribute("onclick") || null,
			}))
			.filter((element) => element.texto.length > 0),
	);
}

async function esperarFrameListado(
	page: Page,
	timeout = 90000,
	nitEsperado?: string,
): Promise<Frame> {
	const inicio = Date.now();
	while (Date.now() - inicio < timeout) {
		const candidatos = page
			.frames()
			.filter((item) => item.url().includes("listadoVehiculos"));
		for (const frame of candidatos) {
			if (nitEsperado) {
				const nitListado = await frame
					.evaluate(() => {
						const texto = document.body?.innerText ?? "";
						return texto.match(/\bNIT\s*:\s*([A-Z0-9-]+)/i)?.[1] ?? null;
					})
					.catch(() => null);
				if (
					normalizarNitTitular(nitListado ?? "") !==
					normalizarNitTitular(nitEsperado)
				) {
					continue;
				}
			}
			return frame;
		}
		await esperar(500);
	}
	throw new SatLoginError(
		nitEsperado
			? `No apareció el listado de vehículos del titular ${nitEsperado}.`
			: "No apareció el iframe del listado de vehículos.",
	);
}

export async function irAVehiculosPropios(page: Page): Promise<Frame> {
	await page
		.waitForFunction(
			() =>
				[...document.querySelectorAll("a, span, li, div")].some(
					(element) =>
						(element.getAttribute("onclick") || "").includes(
							"listadoVehiculos",
						) || (element.textContent || "").trim() === "Vehículos Propios",
				),
			{ timeout: 30000, polling: 500 },
		)
		.catch(() => null);

	const clicado = await page.evaluate(() => {
		const elementos = [
			...document.querySelectorAll<HTMLElement>("a, span, li, div"),
		];
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
		throw new SatLoginError(
			"No se encontró la opción 'Vehículos Propios' en el menú.",
		);
	}

	const frame = await esperarFrameListado(page);
	await frame
		.waitForSelector(SEL.tablaVehiculos, { timeout: 90000 })
		.catch(() => null);
	return frame;
}

/** Flujo de Agencia Virtual cuando la cuenta inició con permisos delegados. */
export async function irAListadoVehiculosDelegado(
	page: Page,
	nitTitular: string,
): Promise<Frame> {
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll<HTMLAnchorElement>("a")].some((element) =>
				(element.getAttribute("onclick") || "").includes(
					"listadoVehiculos.jsf",
				),
			),
		{ timeout: 30000, polling: 300 },
	);
	const clicado = await page.evaluate(() => {
		const enlace = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
			(element) =>
				(element.getAttribute("onclick") || "").includes(
					"listadoVehiculos.jsf",
				),
		);
		if (!enlace) return false;
		enlace.click();
		return true;
	});
	if (!clicado) {
		throw new SatLoginError("No se encontró la opción 'Listado de Vehículos'.");
	}

	const frame = await esperarFrameListado(page, 90000, nitTitular);
	await frame.waitForSelector(SEL.tablaVehiculos, { timeout: 90000 });
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
			? paginadores.flatMap((paginador) => [
					...paginador.querySelectorAll<HTMLElement>(
						".ui-paginator-next, [title*='Next'], [title*='Siguiente']",
					),
				])
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

export async function leerTablaVehiculos(
	frame: Frame,
): Promise<VehiculoSatPropio[]> {
	await frame.waitForSelector(SEL.tablaVehiculos, { timeout: 20000 });

	return frame.evaluate((selector) => {
		const tabla = document.querySelector(selector);
		if (!tabla) return [];

		const controlesActivos = (celda: Element | undefined) => {
			if (!celda) return [];
			return [
				...celda.querySelectorAll<HTMLElement>(
					"a, button, input:not([type='hidden']), span[onclick], img",
				),
			].filter((element) => {
				// Una accion anidada (p. ej. <a><img>) no es otro control.
				const accionPadre = element.parentElement?.closest(
					"a, button, input, span[onclick], img[onclick]",
				);
				if (accionPadre && celda.contains(accionPadre)) {
					return false;
				}
				const deshabilitado = element.closest(
					"[disabled], [aria-disabled='true'], .ui-state-disabled, .disabled",
				);
				return !deshabilitado;
			});
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
				[element, ...element.querySelectorAll<HTMLElement>("img")]
					.flatMap((item) => [
						item.getAttribute("title"),
						item.getAttribute("alt"),
						item.getAttribute("src"),
						item.getAttribute("href"),
						item.getAttribute("onclick"),
					])
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
			const tarjeta = controles.filter(
				(element) =>
					descripcion(element).includes("tarjeta") ||
					descripcion(element).includes("circulacion"),
			);
			const certificado = controles.filter(
				(element) =>
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
					!/no se encontraron registros|no hay registros|no records found/i.test(
						texto,
					)
				);
			})
			.map((fila) => {
				const celdas = [...fila.querySelectorAll("td")];
				const textos = celdas.map((celda) =>
					(celda.textContent || "").trim().replace(/\s+/g, " "),
				);
				const puedeAutorizarTraspaso = controlesActivos(celdas[6]).length > 0;
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

function firmaPagina(vehiculos: VehiculoSatPropio[]) {
	return vehiculos
		.map(
			(vehiculo) => `${vehiculo.placa}|${vehiculo.estado}|${vehiculo.modelo}`,
		)
		.join(";");
}

async function hacerClickSiguiente(frame: Frame): Promise<boolean> {
	return frame.evaluate((selector) => {
		const tabla = document.querySelector(selector);
		if (!tabla) return false;

		const paginadores = [
			document.getElementById(`${tabla.id}_paginator_top`),
			document.getElementById(`${tabla.id}_paginator_bottom`),
		].filter((element): element is HTMLElement => element !== null);
		const selectorSiguiente =
			".ui-paginator-next, [title*='Next'], [title*='Siguiente'], " +
			"[aria-label*='next'], [id$=':btnNext'], [name$=':btnNext']";
		const botones = paginadores.length
			? paginadores.flatMap((paginador) => [
					...paginador.querySelectorAll<HTMLElement>(selectorSiguiente),
				])
			: [...document.querySelectorAll<HTMLElement>(selectorSiguiente)];
		const siguiente = botones.find(
			(element) =>
				!element.classList.contains("ui-state-disabled") &&
				element.getAttribute("aria-disabled") !== "true" &&
				!(element as HTMLButtonElement).disabled,
		);

		if (!siguiente) return false;
		siguiente.click();
		return true;
	}, SEL.tablaVehiculos);
}

/** Lee las diez filas visibles y avanza hasta agotar la paginación de SAT. */
export async function leerTodasLasPaginas(
	frame: Frame,
): Promise<{ vehiculos: VehiculoSatPropio[]; listadoCompleto: boolean }> {
	const MAX_PAGINAS = 500;
	const vehiculos = new Map<string, VehiculoSatPropio>();
	const totalRegistros = await frame.evaluate(() => {
		const texto = document.body?.innerText ?? "";
		const encontrado = texto.match(/Total\s+Registros\s*:\s*([\d.,]+)/i);
		return encontrado ? Number(encontrado[1].replace(/[^\d]/g, "")) : null;
	});
	let filasLeidas = 0;

	for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
		const actuales = await leerTablaVehiculos(frame);
		filasLeidas += actuales.length;
		const firmaAnterior = firmaPagina(actuales);
		for (const vehiculo of actuales) {
			const clave = vehiculo.placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
			if (clave) vehiculos.set(clave, vehiculo);
		}

		const avanzo = await hacerClickSiguiente(frame);
		if (!avanzo) {
			return {
				vehiculos: [...vehiculos.values()],
				listadoCompleto:
					totalRegistros !== null && filasLeidas === totalRegistros,
			};
		}

		await frame.waitForFunction(
			(selector, firma) => {
				const tabla = document.querySelector(selector);
				if (!tabla) return false;
				const filas = [...tabla.querySelectorAll("tbody tr")]
					.map((fila) => {
						const textos = [...fila.querySelectorAll("td")].map((celda) =>
							(celda.textContent || "").trim().replace(/\s+/g, " "),
						);
						return `${textos[0] ?? ""}|${textos[5] ?? ""}|${textos[3] ?? ""}`;
					})
					.join(";");
				return filas.length > 0 && filas !== firma;
			},
			{ timeout: 30000, polling: 300 },
			SEL.tablaVehiculos,
			firmaAnterior,
		);
	}

	return { vehiculos: [...vehiculos.values()], listadoCompleto: false };
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

function clasificarError(
	error: unknown,
	evidencia?: string,
): EstadoConsultaSat {
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

function normalizarNitTitular(nit: string) {
	return nit.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function titularesDelegadosDelEntorno(): SatTitularObjetivo[] {
	const raw = (
		process.env.SAT_AV_TITULARES ??
		process.env.SAT_AV_TITULAR_NITS ??
		""
	).trim();
	if (!raw) {
		throw new Error(
			"Falta SAT_AV_TITULARES. Debe contener un JSON con los titulares delegados.",
		);
	}

	let parsed: unknown;
	try {
		parsed = raw.startsWith("[") ? JSON.parse(raw) : raw.split(",");
	} catch {
		throw new Error(
			'SAT_AV_TITULARES no contiene un JSON válido. Usa [{"nit":"...","nombre":"..."}].',
		);
	}

	if (!Array.isArray(parsed)) {
		throw new Error("SAT_AV_TITULARES debe ser un arreglo de titulares.");
	}

	const titulares = parsed.map((item): SatTitularObjetivo => {
		if (typeof item === "string") {
			const nit = item.trim();
			if (!normalizarNitTitular(nit)) {
				throw new Error("Cada titular SAT debe incluir un NIT válido.");
			}
			return { nit, nombre: nit };
		}

		if (!item || typeof item !== "object") {
			throw new Error("Cada titular SAT debe incluir NIT y nombre.");
		}

		const registro = item as Record<string, unknown>;
		const nit = String(registro.nit ?? "").trim();
		const nombre = String(registro.nombre ?? registro.name ?? nit).trim();
		if (!normalizarNitTitular(nit) || !nombre) {
			throw new Error("Cada titular SAT debe incluir NIT y nombre.");
		}
		return { nit, nombre };
	});

	const unicos = new Map<string, SatTitularObjetivo>();
	for (const titular of titulares) {
		const clave = normalizarNitTitular(titular.nit);
		if (!unicos.has(clave)) unicos.set(clave, titular);
	}
	if (unicos.size === 0) {
		throw new Error("SAT_AV_TITULARES no contiene titulares configurados.");
	}
	return [...unicos.values()];
}

function titularConError(
	titular: SatTitularObjetivo,
	estado: EstadoConsultaSat,
	mensajeError: string,
	evidencia?: string,
): SatVehiculosTitularResponse {
	return {
		...titular,
		estado,
		vehiculos: [],
		listadoCompleto: false,
		mensajeError,
		evidencia,
	};
}

function estadoGeneralDelegado(
	titulares: SatVehiculosTitularResponse[],
): EstadoConsultaSat {
	if (
		titulares.length > 0 &&
		titulares.every((titular) => titular.estado === "OK")
	) {
		return "OK";
	}
	if (titulares.some((titular) => titular.estado === "CODIGO_REQUERIDO")) {
		return "CODIGO_REQUERIDO";
	}
	if (titulares.some((titular) => titular.estado === "BLOQUEADO")) {
		return "BLOQUEADO";
	}
	return "ERROR";
}

async function consultarTitularDelegado(
	page: Page,
	titular: SatTitularObjetivo,
): Promise<SatVehiculosTitularResponse> {
	try {
		await seleccionarTitular(page, titular);
		const listado = await irAListadoVehiculosDelegado(page, titular.nit);
		const resultado = await leerTodasLasPaginas(listado);

		if (!resultado.listadoCompleto) {
			throw new SatScrapeError(
				"El listado de vehículos quedó incompleto; se cancela la corrida del titular.",
			);
		}
		if (resultado.vehiculos.length === 0) {
			throw new SatScrapeError(
				"SAT devolvió un listado vacío; se cancela la corrida del titular para evitar falsos positivos.",
			);
		}

		return {
			...titular,
			estado: "OK",
			vehiculos: resultado.vehiculos,
			listadoCompleto: true,
		};
	} catch (error) {
		const evidencia = await page.content().catch(() => "");
		return titularConError(
			titular,
			clasificarError(error, evidencia),
			error instanceof Error ? error.message : String(error),
			evidencia.slice(0, MAX_EVIDENCIA),
		);
	}
}

/** Inicia una sola sesión y consulta todos los titulares delegados configurados. */
export async function obtenerVehiculosDelegados(): Promise<SatVehiculosDelegadosResponse> {
	const credenciales = credencialesDelEntorno();
	const titulares = titularesDelegadosDelEntorno();

	try {
		const resultados = await conNavegador(async (page) => {
			await iniciarSesion(page, credenciales, { permisosDelegados: true });
			const respuestas: SatVehiculosTitularResponse[] = [];
			for (const titular of titulares) {
				respuestas.push(await consultarTitularDelegado(page, titular));
			}
			return respuestas;
		});

		const estado = estadoGeneralDelegado(resultados);
		return {
			cuentaNit: credenciales.nit,
			estado: estado,
			titulares: resultados,
			mensajeError:
				estado === "OK"
					? undefined
					: resultados
							.filter((titular) => titular.mensajeError)
							.map((titular) => `${titular.nit}: ${titular.mensajeError}`)
							.join(" | "),
			evidencia: resultados.find((titular) => titular.evidencia)?.evidencia,
		};
	} catch (error) {
		const evidencia = (error as { evidencia?: string }).evidencia;
		const estado = clasificarError(error, evidencia);
		return {
			cuentaNit: credenciales.nit,
			estado,
			titulares: titulares.map((titular) =>
				titularConError(
					titular,
					estado,
					error instanceof Error ? error.message : String(error),
					evidencia?.slice(0, MAX_EVIDENCIA),
				),
			),
			mensajeError: error instanceof Error ? error.message : String(error),
			evidencia: evidencia?.slice(0, MAX_EVIDENCIA),
		};
	}
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

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import {
	capturarEvidenciaSat,
	clasificarError,
	dividirRangosPaginas,
	esperarSatConReintento,
	irAListadoVehiculosDelegado,
	leerTablaVehiculos,
	leerTodasLasPaginas,
	seleccionarTitular,
} from "./satVehiculos";

test("reparte todas las páginas entre varios trabajadores sin huecos", () => {
	const rangos = dividirRangosPaginas(154, 4);
	expect(rangos).toEqual([
		{
			paginaInicial: 0,
			paginaFinal: 38,
			totalPaginas: 39,
			direccion: "siguiente",
		},
		{
			paginaInicial: 39,
			paginaFinal: 77,
			totalPaginas: 39,
			direccion: "siguiente",
		},
		{
			paginaInicial: 78,
			paginaFinal: 115,
			totalPaginas: 38,
			direccion: "anterior",
		},
		{
			paginaInicial: 116,
			paginaFinal: 153,
			totalPaginas: 38,
			direccion: "anterior",
		},
	]);
	expect(
		rangos.flatMap((rango) =>
			Array.from(
				{ length: rango.totalPaginas },
				(_, indice) => rango.paginaInicial + indice,
			),
		),
	).toEqual(Array.from({ length: 154 }, (_, indice) => indice));
});

test("conserva evidencia del login delegado cuando SAT bloquea el acceso", async () => {
	const html = "<title>Just a moment...</title><div>cf-chl-</div>";
	let capturas = 0;
	let errorCapturado: (Error & { evidencia?: string }) | undefined;
	try {
		await capturarEvidenciaSat(
			{
				content: async () => {
					capturas += 1;
					return html;
				},
			},
			async () => {
				throw new Error("Login bloqueado");
			},
		);
	} catch (error) {
		errorCapturado = error as Error & { evidencia?: string };
	}
	expect(errorCapturado?.message).toBe("Login bloqueado");
	expect(errorCapturado?.evidencia).toBe(html);
	expect(clasificarError(errorCapturado, errorCapturado?.evidencia)).toBe(
		"BLOQUEADO",
	);
	expect(capturas).toBe(1);
});

test("un fallo al capturar HTML no oculta el error original del login", async () => {
	const errorLogin = new Error("SAT no respondió");
	let errorCapturado: (Error & { evidencia?: string }) | undefined;
	try {
		await capturarEvidenciaSat(
			{
				content: async () => {
					throw new Error("Página cerrada");
				},
			},
			async () => {
				throw errorLogin;
			},
		);
	} catch (error) {
		errorCapturado = error as Error & { evidencia?: string };
	}
	expect(errorCapturado).toBe(errorLogin);
	expect(errorCapturado?.evidencia).toBe("");
});

test("reintenta una espera transitoria y conserva el resultado", async () => {
	let intentos = 0;
	const resultado = await esperarSatConReintento(
		"Página 2 de SAT",
		async () => {
			intentos += 1;
			if (intentos === 1) throw new Error("Waiting failed: 30000ms exceeded");
			return "lista";
		},
	);
	expect(resultado).toBe("lista");
	expect(intentos).toBe(2);
});

test("informa la etapa tras agotar esperas y no repite errores no transitorios", async () => {
	let intentos = 0;
	await expect(
		esperarSatConReintento("Página 57 de SAT", async () => {
			intentos += 1;
			throw new Error("Waiting failed: 30000ms exceeded");
		}),
	).rejects.toThrow("Página 57 de SAT (espera 2/2)");
	expect(intentos).toBe(2);

	intentos = 0;
	await expect(
		esperarSatConReintento("Menú SAT", async () => {
			intentos += 1;
			throw new Error("Selector inválido");
		}),
	).rejects.toThrow("Menú SAT (espera 1/2)");
	expect(intentos).toBe(1);
});

const chromePath =
	process.env.PUPPETEER_EXECUTABLE_PATH ??
	(process.platform === "win32"
		? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
		: puppeteer.executablePath());
const testConChrome = existsSync(chromePath) ? test : test.skip;

function tabla(impresiones: string) {
	return `<table id="frmAcciones:dtListadoVehiculos"><tbody><tr>
		<td>P-123ABC</td><td>Automovil</td><td>Honda</td><td>2020</td>
		<td>Blanco</td><td>Activo</td>
		<td><a href="#"><img src="traspaso.png"></a></td>
		<td><button id="detalle">Detalle</button></td>
		<td></td><td>${impresiones}</td>
	</tr></tbody></table>
	<div id="divtoprint"></div>
	<script>
		document.getElementById('detalle').onclick = function () {
			mostrarDetalle('P-123ABC');
		};
		function mostrarDetalle(placa) {
			document.getElementById('divtoprint').textContent =
				'Detalle del Vehículo Placa actual: ' + placa +
				' Marca: Honda Modelo: 2020 Color: Blanco Tipo: Automovil' +
				' Propietario: Titular de prueba Estado: Activo Serie: ABC123';
		}
	</script>`;
}

testConChrome(
	"un icono anidado no equivale a dos impresiones SAT",
	async () => {
		const browser = await puppeteer.launch({
			executablePath: chromePath,
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		try {
			const page = await browser.newPage();

			await page.setContent(tabla('<a href="#"><img src="imprimir.png"></a>'));
			const [unaImpresion] = await leerTablaVehiculos(page.mainFrame());
			expect(unaImpresion.puedeAutorizarTraspaso).toBe(true);
			expect(unaImpresion.puedeImprimirTarjeta).toBeNull();
			expect(unaImpresion.puedeImprimirCertificado).toBeNull();
			expect(unaImpresion.impuestoCirculacionPagado).toBeNull();

			await page.setContent(
				tabla(
					'<a href="#"><img src="tarjeta.png"></a><a href="#"><img src="certificado.png"></a>',
				),
			);
			const [ambasImpresiones] = await leerTablaVehiculos(page.mainFrame());
			expect(ambasImpresiones.puedeImprimirTarjeta).toBe(true);
			expect(ambasImpresiones.puedeImprimirCertificado).toBe(true);
			expect(ambasImpresiones.impuestoCirculacionPagado).toBe(true);

			await page.setContent(
				tabla('<img src="tarjeta.png"><img src="certificado.png">'),
			);
			const [iconosSueltos] = await leerTablaVehiculos(page.mainFrame());
			expect(iconosSueltos.puedeImprimirTarjeta).toBe(true);
			expect(iconosSueltos.puedeImprimirCertificado).toBe(true);

			await page.setContent(tabla(""));
			const [sinImpresiones] = await leerTablaVehiculos(page.mainFrame());
			expect(sinImpresiones.puedeImprimirTarjeta).toBe(false);
			expect(sinImpresiones.puedeImprimirCertificado).toBe(false);
			expect(sinImpresiones.impuestoCirculacionPagado).toBe(false);
		} finally {
			await browser.close();
		}
	},
);

testConChrome(
	"selecciona titular aunque el NIT tenga un formato distinto",
	async () => {
		const browser = await puppeteer.launch({
			executablePath: chromePath,
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		try {
			const page = await browser.newPage();
			await page.setContent(`
			<button id="contribButton" onclick="document.querySelector('.menu-contrib').style.display = 'block'">Titulares</button>
			<div id="lblUserTop">Cuenta personal</div>
			<div class="menu-contrib" style="display:none">
				<a class="ui-menuitem-link" href="#" onclick="document.querySelector('#lblUserTop').textContent = '98766430 - CUBE'">98766430 - CUBE</a>
			</div>
		`);
			await seleccionarTitular(page, { nit: "9876-6430", nombre: "CUBE" });
			expect(
				await page.$eval("#lblUserTop", (element) => element.textContent),
			).toContain("98766430");
		} finally {
			await browser.close();
		}
	},
);

testConChrome("no confunde un NIT con otro que lo contiene", async () => {
	const browser = await puppeteer.launch({
		executablePath: chromePath,
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});
	try {
		const page = await browser.newPage();
		await page.setContent(`
			<button id="contribButton" onclick="document.querySelector('.menu-contrib').style.display = 'block'">Titulares</button>
			<div id="lblUserTop">Cuenta personal</div>
			<div class="menu-contrib" style="display:none">
				<a class="ui-menuitem-link" href="#" onclick="document.querySelector('#lblUserTop').textContent = '1234 - TITULAR LARGO'">1234 - TITULAR LARGO</a>
				<a class="ui-menuitem-link" href="#" onclick="document.querySelector('#lblUserTop').textContent = '123 - TITULAR EXACTO'">123 - TITULAR EXACTO</a>
			</div>
		`);
		await seleccionarTitular(page, { nit: "123", nombre: "TITULAR EXACTO" });
		expect(
			await page.$eval("#lblUserTop", (element) => element.textContent),
		).toBe("123 - TITULAR EXACTO");
	} finally {
		await browser.close();
	}
});

testConChrome(
	"no publica una pagina SAT incompleta como listado completo",
	async () => {
		const browser = await puppeteer.launch({
			executablePath: chromePath,
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		try {
			const page = await browser.newPage();
			await page.setContent(`<div>Total Registros: 2</div>${tabla("")}`);
			const incompleto = await leerTodasLasPaginas(page.mainFrame());
			expect(incompleto.listadoCompleto).toBe(false);
			expect(incompleto.vehiculos).toHaveLength(1);

			await page.setContent(`<div>Total Registros: 1</div>${tabla("")}`);
			const completo = await leerTodasLasPaginas(page.mainFrame());
			expect(completo.listadoCompleto).toBe(true);
		} finally {
			await browser.close();
		}
	},
);

testConChrome(
	"espera las filas reales al avanzar paginas con un estado de carga intermedio",
	async () => {
		const browser = await puppeteer.launch({
			executablePath: chromePath,
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		try {
			const page = await browser.newPage();
			await page.setContent(`
				<div>Total Registros: 3</div>
				<table id="frmAcciones:dtListadoVehiculos"><tbody></tbody></table>
				<input id="frmAcciones:btnNext" type="button" value="Siguiente" onclick="avanzar()">
				<script>
					let pagina = 0;
					const placas = ["P-111AAA", "P-222BBB", "P-333CCC"];
					const cuerpo = document.querySelector("tbody");
					function mostrarFila() {
						cuerpo.innerHTML = "<tr><td>" + placas[pagina] + "</td><td>Automovil</td><td>Honda</td><td>2020</td><td>Blanco</td><td>Activo</td><td></td><td><button>Detalle</button></td><td></td><td></td></tr>";
						document.querySelector("button").onclick = function () {
							mostrarDetalle(placas[pagina]);
						};
						if (pagina === placas.length - 1) document.getElementById("frmAcciones:btnNext").disabled = true;
					}
					function mostrarDetalle(placa) {
						document.getElementById('divtoprint').textContent = 'Detalle del Vehículo Placa actual: ' + placa + ' Marca: Honda Modelo: 2020 Color: Blanco Tipo: Automovil Propietario: Titular de prueba Estado: Activo Serie: ABC123';
					}
					function avanzar() {
						pagina += 1;
						cuerpo.innerHTML = '<tr><td colspan="10">Cargando...</td></tr>';
						setTimeout(mostrarFila, pagina === 1 ? 180 : 70);
					}
					mostrarFila();
				</script>
				<div id="divtoprint"></div>
			`);
			const resultado = await leerTodasLasPaginas(page.mainFrame());
			expect(resultado.listadoCompleto).toBe(true);
			expect(resultado.vehiculos.map((vehiculo) => vehiculo.placa)).toEqual([
				"P-111AAA",
				"P-222BBB",
				"P-333CCC",
			]);
		} finally {
			await browser.close();
		}
	},
);

testConChrome(
	"ignora el iframe del titular anterior al abrir el siguiente",
	async () => {
		const browser = await puppeteer.launch({
			executablePath: chromePath,
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		try {
			const page = await browser.newPage();
			await page.setContent(
				"<a onclick=\"void('listadoVehiculos.jsf')\">Listado de Vehiculos</a>",
			);
			await page.evaluate(() => {
				for (const nit of ["98766430", "114396426"]) {
					const iframe = document.createElement("iframe");
					iframe.src = `data:text/html,${encodeURIComponent(
						`<body><div>NIT: ${nit}</div><table id="frmAcciones:dtListadoVehiculos"></table></body>`,
					)}#listadoVehiculos`;
					document.body.append(iframe);
				}
			});
			await page.waitForFunction(() => window.frames.length === 2);
			const frame = await irAListadoVehiculosDelegado(page, "114396426");
			expect(await frame.evaluate(() => document.body.innerText)).toContain(
				"NIT: 114396426",
			);
		} finally {
			await browser.close();
		}
	},
);

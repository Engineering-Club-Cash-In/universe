import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function formatQ(val: string | number | null | undefined): string {
	const n = typeof val === "string" ? Number.parseFloat(val) : (val ?? 0);
	if (Number.isNaN(n)) return "Q 0.00";
	return `Q ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function val(v: unknown): string {
	if (v === null || v === undefined) return "";
	return String(v);
}

function parseNum(v: unknown): number {
	if (!v) return 0;
	const n = Number.parseFloat(String(v));
	return Number.isNaN(n) ? 0 : n;
}

function sumArray(arr: unknown): number {
	if (!Array.isArray(arr)) return 0;
	return arr.reduce((sum: number, item: Record<string, unknown>) => {
		return sum + parseNum(item?.monto);
	}, 0);
}

// biome-ignore lint: PDF generation uses any for flexible data
type FormData = Record<string, any>;

export function generateCreditApplicationPdf(
	data: FormData,
	signatureOverride?: string,
) {
	const doc = new jsPDF();
	const pageWidth = doc.internal.pageSize.getWidth();
	let y = 15;

	// Title
	doc.setFontSize(14);
	doc.setFont("helvetica", "bold");
	doc.text(
		"FORMULARIO SOLICITUD DE CRÉDITO SOBRE VEHÍCULOS",
		pageWidth / 2,
		y,
		{
			align: "center",
		},
	);
	y += 5;
	doc.setFontSize(9);
	doc.setFont("helvetica", "normal");
	doc.text("Creación e Imagen, S.A.", pageWidth / 2, y, { align: "center" });
	y += 8;

	// Section: Datos Personales
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("DATOS PERSONALES", 14, y);
	y += 2;

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		headStyles: { fillColor: [60, 60, 60] },
		columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
		body: [
			[
				"Primer Apellido",
				val(data.primerApellido),
				"Segundo Apellido",
				val(data.segundoApellido),
			],
			[
				"Apellido Casada",
				val(data.apellidoCasada),
				"Primer Nombre",
				val(data.primerNombre),
			],
			["Segundo Nombre", val(data.segundoNombre), "DPI", val(data.dpi)],
			["NIT", val(data.nit), "No. Licencia", val(data.licenciaNo)],
			["Edad", val(data.edad), "Estado Civil", val(data.estadoCivil)],
			[
				"Dependientes",
				val(data.dependientes),
				"Fecha Nac.",
				val(data.fechaNacimiento),
			],
			["Sexo", val(data.sexo), "Nacionalidad", val(data.nacionalidad)],
			["Dirección", { content: val(data.direccionResidencia), colSpan: 3 }],
			[
				"Tel. Residencia",
				val(data.telResidencia),
				"Tel. Móvil",
				val(data.telMovil),
			],
			["Tel. Emergencia", val(data.telEmergencia), "Email", val(data.email)],
		],
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Section: Datos del Vehículo
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("DATOS DEL VEHÍCULO", 14, y);
	y += 2;

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
		body: [
			["Marca", val(data.vehiculoMarca), "Línea", val(data.vehiculoLinea)],
			[
				"Modelo/Año",
				val(data.vehiculoModelo),
				"Valor Estimado",
				formatQ(data.valorEstimado),
			],
			[
				"Monto Solicitado",
				formatQ(data.montoSolicitado),
				"Uso Uber",
				data.usoUber ? "Sí" : "No",
			],
		],
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Section: Datos Laborales
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("DATOS LABORALES", 14, y);
	y += 2;

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
		body: [
			["Profesión", val(data.profesion), "Puesto", val(data.puesto)],
			[
				"Sueldo",
				formatQ(data.sueldo),
				"Periodicidad",
				val(data.sueldoPeriodicidad),
			],
			[
				"Egresos",
				formatQ(data.egresos),
				"Periodicidad",
				val(data.egresosPeriodicidad),
			],
			["Prox. Pago", val(data.fechaProximoPago), "Empresa", val(data.empresa)],
			["Dir. Trabajo", { content: val(data.direccionTrabajo), colSpan: 3 }],
			[
				"Inicio Labores",
				val(data.fechaInicioLabores),
				"Tiempo",
				val(data.tiempoTrabajado),
			],
			["Horarios", val(data.horarios), "Tel. Trabajo", val(data.telTrabajo)],
			["Supervisor", val(data.supervisor), "RRHH", val(data.rrhh)],
			["Banco Pago", val(data.bancoPago), "No. Cuenta", val(data.numCuenta)],
			["Tipo Cuenta", val(data.tipoCuenta), "", ""],
		],
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Check if we need a new page
	if (y > 240) {
		doc.addPage();
		y = 15;
	}

	// Section: Datos del Cónyuge
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("DATOS DEL CÓNYUGE", 14, y);
	y += 2;

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
		body: [
			["Nombre", { content: val(data.conyugeNombre), colSpan: 3 }],
			[
				"Empresa",
				val(data.conyugeEmpresa),
				"Dirección",
				val(data.conyugeDireccion),
			],
			[
				"Tel. Oficina",
				val(data.conyugeTelOficina),
				"Tel. Móvil",
				val(data.conyugeTelMovil),
			],
		],
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Section: Referencias Crediticias
	if (
		Array.isArray(data.referenciasCrediticias) &&
		data.referenciasCrediticias.length > 0
	) {
		doc.setFontSize(11);
		doc.setFont("helvetica", "bold");
		doc.text("REFERENCIAS CREDITICIAS", 14, y);
		y += 2;

		autoTable(doc, {
			startY: y,
			theme: "grid",
			styles: { fontSize: 8, cellPadding: 2 },
			head: [["#", "Nombre", "Teléfono"]],
			headStyles: { fillColor: [60, 60, 60] },
			body: data.referenciasCrediticias
				.filter((r: any) => r.nombre || r.telefono)
				.map((r: any, i: number) => [i + 1, val(r.nombre), val(r.telefono)]),
		});

		y = (doc as any).lastAutoTable.finalY + 8;
	}

	// Section: Cuentas Bancarias
	if (
		Array.isArray(data.cuentasBancarias) &&
		data.cuentasBancarias.length > 0
	) {
		if (y > 250) {
			doc.addPage();
			y = 15;
		}
		doc.setFontSize(11);
		doc.setFont("helvetica", "bold");
		doc.text("OTRAS CUENTAS BANCARIAS", 14, y);
		y += 2;

		autoTable(doc, {
			startY: y,
			theme: "grid",
			styles: { fontSize: 8, cellPadding: 2 },
			head: [["#", "Número", "Tipo", "Banco"]],
			headStyles: { fillColor: [60, 60, 60] },
			body: data.cuentasBancarias
				.filter((c: any) => c.numero || c.banco)
				.map((c: any, i: number) => [
					i + 1,
					val(c.numero),
					val(c.tipo),
					val(c.banco),
				]),
		});

		y = (doc as any).lastAutoTable.finalY + 8;
	}

	// Section: Referencias Personales
	if (
		Array.isArray(data.referenciasPersonales) &&
		data.referenciasPersonales.length > 0
	) {
		if (y > 250) {
			doc.addPage();
			y = 15;
		}
		doc.setFontSize(11);
		doc.setFont("helvetica", "bold");
		doc.text("REFERENCIAS PERSONALES", 14, y);
		y += 2;

		autoTable(doc, {
			startY: y,
			theme: "grid",
			styles: { fontSize: 8, cellPadding: 2 },
			head: [["#", "Nombre", "Relación", "Teléfono"]],
			headStyles: { fillColor: [60, 60, 60] },
			body: data.referenciasPersonales
				.filter((r: any) => r.nombre || r.telefono)
				.map((r: any, i: number) => [
					i + 1,
					val(r.nombre),
					val(r.relacion),
					val(r.telefono),
				]),
		});

		y = (doc as any).lastAutoTable.finalY + 8;
	}

	// Section: Control Interno
	if (y > 250) {
		doc.addPage();
		y = 15;
	}
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("CONTROL INTERNO", 14, y);
	y += 2;

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
		body: [
			["Es PEP", data.esPep ? "Sí" : "No"],
			["¿Cómo se enteró?", val(data.comoSeEntero)],
			["Utilización Crédito", val(data.utilizacionCredito)],
		],
	});

	y = (doc as any).lastAutoTable.finalY + 15;

	// Signature
	const firmaImg = data.firmaImagen || signatureOverride;
	if (y > 230) {
		doc.addPage();
		y = 15;
	}
	if (firmaImg) {
		try {
			doc.addImage(firmaImg, "PNG", 14, y, 60, 30);
			y += 32;
		} catch {
			// If image fails, just skip
		}
	}
	doc.setFontSize(8);
	doc.text("_______________________________", 14, y);
	y += 4;
	doc.text("Firma del Solicitante", 14, y);
	y += 4;
	if (data.fechaFirma) {
		doc.text(
			`Fecha: ${val(data.fechaFirma)}  Hora: ${val(data.horaFirma)}`,
			14,
			y,
		);
	}

	// Cláusula de Consentimiento
	doc.addPage();
	y = 20;
	doc.setFontSize(13);
	doc.setFont("helvetica", "bold");
	doc.text(
		"CLAUSULA DE CONSENTIMIENTO DEL CIUDADANO",
		pageWidth / 2,
		y,
		{ align: "center" },
	);
	y += 10;

	doc.setFontSize(8);
	doc.setFont("helvetica", "normal");
	const consentMargin = 14;
	const consentWidth = pageWidth - consentMargin * 2;

	const consentParagraphs = [
		"1. Autorizo expresamente a CREACIÓN E IMAGEN, SOCIEDAD ANÓNIMA para que solicite, recopile, almacene, intercambie y utilice toda la información relacionada con mi historial crediticio, referencias personales, laborales, comerciales, financieras y patrimoniales, ante cualquier entidad pública o privada, burós de crédito, centrales de riesgo, u otras fuentes de información, con el propósito de evaluar mi solicitud de crédito y durante la vigencia del mismo.",
		"2. Autorizo a CREACIÓN E IMAGEN, SOCIEDAD ANÓNIMA para que comparta mi información crediticia y financiera con terceros que tengan un interés legítimo, incluyendo pero no limitado a: entidades financieras, aseguradoras, empresas de cobro, y cualquier otra entidad que participe en la evaluación, otorgamiento, administración o recuperación del crédito solicitado.",
		"3. Declaro que toda la información proporcionada en esta solicitud es verídica y completa. Reconozco que cualquier falsedad u omisión en la información proporcionada puede ser causa de rechazo de mi solicitud o de rescisión del contrato de crédito, sin perjuicio de las acciones legales que pudieran corresponder.",
		"4. Me comprometo a notificar a CREACIÓN E IMAGEN, SOCIEDAD ANÓNIMA de cualquier cambio en mi información personal, laboral, financiera o patrimonial que pueda afectar las condiciones bajo las cuales se otorgó el crédito.",
	];

	for (const paragraph of consentParagraphs) {
		const lines = doc.splitTextToSize(paragraph, consentWidth);
		if (y + lines.length * 4 > 270) {
			doc.addPage();
			y = 20;
		}
		doc.text(lines, consentMargin, y);
		y += lines.length * 4 + 4;
	}

	y += 4;
	const closingText =
		"Al firmar este documento, confirmo que he leído, entendido y aceptado todos los términos anteriores de forma libre y voluntaria.";
	const closingLines = doc.splitTextToSize(closingText, consentWidth);
	doc.text(closingLines, consentMargin, y);
	y += closingLines.length * 4 + 10;

	// Consent fields
	const nombreCompleto = [
		val(data.primerNombre),
		val(data.segundoNombre),
		val(data.primerApellido),
		val(data.segundoApellido),
		val(data.apellidoCasada) ? `de ${val(data.apellidoCasada)}` : "",
	]
		.filter(Boolean)
		.join(" ");

	doc.setFont("helvetica", "bold");
	doc.text("Nombre Completo:", consentMargin, y);
	doc.setFont("helvetica", "normal");
	doc.text(nombreCompleto, consentMargin + 35, y);
	y += 6;

	doc.setFont("helvetica", "bold");
	doc.text("DPI:", consentMargin, y);
	doc.setFont("helvetica", "normal");
	doc.text(val(data.dpi), consentMargin + 35, y);
	y += 6;

	doc.setFont("helvetica", "bold");
	doc.text("NIT:", consentMargin, y);
	doc.setFont("helvetica", "normal");
	doc.text(val(data.nit), consentMargin + 35, y);
	y += 6;

	doc.setFont("helvetica", "bold");
	doc.text("Fecha:", consentMargin, y);
	doc.setFont("helvetica", "normal");
	doc.text(val(data.fechaFirma) || new Date().toLocaleDateString("es-GT"), consentMargin + 35, y);
	y += 10;

	// Consent signature
	if (firmaImg) {
		try {
			doc.addImage(firmaImg, "PNG", consentMargin, y, 60, 30);
			y += 32;
		} catch {
			// Skip if image fails
		}
	}
	doc.text("_______________________________", consentMargin, y);
	y += 4;
	doc.text("Firma del Solicitante", consentMargin, y);

	// Footer
	const pageCount = doc.getNumberOfPages();
	for (let i = 1; i <= pageCount; i++) {
		doc.setPage(i);
		doc.setFontSize(7);
		doc.setTextColor(128);
		doc.text(
			"Creación e Imagen, S.A. - Documento generado automáticamente",
			pageWidth / 2,
			doc.internal.pageSize.getHeight() - 10,
			{ align: "center" },
		);
		doc.text(
			`Página ${i} de ${pageCount}`,
			pageWidth - 14,
			doc.internal.pageSize.getHeight() - 10,
			{ align: "right" },
		);
		doc.setTextColor(0);
	}

	doc.save("solicitud-credito.pdf");
}

export function generateFinancialStatementPdf(data: FormData) {
	const doc = new jsPDF();
	const pageWidth = doc.internal.pageSize.getWidth();
	let y = 15;

	// Title
	doc.setFontSize(14);
	doc.setFont("helvetica", "bold");
	doc.text("ESTADO PATRIMONIAL", pageWidth / 2, y, { align: "center" });
	y += 5;
	doc.setFontSize(9);
	doc.setFont("helvetica", "normal");
	doc.text("Creación e Imagen, S.A.", pageWidth / 2, y, { align: "center" });
	y += 8;

	// Section: Datos Personales
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("DATOS PERSONALES", 14, y);
	y += 2;

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
		body: [
			[
				"Nombre",
				`${val(data.primerNombre)} ${val(data.segundoNombre)}`,
				"Apellidos",
				`${val(data.primerApellido)} ${val(data.segundoApellido)}`,
			],
			["Apellido Casada", val(data.apellidoCasada), "DPI", val(data.dpi)],
			["DPI Extendido en", val(data.dpiExtendidoEn), "NIT", val(data.nit)],
		],
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Calculate totals
	const totalActivos =
		parseNum(data.efectivo) +
		sumArray(data.depositosBancarios) +
		parseNum(data.cuentasCobrarAmigos) +
		parseNum(data.cuentasCobrarOtros) +
		parseNum(data.documentosCobrar) +
		parseNum(data.bienesInmueblesValor) +
		parseNum(data.vehiculosValor) +
		parseNum(data.maquinaria) +
		parseNum(data.muebles) +
		parseNum(data.menaje) +
		sumArray(data.otrosActivos);

	const totalPasivos =
		parseNum(data.cuentasPagarAmigos) +
		parseNum(data.cuentasPagarOtros) +
		parseNum(data.letrasPagar) +
		sumArray(data.obligacionesParticulares) +
		sumArray(data.obligacionesCortoPlazo) +
		sumArray(data.obligacionesLargoPlazo) +
		sumArray(data.otrosPasivos);

	const patrimonio = totalActivos - totalPasivos;

	// Section: Patrimonio Summary
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("RESUMEN PATRIMONIAL", 14, y);
	y += 2;

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 9, cellPadding: 3 },
		columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
		body: [
			["Total Activos", formatQ(totalActivos)],
			["Total Pasivos", formatQ(totalPasivos)],
			["PATRIMONIO", formatQ(patrimonio)],
		],
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Activos Detail
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("DETALLE DE ACTIVOS", 14, y);
	y += 2;

	const activosRows: string[][] = [["Efectivo", formatQ(data.efectivo)]];

	if (Array.isArray(data.depositosBancarios)) {
		for (const dep of data.depositosBancarios) {
			if (dep.monto && parseNum(dep.monto) > 0) {
				activosRows.push([
					`Depósito: ${val(dep.descripcion)}`,
					formatQ(dep.monto),
				]);
			}
		}
	}

	activosRows.push(
		["Ctas. Cobrar (Amigos)", formatQ(data.cuentasCobrarAmigos)],
		["Ctas. Cobrar (Otros)", formatQ(data.cuentasCobrarOtros)],
		["Documentos por Cobrar", formatQ(data.documentosCobrar)],
		[
			`Bienes Inmuebles (${val(data.bienesInmueblesCantidad)})`,
			formatQ(data.bienesInmueblesValor),
		],
		[
			`Vehículos (${val(data.vehiculosCantidad)})`,
			formatQ(data.vehiculosValor),
		],
		["Maquinaria", formatQ(data.maquinaria)],
		["Muebles", formatQ(data.muebles)],
		["Menaje", formatQ(data.menaje)],
	);

	if (Array.isArray(data.otrosActivos)) {
		for (const item of data.otrosActivos) {
			if (item.monto && parseNum(item.monto) > 0) {
				activosRows.push([
					`Otro: ${val(item.descripcion)}`,
					formatQ(item.monto),
				]);
			}
		}
	}

	activosRows.push(["TOTAL ACTIVOS", formatQ(totalActivos)]);

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { cellWidth: 100 }, 1: { halign: "right" } },
		body: activosRows,
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Pasivos Detail
	if (y > 230) {
		doc.addPage();
		y = 15;
	}
	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("DETALLE DE PASIVOS", 14, y);
	y += 2;

	const pasivosRows: string[][] = [
		["Ctas. Pagar (Amigos)", formatQ(data.cuentasPagarAmigos)],
		["Ctas. Pagar (Otros)", formatQ(data.cuentasPagarOtros)],
		["Letras por Pagar", formatQ(data.letrasPagar)],
	];

	const pasivosArrays = [
		["obligacionesParticulares", "Oblig. Particulares"],
		["obligacionesCortoPlazo", "Oblig. Corto Plazo"],
		["obligacionesLargoPlazo", "Oblig. Largo Plazo"],
		["otrosPasivos", "Otros Pasivos"],
	] as const;

	for (const [field, label] of pasivosArrays) {
		if (Array.isArray(data[field])) {
			for (const item of data[field]) {
				if (item.monto && parseNum(item.monto) > 0) {
					pasivosRows.push([
						`${label}: ${val(item.descripcion)}`,
						formatQ(item.monto),
					]);
				}
			}
		}
	}

	pasivosRows.push(["TOTAL PASIVOS", formatQ(totalPasivos)]);

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { cellWidth: 100 }, 1: { halign: "right" } },
		body: pasivosRows,
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Ingresos y Egresos
	if (y > 200) {
		doc.addPage();
		y = 15;
	}

	const totalIngresos =
		parseNum(data.sueldos) +
		parseNum(data.bonificaciones) +
		parseNum(data.arrendamientos) +
		sumArray(data.otrosIngresos);
	const totalEgresos =
		parseNum(data.gastosPersonales) +
		parseNum(data.alquileres) +
		parseNum(data.amortizacionVivienda) +
		parseNum(data.deudasPersonales) +
		sumArray(data.otrosEgresos);

	doc.setFontSize(11);
	doc.setFont("helvetica", "bold");
	doc.text("INGRESOS Y EGRESOS ANUALES", 14, y);
	y += 2;

	const ieRows: string[][] = [
		["INGRESOS", ""],
		["Sueldos", formatQ(data.sueldos)],
		["Bonificaciones", formatQ(data.bonificaciones)],
		["Arrendamientos", formatQ(data.arrendamientos)],
	];

	if (Array.isArray(data.otrosIngresos)) {
		for (const item of data.otrosIngresos) {
			if (item.monto && parseNum(item.monto) > 0) {
				ieRows.push([`Otro: ${val(item.descripcion)}`, formatQ(item.monto)]);
			}
		}
	}
	ieRows.push(["TOTAL INGRESOS", formatQ(totalIngresos)]);
	ieRows.push(["", ""]);
	ieRows.push(["EGRESOS", ""]);
	ieRows.push(
		["Gastos Personales", formatQ(data.gastosPersonales)],
		["Alquileres", formatQ(data.alquileres)],
		["Amortización Vivienda", formatQ(data.amortizacionVivienda)],
		["Deudas Personales", formatQ(data.deudasPersonales)],
	);

	if (Array.isArray(data.otrosEgresos)) {
		for (const item of data.otrosEgresos) {
			if (item.monto && parseNum(item.monto) > 0) {
				ieRows.push([`Otro: ${val(item.descripcion)}`, formatQ(item.monto)]);
			}
		}
	}
	ieRows.push(["TOTAL EGRESOS", formatQ(totalEgresos)]);
	ieRows.push(["DIFERENCIA", formatQ(totalIngresos - totalEgresos)]);

	autoTable(doc, {
		startY: y,
		theme: "grid",
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: { 0: { cellWidth: 100 }, 1: { halign: "right" } },
		body: ieRows,
	});

	y = (doc as any).lastAutoTable.finalY + 8;

	// Origen de Ingresos
	if (data.origenIngresos || data.comoAcreditanIngresos) {
		if (y > 240) {
			doc.addPage();
			y = 15;
		}
		doc.setFontSize(11);
		doc.setFont("helvetica", "bold");
		doc.text("ORIGEN DE INGRESOS", 14, y);
		y += 6;
		doc.setFontSize(8);
		doc.setFont("helvetica", "normal");
		if (data.origenIngresos) {
			doc.text(`Origen: ${val(data.origenIngresos)}`, 14, y, {
				maxWidth: pageWidth - 28,
			});
			y += 8;
		}
		if (data.comoAcreditanIngresos) {
			doc.text(`Acreditación: ${val(data.comoAcreditanIngresos)}`, 14, y, {
				maxWidth: pageWidth - 28,
			});
			y += 8;
		}
	}

	// Anexo Inmuebles
	if (Array.isArray(data.anexoInmuebles) && data.anexoInmuebles.length > 0) {
		if (y > 220) {
			doc.addPage();
			y = 15;
		}
		doc.setFontSize(11);
		doc.setFont("helvetica", "bold");
		doc.text("ANEXO: BIENES INMUEBLES", 14, y);
		y += 2;

		autoTable(doc, {
			startY: y,
			theme: "grid",
			styles: { fontSize: 7, cellPadding: 2 },
			head: [
				[
					"Finca",
					"Folio",
					"Libro",
					"Valor",
					"Hipotecada",
					"A Favor De",
					"Dirección",
				],
			],
			headStyles: { fillColor: [60, 60, 60] },
			body: data.anexoInmuebles.map((item: any) => [
				val(item.finca),
				val(item.folio),
				val(item.libro),
				formatQ(item.valor),
				item.hipotecada ? "Sí" : "No",
				val(item.aFavorDe),
				val(item.direccion),
			]),
		});
		y = (doc as any).lastAutoTable.finalY + 8;
	}

	// Anexo Vehículos
	if (Array.isArray(data.anexoVehiculos) && data.anexoVehiculos.length > 0) {
		if (y > 230) {
			doc.addPage();
			y = 15;
		}
		doc.setFontSize(11);
		doc.setFont("helvetica", "bold");
		doc.text("ANEXO: VEHÍCULOS", 14, y);
		y += 2;

		autoTable(doc, {
			startY: y,
			theme: "grid",
			styles: { fontSize: 7, cellPadding: 2 },
			head: [["Marca", "Línea", "Placa", "Modelo/Año", "Valor"]],
			headStyles: { fillColor: [60, 60, 60] },
			body: data.anexoVehiculos.map((item: any) => [
				val(item.marca),
				val(item.linea),
				val(item.placa),
				val(item.modeloAnio),
				formatQ(item.valor),
			]),
		});
		y = (doc as any).lastAutoTable.finalY + 8;
	}

	// Signature
	if (y > 230) {
		doc.addPage();
		y = 15;
	}
	y += 5;
	if (data.firmaImagen) {
		try {
			doc.addImage(data.firmaImagen, "PNG", 14, y, 60, 30);
			y += 32;
		} catch {
			// Skip if image fails
		}
	}
	doc.setFontSize(8);
	doc.text("_______________________________", 14, y);
	y += 4;
	doc.text("Firma", 14, y);
	y += 4;
	if (data.fechaFirma) {
		doc.text(`Fecha: ${val(data.fechaFirma)}`, 14, y);
	}

	y += 10;
	doc.setFontSize(7);
	doc.setTextColor(128);
	doc.text(
		"Declaro bajo juramento que la información aquí consignada es verídica y que los bienes declarados son de mi legítima propiedad.",
		14,
		y,
		{ maxWidth: pageWidth - 28 },
	);
	doc.setTextColor(0);

	// Footer
	const pageCount = doc.getNumberOfPages();
	for (let i = 1; i <= pageCount; i++) {
		doc.setPage(i);
		doc.setFontSize(7);
		doc.setTextColor(128);
		doc.text(
			"Creación e Imagen, S.A. - Estado Patrimonial",
			pageWidth / 2,
			doc.internal.pageSize.getHeight() - 10,
			{ align: "center" },
		);
		doc.text(
			`Página ${i} de ${pageCount}`,
			pageWidth - 14,
			doc.internal.pageSize.getHeight() - 10,
			{ align: "right" },
		);
		doc.setTextColor(0);
	}

	doc.save("estado-patrimonial.pdf");
}

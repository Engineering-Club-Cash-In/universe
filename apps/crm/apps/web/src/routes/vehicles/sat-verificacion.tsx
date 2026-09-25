import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Clock3,
	Eye,
	FileSpreadsheet,
	RefreshCw,
	Search,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpc } from "@/utils/orpc";

const PAGE_SIZE = 10;
type EstadoSatFiltro = "todos" | "activo" | "inactivo" | "no_encontrado";
type CruceCartera = "con_credito" | "disponible" | "sin_registro";
type CruceCarteraFiltro = "todos" | "con_credito" | "sin_credito";
type EstadoCreditoFiltro = "todos" | "ACTIVO" | "MOROSO" | "EN_CONVENIO";

type ResultadoSatDetalle = {
	placa: string;
	marca: string | null;
	modelo: string | null;
	detalleSat?: {
		texto: string;
		campos: Record<string, string>;
	} | null;
};

export const Route = createFileRoute("/vehicles/sat-verificacion")({
	component: SatVerificationPage,
});

function formatDate(value: Date | string | null | undefined) {
	if (!value) return "Sin consultas registradas";
	return new Date(value).toLocaleString("es-GT", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function formatRunStatus(status: string | null | undefined) {
	if (status === "en_proceso") return "En proceso";
	if (status === "ok") return "Completado";
	if (status) return "Error";
	return "Sin datos";
}

function EstadoSatBadge({
	estadoSat,
	resultado,
}: {
	estadoSat: string | null;
	resultado: string;
}) {
	if (resultado === "no_aparece_en_sat") {
		return (
			<Badge className="border-red-300 bg-red-100 text-red-800">
				<XCircle /> No se encontró en SAT
			</Badge>
		);
	}
	if (estadoSat?.trim().toLowerCase() === "activo") {
		return (
			<Badge className="border-green-300 bg-green-100 text-green-800">
				<CheckCircle2 /> Activo
			</Badge>
		);
	}
	if (estadoSat?.trim().toLowerCase() === "inactivo") {
		return (
			<Badge className="border-red-300 bg-red-100 text-red-800">
				<XCircle /> Inactivo
			</Badge>
		);
	}
	return (
		<Badge className="border-slate-300 bg-slate-100 text-slate-800">
			{estadoSat || "Sin dato SAT"}
		</Badge>
	);
}

function textoEstadoSat(
	estadoSat: string | null,
	resultado: string,
): string {
	if (resultado === "no_aparece_en_sat") return "No se encontr\u00f3 en SAT";
	return estadoSat || "Sin dato SAT";
}

function CruceCarteraBadge({
	cruce,
	estadoCredito,
}: {
	cruce: CruceCartera;
	estadoCredito: string | null;
}) {
	if (cruce === "con_credito") {
		return (
			<Badge className="border-blue-300 bg-blue-100 text-blue-800">
				<CheckCircle2 /> Sí{estadoCredito ? ` · ${estadoCredito}` : ""}
			</Badge>
		);
	}
	return (
		<Badge className="border-amber-300 bg-amber-100 text-amber-800">
			<XCircle /> No
		</Badge>
	);
}

function TitularCell({
	cruce,
	titularCarteraNombre,
}: {
	cruce: CruceCartera;
	titularCarteraNombre: string | null;
}) {
	if (cruce === "con_credito") {
		return (
			<span>
				{titularCarteraNombre?.trim() || "Titular no identificado en Cartera"}
			</span>
		);
	}
	return <span>Sin crédito</span>;
}

function Senal({ valor }: { valor: boolean | null }) {
	if (valor === true)
		return <span className="font-medium text-green-600">Sí</span>;
	if (valor === false)
		return <span className="font-medium text-red-600">No</span>;
	return <span className="text-muted-foreground">No disponible</span>;
}

function textoCruceCartera(cruce: CruceCartera, estadoCredito: string | null) {
	if (cruce === "con_credito") {
		return estadoCredito ? `Sí · ${estadoCredito}` : "Sí";
	}
	return "No";
}

function etiquetaEstadoCredito(estado: EstadoCreditoFiltro | string | null) {
	if (estado === "ACTIVO") return "Activo";
	if (estado === "MOROSO") return "Moroso";
	if (estado === "EN_CONVENIO") return "En convenio";
	return "Todos";
}

function textoTitularCartera(cruce: CruceCartera, nombre: string | null) {
	if (cruce === "con_credito") {
		return nombre?.trim() || "Titular no identificado en Cartera";
	}
	return "Sin crédito";
}

function textoImpuesto(valor: boolean | null) {
	if (valor === true) return "Sí";
	if (valor === false) return "No";
	return "No disponible";
}

const CAMPOS_VISIBLES_DETALLE_SAT = [
	"DOMICILIO FISCAL DEL PROPIETARIO",
	"USO",
	"TIPO",
	"MARCA",
	"LÍNEA O ESTILO",
	"SERIE",
	"MODELO",
	"MOTOR",
	"CHASIS",
	"C.C.",
	"CILINDROS",
	"TONELAJE",
	"ASIENTOS",
	"WATTS",
	"KILOWATTS",
	"EJES",
	"PUERTAS",
	"COMBUSTIBLE",
	"VIN",
	"COLOR",
	"No. SOLVENCIA",
	"FECHA SOLVENCIA",
	"No. FRANQUICIA",
	"FECHA FRANQUICIA",
	"NOMBRE DE LA ADUANA QUE LIQUIDÓ",
	"PÓLIZA",
	"FECHA ALZA",
	"ÚLTIMO AÑO PAGADO",
	"ESTADO ACTUAL",
] as const;

function normalizarEtiquetaDetalleSat(value: string) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase();
}

const ETIQUETAS_DETALLE_SAT = new Map(
	CAMPOS_VISIBLES_DETALLE_SAT.map((campo) => [
		normalizarEtiquetaDetalleSat(campo),
		campo,
	]),
);

function camposVisiblesDetalleSat(campos: Record<string, string>) {
	const valores = new Map(
		Object.entries(campos).map(([campo, valor]) => [
			normalizarEtiquetaDetalleSat(campo),
			valor.trim(),
		]),
	);

	return CAMPOS_VISIBLES_DETALLE_SAT.flatMap((campo) => {
		const valor = valores.get(normalizarEtiquetaDetalleSat(campo));
		if (
			!valor ||
			ETIQUETAS_DETALLE_SAT.has(normalizarEtiquetaDetalleSat(valor))
		) {
			return [];
		}
		return [{ campo, valor }];
	});
}

const CAMPOS_RESUMEN_DETALLE_SAT = new Set([
	"TIPO",
	"MARCA",
	"MODELO",
	"COLOR",
]);

const CAMPOS_EXPORTACION_DETALLE_SAT = CAMPOS_VISIBLES_DETALLE_SAT.filter(
	(campo) =>
		!CAMPOS_RESUMEN_DETALLE_SAT.has(normalizarEtiquetaDetalleSat(campo)),
);

const ETIQUETAS_EXPORTACION_DETALLE_SAT = new Map(
	[
		["DOMICILIO FISCAL DEL PROPIETARIO", "Domicilio fiscal del propietario"],
		["USO", "Uso"],
		["LINEA O ESTILO", "Línea o estilo"],
		["SERIE", "Serie"],
		["MOTOR", "Motor"],
		["CHASIS", "Chasis"],
		["C.C.", "C.C."],
		["CILINDROS", "Cilindros"],
		["TONELAJE", "Tonelaje"],
		["ASIENTOS", "Asientos"],
		["WATTS", "Watts"],
		["KILOWATTS", "Kilowatts"],
		["EJES", "Ejes"],
		["PUERTAS", "Puertas"],
		["COMBUSTIBLE", "Combustible"],
		["VIN", "VIN"],
		["NO. SOLVENCIA", "No. solvencia"],
		["FECHA SOLVENCIA", "Fecha solvencia"],
		["NO. FRANQUICIA", "No. franquicia"],
		["FECHA FRANQUICIA", "Fecha franquicia"],
		["NOMBRE DE LA ADUANA QUE LIQUIDO", "Nombre de la aduana que liquidó"],
		["POLIZA", "Póliza"],
		["FECHA ALZA", "Fecha alza"],
		["ULTIMO ANO PAGADO", "Último año pagado"],
		["ESTADO ACTUAL", "Estado actual"],
	].map(([campo, etiqueta]) => [normalizarEtiquetaDetalleSat(campo), etiqueta]),
);

function etiquetaDetalleSatParaExcel(campo: string) {
	return (
		ETIQUETAS_EXPORTACION_DETALLE_SAT.get(
			normalizarEtiquetaDetalleSat(campo),
		) ?? campo
	);
}

function detalleSatParaExcel(
	detalle: ResultadoSatDetalle["detalleSat"],
): Record<string, string> {
	const valores = new Map(
		camposVisiblesDetalleSat(detalle?.campos ?? {}).map(({ campo, valor }) => [
			normalizarEtiquetaDetalleSat(campo),
			valor,
		]),
	);

	return Object.fromEntries(
		CAMPOS_EXPORTACION_DETALLE_SAT.map((campo) => [
			`Detalle SAT - ${etiquetaDetalleSatParaExcel(campo)}`,
			valores.get(normalizarEtiquetaDetalleSat(campo)) || "-",
		]),
	);
}

function anchoColumnaExcel(encabezado: string, valores: string[]) {
	const anchoContenido = Math.max(
		encabezado.length,
		...valores.map((valor) => valor.length),
	);

	return Math.min(42, Math.max(12, anchoContenido + 2));
}

function normalizeSearch(value: string | null | undefined) {
	return (value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

function esValorVacioReporte(value: string) {
	const normalizado = normalizeSearch(value);
	return [
		"",
		"-",
		"sin dato sat",
		"no disponible",
		"sin consultas registradas",
	].includes(normalizado);
}

function DetalleSatDialog({
	vehiculo,
	onClose,
}: {
	vehiculo: ResultadoSatDetalle | null;
	onClose: () => void;
}) {
	const camposDetalle = vehiculo?.detalleSat
		? camposVisiblesDetalleSat(vehiculo.detalleSat.campos)
		: [];
	const camposDetalleOrdenados = [
		...camposDetalle.filter(
			({ campo }) => normalizarEtiquetaDetalleSat(campo) === "ESTADO ACTUAL",
		),
		...camposDetalle.filter(
			({ campo }) => normalizarEtiquetaDetalleSat(campo) !== "ESTADO ACTUAL",
		),
	];

	return (
		<Dialog
			open={vehiculo !== null}
			onOpenChange={(open) => !open && onClose()}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle>Detalle del vehículo en SAT</DialogTitle>
					<DialogDescription>
						{vehiculo
							? `${vehiculo.placa} · ${[vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ") || "Sin descripción"}`
							: ""}
					</DialogDescription>
				</DialogHeader>
				{vehiculo?.detalleSat ? (
					<div>
						{camposDetalle.length > 0 ? (
							<div className="grid gap-3 md:grid-cols-3">
								{camposDetalleOrdenados.map(({ campo, valor }) => (
									<div className="rounded-md border p-3" key={campo}>
										<p className="font-medium text-muted-foreground text-xs">
											{campo}
										</p>
										<p className="mt-1 text-sm">{valor || "-"}</p>
									</div>
								))}
							</div>
						) : (
							<p className="text-muted-foreground text-sm">
								SAT no devolvió campos estructurados para este registro.
							</p>
						)}
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						SAT no devolvió detalle para este registro.
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}

function SatVerificationPage() {
	const [vehicleSearch, setVehicleSearch] = useState("");
	const [estadoSatFiltro, setEstadoSatFiltro] =
		useState<EstadoSatFiltro>("todos");
	const [cruceCarteraFiltro, setCruceCarteraFiltro] =
		useState<CruceCarteraFiltro>("todos");
	const [estadoCreditoFiltro, setEstadoCreditoFiltro] =
		useState<EstadoCreditoFiltro>("todos");
	const [soloNoPagado, setSoloNoPagado] = useState(false);
	const [pagina, setPagina] = useState(1);
	const [detalleSeleccionado, setDetalleSeleccionado] =
		useState<ResultadoSatDetalle | null>(null);
	const queryClient = useQueryClient();
	const verificationQuery = useQuery(
		orpc.obtenerUltimaVerificacionSat.queryOptions(),
	);
	const statusQuery = useQuery({
		...orpc.obtenerEstadoVerificacionSat.queryOptions(),
		refetchOnMount: "always",
		refetchInterval: (query) =>
			query.state.data?.estado === "en_proceso" ? 5000 : false,
		refetchIntervalInBackground: true,
	});
	const verificationMutation = useMutation(
		orpc.ejecutarVerificacionSat.mutationOptions({
			onSuccess: (resultado) => {
				queryClient.invalidateQueries({
					queryKey: orpc.obtenerUltimaVerificacionSat.queryKey(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.obtenerEstadoVerificacionSat.queryKey(),
				});
				if (resultado.estado === "en_proceso")
					toast.info(
						"La verificación SAT inició y continuará en segundo plano.",
					);
				else if (resultado.estado === "ok")
					toast.success("Verificación SAT completada.");
				else if (resultado.estado === "omitida")
					toast.info(
						resultado.omitida ?? "Ya hay una verificación SAT en proceso.",
					);
				else toast.error("La verificación SAT no se completó.");
			},
			onError: () => toast.error("No se pudo ejecutar la verificación SAT."),
		}),
	);

	const data = verificationQuery.data;
	const lote = data?.lote;
	const estadoLote = statusQuery.data?.estado ?? lote?.estado ?? null;
	const consultaEnProceso = estadoLote === "en_proceso";
	const estadoAnterior = useRef<string | null>(null);
	useEffect(() => {
		if (estadoAnterior.current === "en_proceso" && estadoLote === "ok") {
			toast.success("Verificación SAT completada.");
			queryClient.invalidateQueries({
				queryKey: orpc.obtenerUltimaVerificacionSat.queryKey(),
			});
		} else if (
			estadoAnterior.current === "en_proceso" &&
			estadoLote === "error"
		) {
			toast.error("La verificación SAT terminó con error.");
			queryClient.invalidateQueries({
				queryKey: orpc.obtenerUltimaVerificacionSat.queryKey(),
			});
		}
		estadoAnterior.current = estadoLote;
	}, [estadoLote, queryClient]);

	const resultados = data?.resultados ?? [];
	const resultadosFiltrados = useMemo(() => {
		const vehicleTerm = normalizeSearch(vehicleSearch);
		return resultados.filter((vehiculo) => {
			const searchableText = normalizeSearch(
				[
					vehiculo.marca,
					vehiculo.modelo,
					vehiculo.tipo,
					vehiculo.color,
					vehiculo.placa,
					vehiculo.titularCarteraNombre,
					vehiculo.titularEnSat,
				]
					.filter(Boolean)
					.join(" "),
			);
			const matchesSearch =
				!vehicleTerm || searchableText.includes(vehicleTerm);
			const estadoSat = vehiculo.estadoSat?.trim().toLowerCase();
			const matchesEstadoSat =
				estadoSatFiltro === "todos" ||
				(estadoSatFiltro === "activo" && estadoSat === "activo") ||
				(estadoSatFiltro === "inactivo" && estadoSat === "inactivo") ||
				(estadoSatFiltro === "no_encontrado" &&
					vehiculo.resultado === "no_aparece_en_sat");
			const matchesCartera =
				cruceCarteraFiltro === "todos" ||
				(cruceCarteraFiltro === "con_credito" &&
					vehiculo.cruceCartera === "con_credito") ||
				(cruceCarteraFiltro === "sin_credito" &&
					vehiculo.cruceCartera !== "con_credito");
			const matchesEstadoCredito =
				estadoCreditoFiltro === "todos" ||
				vehiculo.estadoCredito?.trim().toUpperCase() === estadoCreditoFiltro;
			const matchesTax =
				!soloNoPagado || vehiculo.impuestoCirculacionPagado === false;
			return (
				matchesSearch &&
				matchesEstadoSat &&
				matchesCartera &&
				matchesEstadoCredito &&
				matchesTax
			);
		});
	}, [
		cruceCarteraFiltro,
		estadoCreditoFiltro,
		estadoSatFiltro,
		resultados,
		soloNoPagado,
		vehicleSearch,
	]);

	const totalPaginas = Math.max(
		1,
		Math.ceil(resultadosFiltrados.length / PAGE_SIZE),
	);
	useEffect(() => {
		setPagina((paginaActual) => Math.min(paginaActual, totalPaginas));
	}, [totalPaginas]);
	const paginaActual = Math.min(pagina, totalPaginas);
	const resultadosVisibles = resultadosFiltrados.slice(
		(paginaActual - 1) * PAGE_SIZE,
		paginaActual * PAGE_SIZE,
	);
	const hayFiltros =
		vehicleSearch.trim() ||
		estadoSatFiltro !== "todos" ||
		cruceCarteraFiltro !== "todos" ||
		estadoCreditoFiltro !== "todos" ||
		soloNoPagado;
	const resetearFiltros = () => {
		setVehicleSearch("");
		setEstadoSatFiltro("todos");
		setCruceCarteraFiltro("todos");
		setEstadoCreditoFiltro("todos");
		setSoloNoPagado(false);
		setPagina(1);
	};
	const exportarReporte = async () => {
		if (resultadosFiltrados.length === 0) {
			toast.info("No hay resultados que coincidan con los filtros.");
			return;
		}

		const XLSX = await import("xlsx-js-style");
		const filtrosAplicados = [
			vehicleSearch.trim() ? `Búsqueda: ${vehicleSearch.trim()}` : null,
			estadoSatFiltro !== "todos"
				? `Estado SAT: ${
						estadoSatFiltro === "no_encontrado"
							? "No se encontró en SAT"
							: estadoSatFiltro
					}`
				: null,
			cruceCarteraFiltro !== "todos"
				? `Está en Cartera: ${
						cruceCarteraFiltro === "con_credito" ? "Sí" : "No"
					}`
				: null,
			estadoCreditoFiltro !== "todos"
				? `Estado del crédito: ${etiquetaEstadoCredito(estadoCreditoFiltro)}`
				: null,
			soloNoPagado ? "Impuesto: No pagado" : null,
		].filter((filtro): filtro is string => Boolean(filtro));
		const textoFiltros = filtrosAplicados.length
			? filtrosAplicados.join(" | ")
			: "Sin filtros; se muestran todos los resultados";
		const filas = resultadosFiltrados.map((vehiculo) => ({
			"Titular del crédito": textoTitularCartera(
				vehiculo.cruceCartera,
				vehiculo.titularCarteraNombre,
			),
			"Titular en SAT": vehiculo.titularEnSat || "-",
			Placa: vehiculo.placa,
			"Marca SAT": vehiculo.marca || "-",
			"Modelo SAT": vehiculo.modelo || "-",
			"Tipo de vehículo": vehiculo.tipo || "-",
			Color: vehiculo.color || "-",
			"Estado SAT": textoEstadoSat(vehiculo.estadoSat, vehiculo.resultado),
			"Está en Cartera": textoCruceCartera(
				vehiculo.cruceCartera,
				vehiculo.estadoCredito,
			),
			"Número SIFCO": vehiculo.numeroSifco || "-",
			"Impuesto pagado": textoImpuesto(vehiculo.impuestoCirculacionPagado),
			Consultado: formatDate(vehiculo.consultadoAt),
			...detalleSatParaExcel(vehiculo.detalleSat),
		}));
		const encabezados = Object.keys(filas[0]).filter(
			(encabezado) =>
				!encabezado.startsWith("Detalle SAT - ") ||
				filas.some(
					(fila) =>
						!esValorVacioReporte(
							String(fila[encabezado as keyof (typeof filas)[number]] ?? ""),
						),
				),
		);
		const valoresPorColumna = encabezados.map((encabezado) =>
			filas.map((fila) =>
				String(fila[encabezado as keyof (typeof filas)[number]]),
			),
		);
		const fechaGeneracion = formatDate(new Date());
		const ultimaColumna = XLSX.utils.encode_col(encabezados.length - 1);
		const hoja = XLSX.utils.aoa_to_sheet([
			["Reporte de vehículos en SAT"],
			[`Generado: ${fechaGeneracion}`],
			[`Filtros aplicados: ${textoFiltros}`],
			[],
			encabezados,
			...filas.map((fila) =>
				encabezados.map((encabezado) => fila[encabezado as keyof typeof fila]),
			),
		]);
		hoja["!merges"] = [
			{ s: { r: 0, c: 0 }, e: { r: 0, c: encabezados.length - 1 } },
			{ s: { r: 1, c: 0 }, e: { r: 1, c: encabezados.length - 1 } },
			{ s: { r: 2, c: 0 }, e: { r: 2, c: encabezados.length - 1 } },
		];
		hoja["!autofilter"] = {
			ref: `A5:${ultimaColumna}${filas.length + 5}`,
		};
		hoja["!cols"] = encabezados.map((encabezado, columna) => ({
			wch: anchoColumnaExcel(encabezado, valoresPorColumna[columna]),
		}));
		hoja["!rows"] = [
			{ hpt: 30 },
			{ hpt: 20 },
			{ hpt: 20 },
			{ hpt: 8 },
			{ hpt: 34 },
		];

		const estiloTitulo = {
			font: { bold: true, color: { rgb: "FFFFFF" }, sz: 16 },
			fill: { patternType: "solid", fgColor: { rgb: "1F4E78" } },
			alignment: { horizontal: "center", vertical: "center" },
		};
		const estiloMetadato = {
			font: { italic: true, color: { rgb: "44546A" } },
			alignment: { vertical: "center", wrapText: true },
		};
		const estiloEncabezado = {
			font: { bold: true, color: { rgb: "FFFFFF" } },
			fill: { patternType: "solid", fgColor: { rgb: "5B9BD5" } },
			alignment: { horizontal: "center", vertical: "center", wrapText: true },
			border: {
				top: { style: "thin", color: { rgb: "D9EAF7" } },
				bottom: { style: "thin", color: { rgb: "D9EAF7" } },
				left: { style: "thin", color: { rgb: "D9EAF7" } },
				right: { style: "thin", color: { rgb: "D9EAF7" } },
			},
		};
		const estiloDato = {
			alignment: { vertical: "top", wrapText: true },
		};
		const estiloDatoAlterno = {
			...estiloDato,
			fill: { patternType: "solid", fgColor: { rgb: "F3F8FC" } },
		};

		for (let columna = 0; columna < encabezados.length; columna += 1) {
			const tituloRef = XLSX.utils.encode_cell({ r: 0, c: columna });
			const fechaRef = XLSX.utils.encode_cell({ r: 1, c: columna });
			const filtrosRef = XLSX.utils.encode_cell({ r: 2, c: columna });
			if (!hoja[tituloRef]) hoja[tituloRef] = { t: "s", v: "" };
			if (!hoja[fechaRef]) hoja[fechaRef] = { t: "s", v: "" };
			if (!hoja[filtrosRef]) hoja[filtrosRef] = { t: "s", v: "" };
			hoja[tituloRef].s = estiloTitulo;
			hoja[fechaRef].s = estiloMetadato;
			hoja[filtrosRef].s = estiloMetadato;

			const encabezadoRef = XLSX.utils.encode_cell({ r: 4, c: columna });
			hoja[encabezadoRef].s = estiloEncabezado;
			for (let fila = 5; fila < filas.length + 5; fila += 1) {
				const datoRef = XLSX.utils.encode_cell({ r: fila, c: columna });
				if (hoja[datoRef]) {
					hoja[datoRef].s = fila % 2 === 0 ? estiloDatoAlterno : estiloDato;
				}
			}
		}
		const libro = XLSX.utils.book_new();
		libro.Props = {
			Title: "Reporte de vehículos en SAT",
			Subject: "Verificación de vehículos en SAT",
		};
		XLSX.utils.book_append_sheet(libro, hoja, "Verificación SAT");
		const fecha = new Date().toISOString().slice(0, 10);
		XLSX.writeFile(libro, `reporte-vehiculos-sat-${fecha}.xlsx`, {
			cellStyles: true,
		});
		toast.success(`Reporte generado con ${filas.length} vehículos.`);
	};

	return (
		<main className="container mx-auto space-y-6 p-6">
			<div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
				<div>
					<h1 className="font-bold text-3xl tracking-tight">
						Verificación en SAT
					</h1>
					<p className="text-muted-foreground">
						Consulta el estado de los vehículos y sus documentos en Agencia
						Virtual.
					</p>
				</div>
				<Button
					onClick={() => verificationMutation.mutate({})}
					disabled={verificationMutation.isPending || consultaEnProceso}
				>
					<RefreshCw
						className={
							verificationMutation.isPending || consultaEnProceso
								? "animate-spin"
								: ""
						}
					/>
					{verificationMutation.isPending
						? "Iniciando consulta..."
						: consultaEnProceso
							? "Consultando SAT..."
							: "Consultar vehículos"}
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Último intento</CardDescription>
						<CardTitle className="flex items-center gap-2 text-lg">
							<Clock3 className="h-4 w-4" />
							{formatDate(
								statusQuery.data?.finalizadaAt ??
									statusQuery.data?.iniciadaAt ??
									lote?.finalizadaAt ??
									lote?.iniciadaAt,
							)}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Estado del lote</CardDescription>
						<CardTitle className="text-lg">
							{formatRunStatus(estadoLote)}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Resultados</CardDescription>
						<CardTitle className="text-lg">
							{resultados.length} vehículos
						</CardTitle>
						{data?.estadoActual && (
							<CardDescription>
								Consulta completa: {formatDate(data.estadoActual.consultadoAt)}
							</CardDescription>
						)}
					</CardHeader>
				</Card>
			</div>

			{verificationQuery.isError && (
				<Card className="border-red-200">
					<CardContent className="pt-6 text-red-700">
						No se pudo cargar la última verificación SAT.
					</CardContent>
				</Card>
			)}
			{consultaEnProceso && (
				<p className="text-muted-foreground text-sm">
					La consulta continúa en segundo plano. Mientras termina, se muestran
					los resultados de la última consulta completa disponible.
				</p>
			)}
			{estadoLote === "error" && (
				<p className="text-red-700 text-sm">
					La última consulta terminó con error y no actualizó ningún resultado.
					{resultados.length > 0
						? " Se mantiene la última consulta completa."
						: " Todavía no existe una consulta completa anterior."}
				</p>
			)}

			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<ShieldCheck className="h-5 w-5" />
							Resultados por vehículo
						</CardTitle>
						<CardDescription>
							Estado SAT, titular de SAT y relación vigente con Cartera.
						</CardDescription>
					</div>
					<Button
						className="shrink-0"
						disabled={resultadosFiltrados.length === 0}
						onClick={exportarReporte}
						variant="outline"
					>
						<FileSpreadsheet />
						Exportar reporte
					</Button>
				</CardHeader>
				<CardContent>
					<div className="mb-6 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1.5fr)_repeat(3,minmax(9rem,1fr))_auto_auto]">
						<div className="space-y-1.5">
							<label
								className="font-medium text-sm"
								htmlFor="sat-vehicle-search"
							>
								Buscar vehículo o placa
							</label>
							<div className="relative">
								<Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
								<Input
									id="sat-vehicle-search"
									className="pl-9"
									placeholder="Marca, modelo, tipo o placa"
									value={vehicleSearch}
									onChange={(event) => {
										setVehicleSearch(event.target.value);
										setPagina(1);
									}}
								/>
							</div>
						</div>
						<div className="space-y-1.5">
							<label
								className="font-medium text-sm"
								htmlFor="sat-status-filter"
							>
								Estado SAT
							</label>
							<Select
								value={estadoSatFiltro}
								onValueChange={(value) => {
									setEstadoSatFiltro(value as EstadoSatFiltro);
									setPagina(1);
								}}
							>
								<SelectTrigger id="sat-status-filter">
									<SelectValue placeholder="Todos los estados SAT" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									<SelectItem value="activo">Activo</SelectItem>
									<SelectItem value="inactivo">Inactivo</SelectItem>
									<SelectItem value="no_encontrado">
										No se encontró en SAT
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<label
								className="font-medium text-sm"
								htmlFor="sat-cartera-filter"
							>
								Está en cartera
							</label>
							<Select
								value={cruceCarteraFiltro}
								onValueChange={(value) => {
									setCruceCarteraFiltro(value as CruceCarteraFiltro);
									setPagina(1);
								}}
							>
								<SelectTrigger id="sat-cartera-filter">
									<SelectValue placeholder="Todos los cruces" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									<SelectItem value="con_credito">Sí</SelectItem>
									<SelectItem value="sin_credito">No</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<label
								className="font-medium text-sm"
								htmlFor="sat-credit-status-filter"
							>
								Estado del crédito
							</label>
							<Select
								value={estadoCreditoFiltro}
								onValueChange={(value) => {
									setEstadoCreditoFiltro(value as EstadoCreditoFiltro);
									setPagina(1);
								}}
							>
								<SelectTrigger id="sat-credit-status-filter">
									<SelectValue placeholder="Todos los estados" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									<SelectItem value="ACTIVO">Activo</SelectItem>
									<SelectItem value="MOROSO">Moroso</SelectItem>
									<SelectItem value="EN_CONVENIO">En convenio</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col justify-end gap-2">
							<label className="flex min-h-9 cursor-pointer items-center gap-2 whitespace-nowrap text-sm">
								<input
									checked={soloNoPagado}
									className="h-4 w-4 accent-primary"
									type="checkbox"
									onChange={(event) => {
										setSoloNoPagado(event.target.checked);
										setPagina(1);
									}}
								/>
								<span>No pagó impuesto</span>
							</label>
						</div>
						<div className="flex items-end">
							{hayFiltros && (
								<Button
									className="w-full whitespace-nowrap"
									variant="outline"
									onClick={resetearFiltros}
								>
									Limpiar filtros
								</Button>
							)}
						</div>
					</div>

					<div className="mb-3 flex flex-col justify-between gap-2 text-muted-foreground text-sm sm:flex-row sm:items-center">
						<span>
							{resultadosFiltrados.length === 0
								? "0 resultados"
								: `Mostrando ${(paginaActual - 1) * PAGE_SIZE + 1}-${Math.min(paginaActual * PAGE_SIZE, resultadosFiltrados.length)} de ${resultadosFiltrados.length} resultados`}
						</span>
						{hayFiltros && <span>Filtros aplicados</span>}
					</div>

					{verificationQuery.isLoading ? (
						<p className="py-8 text-center text-muted-foreground">
							Cargando resultados...
						</p>
					) : resultados.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground">
							{consultaEnProceso
								? "La consulta está en proceso. Los resultados aparecerán al completarse."
								: "Todavía no hay resultados. Ejecuta una consulta para comenzar."}
						</p>
					) : resultadosFiltrados.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground">
							No hay vehículos que coincidan con los filtros seleccionados.
						</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Titular del crédito</TableHead>
										<TableHead>Titular en SAT</TableHead>
										<TableHead>Placa</TableHead>
										<TableHead>Vehículo SAT</TableHead>
										<TableHead>Estado SAT</TableHead>
										<TableHead>Está en cartera</TableHead>
										<TableHead>Impuesto pagado</TableHead>
										<TableHead>Detalle</TableHead>
										<TableHead>Consultado</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{resultadosVisibles.map((vehiculo) => (
										<TableRow key={vehiculo.id}>
											<TableCell>
												<div className="font-medium">
													<TitularCell
														cruce={vehiculo.cruceCartera}
														titularCarteraNombre={vehiculo.titularCarteraNombre}
													/>
												</div>
											</TableCell>
											<TableCell>{vehiculo.titularEnSat || "-"}</TableCell>
											<TableCell className="font-medium">
												{vehiculo.placa}
											</TableCell>
											<TableCell>
												<div className="font-medium">
													{vehiculo.marca || "Marca sin datos"}
												</div>
												<div className="text-muted-foreground text-xs">
													{vehiculo.modelo
														? `Modelo ${vehiculo.modelo}`
														: "Modelo sin datos"}
												</div>
												<div className="text-muted-foreground text-xs">
													{[vehiculo.tipo, vehiculo.color]
														.filter(Boolean)
														.join(" · ") || "Sin datos"}
												</div>
											</TableCell>
											<TableCell>
												<EstadoSatBadge
													estadoSat={vehiculo.estadoSat}
													resultado={vehiculo.resultado}
												/>
											</TableCell>
											<TableCell>
												<CruceCarteraBadge
													cruce={vehiculo.cruceCartera}
													estadoCredito={vehiculo.estadoCredito}
												/>
											</TableCell>
											<TableCell>
												<Senal valor={vehiculo.impuestoCirculacionPagado} />
											</TableCell>
											<TableCell>
												<Button
													aria-label={`Ver detalle de ${vehiculo.placa}`}
													size="icon"
													variant="ghost"
													onClick={() => setDetalleSeleccionado(vehiculo)}
												>
													<Eye className="h-4 w-4" />
												</Button>
											</TableCell>
											<TableCell>{formatDate(vehiculo.consultadoAt)}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							<div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
								<span className="text-muted-foreground text-sm">
									Página {paginaActual} de {totalPaginas}
								</span>
								<div className="flex items-center gap-2">
									<Button
										aria-label="Página anterior"
										disabled={paginaActual === 1}
										variant="outline"
										onClick={() =>
											setPagina((current) => Math.max(1, current - 1))
										}
									>
										<ChevronLeft />
										Anterior
									</Button>
									<Button
										aria-label="Página siguiente"
										disabled={paginaActual >= totalPaginas}
										variant="outline"
										onClick={() =>
											setPagina((current) =>
												Math.min(totalPaginas, current + 1),
											)
										}
									>
										Siguiente
										<ChevronRight />
									</Button>
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
			<DetalleSatDialog
				vehiculo={detalleSeleccionado}
				onClose={() => setDetalleSeleccionado(null)}
			/>
		</main>
	);
}

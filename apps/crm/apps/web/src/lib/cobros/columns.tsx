import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContactoQuickAction } from "@/components/cobros/contacto-quick-action";
import { parseFechaLocal } from "@/lib/date-utils";

const ESTADOS_MORA_CTA = new Set([
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
]);

export type ContratoCobranza = {
	contratoId: string;
	casoCobroId: string | null;
	clienteNombre: string;
	vehiculoMarca: string;
	vehiculoModelo: string;
	vehiculoYear: number | null;
	vehiculoPlaca: string;
	montoEnMora: string;
	diasMoraMaximo: number;
	estadoMora: string | null;
	estadoContrato: string;
	fechaProximoPago: string | null;
	diasHastaPago: number | null;
	numeroCredito: string | null;
	cuotaMensual: string | null;
	etiquetas: string[] | null;
	isPool?: boolean;
	responsableCobros: string | null;
	montoFinanciado: string;
};

function getEstadoBadge(estado: string) {
	const colors: Record<string, string> = {
		al_dia: "bg-green-100 text-green-800",
		pre_mora: "bg-yellow-50 text-yellow-700 border-yellow-200",
		mora_30: "bg-yellow-100 text-yellow-800",
		mora_60: "bg-orange-100 text-orange-800",
		mora_90: "bg-red-100 text-red-800",
		mora_120: "bg-red-200 text-red-900",
		mora_120_plus: "bg-red-300 text-red-950",
		incobrable: "bg-gray-100 text-gray-800",
		completado: "bg-blue-100 text-blue-800",
	};

	const labels: Record<string, string> = {
		al_dia: "Al Día",
		pre_mora: "Próximo a Vencer",
		mora_30: "Mora 30",
		mora_60: "Mora 60",
		mora_90: "Mora 90",
		mora_120: "Mora 120+",
		mora_120_plus: "Mora 120+",
		incobrable: "Incobrable",
		completado: "Completado",
	};

	return (
		<Badge className={colors[estado] || colors.al_dia}>
			{labels[estado] || estado}
		</Badge>
	);
}

const ETIQUETA_LABELS: Record<string, string> = {
	juridico: "Jurídico",
	convenio: "Convenio",
	cobro: "Cobro",
	no_localizable: "No Loc.",
	unidad_a_recuperar: "U. a Recup.",
	unidad_recuperada: "U. Recup.",
	moras_pendientes: "Moras Pend.",
	compromiso_de_pago: "Comp. Pago",
	cancelado: "Cancelado",
	reclamo: "Reclamo",
};

const ETIQUETA_COLORS: Record<string, string> = {
	juridico: "bg-purple-100 text-purple-800",
	convenio: "bg-blue-100 text-blue-800",
	cobro: "bg-green-100 text-green-800",
	no_localizable: "bg-gray-100 text-gray-800",
	unidad_a_recuperar: "bg-orange-100 text-orange-800",
	unidad_recuperada: "bg-teal-100 text-teal-800",
	moras_pendientes: "bg-red-100 text-red-800",
	compromiso_de_pago: "bg-yellow-100 text-yellow-800",
	cancelado: "bg-slate-100 text-slate-800",
	reclamo: "bg-pink-100 text-pink-800",
};

// Trunca UUIDs largos al medio (ej: "CRM-935cceeb-b88f-449f-..." → "CRM-935c…5c069").
// Para strings cortos (≤18 chars) devuelve el original.
function truncarCredito(numero: string): string {
	if (numero.length <= 18) return numero;
	return `${numero.slice(0, 8)}…${numero.slice(-5)}`;
}

// Detecta vehículos placeholder generados por auto-migrate ("N/A N/A 2000" o
// "- -"). Sólo se considera placeholder cuando AMBOS campos (marca y modelo)
// son vacíos o sentinelas; filas con datos parciales útiles (ej. marca presente
// y modelo vacío) se preservan tal cual.
function esVehiculoPlaceholder(marca: string, modelo: string): boolean {
	const esSentinela = (v: string | null | undefined) => {
		const t = v?.trim() ?? "";
		return t === "" || t === "N/A" || t === "-";
	};
	return esSentinela(marca) && esSentinela(modelo);
}

interface GetColumnsOptions {
	/**
	 * Etapa de mora actualmente filtrada en la tabla. Cuando coincide con un
	 * estado de mora (mora_30/60/90/120+), se muestra el CTA de contacto rápido
	 * en la primera columna.
	 */
	filtroEtapa: string | null;
}

export function getCobrosColumns({
	filtroEtapa,
}: GetColumnsOptions): ColumnDef<ContratoCobranza>[] {
	const mostrarCtaContacto = !!filtroEtapa && ESTADOS_MORA_CTA.has(filtroEtapa);

	return [
	{
		accessorKey: "fechaProximoPago",
		header: ({ column }) => {
			return (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				>
					Fecha de Pago
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
		cell: ({ row }) => {
			const fecha = row.getValue("fechaProximoPago") as string | null;
			const dias = row.original.diasHastaPago;
			const numeroCredito = row.original.numeroCredito;

			const fechaFormateada = fecha
				? parseFechaLocal(fecha).toLocaleDateString("es-GT", {
						day: "2-digit",
						month: "short",
						year: "numeric",
					})
				: null;

			let diasClassName = "text-xs mt-0.5";
			let diasText = "";

			if (dias === null) {
				// sin texto secundario
			} else if (dias === 0) {
				diasClassName += " text-red-600 font-semibold";
				diasText = "¡Hoy!";
			} else if (dias < 0) {
				diasClassName += " text-red-700 font-semibold";
				diasText = `${Math.abs(dias)} días vencido`;
			} else if (dias <= 3) {
				diasClassName += " text-orange-600";
				diasText = `en ${dias} días`;
			} else if (dias <= 7) {
				diasClassName += " text-yellow-600";
				diasText = `en ${dias} días`;
			} else {
				diasClassName += " text-muted-foreground";
				diasText = `en ${dias} días`;
			}

			return (
				<div className="flex items-center gap-2">
					<div className="font-medium">
						{fechaFormateada ? (
							<div>{fechaFormateada}</div>
						) : (
							<div className="text-gray-500">Sin fecha definida</div>
						)}
						{diasText && <div className={diasClassName}>{diasText}</div>}
					</div>
					{mostrarCtaContacto && numeroCredito && (
						<ContactoQuickAction numeroCredito={numeroCredito} />
					)}
				</div>
			);
		},
	},
	{
		accessorKey: "clienteNombre",
		header: ({ column }) => {
			return (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				>
					Cliente / Crédito
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
		cell: ({ row }) => {
			const nombre = row.getValue("clienteNombre") as string;
			const numero = row.original.numeroCredito;
			const isPool = row.original.isPool;
			return (
				<div className="flex min-w-0 max-w-[320px] flex-col gap-0.5">
					<div className="flex items-center gap-2">
						<span className="truncate font-medium">{nombre}</span>
						{isPool && (
							<Badge
								variant="secondary"
								className="shrink-0 bg-indigo-100 text-indigo-800 text-xs"
							>
								Pool
							</Badge>
						)}
					</div>
					<span
						className="truncate font-mono text-muted-foreground text-xs"
						title={numero || undefined}
					>
						{numero ? truncarCredito(numero) : "—"}
					</span>
				</div>
			);
		},
	},
	{
		accessorKey: "responsableCobros",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			>
				Asesor
				<ArrowUpDown className="ml-2 h-4 w-4" />
			</Button>
		),
		cell: ({ row }) => {
			const asesor = row.getValue("responsableCobros") as string | null;
			if (!asesor)
				return (
					<span className="text-muted-foreground text-xs">Sin asignar</span>
				);
			return <span className="font-medium text-sm">{asesor}</span>;
		},
	},
	{
		id: "vehiculo",
		accessorFn: (row) =>
			`${row.vehiculoMarca} ${row.vehiculoModelo} ${row.vehiculoYear} ${row.vehiculoPlaca}`,
		header: "Vehículo",
		cell: ({ row }) => {
			const { vehiculoMarca, vehiculoModelo, vehiculoYear, vehiculoPlaca } =
				row.original;
			const esPlaceholder = esVehiculoPlaceholder(
				vehiculoMarca,
				vehiculoModelo,
			);
			const placaLimpia = vehiculoPlaca?.trim();
			const tienePlaca = placaLimpia && placaLimpia !== "-" && placaLimpia !== "";

			if (esPlaceholder && !tienePlaca) {
				return <span className="text-muted-foreground">—</span>;
			}

			return (
				<div className="flex min-w-0 max-w-[180px] flex-col gap-0.5">
					<span className="whitespace-normal break-words font-medium text-sm leading-tight">
						{esPlaceholder
							? "Sin datos"
							: `${vehiculoMarca} ${vehiculoModelo} ${vehiculoYear ?? ""}`.trim()}
					</span>
					{tienePlaca && (
						<span className="font-mono text-muted-foreground text-xs">
							{placaLimpia}
						</span>
					)}
				</div>
			);
		},
	},
	{
		accessorKey: "montoEnMora",
		header: ({ column }) => {
			return (
				<div className="text-right">
					<Button
						variant="ghost"
						onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
					>
						Monto en Mora
						<ArrowUpDown className="ml-2 h-4 w-4" />
					</Button>
				</div>
			);
		},
		cell: ({ row }) => {
			const monto = Number.parseFloat(row.getValue("montoEnMora"));
			const formatted = new Intl.NumberFormat("es-GT", {
				style: "currency",
				currency: "GTQ",
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(monto);

			return (
				<div
					className={`font-medium tabular-nums ${monto > 0 ? "text-right" : "text-center"}`}
				>
					{monto > 0 ? formatted : "-"}
				</div>
			);
		},
	},
	{
		accessorKey: "montoFinanciado",
		header: ({ column }) => {
			return (
				<div className="text-right">
					<Button
						variant="ghost"
						onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
					>
						Capital
						<ArrowUpDown className="ml-2 h-4 w-4" />
					</Button>
				</div>
			);
		},
		cell: ({ row }) => {
			const monto = Number.parseFloat(row.getValue("montoFinanciado"));
			const formatted = new Intl.NumberFormat("es-GT", {
				style: "currency",
				currency: "GTQ",
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(monto);

			return (
				<div
					className={`font-medium tabular-nums ${monto > 0 ? "text-right" : "text-center"}`}
				>
					{monto > 0 ? formatted : "-"}
				</div>
			);
		},
		sortingFn: (rowA, rowB) => {
			const a = Number.parseFloat(rowA.getValue("montoFinanciado"));
			const b = Number.parseFloat(rowB.getValue("montoFinanciado"));
			return a - b;
		},
	},
	{
		id: "etiquetas",
		accessorKey: "etiquetas",
		header: ({ column }) => (
			<Button
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			>
				Etiquetas
				<ArrowUpDown className="ml-2 h-4 w-4" />
			</Button>
		),
		cell: ({ row }) => {
			const etiquetas = row.original.etiquetas;
			if (!etiquetas || etiquetas.length === 0)
				return <span className="text-muted-foreground text-xs">—</span>;
			return (
				<div className="flex flex-wrap gap-1">
					{etiquetas.map((etiqueta) => (
						<Badge
							key={etiqueta}
							className={`text-xs ${ETIQUETA_COLORS[etiqueta] || "bg-gray-100 text-gray-800"}`}
						>
							{ETIQUETA_LABELS[etiqueta] || etiqueta}
						</Badge>
					))}
				</div>
			);
		},
		sortingFn: (rowA, rowB) => {
			const a = rowA.original.etiquetas?.length ?? 0;
			const b = rowB.original.etiquetas?.length ?? 0;
			return a - b;
		},
	},
	{
		id: "estado",
		accessorFn: (row) =>
			row.estadoContrato === "activo"
				? row.estadoMora || "al_dia"
				: row.estadoContrato,
		header: "Estado",
		cell: ({ row }) => {
			const estadoVisual =
				row.original.estadoContrato === "activo"
					? row.original.estadoMora || "al_dia"
					: row.original.estadoContrato;
			return getEstadoBadge(estadoVisual);
		},
	},
	];
}

// Mantener export legacy para consumidores existentes que no necesiten el CTA.
export const columns = getCobrosColumns({ filtroEtapa: null });

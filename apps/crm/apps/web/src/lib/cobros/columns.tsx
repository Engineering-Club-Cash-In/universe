import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
};

function getEstadoBadge(estado: string) {
	const colors: Record<string, string> = {
		al_dia: "bg-green-100 text-green-800",
		pre_mora: "bg-yellow-50 text-yellow-700 border-yellow-200", // Nuevo: próximo a vencer
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

export const columns: ColumnDef<ContratoCobranza>[] = [
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

			if (!fecha) {
				return (
					<div className="font-medium text-gray-500">Sin fecha definida</div>
				);
			}

			const fechaFormateada = new Date(fecha).toLocaleDateString("es-GT", {
				day: "2-digit",
				month: "short",
				year: "numeric",
			});

			let diasClassName = "text-xs mt-0.5";
			let diasText = "";

			if (dias === null) {
				diasText = "";
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
				<div className="font-medium">
					<div>{fechaFormateada}</div>
					{diasText && <div className={diasClassName}>{diasText}</div>}
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
					Cliente
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
		cell: ({ row }) => {
			return (
				<div
					className="w-[350px] whitespace-normal font-medium"
					style={{ wordBreak: "break-word" }}
				>
					{row.getValue("clienteNombre")}
				</div>
			);
		},
	},
	{
		accessorKey: "numeroCredito",
		header: "No. Crédito",
		cell: ({ row }) => {
			const numero = row.getValue("numeroCredito") as string | null;
			return (
				<div
					className="w-[180px] whitespace-normal font-mono text-sm"
					style={{ wordBreak: "break-all" }}
				>
					{numero || "-"}
				</div>
			);
		},
	},
	{
		id: "vehiculo",
		accessorFn: (row) =>
			`${row.vehiculoMarca} ${row.vehiculoModelo} ${row.vehiculoYear}`,
		header: "Vehículo",
		cell: ({ row }) => {
			return (
				<div className="font-medium">
					{row.original.vehiculoMarca} {row.original.vehiculoModelo}{" "}
					{row.original.vehiculoYear}
				</div>
			);
		},
	},
	{
		accessorKey: "vehiculoPlaca",
		header: "Placa",
		cell: ({ row }) => {
			return (
				<Badge variant="outline" className="font-mono">
					{row.getValue("vehiculoPlaca")}
				</Badge>
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
			}).format(monto);

			return (
				<div
					className={`font-medium ${monto > 0 ? "text-right" : "text-center"}`}
				>
					{monto > 0 ? formatted : "-"}
				</div>
			);
		},
	},
	{
		id: "etiquetas",
		accessorKey: "etiquetas",
		header: "Etiquetas",
		cell: ({ row }) => {
			const etiquetas = row.original.etiquetas;
			if (!etiquetas || etiquetas.length === 0) return null;
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

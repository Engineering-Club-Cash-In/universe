import { type ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Eye } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ContratoCobranza = {
	contratoId: string;
	casoCobroId: string | null;
	clienteNombre: string;
	vehiculoMarca: string;
	vehiculoModelo: string;
	vehiculoYear: number;
	vehiculoPlaca: string;
	montoEnMora: string;
	diasMoraMaximo: number;
	estadoMora: string | null;
	estadoContrato: string;
	diaPagoMensual: number | null;
	diasHastaPago: number; // Calculado: días hasta el próximo pago
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

export const columns: ColumnDef<ContratoCobranza>[] = [
	{
		accessorKey: "diasHastaPago",
		header: ({ column }) => {
			return (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				>
					Días hasta Pago
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			);
		},
		cell: ({ row }) => {
			const dias = row.getValue("diasHastaPago") as number;
			let className = "font-medium";

			if (dias === 0) {
				className += " text-red-600";
				return <div className={className}>¡Hoy!</div>;
			}
			if (dias < 0) {
				className += " text-red-700";
				return <div className={className}>{Math.abs(dias)} días vencido</div>;
			}
			if (dias <= 3) {
				className += " text-orange-600";
			} else if (dias <= 7) {
				className += " text-yellow-600";
			}

			return <div className={className}>{dias} días</div>;
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
				<div className={`font-medium ${monto > 0 ? "text-right" : "text-center"}`}>
					{monto > 0 ? formatted : "-"}
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
	{
		id: "acciones",
		cell: ({ row }) => {
			const linkId = row.original.casoCobroId || row.original.contratoId;
			const tipoLink = row.original.casoCobroId ? "caso" : "contrato";

			return (
				<Link
					to="/cobros/$id"
					params={{ id: linkId }}
					search={{ tipo: tipoLink }}
				>
					<Button variant="ghost" size="sm">
						<Eye className="mr-2 h-4 w-4" />
						Ver Detalles
					</Button>
				</Link>
			);
		},
	},
];

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	QuickActionButton,
	ToolbarButton,
} from "@/components/ui/toolbar-button";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 70,
	title: "Tabla y botones de tabla",
	figma:
		"02 · Componentes › Botones de Tabla (Button/Toolbar, Button/QuickAction) · 03 › Tabla de Cartera (estilo base)",
	description:
		"ToolbarButton action=buscar|filtros|ordenar|columnas, active · QuickActionButton action=llamar|ver|mas · Table density=default (56px) | compact (40px); fila resaltada = data-state=selected.",
};

const acciones = ["buscar", "filtros", "ordenar", "columnas"] as const;
const rapidas = ["llamar", "ver", "mas"] as const;

// Para mostrar el estado Hover sin pasar el mouse.
const hoverToolbar = "bg-cci-neutral-50 dark:bg-cci-carbon-800";
const hoverQuick = "border-brand bg-brand-subtle text-brand";

const filas = [
	{
		nombre: "María José Contreras",
		vehiculo: "Toyota Hilux · P-482GHT",
		deuda: "Q 48,250.00",
		cuota: "Q3,200",
		fecha: "15 ago",
		estado: "Sin acuerdo",
	},
	{
		nombre: "Luis Fernando Aguilar",
		vehiculo: "Nissan Frontier · P-201KLM",
		deuda: "Q 112,900.00",
		cuota: "Q2,900",
		fecha: "5 ago",
		estado: "Promesa incumplida",
		seleccionada: true,
	},
	{
		nombre: "Ana Lucía Morales",
		vehiculo: "Kia Sportage · P-773XYZ",
		deuda: "Q 18,400.00",
		cuota: "Q3,600",
		fecha: "28 jul",
		estado: "Promesa vigente",
	},
	{
		nombre: "Roberto Cárcamo",
		vehiculo: "Mazda BT-50 · P-559ABC",
		deuda: "Q 67,120.00",
		cuota: "Q3,200",
		fecha: "20 ago",
		estado: "Sin acuerdo",
	},
];

type Fila = (typeof filas)[number];

const columnas: ColumnDef<Fila>[] = [
	{ accessorKey: "nombre", header: "Cliente" },
	{ accessorKey: "deuda", header: "Deuda vencida" },
	{ accessorKey: "fecha", header: "Fecha de pago" },
	{ accessorKey: "estado", header: "Estado de gestión" },
];

function TablaEjemplo() {
	return (
		<div className="overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised">
			<div className="flex flex-wrap items-center gap-3 px-4 py-3">
				<div className="flex items-center gap-2.5">
					<span className="font-semibold text-[15px]/[19px] text-fg">
						Cartera asignada
					</span>
					<span className="rounded-full bg-brand-subtle px-2 py-0.5 font-semibold text-[11px]/3.5 text-brand">
						1,538 créditos
					</span>
				</div>
				<div className="flex items-center gap-2">
					{acciones.map((a) => (
						<ToolbarButton key={a} action={a} active={a === "filtros"} />
					))}
				</div>
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Crédito / Cliente</TableHead>
						<TableHead>Deuda vencida</TableHead>
						<TableHead>Cuota normal</TableHead>
						<TableHead>Fecha de pago</TableHead>
						<TableHead className="pl-6">Estado de gestión</TableHead>
						<TableHead className="text-right">Acciones</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{filas.map((f) => (
						<TableRow
							key={f.nombre}
							data-state={f.seleccionada ? "selected" : undefined}
						>
							<TableCell>
								<div className="flex flex-col gap-0.5">
									<span className="font-semibold text-fg">{f.nombre}</span>
									<span className="text-[11px]/3.5 text-fg-tertiary">
										{f.vehiculo}
									</span>
								</div>
							</TableCell>
							<TableCell className="font-bold">{f.deuda}</TableCell>
							<TableCell className="font-bold">{f.cuota}</TableCell>
							<TableCell className="font-bold">{f.fecha}</TableCell>
							<TableCell className="pl-6 font-semibold text-fg-secondary">
								{f.estado}
							</TableCell>
							<TableCell>
								<div className="flex justify-end gap-1.5">
									{rapidas.map((a) => (
										<QuickActionButton key={a} action={a} />
									))}
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			<div className="type-body-sm border-divider border-t px-4 py-3 text-fg-tertiary">
				Mostrando 1–4 de 1,538
			</div>
		</div>
	);
}

export default function TableShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Button/Toolbar">
				{acciones.map((a) => (
					<ShowcaseRow key={a} label={a}>
						<ToolbarButton action={a} />
						<ToolbarButton action={a} className={hoverToolbar} />
						<ToolbarButton action={a} active />
						<ToolbarButton action={a} disabled />
					</ShowcaseRow>
				))}
				<ShowcaseRow label="Estados">
					<span className="type-caption text-fg-tertiary">
						Default · Hover · Activo (active o data-state=open) · Deshabilitado
					</span>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Button/QuickAction">
				{rapidas.map((a) => (
					<ShowcaseRow key={a} label={a}>
						<QuickActionButton action={a} />
						<QuickActionButton action={a} className={hoverQuick} />
						<QuickActionButton action={a} disabled />
					</ShowcaseRow>
				))}
				<ShowcaseRow label="Estados">
					<span className="type-caption text-fg-tertiary">
						Default · Hover · Deshabilitado
					</span>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Tabla (estilo base de Table/Cartera)">
				<div className="space-y-2 py-3">
					<p className="type-caption text-fg-tertiary">
						Encabezado 36px en bg/canvas · filas de 56px con divisor · hover
						brand-subtle al 50% · fila seleccionada brand-subtle (2.ª fila).
					</p>
					<TablaEjemplo />
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Densidad compacta · TableFooter · TableCaption">
				<div className="py-3">
					<div className="overflow-hidden rounded-2xl border border-line-subtle bg-surface">
						<Table density="compact">
							<TableCaption className="mb-3">
								Pagos aplicados en julio 2026
							</TableCaption>
							<TableHeader>
								<TableRow>
									<TableHead>Fecha</TableHead>
									<TableHead>Boleta</TableHead>
									<TableHead className="text-right">Monto</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								<TableRow>
									<TableCell>15 jul 2026</TableCell>
									<TableCell>BAC-448120</TableCell>
									<TableCell className="text-right tabular-nums">
										Q3,200.00
									</TableCell>
								</TableRow>
								<TableRow>
									<TableCell>22 jul 2026</TableCell>
									<TableCell>GYT-120554</TableCell>
									<TableCell className="text-right tabular-nums">
										Q1,450.00
									</TableCell>
								</TableRow>
							</TableBody>
							<TableFooter>
								<TableRow>
									<TableCell colSpan={2}>Total</TableCell>
									<TableCell className="text-right tabular-nums">
										Q4,650.00
									</TableCell>
								</TableRow>
							</TableFooter>
						</Table>
					</div>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="DataTable (components/data-table)">
				<div className="py-3">
					<DataTable
						columns={columnas}
						data={filas}
						searchPlaceholder="Buscar cliente…"
						onRowClick={() => {}}
						pageSizeOptions={[5, 10]}
					/>
				</div>
			</ShowcaseGroup>
		</div>
	);
}

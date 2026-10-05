import { CalendarClock, FileText, History, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { Agenda, AgendaItem } from "@/components/ui/agenda";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
	FilterBar,
	FilterBarButton,
	FilterChip,
} from "@/components/ui/filter-bar";
import {
	OperationalSummaryBar,
	OperationalSummaryItem,
} from "@/components/ui/operational-summary";
import { Pagination } from "@/components/ui/pagination";
import {
	type DefaultPeriod,
	PeriodSelector,
} from "@/components/ui/period-selector";
import { SearchBar } from "@/components/ui/search-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 50,
	title: "Navegación",
	figma:
		"02 · Componentes › Tabs · Breadcrumb · Pagination · Navegación de bloques · Period Selector · Filter Bar · Search Bar (maestro en 03 › Cartera)",
	description:
		"Tabs (Activa/Hover/Inactiva + contador), Breadcrumb, Pagination, Section Header, Agenda (Colapsada/Expandida) y Agenda / Item, Period Selector, Filter Bar (SinFiltros/ConFiltros) y Search Bar (Default/Hover/Focus/ConTexto).",
};

/* Estados forzados para documentar Hover/Focus sin interacción. */
const forcedTabHover =
	"before:bg-cci-neutral-50 dark:before:bg-cci-carbon-800 after:bg-divider/60";
const forcedSearchFocus =
	"border-brand shadow-clay-subtle inset-ring-1 inset-ring-brand [&>svg]:text-brand";
const forcedSearchHover = "bg-surface-raised";

function SummaryDemo() {
	// En Figma la barra va dentro de la Agenda sin fondo, borde ni padding.
	return (
		<OperationalSummaryBar className="border-0 bg-transparent p-0">
			{Array.from({ length: 6 }, (_, i) => (
				<OperationalSummaryItem
					// biome-ignore lint/suspicious/noArrayIndexKey: lista fija de ejemplo.
					key={i}
					value={12}
					label="Etiqueta"
				/>
			))}
		</OperationalSummaryBar>
	);
}

const agendaItems = ["09:00", "09:20", "10:00", "11:30", "12:15"];

function TabsDemo() {
	const [tab, setTab] = useState("resumen");
	return (
		<Tabs value={tab} onValueChange={setTab} className="w-full max-w-[700px]">
			<TabsList>
				<TabsTrigger value="resumen">Resumen</TabsTrigger>
				<TabsTrigger value="historial" count={3}>
					Historial
				</TabsTrigger>
				<TabsTrigger value="estado-cuenta">Estado de cuenta</TabsTrigger>
				<TabsTrigger value="documentos" count={12}>
					Documentos
				</TabsTrigger>
				<TabsTrigger value="referencias">Referencias</TabsTrigger>
				<TabsTrigger value="vehiculo" disabled>
					Vehículo / GPS
				</TabsTrigger>
			</TabsList>
			{[
				"resumen",
				"historial",
				"estado-cuenta",
				"documentos",
				"referencias",
			].map((value) => (
				<TabsContent
					key={value}
					value={value}
					className="type-body-sm pt-2 text-fg-secondary"
				>
					Contenido de la pestaña «{value}».
				</TabsContent>
			))}
		</Tabs>
	);
}

function PaginationDemo() {
	const [page, setPage] = useState(1);
	return (
		<Pagination
			className="max-w-[700px]"
			page={page}
			pageCount={77}
			totalItems={1538}
			pageSize={20}
			onPageChange={setPage}
		/>
	);
}

function PeriodDemo() {
	const [period, setPeriod] = useState<DefaultPeriod>("dia");
	return (
		<>
			<PeriodSelector value={period} onChange={setPeriod} />
			<span className="type-caption text-fg-tertiary">
				Seleccionado: {period}
			</span>
		</>
	);
}

function FilterBarDemo() {
	const [bucket, setBucket] = useState(2);
	const [mora, setMora] = useState(1);
	const active = (bucket > 0 ? 1 : 0) + (mora > 0 ? 1 : 0);
	return (
		<FilterBar
			activeCount={active}
			onClear={() => {
				setBucket(0);
				setMora(0);
			}}
			actions={
				active === 0 ? (
					<FilterBarButton>Vistas guardadas</FilterBarButton>
				) : null
			}
		>
			<FilterChip
				label="Bucket"
				count={bucket}
				onClick={() => setBucket((n) => (n + 1) % 4)}
			/>
			<FilterChip
				label="Estado de mora"
				count={mora}
				onClick={() => setMora((n) => (n + 1) % 3)}
			/>
			<FilterChip label="Asesor" />
			<FilterChip label="Período" />
			<FilterChip label="Próxima acción" />
		</FilterBar>
	);
}

function SearchDemo() {
	const [query, setQuery] = useState("");
	return (
		<SearchBar
			containerClassName="max-w-[420px]"
			value={query}
			onChange={(event) => setQuery(event.target.value)}
			shortcut
		/>
	);
}

const staticChips = [
	"Bucket",
	"Estado de mora",
	"Asesor",
	"Período",
	"Próxima acción",
];

export default function NavigationShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Tabs">
				<ShowcaseRow label="Barra (interactiva)">
					<TabsDemo />
				</ShowcaseRow>
				<ShowcaseRow label="Tabs/Item · estados">
					<Tabs defaultValue="activa" className="w-auto">
						<TabsList className="w-auto">
							<TabsTrigger value="activa">Activa</TabsTrigger>
							<TabsTrigger value="hover" className={forcedTabHover}>
								Hover
							</TabsTrigger>
							<TabsTrigger value="inactiva">Inactiva</TabsTrigger>
							<TabsTrigger value="disabled" disabled>
								Deshabilitada
							</TabsTrigger>
						</TabsList>
					</Tabs>
				</ShowcaseRow>
				<ShowcaseRow label="Contador · íconos">
					<Tabs defaultValue="pagos" className="w-auto">
						<TabsList className="w-auto">
							<TabsTrigger value="pagos" count={3}>
								<CalendarClock />
								Pagos
							</TabsTrigger>
							<TabsTrigger value="historial" count={12}>
								<History />
								Historial
							</TabsTrigger>
							<TabsTrigger value="documentos">
								<FileText />
								Documentos
							</TabsTrigger>
						</TabsList>
					</Tabs>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Breadcrumb">
				<ShowcaseRow label="Default">
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink href="#">Dashboard</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbLink href="#">Cartera</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>Crédito #48213</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Pagination">
				<ShowcaseRow label="Interactiva">
					<PaginationDemo />
				</ShowcaseRow>
				<ShowcaseRow label="Página intermedia">
					<Pagination
						className="max-w-[700px]"
						page={10}
						pageCount={77}
						totalItems={1538}
						pageSize={20}
						onPageChange={() => {}}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Pocas páginas · última">
					<Pagination
						className="max-w-[700px]"
						page={5}
						pageCount={5}
						totalItems={92}
						pageSize={20}
						onPageChange={() => {}}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Deshabilitada">
					<Pagination
						className="max-w-[700px]"
						page={2}
						pageCount={3}
						summary="Cargando…"
						onPageChange={() => {}}
						disabled
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Section Header">
				<ShowcaseRow label="Título + acción">
					<SectionHeader
						className="max-w-[600px]"
						title="Título del bloque"
						action={
							<Button variant="link" size="sm">
								Ver todas →
							</Button>
						}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Ícono + descripción">
					<SectionHeader
						className="max-w-[600px]"
						icon={Phone}
						title="Promesas de pago"
						description="Compromisos de pago que vencen esta semana"
						action={
							<Button variant="outline" size="sm">
								Filtrar
							</Button>
						}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Solo título">
					<SectionHeader className="max-w-[600px]" title="Convenios" />
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Agenda">
				<ShowcaseRow label="Colapsada">
					<Agenda
						className="max-w-[730px]"
						progress={{ done: 4, total: 16 }}
						summary={<SummaryDemo />}
					>
						{agendaItems.map((time) => (
							<AgendaItem
								key={time}
								time={time}
								title="Actividad programada"
								description="Detalle de la tarea"
								action={
									<Button variant="outline" size="sm">
										Abrir Ficha 360
									</Button>
								}
							/>
						))}
					</Agenda>
				</ShowcaseRow>
				<ShowcaseRow label="Expandida">
					<Agenda
						className="max-w-[900px]"
						defaultExpanded
						progress={{ done: 4, total: 16 }}
						summary={<SummaryDemo />}
					>
						{agendaItems.map((time) => (
							<AgendaItem
								key={time}
								time={time}
								title="Actividad programada"
								description="Detalle de la tarea"
								action={
									<Button variant="outline" size="sm">
										Abrir Ficha 360
									</Button>
								}
							/>
						))}
					</Agenda>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Agenda / Item">
				{(
					[
						["Pendiente", "pendiente"],
						["En progreso", "en-progreso"],
						["Completada", "completada"],
					] as const
				).map(([label, status]) => (
					<ShowcaseRow key={status} label={label}>
						<ul className="w-full max-w-[620px]">
							<AgendaItem
								status={status}
								time="09:00"
								title="Actividad"
								description="Detalle"
								action={
									<Button variant="outline" size="sm">
										Abrir Ficha 360
									</Button>
								}
							/>
						</ul>
					</ShowcaseRow>
				))}
				<ShowcaseRow label="Sin descripción ni acción">
					<ul className="w-full max-w-[620px]">
						<AgendaItem
							status="en-progreso"
							time="14:30"
							icon={MapPin}
							title="Visita a domicilio"
						/>
					</ul>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Period Selector">
				{(
					[
						["Período=Día", "dia"],
						["Período=Semana", "semana"],
						["Período=Mes", "mes"],
					] as const
				).map(([label, value]) => (
					<ShowcaseRow key={value} label={label}>
						<PeriodSelector value={value} onChange={() => {}} />
					</ShowcaseRow>
				))}
				<ShowcaseRow label="Interactivo">
					<PeriodDemo />
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Filter Bar">
				<ShowcaseRow label="SinFiltros">
					<FilterBar
						actions={<FilterBarButton>Vistas guardadas</FilterBarButton>}
					>
						{staticChips.map((chip) => (
							<FilterChip key={chip} label={chip} />
						))}
					</FilterBar>
				</ShowcaseRow>
				<ShowcaseRow label="ConFiltros">
					<FilterBar activeCount={3} onClear={() => {}}>
						<FilterChip label="Bucket" count={2} />
						<FilterChip label="Estado de mora" count={1} />
						<FilterChip label="Asesor" />
						<FilterChip label="Período" />
						<FilterChip label="Próxima acción" />
					</FilterBar>
				</ShowcaseRow>
				<ShowcaseRow label="Interactiva">
					<FilterBarDemo />
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Search Bar">
				<ShowcaseRow label="Default (atajo ⌘K / Ctrl K)">
					<SearchBar containerClassName="max-w-[420px]" shortcut readOnly />
				</ShowcaseRow>
				<ShowcaseRow label="Hover">
					<SearchBar
						containerClassName={`max-w-[420px] ${forcedSearchHover}`}
						shortcut
						readOnly
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Focus">
					<SearchBar
						containerClassName={`max-w-[420px] ${forcedSearchFocus}`}
						shortcut
						readOnly
					/>
				</ShowcaseRow>
				<ShowcaseRow label="ConTexto">
					<SearchBar
						containerClassName="max-w-[420px]"
						defaultValue="María José Contreras"
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Interactiva">
					<SearchDemo />
				</ShowcaseRow>
				<ShowcaseRow label="Deshabilitada">
					<SearchBar containerClassName="max-w-[420px]" disabled />
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}

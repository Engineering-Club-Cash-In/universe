import {
	Banknote,
	CheckIcon,
	ChevronDown,
	CircleX,
	EllipsisVertical,
	Pencil,
	TriangleAlert,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	selectContentClassName,
	selectItemClassName,
	selectTriggerClassName,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 40,
	title: "Dropdown y menús",
	figma: "02 · Componentes › Dropdown (120:975) · Context Menu (497:8482)",
	description:
		'Dropdown Single = Select · Multi = Popover + Command + Checkbox sm · Searchable = Combobox. Context Menu = DropdownMenu (ítem Peligro = variant="destructive"). Los paneles abiertos se renderizan abiertos de entrada; un clic afuera los cierra.',
};

const asesores = [
	{ value: "carlos", label: "Carlos Ramírez" },
	{ value: "andrea", label: "Andrea Solís" },
	{ value: "luis", label: "Luis Marroquín" },
	{ value: "maria", label: "María Gómez" },
];

/** Hover de Figma forzado para la captura (el real es :hover). */
const FORCED_HOVER = "bg-cci-neutral-50 dark:bg-cci-carbon-800";

/** Etiqueta del Dropdown en Figma: 13px 500 text/secondary, 6px sobre el disparador. */
function Field({
	label,
	disabled,
	children,
}: {
	label: string;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span
				className={cn(
					"font-medium text-[13px] text-fg-secondary leading-4",
					disabled && "opacity-50",
				)}
			>
				{label}
			</span>
			{children}
		</div>
	);
}

function StateColumn({
	state,
	className,
	children,
}: {
	state: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("min-w-0 space-y-2", className)}>
			<p className="type-label-sm text-fg-tertiary">{state}</p>
			{children}
		</div>
	);
}

function StatesGrid({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-4 items-start gap-6 py-3">{children}</div>
	);
}

/* ── Single ─────────────────────────────────────────────────────────── */

function SingleSelect({
	disabled,
	className,
}: {
	disabled?: boolean;
	className?: string;
}) {
	return (
		<Select disabled={disabled}>
			<SelectTrigger className={className}>
				<SelectValue placeholder="Seleccionar bucket" />
			</SelectTrigger>
			<SelectContent>
				{asesores.map((a) => (
					<SelectItem key={a.value} value={a.value}>
						{a.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Vista estática de Single · Abierto (el Select de Radix abierto bloquea la página). */
function SingleOpenStatic() {
	return (
		// Solo ilustración: oculta a lectores de pantalla.
		<div aria-hidden className="space-y-1.5">
			<div
				data-state="open"
				data-placeholder=""
				className={cn(selectTriggerClassName, "w-full")}
			>
				<span>Seleccionar bucket</span>
				<ChevronDown className="size-4 rotate-180 text-fg-tertiary" />
			</div>
			<div className={cn(selectContentClassName, "px-1 py-2")}>
				{asesores.map((a, i) => (
					<div
						key={a.value}
						data-highlighted={i === 0 ? "" : undefined}
						className={selectItemClassName}
					>
						{a.label}
						{i === 0 ? (
							<span className="absolute right-3 flex size-4 items-center justify-center">
								<CheckIcon strokeWidth={3} className="size-3.5 text-brand" />
							</span>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}

/* ── Multi ──────────────────────────────────────────────────────────── */

function MultiSelect({
	defaultOpen = false,
	disabled,
	className,
}: {
	defaultOpen?: boolean;
	disabled?: boolean;
	className?: string;
}) {
	const [open, setOpen] = React.useState(defaultOpen);
	const [selected, setSelected] = React.useState<string[]>(["carlos", "luis"]);
	const toggle = (value: string) =>
		setSelected((prev) =>
			prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
		);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					data-placeholder={selected.length === 0 ? "" : undefined}
					className={cn(selectTriggerClassName, "w-full", className)}
				>
					<span className="truncate">
						{selected.length === 0
							? "Seleccionar asesores"
							: `${selected.length} seleccionados`}
					</span>
					<ChevronDown className="size-4 text-fg-tertiary transition-transform duration-150 group-data-[state=open]/select:rotate-180" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={6}
				avoidCollisions={false}
				onOpenAutoFocus={(e) => e.preventDefault()}
				onFocusOutside={(e) => e.preventDefault()}
				className="w-(--radix-popover-trigger-width) p-0"
			>
				<Command>
					<CommandList>
						<CommandGroup>
							{asesores.map((a) => (
								<CommandItem key={a.value} onSelect={() => toggle(a.value)}>
									<Checkbox
										size="sm"
										tabIndex={-1}
										checked={selected.includes(a.value)}
										aria-label={a.label}
									/>
									<span className="truncate">{a.label}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/* ── Searchable ─────────────────────────────────────────────────────── */

/** Searchable · Abierto: lo mismo que arma el Combobox, abierto de entrada para la captura. */
function SearchableOpen() {
	const [open, setOpen] = React.useState(true);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					role="combobox"
					aria-expanded={open}
					data-placeholder=""
					className={cn(selectTriggerClassName, "w-full")}
				>
					<span className="truncate">Buscar asesor…</span>
					<ChevronDown className="size-4 text-fg-tertiary transition-transform duration-150 group-data-[state=open]/select:rotate-180" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={6}
				avoidCollisions={false}
				onOpenAutoFocus={(e) => e.preventDefault()}
				onFocusOutside={(e) => e.preventDefault()}
				className="w-(--radix-popover-trigger-width) p-0"
			>
				<Command>
					<CommandInput placeholder="Buscar…" />
					<CommandList>
						<CommandGroup>
							{asesores.map((a) => (
								<CommandItem key={a.value} value={a.label}>
									{a.label}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/* ── Context Menu ───────────────────────────────────────────────────── */

function ContextMenuDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
	const [open, setOpen] = React.useState(defaultOpen);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label="Más acciones">
					<EllipsisVertical className="size-4 text-fg-tertiary" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				avoidCollisions={false}
				onFocusOutside={(e) => e.preventDefault()}
			>
				<DropdownMenuItem>
					<Pencil />
					Editar promesa
				</DropdownMenuItem>
				<DropdownMenuItem>
					<Banknote />
					Confirmar pago
				</DropdownMenuItem>
				<DropdownMenuItem>
					<TriangleAlert />
					Marcar incumplida
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive">
					<CircleX />
					Cancelar promesa
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function MenuExtrasDemo() {
	const [canal, setCanal] = React.useState("llamada");
	const [soloMora, setSoloMora] = React.useState(true);
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm">
					Opciones de vista
					<ChevronDown />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuLabel>Canal</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={canal} onValueChange={setCanal}>
					<DropdownMenuRadioItem value="llamada">Llamada</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="whatsapp">
						WhatsApp
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem
					checked={soloMora}
					onCheckedChange={(v) => setSoloMora(v === true)}
				>
					Solo casos en mora
				</DropdownMenuCheckboxItem>
				<DropdownMenuItem>
					<Pencil />
					Editar filtros
					<DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem disabled>
					<Banknote />
					Exportar (sin permiso)
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default function MenusShowcase() {
	const [combo, setCombo] = React.useState<string | null>(null);

	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Dropdown · Single (Select)">
				<StatesGrid>
					<StateColumn state="Cerrado">
						<Field label="Asesor asignado">
							<SingleSelect />
						</Field>
					</StateColumn>
					<StateColumn state="Abierto (vista estática)">
						<Field label="Asesor asignado">
							<SingleOpenStatic />
						</Field>
					</StateColumn>
					<StateColumn state="Hover">
						<Field label="Asesor asignado">
							<SingleSelect className={FORCED_HOVER} />
						</Field>
					</StateColumn>
					<StateColumn state="Disabled">
						<Field label="Asesor asignado" disabled>
							<SingleSelect disabled />
						</Field>
					</StateColumn>
				</StatesGrid>
			</ShowcaseGroup>

			<ShowcaseGroup title="Dropdown · Multi (Popover + Command + Checkbox sm)">
				<StatesGrid>
					<StateColumn state="Cerrado">
						<Field label="Asesor asignado">
							<MultiSelect />
						</Field>
					</StateColumn>
					<StateColumn state="Abierto" className="min-h-[248px]">
						<Field label="Asesor asignado">
							<MultiSelect defaultOpen />
						</Field>
					</StateColumn>
					<StateColumn state="Hover">
						<Field label="Asesor asignado">
							<MultiSelect className={FORCED_HOVER} />
						</Field>
					</StateColumn>
					<StateColumn state="Disabled">
						<Field label="Asesor asignado" disabled>
							<MultiSelect disabled />
						</Field>
					</StateColumn>
				</StatesGrid>
			</ShowcaseGroup>

			<ShowcaseGroup title="Dropdown · Searchable (Combobox)">
				<StatesGrid>
					<StateColumn state="Cerrado">
						<Field label="Asesor asignado">
							<Combobox
								options={asesores}
								placeholder="Buscar asesor…"
								value={combo}
								onChange={(v) => setCombo(v || null)}
								width="full"
								popOverWidth="full"
							/>
						</Field>
					</StateColumn>
					<StateColumn state="Abierto" className="min-h-[280px]">
						<Field label="Asesor asignado">
							<SearchableOpen />
						</Field>
					</StateColumn>
					<StateColumn state="Hover">
						<Field label="Asesor asignado">
							<div
								data-placeholder=""
								className={cn(selectTriggerClassName, "w-full", FORCED_HOVER)}
							>
								<span className="truncate">Buscar asesor…</span>
								<ChevronDown className="size-4 text-fg-tertiary" />
							</div>
						</Field>
					</StateColumn>
					<StateColumn state="Disabled">
						<Field label="Asesor asignado" disabled>
							<Combobox
								options={asesores}
								placeholder="Buscar asesor…"
								value={null}
								onChange={() => {}}
								width="full"
								disabled
							/>
						</Field>
					</StateColumn>
				</StatesGrid>
			</ShowcaseGroup>

			<ShowcaseGroup title="Context Menu (DropdownMenu)">
				<ShowcaseRow label="Cerrado">
					<ContextMenuDemo />
				</ShowcaseRow>
				<ShowcaseRow
					label="Abierto · Item Default / Peligro"
					className="min-h-[200px] items-start justify-center"
				>
					<ContextMenuDemo defaultOpen />
				</ShowcaseRow>
				<ShowcaseRow label="Etiqueta, radio, casilla, atajo, disabled">
					<MenuExtrasDemo />
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}

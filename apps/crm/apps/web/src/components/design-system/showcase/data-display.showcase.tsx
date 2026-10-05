import {
	CircleAlert,
	CircleCheck,
	ClipboardCheck,
	Info,
	MoreHorizontal,
	Phone,
} from "lucide-react";
import * as React from "react";
import { logo } from "@/assets";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DataField } from "@/components/ui/data-field";
import { Icon } from "@/components/ui/icon";
import {
	OperationalSummaryBar,
	OperationalSummaryItem,
} from "@/components/ui/operational-summary";
import { Separator } from "@/components/ui/separator";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 60,
	title: "Avatar, chip, badge, card y datos",
	figma:
		"02 · Componentes › Avatar · Chip · Divider · DataField · Icon · Operational Summary — Card y Badge derivados de 03 · Componentes CRM",
	description:
		"Avatar (size xs/sm/md/lg, active) · Chip (tone, onRemove) · Badge (variantes semánticas + dot) · Separator (Divider, label) · DataField (orientation, emphasis) · Icon (size, color) · OperationalSummary (Item + Bar) · Card (default/raised/flat).",
};

const avatarSizes = ["xs", "sm", "md", "lg"] as const;

const chipTones = [
	["Neutro", "neutral"],
	["Marca", "brand"],
	["Info", "info"],
	["Éxito", "success"],
	["Alerta", "warning"],
	["Peligro", "danger"],
] as const;

const iconSizes = [
	["XS · 14", "xs"],
	["S · 16", "sm"],
	["M · 20", "md"],
	["L · 24", "lg"],
	["XL · 32", "xl"],
] as const;

const iconColors = [
	"default",
	"secondary",
	"tertiary",
	"brand",
	"success",
	"warning",
	"danger",
	"inverse",
] as const;

const emphases = [
	["Normal", "normal"],
	["Fuerte", "strong"],
	["Positivo", "positive"],
	["Negativo", "negative"],
] as const;

const summaryStates = [
	["Normal", "normal"],
	["Éxito", "success"],
	["Alerta", "warning"],
	["Peligro", "danger"],
	["Info", "info"],
] as const;

function AvatarShowcase() {
	return (
		<ShowcaseGroup title="Avatar">
			<ShowcaseRow label="Iniciales">
				{avatarSizes.map((size) => (
					<React.Fragment key={size}>
						<Avatar size={size}>
							<AvatarFallback>MC</AvatarFallback>
						</Avatar>
						<Avatar size={size} active>
							<AvatarFallback>MC</AvatarFallback>
						</Avatar>
					</React.Fragment>
				))}
			</ShowcaseRow>
			<ShowcaseRow label="Foto">
				{avatarSizes.map((size) => (
					<React.Fragment key={size}>
						<Avatar size={size}>
							<AvatarImage src={logo} alt="Club Cash In" />
							<AvatarFallback>CC</AvatarFallback>
						</Avatar>
						<Avatar size={size} active>
							<AvatarImage src={logo} alt="Club Cash In" />
							<AvatarFallback>CC</AvatarFallback>
						</Avatar>
					</React.Fragment>
				))}
			</ShowcaseRow>
			<ShowcaseRow label="Vacío">
				{avatarSizes.map((size) => (
					<React.Fragment key={size}>
						<Avatar size={size}>
							<AvatarFallback variant="empty" />
						</Avatar>
						<Avatar size={size} active>
							<AvatarFallback variant="empty" />
						</Avatar>
					</React.Fragment>
				))}
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

function ChipShowcase() {
	const [chips, setChips] = React.useState([
		"Cliente VIP",
		"Toyota",
		"Automático",
	]);
	return (
		<ShowcaseGroup title="Chip">
			{chipTones.map(([label, tone]) => (
				<ShowcaseRow key={tone} label={label}>
					<Chip tone={tone}>Cliente VIP</Chip>
					<Chip tone={tone} onRemove={() => {}}>
						Cliente VIP
					</Chip>
				</ShowcaseRow>
			))}
			<ShowcaseRow label="Ejemplos de uso">
				<Chip tone="brand">Cliente VIP</Chip>
				<Chip tone="success">GPS Activo</Chip>
				<Chip tone="neutral">Toyota</Chip>
				<Chip tone="info">Seguro vigente</Chip>
				<Chip tone="neutral">Automático</Chip>
			</ShowcaseRow>
			<ShowcaseRow label="Removibles (clic en ✕)">
				{chips.map((chip) => (
					<Chip
						key={chip}
						tone="neutral"
						removeLabel={`Quitar ${chip}`}
						onRemove={() => setChips((c) => c.filter((x) => x !== chip))}
					>
						{chip}
					</Chip>
				))}
				{chips.length < 3 && (
					<Button
						size="sm"
						variant="link"
						onClick={() => setChips(["Cliente VIP", "Toyota", "Automático"])}
					>
						Restablecer
					</Button>
				)}
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

function BadgeShowcase() {
	return (
		<ShowcaseGroup title="Badge">
			<ShowcaseRow label="Semánticos + dot">
				<Badge variant="warning" dot>
					Pendiente
				</Badge>
				<Badge variant="success" dot>
					Cumplida
				</Badge>
				<Badge variant="danger" dot>
					Incumplida
				</Badge>
				<Badge variant="brand" dot>
					Vigente
				</Badge>
				<Badge variant="neutral" dot>
					Cancelada
				</Badge>
				<Badge variant="info" dot>
					Activo
				</Badge>
			</ShowcaseRow>
			<ShowcaseRow label="Semánticos">
				<Badge variant="warning">Promesa</Badge>
				<Badge variant="info">Convenio</Badge>
				<Badge variant="success">Recuperación</Badge>
				<Badge variant="danger">Vencido</Badge>
				<Badge variant="brand">Vigente</Badge>
				<Badge variant="neutral">Apagado</Badge>
			</ShowcaseRow>
			<ShowcaseRow label="Existentes">
				<Badge>default</Badge>
				<Badge variant="secondary">secondary</Badge>
				<Badge variant="destructive">destructive</Badge>
				<Badge variant="outline">outline</Badge>
				<Badge variant="outline">
					<CircleCheck />
					Con ícono
				</Badge>
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

function DividerShowcase() {
	return (
		<ShowcaseGroup title="Divider (Separator)">
			<ShowcaseRow label="Horizontal">
				<div className="w-80">
					<Separator />
				</div>
			</ShowcaseRow>
			<ShowcaseRow label="Vertical">
				<div className="flex h-15 items-center gap-4">
					<span className="type-body-sm text-fg-secondary">Llamadas</span>
					<Separator orientation="vertical" />
					<span className="type-body-sm text-fg-secondary">Visitas</span>
				</div>
			</ShowcaseRow>
			<ShowcaseRow label="Con título">
				<div className="w-80">
					<Separator label="Documentos" />
				</div>
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

function DataFieldShowcase() {
	return (
		<ShowcaseGroup title="DataField">
			<ShowcaseRow label="Vertical" className="gap-10">
				{emphases.map(([label, emphasis]) => (
					<DataField
						key={emphasis}
						title={label}
						label="Saldo pendiente"
						value="Q 48,250.00"
						emphasis={emphasis}
					/>
				))}
			</ShowcaseRow>
			<ShowcaseRow label="Horizontal" className="gap-10">
				{emphases.map(([label, emphasis]) => (
					<DataField
						key={emphasis}
						title={label}
						className="w-70"
						orientation="horizontal"
						label="Saldo pendiente"
						value="Q 48,250.00"
						emphasis={emphasis}
					/>
				))}
			</ShowcaseRow>
			<ShowcaseRow label="Vertical · align end">
				<DataField
					align="end"
					emphasis="strong"
					label="Saldo pendiente"
					value="Q 48,250.00"
				/>
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

function IconShowcase() {
	return (
		<ShowcaseGroup title="Icon">
			{iconSizes.map(([label, size]) => (
				<ShowcaseRow key={size} label={label} className="gap-8">
					{iconColors.map((color) => (
						<span
							key={color}
							title={color}
							className={
								color === "inverse"
									? "inline-flex rounded-sm bg-fg p-1"
									: "inline-flex p-1"
							}
						>
							<Icon icon={CircleCheck} size={size} color={color} />
						</span>
					))}
				</ShowcaseRow>
			))}
			<ShowcaseRow label="Colores">
				<span className="type-caption text-fg-tertiary">
					default · secondary · tertiary · brand · success · warning · danger ·
					inverse
				</span>
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

function OperationalSummaryShowcase() {
	const [selected, setSelected] = React.useState<string | null>(null);
	return (
		<ShowcaseGroup title="Operational Summary">
			<ShowcaseRow label="Item · Estado" className="flex-col items-start gap-6">
				{summaryStates.map(([label, status]) => (
					<OperationalSummaryItem
						key={status}
						status={status}
						value={12}
						label={label}
					/>
				))}
			</ShowcaseRow>
			<ShowcaseRow label="Bar · 6 items">
				<OperationalSummaryBar>
					{[1, 2, 3, 4, 5, 6].map((n) => (
						<OperationalSummaryItem key={n} value={12} label="Etiqueta" />
					))}
				</OperationalSummaryBar>
			</ShowcaseRow>
			<ShowcaseRow label="Ejemplo · navegable">
				<div className="w-full space-y-2">
					<OperationalSummaryBar>
						<OperationalSummaryItem
							value={8}
							label="Tareas de hoy"
							icon={ClipboardCheck}
							onClick={() => setSelected("Tareas de hoy")}
						/>
						<OperationalSummaryItem
							status="danger"
							value={3}
							label="Vencidas"
							icon={CircleAlert}
							onClick={() => setSelected("Vencidas")}
						/>
						<OperationalSummaryItem
							status="success"
							value={5}
							label="Completadas"
							icon={CircleCheck}
							onClick={() => setSelected("Completadas")}
						/>
						<OperationalSummaryItem
							status="info"
							value={2}
							label="Nuevas"
							icon={Info}
							asChild
						>
							<a href="#data-display">
								<span className="sr-only">Ir a</span>
							</a>
						</OperationalSummaryItem>
					</OperationalSummaryBar>
					<p className="type-caption text-fg-tertiary">
						{selected ? `Filtro: ${selected}` : "Seleccione un indicador."}
					</p>
				</div>
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

function CardShowcase() {
	return (
		<ShowcaseGroup title="Card">
			<ShowcaseRow label="variant" className="items-start gap-6">
				{(["default", "raised", "flat"] as const).map((variant) => (
					<Card key={variant} variant={variant} className="w-80">
						<CardHeader>
							<CardTitle>Promesa de pago</CardTitle>
							<CardDescription>variant="{variant}"</CardDescription>
							<CardAction>
								<Badge variant="warning" dot>
									Pendiente
								</Badge>
							</CardAction>
						</CardHeader>
						<CardContent className="flex justify-between">
							<DataField
								label="Monto comprometido"
								value="Q 5,000.00"
								emphasis="strong"
							/>
							<DataField
								align="end"
								label="Fecha compromiso"
								value="15/07/2026"
							/>
						</CardContent>
						<CardFooter className="justify-end gap-2 border-t">
							<Button size="sm" variant="outline">
								Reagendar
							</Button>
							<Button size="sm">Registrar pago</Button>
						</CardFooter>
					</Card>
				))}
			</ShowcaseRow>
			<ShowcaseRow label="Composición · Card/Cliente">
				<Card variant="raised" className="w-85 gap-3.5 px-5">
					<div className="flex items-center gap-3">
						<Avatar size="md">
							<AvatarFallback>MC</AvatarFallback>
						</Avatar>
						<div className="min-w-0 flex-1">
							<p className="type-heading-sm truncate text-fg leading-5">
								María José Contreras
							</p>
							<p className="type-caption text-fg-secondary">
								DPI 2547 88213 0101
							</p>
						</div>
						<Button size="icon-sm" variant="ghost" aria-label="Más opciones">
							<MoreHorizontal />
						</Button>
					</div>
					<Separator />
					<div className="grid grid-cols-2 gap-y-3.5">
						<DataField label="Teléfono" value="5521-4478" />
						<DataField label="Créditos activos" value="2" />
						<DataField label="Ciudad" value="Guatemala" />
						<DataField
							label="Contactabilidad"
							value="Alta"
							emphasis="positive"
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Chip tone="brand">Cliente VIP</Chip>
						<Chip tone="success">GPS Activo</Chip>
					</div>
				</Card>
				<Card variant="flat" className="w-75 gap-2 px-3.5 py-3">
					<div className="flex items-center gap-2">
						<Icon icon={Phone} size="sm" color="secondary" />
						<span className="font-semibold text-[13px] text-fg">Contacto</span>
					</div>
					<DataField
						orientation="horizontal"
						label="Teléfono"
						value="5555-1234"
					/>
					<DataField
						orientation="horizontal"
						label="Residencia"
						value="Z.10, Guatemala"
					/>
				</Card>
			</ShowcaseRow>
		</ShowcaseGroup>
	);
}

export default function DataDisplayShowcase() {
	return (
		<div className="space-y-6">
			<AvatarShowcase />
			<ChipShowcase />
			<BadgeShowcase />
			<DividerShowcase />
			<DataFieldShowcase />
			<IconShowcase />
			<OperationalSummaryShowcase />
			<CardShowcase />
		</div>
	);
}

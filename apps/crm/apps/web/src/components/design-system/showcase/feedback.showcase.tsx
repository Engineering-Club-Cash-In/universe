import { BadgeCheck, Target } from "lucide-react";
import type * as React from "react";
import Loader from "@/components/loader";
import { Alert, AlertDescription, Callout } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import {
	EmptyState,
	type EmptyStateVariant,
} from "@/components/ui/empty-state";
import {
	Progress,
	ProgressBar,
	ProgressCircular,
	ProgressCompact,
} from "@/components/ui/progress";
import {
	Skeleton,
	SkeletonCard,
	SkeletonTable,
	SkeletonText,
} from "@/components/ui/skeleton";
import { LoaderInline, LoaderPage, Spinner } from "@/components/ui/spinner";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 90,
	title: "Callout, empty state, loader, skeleton y progress",
	figma:
		"02 · Componentes › Callout & Checklist · Empty State · Loader · Skeleton · Progress",
	description:
		"Callout = <Alert>/<Callout> (Neutro=default · Marca=brand · Éxito=success · Alerta=warning · Peligro=destructive|danger). Checklist/Item = <ChecklistItem>. Empty State = <EmptyState variant size>. Loader = <Spinner>/<LoaderInline>/<LoaderPage>. Skeleton = <Skeleton>/<SkeletonText|Card|Table>. Progress = <ProgressBar|Compact|Circular tone>.",
};

const tones = [
	["Neutro (default)", "default"],
	["Marca (brand)", "brand"],
	["Éxito (success)", "success"],
	["Alerta (warning)", "warning"],
	["Peligro (destructive)", "destructive"],
	["info (derivado)", "info"],
] as const;

const emptyTypes: [string, EmptyStateVariant][] = [
	["Vacío", "empty"],
	["SinDatos", "no-data"],
	["Error", "error"],
	["SinPermisos", "no-permission"],
	["SinConexión", "offline"],
];

const progressTones = [
	["Normal", "default"],
	["Éxito", "success"],
	["Alerta", "warning"],
	["Riesgo", "danger"],
] as const;

const DESC =
	"Descripción breve que explica el estado y qué puede hacer el usuario.";

/**
 * Marco punteado sobre bg/canvas para ver el ancho real de cada empty state (el
 * círculo del ícono es bg/surface-raised y no se distingue sobre una card blanca).
 */
function Frame({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-line-subtle border-dashed bg-canvas">
			{children}
		</div>
	);
}

export default function FeedbackShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Callout">
				{tones.map(([label, variant]) => (
					<ShowcaseRow key={variant} label={label}>
						<Callout variant={variant} title="Título" className="max-w-90">
							Cuerpo del callout
						</Callout>
						<Callout
							variant={variant}
							title="Objetivo de la gestión"
							icon={<Target />}
							className="max-w-90"
						>
							Confirme la fecha de pago y registre la promesa antes de cerrar la
							llamada.
						</Callout>
					</ShowcaseRow>
				))}
				<ShowcaseRow label="Solo cuerpo (uso actual)">
					<Alert className="max-w-90">
						<BadgeCheck />
						<AlertDescription>
							Este bloque usa el cierre oficial importado.
						</AlertDescription>
					</Alert>
					<Alert variant="destructive" className="max-w-90">
						<AlertDescription>
							No se pudo validar el documento. Intente de nuevo.
						</AlertDescription>
					</Alert>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Checklist">
				<ShowcaseRow label="Item · Pendiente / Completado">
					<div className="w-80">
						<ChecklistItem label="Paso del checklist" />
						<ChecklistItem label="Paso del checklist" defaultChecked />
						<ChecklistItem label="Paso deshabilitado" disabled />
					</div>
				</ShowcaseRow>
				<ShowcaseRow label="Checklist (4 pasos)">
					<Checklist title="Checklist de gestión" className="max-w-90">
						<ChecklistItem
							label="Confirmar identidad del cliente"
							defaultChecked
						/>
						<ChecklistItem label="Validar el monto adeudado" defaultChecked />
						<ChecklistItem label="Registrar la promesa de pago" />
						<ChecklistItem label="Enviar el resumen por WhatsApp" />
					</Checklist>
					<Checklist
						title="Checklist de gestión"
						action={
							<Button variant="link" size="sm">
								Ver todo →
							</Button>
						}
						className="max-w-90"
					>
						<ChecklistItem label="Paso 1" />
						<ChecklistItem label="Paso 2" />
					</Checklist>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Empty State · Medium (default)">
				<div className="grid grid-cols-2 gap-4 py-3">
					{emptyTypes.map(([label, variant]) => (
						<Frame key={variant}>
							<EmptyState
								variant={variant}
								title={`Título del estado · ${label}`}
								description={DESC}
								action={<Button>Acción</Button>}
							/>
						</Frame>
					))}
					<Frame>
						<EmptyState
							title="Sin acción"
							description="Mostrar acción = false: no se pasa `action`."
						/>
					</Frame>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Empty State · Small">
				<div className="grid grid-cols-3 gap-4 py-3">
					{emptyTypes.map(([label, variant]) => (
						<Frame key={variant}>
							<EmptyState
								size="sm"
								variant={variant}
								title={label}
								description={DESC}
								action={<Button>Acción</Button>}
							/>
						</Frame>
					))}
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Empty State · Large">
				<div className="grid grid-cols-2 gap-4 py-3">
					{emptyTypes.map(([label, variant]) => (
						<Frame key={variant}>
							<EmptyState
								size="lg"
								variant={variant}
								title={label}
								description={DESC}
								action={<Button>Acción</Button>}
							/>
						</Frame>
					))}
					<Frame>
						<div className="flex h-full flex-col items-center justify-center gap-3 p-6">
							<Spinner size="lg" />
							<p className="type-body-base text-fg-secondary">Cargando…</p>
							<p className="type-caption text-fg-tertiary">
								Patrón Loading (composición, no componente)
							</p>
						</div>
					</Frame>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Loader">
				<ShowcaseRow label="Spinner · S / M / L">
					<Spinner size="sm" />
					<Spinner size="md" />
					<Spinner size="lg" />
				</ShowcaseRow>
				<ShowcaseRow label="tone (extensión)">
					<Spinner size="md" tone="muted" />
					<span className="inline-flex items-center gap-2 text-fg">
						<Spinner tone="current" /> current
					</span>
					<span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand">
						<Spinner tone="on-solid" />
					</span>
				</ShowcaseRow>
				<ShowcaseRow label="Inline">
					<LoaderInline>Cargando cartera…</LoaderInline>
				</ShowcaseRow>
				<ShowcaseRow label="Página">
					<LoaderPage />
				</ShowcaseRow>
				<ShowcaseRow label="components/loader.tsx">
					<div className="h-20">
						<Loader />
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Skeleton">
				<ShowcaseRow label="Texto" className="items-start">
					<SkeletonText className="w-75" />
				</ShowcaseRow>
				<ShowcaseRow label="Card">
					<SkeletonCard />
				</ShowcaseRow>
				<ShowcaseRow label="Fila (tabla)">
					<SkeletonTable className="max-w-160" />
				</ShowcaseRow>
				<ShowcaseRow label="Base (className)">
					<Skeleton className="h-9 w-24" />
					<Skeleton className="size-10 rounded-full" />
					<Skeleton className="h-4 w-48" />
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Progress">
				<ShowcaseRow label="Barra">
					<div className="grid w-full grid-cols-2 gap-x-10 gap-y-6">
						{progressTones.map(([label, tone]) => (
							<ProgressBar
								key={tone}
								tone={tone}
								value={65}
								label={`Meta mensual · ${label}`}
								detail="4 de 6 cuotas pagadas"
							/>
						))}
					</div>
				</ShowcaseRow>
				<ShowcaseRow label="Compacta">
					<div className="grid w-full grid-cols-4 gap-6">
						{progressTones.map(([label, tone]) => (
							<ProgressCompact
								key={tone}
								tone={tone}
								value={65}
								aria-label={label}
							/>
						))}
					</div>
				</ShowcaseRow>
				<ShowcaseRow label="Circular">
					{progressTones.map(([label, tone]) => (
						<ProgressCircular
							key={tone}
							tone={tone}
							value={65}
							aria-label={label}
						/>
					))}
					<ProgressCircular value={0} aria-label="Vacío" />
					<ProgressCircular value={100} tone="success" aria-label="Completo" />
				</ShowcaseRow>
				<ShowcaseRow label="<Progress> (uso actual)">
					<Progress value={40} className="h-2 max-w-80" />
					<Progress value={80} size="sm" tone="success" className="max-w-80" />
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}

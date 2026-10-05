import { toast } from "sonner";
import { ActionCrm } from "@/components/ds/action-crm";
import {
	BucketBadge,
	ConvenioBadge,
	MoraBadge,
	PromesaBadge,
} from "@/components/ds/badges";
import { PanelResumenCredito } from "@/components/ds/panel-resumen-credito";
import { ProximaAccionCell } from "@/components/ds/proxima-accion-cell";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogIcon,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogIcon,
	DialogTitle,
	DialogTrigger,
	dialogPanelClassName,
} from "@/components/ui/dialog";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
	Sheet,
	SheetBody,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { ToastView } from "@/components/ui/sonner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 80,
	title: "Modal, side panel, toast y tooltip",
	figma:
		"02 · Componentes › Modal, Toast, Tooltip, Info Tooltip · 03 · Componentes CRM › Side Panel / Drawer",
	description:
		"Modal = AlertDialog (420px) y Dialog (formularios) con DialogIcon variant default/warning/destructive/info. Side Panel = Sheet size sm/md/lg (360/480/640). Toast = toast.success/error/warning/info de sonner. Tooltip side top/bottom. InfoTooltip = ⓘ + Tooltip.",
};

const modalTipos = [
	{
		tipo: "Confirmación",
		variant: "default",
		titulo: "¿Confirmar pago?",
		descripcion:
			"Esta acción quedará registrada en el historial del crédito #48215.",
		accion: "Confirmar",
	},
	{
		tipo: "Advertencia",
		variant: "warning",
		titulo: "¿Marcar la promesa como incumplida?",
		descripcion:
			"El cliente pasará a la cola de seguimiento. Puede revertirlo desde el historial.",
		accion: "Marcar",
	},
	{
		tipo: "Eliminación",
		variant: "destructive",
		titulo: "¿Cancelar la promesa vigente?",
		descripcion:
			"La promesa del crédito #48215 se cancelará y no podrá recuperarse.",
		accion: "Cancelar promesa",
	},
	{
		tipo: "Información",
		variant: "info",
		titulo: "Reglas del Bucket B2",
		descripcion:
			"Los créditos con 31 a 60 días de atraso pasan a Gestión Activa.",
		accion: "Entendido",
	},
] as const;

const toastTipos = [
	{
		type: "success",
		titulo: "Pago registrado",
		descripcion: "Se aplicó a la cuota 12 del crédito #48213.",
	},
	{
		type: "error",
		titulo: "No se pudo registrar el pago",
		descripcion: "Revise la conexión e intente de nuevo.",
	},
	{
		type: "warning",
		titulo: "Promesa por vencer",
		descripcion: "La promesa del crédito #48213 vence mañana.",
	},
	{
		type: "info",
		titulo: "Cartera actualizada",
		descripcion: "Se reasignaron 12 créditos a su cartera.",
	},
] as const;

const sidePanelTamanos = [
	{ size: "sm", label: "Small (360)", width: "w-90" },
	{ size: "md", label: "Medium (480)", width: "w-120" },
	{ size: "lg", label: "Large (640)", width: "w-160" },
] as const;

function ResumenCreditoDemo() {
	return (
		<PanelResumenCredito
			numeroCredito="48213"
			bucket={<BucketBadge bucket="B2" formato="Completa" />}
			mora={<MoraBadge mora="Mora60" />}
			proximaAccion={<ProximaAccionCell accion="Llamar" />}
			promesa={<PromesaBadge promesa="Pendiente" />}
			saldo="Q 48,250.00"
			convenio={<ConvenioBadge convenio="Activo" />}
			responsable="C. Ramírez"
			ultimaGestion="hace 3 días"
		/>
	);
}

/** Contenido del Side Panel de Figma (head + body + foot). */
function SidePanelPartes() {
	return (
		<>
			<SheetHeader>
				<SheetTitle>Crédito #48213</SheetTitle>
				<SheetDescription>María José Contreras</SheetDescription>
			</SheetHeader>
			<SheetBody>
				<ResumenCreditoDemo />
			</SheetBody>
			<SheetFooter>
				<ActionCrm accion="reasignar" />
				<ActionCrm accion="registrar-gestion" />
			</SheetFooter>
		</>
	);
}

export default function OverlaysShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Modal">
				<ShowcaseRow
					label="Tipo (vista estática)"
					className="grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] items-start gap-6"
				>
					{modalTipos.map((m) => (
						// Root cerrado: solo da contexto a Title/Description/Close de Radix.
						<Dialog key={m.tipo}>
							<div className="space-y-2">
								<p className="type-caption text-fg-tertiary">{m.tipo}</p>
								<div className={cn(dialogPanelClassName, "w-105")}>
									<DialogIcon variant={m.variant} />
									<DialogHeader>
										<DialogTitle className="pr-0">{m.titulo}</DialogTitle>
										<DialogDescription>{m.descripcion}</DialogDescription>
									</DialogHeader>
									<DialogFooter>
										<Button variant="outline" size="sm">
											Cancelar
										</Button>
										<Button
											variant={
												m.variant === "destructive" ? "destructive" : "default"
											}
											size="sm"
										>
											{m.accion}
										</Button>
									</DialogFooter>
								</div>
							</div>
						</Dialog>
					))}
				</ShowcaseRow>
				<ShowcaseRow label="AlertDialog (en vivo)">
					{modalTipos.map((m) => (
						<AlertDialog key={m.tipo}>
							<AlertDialogTrigger asChild>
								<Button variant="outline" size="sm">
									{m.tipo}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogIcon variant={m.variant} />
								<AlertDialogHeader>
									<AlertDialogTitle>{m.titulo}</AlertDialogTitle>
									<AlertDialogDescription>
										{m.descripcion}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancelar</AlertDialogCancel>
									<AlertDialogAction
										variant={
											m.variant === "destructive" ? "destructive" : "default"
										}
									>
										{m.accion}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					))}
				</ShowcaseRow>
				<ShowcaseRow label="Dialog (en vivo)">
					<Dialog>
						<DialogTrigger asChild>
							<Button variant="outline" size="sm">
								Dialog con botón de cerrar
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogIcon variant="info" />
								<DialogTitle>Detalle de la gestión</DialogTitle>
								<DialogDescription>
									El Dialog conserva el botón de cerrar y el ancho de 512px para
									formularios; el aspecto es el del Modal de Figma.
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<DialogClose asChild>
									<Button variant="outline">Cerrar</Button>
								</DialogClose>
								<Button>Guardar gestión</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Side Panel / Drawer">
				<ShowcaseRow
					label="Tamaño (vista estática)"
					className="items-start gap-6"
				>
					{sidePanelTamanos.map((t) => (
						<Sheet key={t.size}>
							<div className="space-y-2">
								<p className="type-caption text-fg-tertiary">{t.label}</p>
								{/* Mismo aspecto que SheetContent, sin fixed ni portal. */}
								<div
									className={cn(
										"flex flex-col overflow-hidden rounded-2xl bg-surface text-fg shadow-sidepanel dark:border dark:border-line-subtle",
										t.width,
									)}
								>
									<SidePanelPartes />
								</div>
							</div>
						</Sheet>
					))}
				</ShowcaseRow>
				<ShowcaseRow label="Sheet (en vivo)">
					{sidePanelTamanos.map((t) => (
						<Sheet key={t.size}>
							<SheetTrigger asChild>
								<Button variant="outline" size="sm">
									{t.label}
								</Button>
							</SheetTrigger>
							<SheetContent size={t.size}>
								<SidePanelPartes />
							</SheetContent>
						</Sheet>
					))}
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Toast">
				<ShowcaseRow
					label="Tipo (vista estática)"
					className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] items-start gap-6"
				>
					{toastTipos.map((t) => (
						<ToastView
							key={t.type}
							type={t.type}
							title={t.titulo}
							description={t.descripcion}
							onClose={() => {}}
						/>
					))}
				</ShowcaseRow>
				<ShowcaseRow label="Sin descripción">
					<ToastView
						type="success"
						title="Gestión guardada"
						onClose={() => {}}
					/>
					<ToastView title="Aviso neutro (toast)" onClose={() => {}} />
				</ShowcaseRow>
				<ShowcaseRow label="sonner (en vivo)">
					{toastTipos.map((t) => (
						<Button
							key={t.type}
							variant="outline"
							size="sm"
							onClick={() =>
								toast[t.type](t.titulo, { description: t.descripcion })
							}
						>
							toast.{t.type}
						</Button>
					))}
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							toast.error("No se pudo cargar la cartera", {
								action: { label: "Reintentar", onClick: () => {} },
							})
						}
					>
						Con acción
					</Button>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Tooltip">
				<ShowcaseRow label="Posición (abierto)" className="gap-40 py-12 pl-24">
					<Tooltip open>
						<TooltipTrigger asChild>
							<Button variant="outline" size="sm">
								Arriba
							</Button>
						</TooltipTrigger>
						<TooltipContent side="top">
							Días transcurridos desde el último contacto
						</TooltipContent>
					</Tooltip>
					<Tooltip open>
						<TooltipTrigger asChild>
							<Button variant="outline" size="sm">
								Abajo
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							Días transcurridos desde el último contacto
						</TooltipContent>
					</Tooltip>
				</ShowcaseRow>
				<ShowcaseRow label="Al pasar el cursor">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="outline" size="sm">
								Pase el cursor
							</Button>
						</TooltipTrigger>
						<TooltipContent>Último contacto: hace 3 días</TooltipContent>
					</Tooltip>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Info Tooltip">
				<ShowcaseRow label="Estado" className="gap-16 pt-12 pl-12">
					<span className="type-label-sm inline-flex items-center gap-1.5 text-fg-secondary">
						Reposo
						<InfoTooltip>Descripción del indicador.</InfoTooltip>
					</span>
					<span className="type-label-sm inline-flex items-center gap-1.5 text-fg-secondary">
						Hover
						<InfoTooltip open>Descripción del indicador.</InfoTooltip>
					</span>
				</ShowcaseRow>
				<ShowcaseRow label="En un KPI">
					<div className="rounded-2xl bg-surface p-4 shadow-clay-subtle">
						<p className="type-label-sm inline-flex items-center gap-1.5 text-fg-secondary">
							Promesas cumplidas
							<InfoTooltip>
								Promesas pagadas a tiempo sobre el total de promesas del período
								seleccionado.
							</InfoTooltip>
						</p>
						<p className="type-number-lg text-fg">82%</p>
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}

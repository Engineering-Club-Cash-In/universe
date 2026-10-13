import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogIcon,
	DialogTitle,
} from "@/components/ui/dialog";
import { fechaCorta, MOTIVO_COBERTURA_LABEL } from "./estado-asesor";

/**
 * «Reactivar» de la tarjeta de un asesor ausente. Hay dos clases de ausencia:
 *   - cobertura con suplente (`coberturas_agenda_cobros`): reactivar =
 *     `cancelarCobertura`. La cartera nunca cambió de propietario; vuelven al
 *     titular sus tareas de agenda.
 *   - ausencia indefinida con reparto (M5): reactivar = `reactivarAsesor`. Se le
 *     devuelve la cartera que se repartió (salvo lo que ya cambió de dueño o de
 *     bucket), vuelve al pool y el servidor avisa al equipo.
 * Presentación pura: el contenedor hace la mutación.
 */

export type CoberturaReactivar = {
	nombre: string;
	motivo: string;
	desde: string;
	hasta: string;
	suplente: string;
	/** Ausencia indefinida con reparto (M5); sin fechas ni suplente. */
	indefinida?: {
		/** La reactivación empezó y no terminó: se repite. */
		aMedias: boolean;
	};
};

/** Qué pasó con la cartera al reactivar una ausencia indefinida. */
export type ResultadoReactivacion = {
	devueltas: number;
	retenidas: { motivo: string }[];
};

const MOTIVO_RETENIDA: Record<string, string> = {
	cambio_de_dueno: "cambiaron de dueño durante la ausencia",
	fuera_del_funnel: "ya no se gestionan (canceladas o caídas)",
	bucket_fuera_del_pool: "pasaron a un bucket que el asesor no atiende",
};

/** «3 cambiaron de dueño…, 1 ya no se gestiona…» */
function resumenRetenidas(retenidas: { motivo: string }[]) {
	const cuenta = new Map<string, number>();
	for (const r of retenidas)
		cuenta.set(r.motivo, (cuenta.get(r.motivo) ?? 0) + 1);
	return [...cuenta].map(
		([motivo, n]) => `${n} ${MOTIVO_RETENIDA[motivo] ?? motivo}`,
	);
}

export function ConfirmarReactivarDialog({
	cobertura,
	pendiente,
	error,
	onConfirmar,
	onCerrar,
}: {
	cobertura: CoberturaReactivar | null;
	pendiente: boolean;
	error?: string | null;
	onConfirmar: () => void;
	onCerrar: () => void;
}) {
	return (
		<AlertDialog
			open={!!cobertura}
			onOpenChange={(abierto) => !abierto && !pendiente && onCerrar()}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Reactivar a {cobertura?.nombre}</AlertDialogTitle>
					<AlertDialogDescription>
						{cobertura?.indefinida ? (
							<>
								{cobertura.indefinida.aMedias
									? "La reactivación quedó a medias: se repite desde donde se cortó. "
									: ""}
								Se le devolverá la cartera que se repartió al equipo (salvo lo
								que ya cambió de dueño o de bucket), volverá a recibir cuentas
								nuevas y se avisará al equipo.
							</>
						) : null}
						{cobertura?.indefinida ? null : (
							<>
								Se cancelará su ausencia por{" "}
								{(
									MOTIVO_COBERTURA_LABEL[cobertura?.motivo ?? ""] ??
									cobertura?.motivo ??
									""
								).toLowerCase()}{" "}
								({cobertura ? fechaCorta(cobertura.desde) : ""} al{" "}
								{cobertura ? fechaCorta(cobertura.hasta) : ""}). Desde ahora sus
								tareas de agenda dejan de mostrarse a {cobertura?.suplente} y
								vuelven a ser suyas. El registro se conserva en el historial de
								coberturas.
							</>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<p role="alert" className="text-danger-text text-sm">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pendiente}>Volver</AlertDialogCancel>
					<AlertDialogAction
						disabled={pendiente}
						onClick={(e) => {
							e.preventDefault();
							onConfirmar();
						}}
					>
						{pendiente
							? "Reactivando…"
							: cobertura?.indefinida?.aMedias
								? "Reintentar"
								: "Reactivar"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** Figma «Modal · Asesor reactivado» (3366:4235), en usted. */
export function AsesorReactivadoDialog({
	nombre,
	resultado,
	onCerrar,
}: {
	nombre: string | null;
	/** Solo en la ausencia indefinida (M5): cuentas devueltas y retenidas. */
	resultado?: ResultadoReactivacion | null;
	onCerrar: () => void;
}) {
	const retenidas = resultado ? resumenRetenidas(resultado.retenidas) : [];
	return (
		<Dialog open={!!nombre} onOpenChange={(abierto) => !abierto && onCerrar()}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogIcon />
					<DialogTitle>Asesor reactivado</DialogTitle>
					<DialogDescription>
						{resultado
							? `${nombre} se reincorporó: volvió al pool y se le devolvieron ${resultado.devueltas} cuentas.`
							: `${nombre} se reincorporó: se canceló su ausencia y sus tareas de agenda vuelven a ser suyas desde hoy. Su cartera siempre conservó su propietario.`}
					</DialogDescription>
				</DialogHeader>
				{retenidas.length ? (
					<div className="rounded-xl bg-muted px-4 py-3 text-fg-secondary text-sm">
						<p className="font-medium text-fg">
							Se quedaron con quien las recibió:
						</p>
						<ul className="mt-1 list-disc pl-5">
							{retenidas.map((t) => (
								<li key={t}>{t}</li>
							))}
						</ul>
					</div>
				) : null}
				{resultado ? (
					<p className="rounded-xl bg-muted px-4 py-3 text-fg-secondary text-sm">
						Se avisó al equipo de la reincorporación.
					</p>
				) : null}
				<DialogFooter>
					<Button className="w-full" onClick={onCerrar}>
						Entendido
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

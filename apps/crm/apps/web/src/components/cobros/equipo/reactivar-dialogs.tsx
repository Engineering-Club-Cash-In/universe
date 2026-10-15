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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { ExitoModal, NotaModal } from "./asignacion/piezas-modal";
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

/** Por qué un crédito no volvió, en singular y en plural. */
const MOTIVO_RETENIDA: Record<string, [string, string]> = {
	cambio_de_dueno: [
		"cambió de dueño durante la ausencia",
		"cambiaron de dueño durante la ausencia",
	],
	fuera_del_funnel: [
		"quedó fuera de cobranza (cancelado o caído)",
		"quedaron fuera de cobranza (cancelados o caídos)",
	],
	bucket_fuera_del_pool: [
		"pasó a un bucket que el asesor no atiende",
		"pasaron a un bucket que el asesor no atiende",
	],
};

/** «2 cambiaron de dueño…», «1 quedó fuera de cobranza…» */
function resumenRetenidas(retenidas: { motivo: string }[]) {
	const cuenta = new Map<string, number>();
	for (const r of retenidas)
		cuenta.set(r.motivo, (cuenta.get(r.motivo) ?? 0) + 1);
	return [...cuenta].map(([motivo, n]) => {
		const texto = MOTIVO_RETENIDA[motivo];
		return `${n} ${texto ? texto[n === 1 ? 0 : 1] : motivo}`;
	});
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
								que ya cambió de dueño o de bucket), volverá a recibir créditos
								nuevos y se avisará al equipo.
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

/** Texto de «Asesor reactivado» según la clase de ausencia. */
function textoReactivado(
	nombre: string | null,
	resultado: ResultadoReactivacion | null | undefined,
) {
	if (!resultado)
		return `${nombre} se reincorporó. Se canceló su ausencia y sus tareas de agenda vuelven a ser suyas desde hoy; su cartera nunca cambió de dueño.`;
	const devueltas =
		resultado.devueltas === 1
			? "Se le devolvió 1 crédito"
			: `Se le devolvieron ${resultado.devueltas.toLocaleString("es-GT")} créditos`;
	return `${nombre} se reincorporó. ${devueltas} de su cartera y vuelve a recibir créditos nuevos.`;
}

/**
 * Figma «Asesor reactivado» (3366:4235), en usted: ícono verde, título, qué
 * pasó con su cartera, lo que se quedó con quien lo recibió y, en la ausencia
 * con reparto (el servidor avisa al equipo), «Se notificó al equipo por el
 * sistema». Sin el Dialog: así el showcase lo pinta en línea.
 */
export function AsesorReactivadoVista({
	nombre,
	resultado,
	onCerrar,
}: {
	nombre: string | null;
	/** Solo en la ausencia indefinida (M5): créditos devueltos y retenidos. */
	resultado?: ResultadoReactivacion | null;
	onCerrar: () => void;
}) {
	const retenidas = resultado ? resumenRetenidas(resultado.retenidas) : [];
	return (
		<ExitoModal
			titulo="Asesor reactivado"
			onListo={onCerrar}
			extra={
				retenidas.length ? (
					<NotaModal tono="neutral" titulo="Se quedaron con quien los recibió">
						<ul className="list-disc pl-4">
							{retenidas.map((t) => (
								<li key={t}>{t}</li>
							))}
						</ul>
					</NotaModal>
				) : null
			}
			nota={resultado ? "Se notificó al equipo por el sistema." : undefined}
		>
			{textoReactivado(nombre, resultado)}
		</ExitoModal>
	);
}

export function AsesorReactivadoDialog({
	nombre,
	resultado,
	onCerrar,
}: {
	nombre: string | null;
	/** Solo en la ausencia indefinida (M5): créditos devueltos y retenidos. */
	resultado?: ResultadoReactivacion | null;
	onCerrar: () => void;
}) {
	return (
		<Dialog open={!!nombre} onOpenChange={(abierto) => !abierto && onCerrar()}>
			<DialogContent className="sm:max-w-120" showCloseButton={false}>
				<DialogTitle className="sr-only">Asesor reactivado</DialogTitle>
				<DialogDescription className="sr-only">
					{textoReactivado(nombre, resultado)}
				</DialogDescription>
				<AsesorReactivadoVista
					nombre={nombre}
					resultado={resultado}
					onCerrar={onCerrar}
				/>
			</DialogContent>
		</Dialog>
	);
}

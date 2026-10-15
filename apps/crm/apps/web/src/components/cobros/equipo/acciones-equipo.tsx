import { ArrowRightLeft, UserPlus, UserX } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { AltaAsesorDialog } from "./alta-baja/alta-asesor-dialog";
import { BajaAsesorDialog } from "./alta-baja/baja-asesor-dialog";
import { MarcarAusenteDialog } from "./asignacion/marcar-ausente";
import { TrasladarDialog } from "./asignacion/trasladar-dialog";
import type { AccionEquipo } from "./search";

/**
 * Acciones de «Mi equipo» que viven en el encabezado (visibles en las tres
 * pestañas): «Crear asesor», «Trasladar cartera» y «Marcar ausente». Las tres
 * son primarias: son acciones del mismo nivel. Las filas del «Reparto por
 * asesor» abren los mismos modales con el asesor ya elegido; «Dar de baja»
 * sale del menú «⋯» de cada tarjeta y del Detalle del asesor.
 */
export function AccionesEquipo({
	onCrearAsesor,
	onTrasladar,
	onMarcarAusente,
}: {
	/** Sin él (showcases viejos) no se muestra «Crear asesor». */
	onCrearAsesor?: () => void;
	onTrasladar: () => void;
	onMarcarAusente: () => void;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			{onCrearAsesor ? (
				<Button size="sm" onClick={onCrearAsesor}>
					<UserPlus aria-hidden />
					Crear asesor
				</Button>
			) : null}
			<Button size="sm" onClick={onTrasladar}>
				<ArrowRightLeft aria-hidden />
				Trasladar cartera
			</Button>
			<Button size="sm" onClick={onMarcarAusente}>
				<UserX aria-hidden />
				Marcar ausente
			</Button>
		</div>
	);
}

/**
 * Los modales, montados por la ruta sobre la pestaña actual. Los abre
 * `?accion=trasladar|ausente|alta|baja&asesor=<asesor_id>` desde cualquier
 * pestaña (el Detalle del asesor enlaza con `?tab=asignacion&accion=…`, que
 * sigue igual, o los monta él mismo con su asesor).
 */
export function ModalesEquipo({
	accion,
	asesor,
	onCerrar,
	onCoberturaRegistrada,
}: {
	accion: AccionEquipo | undefined;
	asesor: number | undefined;
	/** `coberturaRegistrada`: el modal de ausencia se cierra tras registrar. */
	onCerrar: (coberturaRegistrada: boolean) => void;
	/** Rango de la cobertura recién registrada (para el historial). */
	onCoberturaRegistrada: (rango: { desde: string; hasta: string }) => void;
}) {
	// El modal de ausencia avisa «registrada» y luego «cerrar»: la ruta los
	// junta en una sola navegación.
	const registrada = useRef(false);
	return (
		<>
			<TrasladarDialog
				abierto={accion === "trasladar"}
				asesorInicial={accion === "trasladar" ? asesor : undefined}
				onCerrar={() => onCerrar(false)}
			/>
			<MarcarAusenteDialog
				abierto={accion === "ausente"}
				asesorInicial={accion === "ausente" ? asesor : undefined}
				onCerrar={() => {
					const r = registrada.current;
					registrada.current = false;
					onCerrar(r);
				}}
				onRegistrada={(rango) => {
					registrada.current = true;
					onCoberturaRegistrada(rango);
				}}
			/>
			<AltaAsesorDialog
				abierto={accion === "alta"}
				onCerrar={() => onCerrar(false)}
			/>
			<BajaAsesorDialog
				abierto={accion === "baja" && !!asesor}
				asesorId={accion === "baja" ? asesor : undefined}
				onCerrar={() => onCerrar(false)}
			/>
		</>
	);
}

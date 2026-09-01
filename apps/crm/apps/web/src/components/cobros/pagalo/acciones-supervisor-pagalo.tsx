/**
 * CB-127 · Botones de invalidar/regenerar/reintentar sobre un grupo Págalo
 * — viven en la tarjeta de CADA grupo (las acciones son por grupo, no un
 * bloque único de la Ficha 360). "Cancelar en Págalo" queda deliberadamente
 * inerte (D-21): Págalo no documenta cómo cancelar un link remoto todavía.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import {
	accionesDisponibles,
	esReintentoForzado,
} from "@/lib/cobros/pagalo-acciones";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

const MOTIVO_MIN = 10;

type Accion = "invalidar" | "regenerar" | "reintentar" | "forzar" | null;

export function AccionesSupervisorPagalo({
	casoCobroId,
	creditoId,
	groupId,
	status,
}: {
	casoCobroId: string;
	creditoId: number;
	groupId: string;
	status: string;
}) {
	const { data: session, isPending } = authClient.useSession();
	const [accionAbierta, setAccionAbierta] = useState<Accion>(null);
	const [motivo, setMotivo] = useState("");
	const queryClient = useQueryClient();

	const invalidar = (client as any).invalidarGrupoPagalo;
	const regenerar = (client as any).regenerarGrupoPagalo;
	const reintentar = (client as any).reintentarDispatchPagalo;

	const invalidarQueries = () => {
		// .key() = prefijo del path → invalida TODAS las páginas del historial,
		// que va paginado (el input trae page/pageSize).
		queryClient.invalidateQueries({
			queryKey: orpc.getPagaloHistorial.key(),
		});
		queryClient.invalidateQueries(
			orpc.getPagaloGrupoActivo.queryOptions({
				input: { casoCobroId, creditoId },
			}),
		);
	};

	const mutationInvalidar = useMutation({
		mutationFn: () => invalidar({ groupId, motivo }),
		onSuccess: () => {
			toast.success("Grupo invalidado.");
			invalidarQueries();
			cerrar();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const mutationRegenerar = useMutation({
		mutationFn: () => regenerar({ groupId, motivo }),
		onSuccess: () => {
			toast.success("Grupo regenerado con nuevos links.");
			invalidarQueries();
			cerrar();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const mutationReintentar = useMutation({
		mutationFn: () => reintentar({ groupId }),
		onSuccess: (respuesta: { resultado?: string } | undefined) => {
			// El endpoint devuelve QUÉ pasó, no solo que se disparó: decir
			// "reintento disparado" cuando cartera acaba de mandarlo otra vez a
			// revisión hace que el admin lo apriete en círculos.
			const resultado = respuesta?.resultado;
			if (resultado === "COMPLETADO") {
				toast.success("Pago aplicado en cartera.");
			} else if (resultado === "REVIEW_REQUIRED") {
				toast.warning(
					"Cartera lo volvió a mandar a revisión — mirá el motivo en la bitácora.",
				);
			} else if (resultado === "ERROR") {
				toast.error(
					"El intento falló. El motivo queda en la bitácora del grupo.",
				);
			} else {
				toast.success("Reintento de aplicación disparado.");
			}
			invalidarQueries();
			cerrar();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const cerrar = () => {
		setAccionAbierta(null);
		setMotivo("");
	};

	// isPending degrada a "no supervisor" — no mostrar ni botones ni acceso
	// denegado mientras la sesión carga (bug documentado en
	// historial-agendas.tsx: userRole es undefined durante la carga).
	if (isPending) {
		return <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />;
	}

	const esSupervisor = PERMISSIONS.canAssignCobros(session?.user?.role ?? "");
	const esAdmin = PERMISSIONS.canAccessAdmin(session?.user?.role ?? "");
	const acciones = accionesDisponibles(status, esSupervisor, esAdmin);
	// Reintentar desde REVIEW_REQUIRED/APPLYING es una decisión, no el retry de
	// siempre: pide confirmación y se llama por su nombre.
	const forzado = esReintentoForzado(status, esAdmin);
	if (!acciones.invalidar && !acciones.regenerar && !acciones.reintentar) {
		return null;
	}

	const pendiente =
		mutationInvalidar.isPending ||
		mutationRegenerar.isPending ||
		mutationReintentar.isPending;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{acciones.invalidar && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={pendiente}
					onClick={() => setAccionAbierta("invalidar")}
				>
					Invalidar
				</Button>
			)}
			{acciones.regenerar && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={pendiente}
					onClick={() => setAccionAbierta("regenerar")}
				>
					Regenerar
				</Button>
			)}
			{acciones.reintentar && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={pendiente}
					onClick={() =>
						forzado ? setAccionAbierta("forzar") : mutationReintentar.mutate()
					}
				>
					{mutationReintentar.isPending && (
						<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
					)}
					{forzado ? "Forzar aplicación" : "Aplicar ahora"}
				</Button>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<span>
						<Button type="button" size="sm" variant="outline" disabled>
							Cancelar en Págalo
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent>
					Págalo todavía no documenta cómo cancelar un link. Por ahora hay que
					cancelarlo a mano en el panel de Págalo.
				</TooltipContent>
			</Tooltip>

			<AlertDialog
				open={accionAbierta !== null}
				onOpenChange={(open) => !open && cerrar()}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{accionAbierta === "invalidar"
								? "Invalidar grupo"
								: accionAbierta === "forzar"
									? "Forzar la aplicación del pago"
									: "Regenerar grupo"}
						</AlertDialogTitle>
						<AlertDialogDescription asChild>
							{accionAbierta === "forzar" ? (
								<div className="space-y-3">
									<Alert>
										<AlertDescription>
											{status === "REVIEW_REQUIRED"
												? "Cartera ya revisó este grupo y lo dejó pendiente. Forzarlo vuelve a mandárselo: si el motivo sigue vivo, lo rechaza igual — no se salta ninguna validación. Sirve cuando ya arreglaste la causa."
												: "El grupo quedó colgado aplicándose (un proceso que murió a medias). Forzarlo lo vuelve a reclamar y reintenta el envío; solo se puede si el proceso anterior ya no responde."}
										</AlertDescription>
									</Alert>
									<p className="text-muted-foreground text-sm">
										Reintentar el mismo grupo nunca duplica el pago: cartera lo
										reconoce por su identificador y devuelve el mismo resultado.
									</p>
								</div>
							) : (
								<div className="space-y-3">
									<Alert variant="destructive">
										<AlertDescription>
											El link viejo sigue siendo cobrable. Págalo no tiene API
											de cancelación: hay que cancelarlo a mano en el panel de
											Págalo. Si el cliente lo paga después, el grupo cae en
											revisión.
											{accionAbierta === "regenerar" &&
												" Se creará un grupo nuevo con las mismas cuotas y montos."}
										</AlertDescription>
									</Alert>
									<Textarea
										placeholder={`Motivo (mínimo ${MOTIVO_MIN} caracteres)`}
										value={motivo}
										onChange={(e) => setMotivo(e.target.value)}
										rows={3}
									/>
								</div>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={cerrar}>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								pendiente ||
								(accionAbierta !== "forzar" &&
									motivo.trim().length < MOTIVO_MIN)
							}
							onClick={(e) => {
								e.preventDefault();
								if (accionAbierta === "invalidar") mutationInvalidar.mutate();
								else if (accionAbierta === "regenerar")
									mutationRegenerar.mutate();
								else if (accionAbierta === "forzar")
									mutationReintentar.mutate();
							}}
						>
							{pendiente && (
								<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
							)}
							{accionAbierta === "forzar" ? "Forzar" : "Confirmar"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

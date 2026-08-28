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
import { accionesDisponibles } from "@/lib/cobros/pagalo-acciones";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

const MOTIVO_MIN = 10;

type Accion = "invalidar" | "regenerar" | "reintentar" | null;

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
		queryClient.invalidateQueries(
			orpc.getPagaloHistorial.queryOptions({ input: { casoCobroId } }),
		);
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
		onSuccess: () => {
			toast.success("Reintento de aplicación disparado.");
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
	const acciones = accionesDisponibles(status, esSupervisor);
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
					onClick={() => mutationReintentar.mutate()}
				>
					{mutationReintentar.isPending && (
						<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
					)}
					Reintentar aplicación
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
								: "Regenerar grupo"}
						</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-3">
								<Alert variant="destructive">
									<AlertDescription>
										El link viejo sigue siendo cobrable. Págalo no tiene API de
										cancelación: hay que cancelarlo a mano en el panel de
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
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={cerrar}>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							disabled={motivo.trim().length < MOTIVO_MIN || pendiente}
							onClick={(e) => {
								e.preventDefault();
								if (accionAbierta === "invalidar") mutationInvalidar.mutate();
								else if (accionAbierta === "regenerar")
									mutationRegenerar.mutate();
							}}
						>
							{pendiente && (
								<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
							)}
							Confirmar
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

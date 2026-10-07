import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CrmPill } from "@/components/ds/cards-credito";
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
import { FieldMessage } from "@/components/ui/field-message";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { client, orpc, queryClient } from "@/utils/orpc";
import { CampoFecha } from "./campo-fecha";
import { AvatarMini } from "./equipo/asignacion/carga-resumen-vista";
import {
	EstadoTabla,
	fechaLegible,
	MarcoHistorial,
} from "./equipo/asignacion/marco-historial";

/**
 * «Coberturas registradas» (CB-114): sección «Coberturas» del historial de
 * «Mi equipo» › Carga y asignación. Filtro Desde/Hasta con «Consultar», tabla
 * (Titular, Suplente, Fechas incluidas, Motivo, Estado, «Cancelar» con
 * confirmación) y el vacío.
 *
 * El formulario de registro (titular, suplente, motivo, fechas, revisar y
 * confirmar) se movió al modal «Marcar ausente»
 * (`components/cobros/equipo/asignacion/marcar-ausente.tsx`). El rango
 * consultado lo controla el contenedor: al registrar una cobertura, la tabla
 * salta a sus fechas, como antes.
 */

export const hoyGT = () =>
	new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

export type RangoCoberturas = { desde: string; hasta: string };

export type FilaCobertura = {
	id: string;
	titularId: string;
	suplenteId: string;
	desde: string;
	hasta: string;
	motivo: string;
	canceladaEn: string | Date | null;
};

export type CoberturasVistaProps = {
	filtroDesde: string;
	filtroHasta: string;
	onFiltroDesde: (fecha: string) => void;
	onFiltroHasta: (fecha: string) => void;
	onConsultar: () => void;
	filas: FilaCobertura[] | undefined;
	cargando: boolean;
	error: boolean;
	onReintentar?: () => void;
	/** Nombre del asesor por `userId` del CRM. */
	nombre: (userId: string) => string;
	/** YYYY-MM-DD de hoy en Guatemala. */
	hoy: string;
	cancelando: boolean;
	errorCancelar: string | null;
	onCancelar: (id: string) => void;
};

function estadoCobertura(c: FilaCobertura, hoy: string) {
	if (c.canceladaEn) return { texto: "Cancelada", tono: "neutral" } as const;
	if (c.hasta < hoy)
		return { texto: "Período finalizado", tono: "neutral" } as const;
	return { texto: "Registrada", tono: "success" } as const;
}

function Asesor({ nombre }: { nombre: string }) {
	return (
		<span className="flex items-center gap-2">
			<AvatarMini nombre={nombre} />
			<span className="font-semibold text-[13px] text-fg leading-[1.26]">
				{nombre}
			</span>
		</span>
	);
}

/** Sección «Coberturas»: filtro de fechas, tabla y «Cancelar» (presentación). */
export function CoberturasVista(p: CoberturasVistaProps) {
	const rangoValido =
		!!p.filtroDesde && !!p.filtroHasta && p.filtroDesde <= p.filtroHasta;
	return (
		<MarcoHistorial
			filtros={
				<form
					className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (rangoValido) p.onConsultar();
					}}
				>
					<div className="flex min-w-0 items-center gap-2">
						<Label
							htmlFor="cobertura-filtro-desde"
							className="text-fg-secondary text-xs"
						>
							Desde
						</Label>
						<CampoFecha
							id="cobertura-filtro-desde"
							className="h-8 w-38"
							value={p.filtroDesde}
							onChange={p.onFiltroDesde}
						/>
					</div>
					<div className="flex min-w-0 items-center gap-2">
						<Label
							htmlFor="cobertura-filtro-hasta"
							className="text-fg-secondary text-xs"
						>
							Hasta
						</Label>
						<CampoFecha
							id="cobertura-filtro-hasta"
							className="h-8 w-38"
							min={p.filtroDesde}
							value={p.filtroHasta}
							onChange={p.onFiltroHasta}
						/>
					</div>
					<Button
						variant="outline"
						size="sm"
						type="submit"
						disabled={!rangoValido}
					>
						Consultar
					</Button>
				</form>
			}
			resumen={
				p.errorCancelar ? (
					<FieldMessage role="alert">{p.errorCancelar}</FieldMessage>
				) : null
			}
		>
			{p.cargando || (p.error && !p.filas) ? (
				<EstadoTabla
					estado={p.cargando ? "cargando" : "error"}
					onReintentar={p.onReintentar}
				>
					No se pudieron cargar las coberturas. Intente de nuevo.
				</EstadoTabla>
			) : !p.filas?.length ? (
				<EstadoTabla estado="vacio">
					Sin coberturas para estas fechas.
				</EstadoTabla>
			) : (
				<Table>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead>Titular</TableHead>
							<TableHead>Suplente</TableHead>
							<TableHead>Fechas incluidas</TableHead>
							<TableHead>Motivo</TableHead>
							<TableHead>Estado</TableHead>
							<TableHead className="text-right">Acción</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{p.filas.map((c) => {
							const estado = estadoCobertura(c, p.hoy);
							return (
								<TableRow key={c.id}>
									<TableCell>
										<Asesor nombre={p.nombre(c.titularId)} />
									</TableCell>
									<TableCell>
										<Asesor nombre={p.nombre(c.suplenteId)} />
									</TableCell>
									<TableCell>
										<span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
											{fechaLegible(c.desde)}
											<ArrowRight
												aria-label="al"
												className="size-3 text-fg-tertiary"
											/>
											{fechaLegible(c.hasta)}
										</span>
									</TableCell>
									<TableCell className="text-fg-secondary">
										{c.motivo === "vacaciones" ? "Vacaciones" : "Permiso"}
									</TableCell>
									<TableCell>
										<CrmPill
											tone={estado.tono}
											kind="chip"
											className="px-2.5 py-0.5"
										>
											{estado.texto}
										</CrmPill>
									</TableCell>
									<TableCell className="text-right">
										{!c.canceladaEn && c.hasta >= p.hoy ? (
											<Button
												size="sm"
												variant="outline"
												disabled={p.cancelando}
												onClick={() => p.onCancelar(c.id)}
											>
												Cancelar
											</Button>
										) : null}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</MarcoHistorial>
	);
}

export function CoberturasRegistradas({
	rango,
	onRango,
}: {
	rango: RangoCoberturas;
	onRango: (rango: RangoCoberturas) => void;
}) {
	const [cancelarId, setCancelarId] = useState<string | null>(null);
	// Los campos del filtro se editan sin consultar; «Consultar» aplica el rango.
	// Si el rango cambia desde afuera (cobertura recién registrada), los campos
	// se sincronizan con él.
	const [filtroDesde, setFiltroDesde] = useState(rango.desde);
	const [filtroHasta, setFiltroHasta] = useState(rango.hasta);
	const [rangoVisto, setRangoVisto] = useState(rango);
	if (rangoVisto.desde !== rango.desde || rangoVisto.hasta !== rango.hasta) {
		setRangoVisto(rango);
		setFiltroDesde(rango.desde);
		setFiltroHasta(rango.hasta);
	}
	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	const listado = useQuery(
		orpc.listarCoberturas.queryOptions({ input: rango }),
	);
	const nombre = (userId: string) =>
		asesores.data?.find((a) => a.userId === userId)?.nombre ?? userId;
	const refrescar = () =>
		queryClient.invalidateQueries({ queryKey: orpc.listarCoberturas.key() });
	const cancelar = useMutation({
		mutationFn: () => {
			if (!cancelarId)
				throw new Error("Seleccione una cobertura para cancelar.");
			return client.cancelarCobertura({ id: cancelarId });
		},
		onSuccess: () => {
			setCancelarId(null);
			void refrescar();
			toast.success("Cobertura cancelada");
		},
		onError: () => setCancelarId(null),
	});
	return (
		<>
			<CoberturasVista
				filtroDesde={filtroDesde}
				filtroHasta={filtroHasta}
				onFiltroDesde={setFiltroDesde}
				onFiltroHasta={setFiltroHasta}
				onConsultar={() => onRango({ desde: filtroDesde, hasta: filtroHasta })}
				filas={listado.data as FilaCobertura[] | undefined}
				cargando={listado.isPending}
				error={listado.isError}
				onReintentar={() => void listado.refetch()}
				nombre={nombre}
				hoy={hoyGT()}
				cancelando={cancelar.isPending}
				errorCancelar={cancelar.error?.message ?? null}
				onCancelar={setCancelarId}
			/>
			<AlertDialog
				open={!!cancelarId}
				onOpenChange={(v) => !v && !cancelar.isPending && setCancelarId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancelar cobertura</AlertDialogTitle>
						<AlertDialogDescription>
							Se conservará el registro en el historial.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={cancelar.isPending}>
							Volver
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={cancelar.isPending}
							onClick={(e) => {
								e.preventDefault();
								cancelar.mutate();
							}}
						>
							{cancelar.isPending ? "Cancelando…" : "Cancelar cobertura"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { CargaData } from "@/components/cobros/equipo/asignacion/carga-resumen-vista";
import {
	type CapacidadDestino,
	MOTIVOS_TRASLADO,
	type ModoTraslado,
	type PreviewTraslado,
	type RazonTraslado,
	TrasladoVista,
} from "@/components/cobros/equipo/asignacion/trasladar-vista";
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
	puedeRecibirTodosBuckets,
	validarFormularioTraslado,
} from "@/lib/cobros/traslados";
import { client, orpc, queryClient } from "@/utils/orpc";

async function refrescarTraslados() {
	await Promise.all(
		[
			orpc.getCreditosPorBucket.key(),
			orpc.getHistorialReasignaciones.key(),
			orpc.getCargaPorAsesorBucket.key(),
			orpc.listarTraslados.key(),
			orpc.getAgendaDia.key(),
			orpc.getColaDia.key(),
		].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
	);
}

/** Cuentas y capacidad de un asesor sumadas en esos buckets (null sin datos). */
function capacidadDe(
	carga: CargaData | undefined,
	asesorId: number,
	buckets: readonly number[],
): CapacidadDestino | null {
	const filas = carga?.porAsesor
		.find((a) => a.asesor_id === asesorId)
		?.porBucket.filter((d) => buckets.includes(d.bucket));
	if (!filas?.length) return null;
	return {
		cuentas: filas.reduce((t, d) => t + d.cuentas, 0),
		capacidad: filas.reduce((t, d) => t + d.capacidad_base, 0),
	};
}

/**
 * Traslado masivo de cartera: el contenedor del modal «Trasladar cartera» de
 * «Mi equipo» (`?accion=trasladar&asesor=`). Toda la lógica vive aquí y la
 * presentación por pasos en `TrasladoVista`
 * (components/cobros/equipo/asignacion/trasladar-vista.tsx):
 *   - formulario: mismas validaciones (`validarFormularioTraslado`):
 *     explicación obligatoria con «Otro», responsable de cuentas sin bucket
 *     obligatorio con despido o renuncia, destino por bucket completo.
 *   - revisión: `previsualizarTraslado` con su vencimiento (un único timeout al
 *     instante exacto) y su clave de idempotencia (`crypto.randomUUID`).
 *   - confirmación: AlertDialog «Confirmar traslado permanente» y
 *     `confirmarTraslado` con la misma clave; un 409 descarta la vista previa.
 *   - resultado: «Traslado confirmado» e invalidaciones (`refrescarTraslados`).
 *
 * Props:
 *   - `origenInicial` (asesor_id de cartera): abre con ese asesor de origen.
 *   - `onOcupado`: avisa mientras se previsualiza o confirma, para que el modal
 *     no se cierre a mitad de la operación.
 *   - `onCerrar`: «Cancelar» y «Listo».
 *
 * Además de las consultas de siempre, en «A un solo asesor» y «Destino por
 * bucket» lee la carga del equipo (`getCargaPorAsesorBucket` sin filtro, la
 * misma consulta de la pestaña Carga y asignación) para mostrar la capacidad
 * de cada destino. Solo informa: no cambia el reparto ni las validaciones.
 */
export function TrasladosPanel({
	origenInicial,
	onOcupado,
	onCerrar,
}: {
	origenInicial?: number;
	onOcupado?: (ocupado: boolean) => void;
	onCerrar: () => void;
}) {
	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	const [modo, setModo] = useState<ModoTraslado>("redistribucion");
	const [origen, setOrigen] = useState(
		origenInicial ? String(origenInicial) : "",
	);
	const [destino, setDestino] = useState("");
	const [destinoEspecial, setDestinoEspecial] = useState("");
	const [destinosPorBucket, setDestinosPorBucket] = useState<
		Record<number, string>
	>({});
	const [razon, setRazon] = useState<RazonTraslado>("redistribucion");
	const [detalle, setDetalle] = useState("");
	const [preview, setPreview] = useState<PreviewTraslado | null>(null);
	const [clave, setClave] = useState("");
	const [confirmando, setConfirmando] = useState(false);
	const [resultado, setResultado] = useState<Awaited<
		ReturnType<typeof client.confirmarTraslado>
	> | null>(null);
	const [page, setPage] = useState(1);
	// Paso visible: la revisión solo se muestra con una vista previa vigente
	// en memoria; «Atrás» vuelve al formulario sin tocar nada más.
	const [enRevision, setEnRevision] = useState(false);
	const nombres = new Map(asesores.data?.map((a) => [a.asesor_id, a.nombre]));
	const origenSeleccionado = /^\d+$/.test(origen) && Number(origen) > 0;
	const cargaOrigen = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({
			input: { asesorId: Number(origen) },
		}),
		enabled: origenSeleccionado,
	});
	const cargaOrigenPendiente = origenSeleccionado && cargaOrigen.isPending;
	const bucketsOrigen = [
		...new Set(
			cargaOrigen.data?.porAsesor
				.find((asesor) => asesor.asesor_id === Number(origen))
				?.porBucket.map((bucket) => bucket.bucket) ?? [],
		),
	].sort((a, b) => a - b);
	// Capacidad de los destinos (solo informativa; ver el comentario de arriba).
	const cargaEquipo = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({ input: {} }),
		enabled: origenSeleccionado && modo !== "redistribucion",
	});
	const cargaEquipoData = cargaEquipo.data as CargaData | undefined;
	const motivo =
		razon === "otro"
			? detalle.trim()
			: `${MOTIVOS_TRASLADO[razon]}${detalle.trim() ? `: ${detalle.trim()}` : ""}`;
	const requiereDestinoEspecial = razon === "despido" || razon === "renuncia";
	const errorFormulario = cargaOrigen.isError
		? "No se pudieron cargar los buckets de la cartera. Intente de nuevo."
		: cargaOrigenPendiente
			? "Cargando buckets de la cartera…"
			: validarFormularioTraslado({
					modo,
					origen,
					destino,
					destinoEspecial,
					requiereDestinoEspecial,
					destinosPorBucket,
					bucketsOrigen,
					motivo,
				});
	const limpiar = () => {
		setPreview(null);
		setResultado(null);
		setPage(1);
		setEnRevision(false);
	};
	const previsualizar = useMutation({
		mutationFn: () => {
			const solicitud = {
				asesorOrigenId: Number(origen),
				asesorDestinoId:
					modo === "traslado_completo" ? Number(destino) : undefined,
				destinosPorBucket:
					modo === "destino_por_bucket"
						? Object.fromEntries(
								Object.entries(destinosPorBucket).map(([bucket, asesorId]) => [
									bucket,
									Number(asesorId),
								]),
							)
						: undefined,
				modo,
				motivo,
			};
			if (destinoEspecial)
				Object.assign(solicitud, {
					asesorDestinoEspecialId: Number(destinoEspecial),
				});
			return client.previsualizarTraslado(solicitud);
		},
		onSuccess: (data) => {
			setPreview(data);
			setClave(crypto.randomUUID());
			setPage(1);
			setResultado(null);
			setEnRevision(true);
		},
	});
	const confirmar = useMutation({
		retry: false,
		mutationFn: () => {
			if (!preview) throw new Error("Primero previsualice la operación.");
			return client.confirmarTraslado({
				previewId: preview.previewId,
				idempotencyKey: clave,
			});
		},
		onSuccess: (data) => {
			setResultado(data);
			setPreview(null);
			setConfirmando(false);
			toast.success(`${data.cuentas} cuentas trasladadas`);
			void refrescarTraslados();
		},
		onError: (error: Error & { code?: string }) => {
			setConfirmando(false);
			if (error.code === "CONFLICT") setPreview(null);
		},
	});
	const ocupado = previsualizar.isPending || confirmar.isPending;
	useEffect(() => {
		onOcupado?.(ocupado);
	}, [ocupado, onOcupado]);
	// `vencido` se calcula en render, así que sin esto una previsualización
	// abierta y quieta seguía mostrando Confirmar habilitado después de su
	// hora: nada dispara un re-render al pasar el minuto. El backend igual la
	// rechaza (409), pero el usuario se lleva el error en vez de ver el botón
	// deshabilitado y el aviso de vencida.
	//
	// Un timeout ÚNICO al instante exacto del vencimiento, no un intervalo:
	// solo hace falta un re-render, justo cuando el valor cambia.
	const [, setTickVencimiento] = useState(0);
	useEffect(() => {
		if (!preview) return;
		const restante = new Date(preview.venceEn).getTime() - Date.now();
		if (restante <= 0) return;
		const id = setTimeout(() => setTickVencimiento((t) => t + 1), restante);
		return () => clearTimeout(id);
	}, [preview]);
	const vencido = preview
		? new Date(preview.venceEn).getTime() <= Date.now()
		: false;
	const hayExcluidos = (preview?.excluidos.length ?? 0) > 0;
	const puedeConfirmar =
		!!preview &&
		!(
			ocupado ||
			vencido ||
			hayExcluidos ||
			!!preview.bloqueos.length ||
			!preview.asignaciones.length
		);

	const catalogo = asesores.data ?? [];
	const asesorOrigen = catalogo.find((a) => String(a.asesor_id) === origen);
	const filasOrigen = cargaOrigen.data?.porAsesor.find(
		(a) => a.asesor_id === Number(origen),
	)?.porBucket;
	const paso = resultado
		? "resultado"
		: enRevision && preview
			? "revision"
			: "formulario";

	return (
		<>
			<TrasladoVista
				paso={paso}
				cargando={asesores.isPending}
				errorCarga={asesores.isError}
				onReintentar={() => void asesores.refetch()}
				ocupado={ocupado}
				asesores={catalogo}
				origen={origen}
				onOrigen={(v) => {
					setOrigen(v);
					setDestino("");
					setDestinoEspecial("");
					setDestinosPorBucket({});
					limpiar();
				}}
				origenInfo={
					asesorOrigen
						? {
								nombre: asesorOrigen.nombre,
								activo: !!asesorOrigen.activo,
								buckets: asesorOrigen.buckets,
								porBucket: cargaOrigen.data
									? (filasOrigen ?? []).map((d) => ({
											bucket: d.bucket,
											cuentas: d.cuentas,
										}))
									: null,
							}
						: null
				}
				modo={modo}
				onModo={(v) => {
					setModo(v);
					setDestino("");
					setDestinoEspecial("");
					setDestinosPorBucket({});
					limpiar();
				}}
				destino={destino}
				onDestino={(v) => {
					setDestino(v);
					limpiar();
				}}
				destinos={catalogo
					.filter(
						(a) =>
							a.activo &&
							String(a.asesor_id) !== origen &&
							puedeRecibirTodosBuckets(bucketsOrigen, a.buckets),
					)
					.map((asesor) => ({
						asesor,
						capacidad: capacidadDe(
							cargaEquipoData,
							asesor.asesor_id,
							bucketsOrigen,
						),
					}))}
				cargandoBucketsOrigen={cargaOrigenPendiente}
				bucketsOrigen={bucketsOrigen}
				destinosPorBucket={destinosPorBucket}
				onDestinoBucket={(bucket, value) => {
					setDestinosPorBucket((actual) => ({
						...actual,
						[bucket]: value,
					}));
					limpiar();
				}}
				candidatosPorBucket={Object.fromEntries(
					bucketsOrigen.map((bucket) => [
						bucket,
						catalogo.filter(
							(asesor) =>
								asesor.activo &&
								asesor.asesor_id !== Number(origen) &&
								asesor.buckets.includes(bucket),
						),
					]),
				)}
				capacidadEnBucket={(asesorId, bucket) =>
					capacidadDe(cargaEquipoData, asesorId, [bucket])
				}
				destinoEspecial={destinoEspecial}
				onDestinoEspecial={(v) => {
					setDestinoEspecial(v);
					limpiar();
				}}
				candidatosEspecial={catalogo.filter(
					(a) =>
						a.activo && a.buckets.length > 0 && String(a.asesor_id) !== origen,
				)}
				requiereDestinoEspecial={requiereDestinoEspecial}
				razon={razon}
				onRazon={(v) => {
					setRazon(v);
					limpiar();
				}}
				detalle={detalle}
				onDetalle={(v) => {
					setDetalle(v);
					limpiar();
				}}
				errorFormulario={errorFormulario}
				errorPrevisualizar={previsualizar.error?.message ?? null}
				previsualizando={previsualizar.isPending}
				onCancelar={onCerrar}
				onRevisar={() => previsualizar.mutate()}
				preview={preview}
				vencido={vencido}
				nombres={Object.fromEntries(nombres)}
				puedeConfirmar={puedeConfirmar}
				pagina={page}
				onPagina={setPage}
				errorConfirmar={
					confirmar.error
						? `${confirmar.error.message} Si hubo un problema de conexión, puede reintentar la misma confirmación.`
						: null
				}
				confirmando={confirmar.isPending}
				onAtras={() => setEnRevision(false)}
				onConfirmar={() => setConfirmando(true)}
				resultado={resultado}
				onListo={onCerrar}
			/>
			<AlertDialog
				open={confirmando}
				onOpenChange={(v) => !confirmar.isPending && setConfirmando(v)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Confirmar traslado permanente</AlertDialogTitle>
						<AlertDialogDescription>
							Se cambiará el responsable de {preview?.asignaciones.length ?? 0}{" "}
							cuentas de {nombres.get(Number(origen))}. Motivo: {motivo}. Cada
							cambio quedará en el historial.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={confirmar.isPending}>
							Volver
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={confirmar.isPending || vencido}
							onClick={(e) => {
								e.preventDefault();
								confirmar.mutate();
							}}
						>
							{confirmar.isPending ? "Confirmando…" : "Confirmar traslado"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

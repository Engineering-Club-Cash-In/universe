import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
	bucketsParaDestinoUnico,
	partirCarteraPorPool,
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

/**
 * cartera-back rechaza la vista previa (409) si el origen tiene créditos fuera
 * del funnel y nadie los recibe: «El asesor origen tiene N cuenta(s) fuera del
 * funnel (…). Selecciona un responsable para ellas.». Devuelve N (o null si
 * no viene el número), o `undefined` si el error es otro.
 */
export function especialesDelError(
	mensaje: string | undefined,
): { cuantos: number | null } | undefined {
	if (!mensaje || !/fuera del funnel/i.test(mensaje)) return undefined;
	const n = /tiene\s+(\d+)/i.exec(mensaje)?.[1];
	return { cuantos: n ? Number(n) : null };
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
 *     nota obligatoria con «Otro», responsable de los créditos fuera de
 *     cobranza obligatorio con despido o renuncia, destino por bucket completo.
 *     Si cartera-back rechaza la vista previa porque el origen tiene créditos
 *     fuera de cobranza sin responsable, se recuerda cuántos (hasta cambiar de
 *     origen) para mostrar esa pregunta y se traduce el mensaje.
 *   - revisión: `previsualizarTraslado` con su vencimiento (un único timeout al
 *     instante exacto) y su clave de idempotencia (`crypto.randomUUID`).
 *   - confirmación: AlertDialog «Confirmar traslado permanente» y
 *     `confirmarTraslado` con la misma clave; un 409 descarta la vista previa.
 *   - resultado: «Cartera redistribuida» e invalidaciones (`refrescarTraslados`).
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
	// Créditos fuera de cobranza del origen, si una vista previa lo dijo: la
	// pregunta «¿quién queda a cargo?» se muestra solo entonces (o si es
	// obligatoria). Se olvida al cambiar de origen.
	const [especialesOrigen, setEspecialesOrigen] = useState<{
		cuantos: number | null;
	} | null>(null);
	// Asesores que recibieron créditos (para el paso de éxito).
	const [receptoresResultado, setReceptoresResultado] = useState<number>();
	const nombres = new Map(asesores.data?.map((a) => [a.asesor_id, a.nombre]));
	const origenSeleccionado = /^\d+$/.test(origen) && Number(origen) > 0;
	const cargaOrigen = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({
			input: { asesorId: Number(origen) },
		}),
		enabled: origenSeleccionado,
	});
	const cargaOrigenPendiente = origenSeleccionado && cargaOrigen.isPending;
	const filasCartera =
		cargaOrigen.data?.porAsesor.find(
			(asesor) => asesor.asesor_id === Number(origen),
		)?.porBucket ?? [];
	// Buckets en los que el origen TIENE créditos (con los sueltos): cada uno
	// necesita destino en «Un asesor por bucket». Uno sin créditos no.
	const bucketsOrigen = [
		...new Set(filasCartera.filter((d) => d.cuentas > 0).map((d) => d.bucket)),
	].sort((a, b) => a - b);
	const poolOrigen =
		asesores.data?.find((a) => String(a.asesor_id) === origen)?.buckets ?? [];
	// «A un solo asesor» se elige por el pool del origen (como el suplente de
	// «Marcar ausente»), no por los buckets de cada crédito suelto.
	const bucketsDestinoUnico = bucketsParaDestinoUnico(filasCartera, poolOrigen);
	const bucketsSueltos = partirCarteraPorPool(
		filasCartera,
		poolOrigen,
	).sueltos.map((d) => d.bucket);
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
		// El aviso de la vista previa anterior ya no aplica a lo que se cambió.
		previsualizar.reset();
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
			const especiales = data.asignaciones.filter(
				(a) => (a as { estadoEspecial?: string }).estadoEspecial,
			).length;
			if (especiales > 0) setEspecialesOrigen({ cuantos: especiales });
			setPreview(data);
			setClave(crypto.randomUUID());
			setPage(1);
			setResultado(null);
			setEnRevision(true);
		},
		onError: (error) => {
			const especiales = especialesDelError(error.message);
			if (especiales) setEspecialesOrigen(especiales);
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
			setReceptoresResultado(
				preview
					? new Set(preview.asignaciones.map((a) => a.asesorNuevoId)).size
					: undefined,
			);
			setResultado(data);
			setPreview(null);
			setConfirmando(false);
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
	const filasOrigen = filasCartera;
	const errorEspeciales = especialesDelError(previsualizar.error?.message);
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
					setEspecialesOrigen(null);
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
							puedeRecibirTodosBuckets(bucketsDestinoUnico, a.buckets),
					)
					.map((asesor) => ({
						asesor,
						capacidad: capacidadDe(
							cargaEquipoData,
							asesor.asesor_id,
							bucketsDestinoUnico,
						),
						noCubre: bucketsSueltos.filter((b) => !asesor.buckets.includes(b)),
					}))
					// Primero quienes también atienden los créditos sueltos.
					.sort((a, b) => a.noCubre.length - b.noCubre.length)}
				cargandoBucketsOrigen={cargaOrigenPendiente}
				bucketsOrigen={bucketsOrigen}
				bucketsDestinoUnico={bucketsDestinoUnico}
				onUsarPorBucket={() => {
					// El destino único se queda con los buckets que atiende; el resto
					// (los sueltos) quedan por elegir.
					const elegido = catalogo.find((a) => String(a.asesor_id) === destino);
					setModo("destino_por_bucket");
					setDestino("");
					setDestinosPorBucket(
						elegido
							? Object.fromEntries(
									bucketsOrigen
										.filter((b) => elegido.buckets.includes(b))
										.map((b) => [b, destino]),
								)
							: {},
					);
					limpiar();
				}}
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
				especialesOrigen={especialesOrigen}
				faltaResponsableEspecial={!!errorEspeciales}
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
				// El rechazo por créditos fuera de cobranza se explica en su pregunta.
				errorPrevisualizar={
					errorEspeciales ? null : (previsualizar.error?.message ?? null)
				}
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
				resultado={
					resultado ? { ...resultado, receptores: receptoresResultado } : null
				}
				onListo={onCerrar}
			/>
			<AlertDialog
				open={confirmando}
				onOpenChange={(v) => !confirmar.isPending && setConfirmando(v)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Confirmar el traslado?</AlertDialogTitle>
						<AlertDialogDescription>
							{preview?.asignaciones.length === 1
								? "1 crédito"
								: `${preview?.asignaciones.length ?? 0} créditos`}{" "}
							de {nombres.get(Number(origen))} pasan a su nuevo asesor. Es
							permanente: para deshacerlo habría que hacer otro traslado. Cada
							cambio queda en el historial. Motivo: {motivo}.
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

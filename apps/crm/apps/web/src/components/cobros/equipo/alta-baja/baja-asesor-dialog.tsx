import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { MotivoBaja } from "server/src/lib/alta-baja-asesor";
import { toast } from "sonner";
import { hoyGT } from "@/components/cobros/coberturas-panel";
import { orpc, orpcAparte } from "@/utils/orpc";
import {
	BajaAsesorVista,
	type PasoBaja,
	type RepartoBaja,
	type ResultadoBaja,
} from "./baja-asesor-vista";
import { refrescarEquipo } from "./datos";
import { MarcoAltaBaja } from "./piezas";

/**
 * «Dar de baja» (menú «⋯» de la tarjeta en Mi equipo, `?accion=baja&asesor=`,
 * y encabezado del Detalle del asesor). Datos:
 *   - asesor, nivel y supervisor    → getAsesoresTraslados
 *   - créditos activos               → getCargaPorAsesorBucket
 *   - «Siguiente: redistribuir»      → previsualizarBajaAsesor (reparto por
 *                                      capacidad de cartera, vale 10 minutos)
 *   - «Confirmar baja y redistribución» → confirmarBajaAsesor: reparte y
 *     desactiva en cartera (una transacción) y suspende su usuario del CRM. Un
 *     fallo deja la revisión abierta y el reintento reenvía la MISMA
 *     confirmación (mismo `id` y `previewId`), que no repite el reparto.
 */
export function BajaAsesorDialog({
	abierto,
	asesorId,
	onCerrar,
}: {
	abierto: boolean;
	/** `asesor_id` de cartera. */
	asesorId: number | undefined;
	onCerrar: () => void;
}) {
	const [ocupado, setOcupado] = useState(false);
	return (
		<MarcoAltaBaja
			abierto={abierto}
			ocupado={ocupado}
			titulo="Dar de baja"
			descripcion="Registre el motivo y el último día del asesor y revise cómo se reparte su cartera."
			onCerrar={onCerrar}
		>
			{abierto && asesorId ? (
				<FormularioBaja
					key={asesorId}
					asesorId={asesorId}
					onOcupado={setOcupado}
					onCerrar={onCerrar}
				/>
			) : null}
		</MarcoAltaBaja>
	);
}

function FormularioBaja({
	asesorId,
	onOcupado,
	onCerrar,
}: {
	asesorId: number;
	onOcupado: (ocupado: boolean) => void;
	onCerrar: () => void;
}) {
	const navigate = useNavigate();
	const [paso, setPaso] = useState<PasoBaja>("datos");
	const [motivo, setMotivo] = useState<MotivoBaja | "">("");
	const [detalle, setDetalle] = useState("");
	const [ultimoDia, setUltimoDia] = useState(hoyGT);
	const [id, setId] = useState(() => crypto.randomUUID());
	const [preview, setPreview] = useState<{
		previewId: string;
		venceEn: string;
		reparto: RepartoBaja;
	} | null>(null);
	const [vencida, setVencida] = useState(false);
	const [resultado, setResultado] = useState<ResultadoBaja | null>(null);

	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	const ausencias = useQuery(
		orpcAparte.listarAusencias.queryOptions({ input: { soloVigentes: true } }),
	);
	const carga = useQuery(
		orpc.getCargaPorAsesorBucket.queryOptions({ input: { asesorId } }),
	);
	const asesor = asesores.data?.find((a) => a.asesor_id === asesorId);
	const creditos = carga.data
		? (carga.data.porAsesor
				.find((a) => a.asesor_id === asesorId)
				?.porBucket.reduce((t, d) => t + d.cuentas, 0) ?? 0)
		: null;

	const avisoAsesor =
		paso !== "datos" || asesores.isPending
			? null
			: !asesor
				? "El asesor no está en el catálogo de cartera."
				: asesor.activo === false
					? `${asesor.nombre} ya está dado de baja.`
					: ausencias.data?.some((x) => x.asesorId === asesorId)
						? `${asesor.nombre} está ausente con su cartera repartida. Reactívelo antes de darlo de baja.`
						: null;

	const datosBaja = {
		asesorId,
		motivo: motivo || "renuncia",
		ultimoDia,
		detalle: detalle.trim() || undefined,
	} as const;

	const previsualizar = useMutation({
		...orpcAparte.previsualizarBajaAsesor.mutationOptions(),
		retry: false,
		onSuccess: (data) => {
			setPreview({
				previewId: data.previewId,
				venceEn: data.venceEn,
				reparto: {
					nombre: data.nombre,
					nivel: data.nivel,
					resumen: data.resumen,
					responsableEspeciales: data.responsableEspeciales
						? {
								asesorId: data.responsableEspeciales.asesorId,
								nombre: data.responsableEspeciales.nombre,
							}
						: null,
					candidatosEspeciales: data.candidatosEspeciales,
				},
			});
			// Reparto nuevo = confirmación nueva.
			setId(crypto.randomUUID());
			setPaso("reparto");
		},
	});
	// La previsualización vale 10 minutos: pasado ese instante se ofrece recalcular.
	const venceEn = preview?.venceEn;
	useEffect(() => {
		setVencida(false);
		if (!venceEn) return;
		const falta = new Date(venceEn).getTime() - Date.now();
		if (falta <= 0) {
			setVencida(true);
			return;
		}
		const t = setTimeout(() => setVencida(true), falta);
		return () => clearTimeout(t);
	}, [venceEn]);

	const confirmar = useMutation({
		...orpcAparte.confirmarBajaAsesor.mutationOptions(),
		retry: false,
		onError: (e) => {
			// Vencida, o la cartera cambió desde que se calculó: hay que recalcular.
			if (/venci|previsualiz|cambi/i.test(e.message)) setVencida(true);
		},
		onSuccess: (data) => {
			setResultado({
				nombre: data.nombre,
				cuentas: data.cuentas,
				receptores: preview?.reparto.resumen.receptores.length ?? 0,
				nivel: preview?.reparto.nivel ?? null,
				usuarioSuspendido: data.usuarioSuspendido,
				sinUsuarioCobros: data.sinUsuarioCobros,
			});
			setPaso("hecha");
			toast.success("Asesor dado de baja", {
				description: `${data.nombre}: ${data.cuentas} créditos redistribuidos.`,
			});
		},
		// Un error ambiguo (tiempo, conexión) pudo confirmar en cartera: se refresca igual.
		onSettled: () => void refrescarEquipo(),
	});
	const pendiente = previsualizar.isPending || confirmar.isPending;
	useEffect(() => onOcupado(pendiente), [pendiente, onOcupado]);

	const cambiar = () => {
		previsualizar.reset();
		confirmar.reset();
		setPreview(null);
	};
	const pedirReparto = (responsableEspecialesId?: number) => {
		confirmar.reset();
		previsualizar.mutate({
			...datosBaja,
			...(responsableEspecialesId ? { responsableEspecialesId } : {}),
		});
	};

	const errorDatos = !motivo
		? "Seleccione el motivo de la baja."
		: motivo === "otro" && !detalle.trim()
			? "Describa el motivo de la baja."
			: !ultimoDia
				? "Indique el último día de trabajo."
				: null;

	return (
		<BajaAsesorVista
			paso={paso}
			cargando={asesores.isPending || ausencias.isPending}
			errorCarga={asesores.isError || ausencias.isError}
			onReintentar={() => {
				void asesores.refetch();
				void ausencias.refetch();
			}}
			asesor={
				asesor
					? {
							nombre: asesor.nombre,
							nivel: asesor.nivel,
							creditos,
							supervisor: asesor.supervisor?.nombre ?? null,
						}
					: null
			}
			avisoAsesor={avisoAsesor}
			motivo={motivo}
			onMotivo={(m) => {
				setMotivo(m);
				cambiar();
			}}
			detalle={detalle}
			onDetalle={(v) => {
				setDetalle(v);
				cambiar();
			}}
			ultimoDia={ultimoDia}
			onUltimoDia={(v) => {
				setUltimoDia(v);
				cambiar();
			}}
			errorDatos={errorDatos}
			errorServidor={(previsualizar.error ?? confirmar.error)?.message ?? null}
			pendiente={pendiente}
			reparto={preview?.reparto ?? null}
			vencida={vencida}
			onRecalcular={() =>
				pedirReparto(preview?.reparto.responsableEspeciales?.asesorId)
			}
			onResponsable={(responsable) => pedirReparto(responsable)}
			resultado={resultado}
			onCancelar={onCerrar}
			onSiguiente={() => pedirReparto()}
			onAtras={() => {
				cambiar();
				setPaso("datos");
			}}
			onConfirmar={() => {
				if (!preview) return;
				confirmar.mutate({ ...datosBaja, id, previewId: preview.previewId });
			}}
			onVerEquipo={() => {
				void navigate({ to: "/cobros/equipo", search: {} });
			}}
			onCerrar={onCerrar}
		/>
	);
}

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
	erroresMotivosInmovilizacion,
	MOTIVOS_INMOVILIZACION,
} from "server/src/lib/inmovilizacion-unidad";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/utils/orpc";
import {
	UbicacionGpsBloque,
	useUbicacionInmovilizacion,
} from "./inmovilizacion-ubicacion";

const MOTIVO_MIN_LENGTH = 5;

/**
 * CB-041 — Solicita el apagado o la reactivación de la unidad del caso. El
 * server valida el bucket y el estado actual de la unidad (puedeSolicitar).
 *
 * El apagado pide lo mismo que la recuperación forzosa: por qué (motivos del
 * catálogo + detalle) y dónde está el vehículo, que se toma de Wialon al abrir
 * el modal. La reactivación sigue pidiendo solo un motivo de texto.
 */
export function SolicitarInmovilizacionModal({
	accion,
	casoCobroId,
	open,
	onOpenChange,
	onSolicitado,
}: {
	accion: "apagado" | "reactivacion";
	casoCobroId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSolicitado: () => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				{accion === "apagado" ? (
					<FormularioApagado
						casoCobroId={casoCobroId}
						onCerrar={() => onOpenChange(false)}
						onSolicitado={onSolicitado}
					/>
				) : (
					<FormularioReactivacion
						casoCobroId={casoCobroId}
						onCerrar={() => onOpenChange(false)}
						onSolicitado={onSolicitado}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

type PropsFormulario = {
	casoCobroId: string;
	onCerrar: () => void;
	onSolicitado: () => void;
};

function FormularioApagado({
	casoCobroId,
	onCerrar,
	onSolicitado,
}: PropsFormulario) {
	const [motivos, setMotivos] = useState<string[]>([]);
	const [detalle, setDetalle] = useState("");
	const [direccion, setDireccion] = useState("");
	const [enlace, setEnlace] = useState("");
	const gps = useUbicacionInmovilizacion(casoCobroId, "solicitud");

	const solicitar = useMutation({
		...orpc.solicitarInmovilizacion.mutationOptions(),
		onSuccess: () => {
			toast.success(
				"Solicitud de apagado enviada. El supervisor debe aprobarla.",
			);
			onSolicitado();
			onCerrar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo enviar la solicitud.", {
				duration: 8000,
			});
		},
	});

	const alternar = (clave: string) =>
		setMotivos((m) =>
			m.includes(clave) ? m.filter((x) => x !== clave) : [...m, clave],
		);

	const enlaceLimpio = enlace.trim();
	const direccionLimpia = direccion.trim();
	const enlaceValido = !enlaceLimpio || /^https?:\/\//i.test(enlaceLimpio);
	const tieneGps = gps.resultado?.ubicacion?.fuente === "gps";
	// Mismas reglas que el server: el botón se habilita con lo que va a aceptar.
	const errorMotivos = erroresMotivosInmovilizacion(motivos, detalle);
	const errorUbicacion =
		tieneGps || direccionLimpia || enlaceLimpio
			? null
			: "Falta la ubicación del vehículo: tomala del GPS o escribí la dirección.";
	const error =
		errorMotivos ??
		errorUbicacion ??
		(enlaceValido
			? null
			: "El enlace tiene que empezar con http:// o https://");

	return (
		<>
			<DialogHeader>
				<DialogTitle>Solicitar apagado de unidad</DialogTitle>
				<DialogDescription>
					Un supervisor debe aprobar la solicitud. Después, LEGION apaga la
					unidad y vos registrás su confirmación en la Ficha 360.
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-5">
				<section className="space-y-2">
					<Label>
						¿Por qué se apaga? <span className="text-red-600">*</span>
					</Label>
					<div className="grid gap-2 sm:grid-cols-2">
						{Object.entries(MOTIVOS_INMOVILIZACION).map(([clave, label]) => (
							<label
								className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
								htmlFor={`motivo-apagado-${clave}`}
								key={clave}
							>
								<Checkbox
									checked={motivos.includes(clave)}
									id={`motivo-apagado-${clave}`}
									onCheckedChange={() => alternar(clave)}
								/>
								{label}
							</label>
						))}
					</div>
					<Label
						className="pt-1 font-normal text-sm"
						htmlFor="motivo-apagado-detalle"
					>
						Detalle{" "}
						{motivos.includes("otro") ? (
							<span className="text-red-600">*</span>
						) : (
							<span className="text-muted-foreground">(opcional)</span>
						)}
					</Label>
					<Textarea
						id="motivo-apagado-detalle"
						onChange={(e) => setDetalle(e.target.value)}
						placeholder="Ej: Tercera promesa rota este mes y ya no contesta"
						rows={2}
						value={detalle}
					/>
				</section>

				<section className="space-y-2">
					<UbicacionGpsBloque
						cargando={gps.cargando}
						errorRed={gps.errorRed}
						onActualizar={gps.actualizar}
						resultado={gps.resultado}
						titulo="Dónde está el vehículo"
					/>
					<Input
						aria-label="Dirección o referencia"
						onChange={(e) => setDireccion(e.target.value)}
						placeholder="Dirección o referencia (ej: casa de la mamá, 3a calle 4-10 zona 7)"
						value={direccion}
					/>
					<Input
						aria-label="Enlace de mapa"
						onChange={(e) => setEnlace(e.target.value)}
						placeholder="Enlace de Google Maps o WhatsApp (opcional)"
						value={enlace}
					/>
				</section>
			</div>

			<DialogFooter className="items-center sm:justify-between">
				<p className="text-muted-foreground text-xs">
					{error ?? "Listo para enviar."}
				</p>
				<div className="flex gap-2">
					<Button onClick={onCerrar} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={!!error || gps.cargando || solicitar.isPending}
						onClick={() =>
							solicitar.mutate({
								casoCobroId,
								accion: "apagado",
								motivos,
								motivoDetalle: detalle.trim() || undefined,
								ubicacion: {
									consultaLogId: gps.resultado?.consultaLogId ?? undefined,
									direccion: direccionLimpia || undefined,
									enlace: enlaceLimpio || undefined,
								},
							})
						}
						variant="destructive"
					>
						{solicitar.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Solicitar apagado
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}

function FormularioReactivacion({
	casoCobroId,
	onCerrar,
	onSolicitado,
}: PropsFormulario) {
	const [motivo, setMotivo] = useState("");
	const motivoValido = motivo.trim().length >= MOTIVO_MIN_LENGTH;

	const solicitar = useMutation({
		...orpc.solicitarInmovilizacion.mutationOptions(),
		onSuccess: () => {
			toast.success(
				"Solicitud de reactivación enviada. El supervisor debe aprobarla.",
			);
			onSolicitado();
			onCerrar();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo enviar la solicitud.", {
				duration: 8000,
			});
		},
	});

	return (
		<>
			<DialogHeader>
				<DialogTitle>Solicitar reactivación de unidad</DialogTitle>
				<DialogDescription>
					Un supervisor debe aprobar la solicitud antes de que LEGION reactive
					la unidad.
				</DialogDescription>
			</DialogHeader>

			<div>
				<Label htmlFor="motivo-inmovilizacion">Motivo</Label>
				<Textarea
					id="motivo-inmovilizacion"
					onChange={(e) => setMotivo(e.target.value)}
					placeholder="Explicá por qué se solicita esta acción"
					rows={4}
					value={motivo}
				/>
				{!motivoValido && motivo.length > 0 && (
					<p className="mt-1 text-destructive text-xs">
						Ingresá al menos {MOTIVO_MIN_LENGTH} caracteres.
					</p>
				)}
			</div>

			<DialogFooter>
				<Button onClick={onCerrar} variant="outline">
					Cancelar
				</Button>
				<Button
					disabled={!motivoValido || solicitar.isPending}
					onClick={() =>
						solicitar.mutate({
							casoCobroId,
							accion: "reactivacion",
							motivo: motivo.trim(),
						})
					}
				>
					{solicitar.isPending && (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					)}
					Solicitar reactivación
				</Button>
			</DialogFooter>
		</>
	);
}

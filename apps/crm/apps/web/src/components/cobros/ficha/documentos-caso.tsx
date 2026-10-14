import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import {
	type DocumentoFila,
	DocumentosFicha,
} from "@/components/cobros/ficha/ficha-pestanas";
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
	DialogTitle,
	dialogDescriptionClassName,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { orpc, orpcAparte } from "@/utils/orpc";

/**
 * Ficha 360 · F6 (#1864) · Documentos del caso: enviar al cliente por WhatsApp
 * (tarjeta de circulación, seguro) y solicitar al supervisor (contrato, carta
 * poder, cambio de placas, expertaje). Lo usan la pestaña Documentos de la
 * ficha y el panel de contexto del Workspace.
 *
 * - `useDocumentosCaso`: arma las filas (`DocumentoFila`) desde el catálogo de
 *   `getFichaComplementos.documentos` y devuelve los diálogos (confirmación de
 *   envío y modal de solicitud) para montarlos una vez.
 * - `DocumentosCaso`: lo mismo ya pintado con `DocumentosFicha`.
 * - `SolicitarDocumentoVista`: contenido del modal de solicitud, sin estado
 *   (lo usa el showcase).
 *
 * Plan: docs/features/cobros-02/21-plan-backend-ficha-360.md (F6).
 */

/** `getFichaComplementos.documentos` (DocumentoFicha del servidor). */
export type DocumentoCatalogo = {
	clave: string;
	nombre: string;
	descripcion: string;
	modo: "enviar" | "solicitar";
	disponible: boolean;
};

const CLAVES_ENVIAR = ["tarjeta-circulacion", "seguro"] as const;
const CLAVES_SOLICITAR = [
	"contrato",
	"carta-poder",
	"cambio-placas",
	"expertaje",
] as const;
type ClaveEnviar = (typeof CLAVES_ENVIAR)[number];
type ClaveSolicitar = (typeof CLAVES_SOLICITAR)[number];

/**
 * Mismas claves y textos que el catálogo del servidor (`documentos-ficha.ts`):
 * se pintan mientras el catálogo carga o si no se pudo leer.
 */
export const CATALOGO_DOCUMENTOS: Array<Omit<DocumentoCatalogo, "disponible">> =
	[
		{
			clave: "tarjeta-circulacion",
			nombre: "Tarjeta de circulación",
			descripcion: "Documento vehicular",
			modo: "enviar",
		},
		{
			clave: "seguro",
			nombre: "Información de seguro",
			descripcion: "Póliza vigente",
			modo: "enviar",
		},
		{
			clave: "contrato",
			nombre: "Contrato de crédito",
			descripcion: "PDF · Documento legal",
			modo: "solicitar",
		},
		{
			clave: "carta-poder",
			nombre: "Carta poder",
			descripcion: "Requiere firma del titular",
			modo: "solicitar",
		},
		{
			clave: "cambio-placas",
			nombre: "Cambio de placas",
			descripcion: "Trámite vehicular",
			modo: "solicitar",
		},
		{
			clave: "expertaje",
			nombre: "Expertaje",
			descripcion: "Avalúo del vehículo",
			modo: "solicitar",
		},
	];

/** Igual que el esquema de `solicitarDocumentoCaso` en el servidor. */
export const MAXIMO_COMENTARIO_SOLICITUD = 1000;

const esClaveEnviar = (c: string): c is ClaveEnviar =>
	(CLAVES_ENVIAR as readonly string[]).includes(c);
const esClaveSolicitar = (c: string): c is ClaveSolicitar =>
	(CLAVES_SOLICITAR as readonly string[]).includes(c);

type DocumentoAccion = { clave: string; nombre: string };

/**
 * Filas de la pestaña Documentos. Pura: el hook le pasa el estado.
 * - Catálogo cargando → acciones deshabilitadas.
 * - Catálogo `null` (no se pudo leer) → acciones habilitadas: el servidor
 *   valida y responde con el motivo («Este crédito no tiene ese documento
 *   cargado.», solicitud repetida).
 * - Enviar sin archivo → «Sin archivo»; solicitar con otra pendiente →
 *   «Solicitado».
 */
export function filasDocumentos(p: {
	catalogo: DocumentoCatalogo[] | null | undefined;
	cargandoCatalogo: boolean;
	/** Sin caso o solo consulta: sin acciones. */
	motivoSinAcciones: string | null;
	enviando: string | null;
	onEnviar: (doc: DocumentoAccion) => void;
	onSolicitar: (doc: DocumentoAccion) => void;
}): { enviar: DocumentoFila[]; solicitar: DocumentoFila[] } {
	const fila = (base: Omit<DocumentoCatalogo, "disponible">): DocumentoFila => {
		const comun = {
			clave: base.clave,
			nombre: base.nombre,
			descripcion: base.descripcion,
		};
		if (p.motivoSinAcciones)
			return { ...comun, motivoDeshabilitado: p.motivoSinAcciones };
		if (p.cargandoCatalogo)
			return {
				...comun,
				motivoDeshabilitado: "Consultando los documentos del caso…",
			};
		const disponible =
			p.catalogo?.find((d) => d.clave === base.clave)?.disponible ?? true;
		const doc = { clave: base.clave, nombre: base.nombre };
		if (base.modo === "enviar") {
			if (!disponible)
				return {
					...comun,
					estado: { etiqueta: "Sin archivo", tone: "neutral" },
					motivoDeshabilitado: "Este crédito no tiene ese documento cargado.",
				};
			return {
				...comun,
				onClick: () => p.onEnviar(doc),
				cargando: p.enviando === base.clave,
			};
		}
		if (!disponible)
			return {
				...comun,
				estado: { etiqueta: "Solicitado", tone: "warning" },
				motivoDeshabilitado:
					"Ya hay una solicitud pendiente de este documento. Su supervisor la aprobará o la rechazará.",
			};
		return { ...comun, onClick: () => p.onSolicitar(doc) };
	};
	// El orden y los textos son los del catálogo del servidor; si llega uno que
	// el front no conoce, se ignora (no hay acción para él).
	const base =
		p.catalogo && p.catalogo.length > 0
			? p.catalogo.filter(
					(d) => esClaveEnviar(d.clave) || esClaveSolicitar(d.clave),
				)
			: CATALOGO_DOCUMENTOS;
	return {
		enviar: base.filter((d) => d.modo === "enviar").map(fila),
		solicitar: base.filter((d) => d.modo === "solicitar").map(fila),
	};
}

/* ── Modal de solicitud (presentación) ──────────────────────────────────────── */

export type SolicitarDocumentoVistaProps = {
	documento: string;
	comentario: string;
	onComentario: (valor: string) => void;
	error: string | null;
	pendiente: boolean;
	onCancelar: () => void;
	onSolicitar: () => void;
};

const DESCRIPCION_SOLICITUD =
	"La solicitud le llega a su supervisor, que la aprueba o la rechaza con una nota.";

/**
 * Contenido del modal «Solicitar documento», sin el Dialog: así el showcase lo
 * pinta en línea. El título accesible del Dialog va aparte (`sr-only`).
 */
export function SolicitarDocumentoVista(p: SolicitarDocumentoVistaProps) {
	return (
		<>
			<DialogHeader>
				<h2 className={cn(dialogTitleClassName, "pr-10")}>
					Solicitar «{p.documento}»
				</h2>
				<p className={dialogDescriptionClassName}>{DESCRIPCION_SOLICITUD}</p>
			</DialogHeader>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="solicitud-documento-comentario">
					Comentario para el supervisor (opcional)
				</Label>
				<Textarea
					id="solicitud-documento-comentario"
					rows={3}
					showCount
					maxLength={MAXIMO_COMENTARIO_SOLICITUD}
					value={p.comentario}
					disabled={p.pendiente}
					placeholder="Ej.: El cliente necesita el documento para un trámite en el banco."
					onChange={(e) => p.onComentario(e.target.value)}
				/>
			</div>
			{p.error ? <FieldMessage role="alert">{p.error}</FieldMessage> : null}
			<DialogFooter>
				<Button
					variant="secondary"
					disabled={p.pendiente}
					onClick={p.onCancelar}
				>
					Cancelar
				</Button>
				<Button loading={p.pendiente} onClick={p.onSolicitar}>
					{p.pendiente ? "Enviando…" : "Solicitar documento"}
				</Button>
			</DialogFooter>
		</>
	);
}

/* ── Conectado ──────────────────────────────────────────────────────────────── */

const DESCRIPCION_ENVIO: Record<ClaveEnviar, string> = {
	"tarjeta-circulacion":
		"Se enviará por WhatsApp, al teléfono registrado del cliente, la tarjeta de circulación más reciente cargada al vehículo.",
	seguro:
		"Se enviará por WhatsApp, al teléfono registrado del cliente, la póliza del vehículo o, si no está cargada, la cobertura general del seguro.",
};

export type UseDocumentosCasoOpciones = {
	casoCobroId: string | null | undefined;
	/** `getFichaComplementos.documentos`; `null` = no se pudo leer. */
	catalogo: DocumentoCatalogo[] | null | undefined;
	/** Mientras `getFichaComplementos` carga. */
	cargandoCatalogo?: boolean;
	/** Solo consulta (Espacio de aprobación): sin acciones. */
	soloLectura?: boolean;
};

/**
 * Filas de Documentos con sus acciones. Devuelve `dialogos`, que hay que
 * montar una vez (confirmación de envío y modal de solicitud). Las filas que
 * no son de F6 (estado de cuenta, carta notarial) las suma quien llama.
 */
export function useDocumentosCaso({
	casoCobroId,
	catalogo,
	cargandoCatalogo = false,
	soloLectura = false,
}: UseDocumentosCasoOpciones): {
	enviar: DocumentoFila[];
	solicitar: DocumentoFila[];
	dialogos: React.ReactNode;
} {
	const queryClient = useQueryClient();
	const [confirmarEnvio, setConfirmarEnvio] = React.useState<
		(DocumentoAccion & { clave: ClaveEnviar }) | null
	>(null);
	const [solicitud, setSolicitud] = React.useState<
		(DocumentoAccion & { clave: ClaveSolicitar }) | null
	>(null);
	const [comentario, setComentario] = React.useState("");
	const [errorSolicitud, setErrorSolicitud] = React.useState<string | null>(
		null,
	);

	// Cambiar de caso (la ruta no se remonta) cierra lo que estuviera abierto.
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo al cambiar de caso
	React.useEffect(() => {
		setConfirmarEnvio(null);
		setSolicitud(null);
	}, [casoCobroId]);

	const refrescarCatalogo = () => {
		if (!casoCobroId) return;
		queryClient.invalidateQueries({
			queryKey: orpc.getFichaComplementos.key({ input: { casoCobroId } }),
		});
	};

	const enviarMutation = useMutation({
		mutationFn: (doc: DocumentoAccion & { clave: ClaveEnviar }) =>
			orpcAparte.enviarDocumentoClienteWhatsapp.call({
				casoCobroId: casoCobroId as string,
				clave: doc.clave,
			}),
		onSuccess: (r, doc) => {
			toast.success(`Se envió «${doc.nombre}» por WhatsApp al ${r.telefono}.`);
		},
		onError: (error, doc) => {
			toast.error(
				error instanceof Error && error.message
					? error.message
					: `No se pudo enviar «${doc.nombre}». Intente de nuevo.`,
			);
			// «Sin documento»: el catálogo estaba desactualizado.
			refrescarCatalogo();
		},
	});

	const solicitarMutation = useMutation({
		mutationFn: (v: {
			clave: ClaveSolicitar;
			nombre: string;
			comentario: string;
		}) =>
			orpcAparte.solicitarDocumentoCaso.call({
				casoCobroId: casoCobroId as string,
				clave: v.clave,
				comentario: v.comentario.trim() || undefined,
			}),
		onSuccess: (_r, v) => {
			toast.success(`Se envió la solicitud de «${v.nombre}» a su supervisor.`);
			setSolicitud(null);
			refrescarCatalogo();
			queryClient.invalidateQueries({
				queryKey: orpcAparte.getSolicitudesDocumentos.key(),
			});
		},
		onError: (error) => {
			setErrorSolicitud(
				error instanceof Error && error.message
					? error.message
					: "No se pudo enviar la solicitud. Intente de nuevo.",
			);
			// Repetida (CONFLICT): la fila tiene que pasar a «Solicitado».
			refrescarCatalogo();
		},
	});

	const filas = filasDocumentos({
		catalogo,
		cargandoCatalogo,
		motivoSinAcciones: soloLectura
			? "Solo consulta."
			: !casoCobroId
				? "El crédito no tiene un caso de cobro."
				: null,
		enviando: enviarMutation.isPending
			? (enviarMutation.variables?.clave ?? null)
			: null,
		onEnviar: (doc) => {
			if (esClaveEnviar(doc.clave))
				setConfirmarEnvio({ ...doc, clave: doc.clave });
		},
		onSolicitar: (doc) => {
			if (!esClaveSolicitar(doc.clave)) return;
			setComentario("");
			setErrorSolicitud(null);
			setSolicitud({ ...doc, clave: doc.clave });
		},
	});

	const dialogos = (
		<>
			<AlertDialog
				open={!!confirmarEnvio}
				onOpenChange={(abierto) => {
					if (!abierto) setConfirmarEnvio(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							¿Enviar «{confirmarEnvio?.nombre}» al cliente?
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmarEnvio ? DESCRIPCION_ENVIO[confirmarEnvio.clave] : null}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (confirmarEnvio) enviarMutation.mutate(confirmarEnvio);
							}}
						>
							Enviar
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<Dialog
				open={!!solicitud}
				onOpenChange={(abierto) => {
					if (!abierto && !solicitarMutation.isPending) setSolicitud(null);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogTitle className="sr-only">
						Solicitar «{solicitud?.nombre}»
					</DialogTitle>
					<DialogDescription className="sr-only">
						{DESCRIPCION_SOLICITUD}
					</DialogDescription>
					{solicitud ? (
						<SolicitarDocumentoVista
							documento={solicitud.nombre}
							comentario={comentario}
							onComentario={(v) => {
								setComentario(v);
								setErrorSolicitud(null);
							}}
							error={errorSolicitud}
							pendiente={solicitarMutation.isPending}
							onCancelar={() => setSolicitud(null)}
							onSolicitar={() =>
								solicitarMutation.mutate({
									clave: solicitud.clave,
									nombre: solicitud.nombre,
									comentario,
								})
							}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);

	return { ...filas, dialogos };
}

/**
 * La pestaña Documentos conectada. `extrasEnviar` son las filas que no son de
 * F6 (estado de cuenta, carta notarial) y van después de las del catálogo.
 */
export function DocumentosCaso({
	extrasEnviar = [],
	...opciones
}: UseDocumentosCasoOpciones & { extrasEnviar?: DocumentoFila[] }) {
	const { enviar, solicitar, dialogos } = useDocumentosCaso(opciones);
	return (
		<>
			<DocumentosFicha
				enviar={[...enviar, ...extrasEnviar]}
				solicitar={solicitar}
			/>
			{dialogos}
		</>
	);
}

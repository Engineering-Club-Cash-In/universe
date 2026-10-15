/**
 * Ficha 360 / Workspace · pestaña «Estado de cuenta» · acciones del documento.
 *
 * Tres acciones del mismo nivel, en una barra compacta:
 *  - Vista previa: el PDF en un modal (el mismo documento que se envía).
 *  - Enviar por WhatsApp: abre la confirmación que ya maneja la pantalla; su
 *    mutación, toasts e invalidaciones no cambian.
 *  - Enviar por correo: modal con el correo del cliente del CRM, editable
 *    solo para este envío.
 *
 * Piezas:
 *  - `EstadoCuentaAccionesBarra`, `VistaPreviaEstadoCuentaVista` y
 *    `EnviarCorreoEstadoCuentaVista`: solo presentación (las usa el showcase).
 *  - `EstadoCuentaAcciones`: el contenedor (vista previa y correo).
 */
import { useMutation } from "@tanstack/react-query";
import {
	ExternalLink,
	Eye,
	Mail,
	MessageCircle,
	RefreshCw,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { correoDeRelleno } from "@/components/cobros/workspace/gestion/contacto-valido";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	dialogDescriptionClassName,
	dialogHeaderClassName,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { client } from "@/utils/orpc";

/* ── Barra ─────────────────────────────────────────────────────────────────── */

export type EstadoCuentaAccionesBarraProps = {
	onVistaPrevia?: () => void;
	/** Sin él no se muestra (solo consulta). */
	onWhatsapp?: () => void;
	/** Sin él no se muestra (solo consulta). */
	onCorreo?: () => void;
	enviandoWhatsapp?: boolean;
	enviandoCorreo?: boolean;
	/** El cliente no tiene correo válido: el botón lo explica al pasar el cursor. */
	sinCorreo?: boolean;
	className?: string;
};

export function EstadoCuentaAccionesBarra({
	onVistaPrevia,
	onWhatsapp,
	onCorreo,
	enviandoWhatsapp,
	enviandoCorreo,
	sinCorreo,
	className,
}: EstadoCuentaAccionesBarraProps) {
	const botonCorreo = onCorreo ? (
		<Button
			size="sm"
			variant="secondary"
			loading={enviandoCorreo}
			onClick={enviandoCorreo ? undefined : onCorreo}
		>
			{enviandoCorreo ? null : <Mail aria-hidden />}
			{enviandoCorreo ? "Enviando…" : "Enviar por correo"}
		</Button>
	) : null;

	return (
		<div
			role="toolbar"
			aria-label="Acciones del estado de cuenta"
			className={cn("flex flex-wrap items-center justify-end gap-2", className)}
		>
			{onVistaPrevia ? (
				<Button size="sm" variant="secondary" onClick={onVistaPrevia}>
					<Eye aria-hidden />
					Vista previa
				</Button>
			) : null}
			{onWhatsapp ? (
				<Button
					size="sm"
					variant="secondary"
					loading={enviandoWhatsapp}
					// Mientras envía no se vuelve a abrir la confirmación (ni con teclado).
					onClick={enviandoWhatsapp ? undefined : onWhatsapp}
				>
					{enviandoWhatsapp ? null : <MessageCircle aria-hidden />}
					{enviandoWhatsapp ? "Enviando…" : "Enviar por WhatsApp"}
				</Button>
			) : null}
			{botonCorreo && sinCorreo ? (
				<Tooltip>
					<TooltipTrigger asChild>{botonCorreo}</TooltipTrigger>
					<TooltipContent>
						El cliente no tiene un correo registrado. Podrá ingresar uno al
						enviar.
					</TooltipContent>
				</Tooltip>
			) : (
				botonCorreo
			)}
		</div>
	);
}

/* ── Vista previa ──────────────────────────────────────────────────────────── */

export type VistaPreviaEstadoCuentaVistaProps = {
	estado: "generando" | "error" | "listo";
	url?: string | null;
	error?: string | null;
	onReintentar?: () => void;
	onCerrar: () => void;
};

/** Contenido del modal (sin el Dialog: así el showcase lo pinta en línea). */
export function VistaPreviaEstadoCuentaVista({
	estado,
	url,
	error,
	onReintentar,
	onCerrar,
}: VistaPreviaEstadoCuentaVistaProps) {
	return (
		<>
			<DialogHeaderEnLinea
				titulo="Vista previa del estado de cuenta"
				descripcion="Documento generado con los datos actuales del crédito. Es el mismo que se envía por WhatsApp y por correo."
			/>
			<div className="h-[65vh] min-h-80 w-full overflow-hidden rounded-xl border border-line-subtle bg-muted">
				{estado === "listo" && url ? (
					<iframe
						title="Estado de cuenta"
						src={url}
						className="size-full border-0 bg-surface"
					/>
				) : estado === "error" ? (
					<div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
						<FieldMessage>
							{error || "No se pudo generar el estado de cuenta."}
						</FieldMessage>
						{onReintentar ? (
							<Button size="sm" variant="secondary" onClick={onReintentar}>
								<RefreshCw aria-hidden />
								Reintentar
							</Button>
						) : null}
					</div>
				) : (
					<div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-fg-secondary text-sm">
						<Spinner />
						Generando el estado de cuenta…
					</div>
				)}
			</div>
			<DialogFooter>
				<Button variant="outline" onClick={onCerrar}>
					Cerrar
				</Button>
				{estado === "listo" && url ? (
					<Button asChild variant="default">
						<a href={url} target="_blank" rel="noopener noreferrer">
							<ExternalLink aria-hidden />
							Abrir en otra pestaña
						</a>
					</Button>
				) : (
					<Button variant="default" disabled>
						<ExternalLink aria-hidden />
						Abrir en otra pestaña
					</Button>
				)}
			</DialogFooter>
		</>
	);
}

/* ── Envío por correo ──────────────────────────────────────────────────────── */

export type EnviarCorreoEstadoCuentaVistaProps = {
	correo: string;
	onCorreo: (valor: string) => void;
	/** Correo válido del cliente en el CRM, o null si no tiene. */
	correoRegistrado: string | null;
	error?: string | null;
	enviando?: boolean;
	onCancelar: () => void;
	onEnviar: () => void;
};

export function EnviarCorreoEstadoCuentaVista({
	correo,
	onCorreo,
	correoRegistrado,
	error,
	enviando,
	onCancelar,
	onEnviar,
}: EnviarCorreoEstadoCuentaVistaProps) {
	const id = React.useId();
	const distinto =
		!!correoRegistrado &&
		correo.trim().toLowerCase() !== correoRegistrado.trim().toLowerCase();
	return (
		<form
			className="grid gap-5"
			onSubmit={(e) => {
				e.preventDefault();
				onEnviar();
			}}
		>
			<DialogHeaderEnLinea
				titulo="Enviar estado de cuenta por correo"
				descripcion="Se generará el estado de cuenta actualizado del crédito y se enviará como PDF adjunto."
			/>
			<fieldset className="flex flex-col gap-1.5" disabled={enviando}>
				<Label htmlFor={`${id}-correo`}>Correo de destino</Label>
				<Input
					id={`${id}-correo`}
					type="email"
					inputMode="email"
					autoComplete="off"
					placeholder="Ej.: nombre@dominio.com"
					value={correo}
					aria-invalid={error ? true : undefined}
					onChange={(e) => onCorreo(e.target.value)}
				/>
				{error ? (
					<FieldMessage>{error}</FieldMessage>
				) : !correoRegistrado ? (
					<FieldMessage variant="warning">
						El cliente no tiene un correo registrado. Ingrese el correo al que
						se enviará.
					</FieldMessage>
				) : distinto ? (
					<FieldMessage variant="help">
						Este correo solo se usa para este envío; el registrado en la ficha (
						{correoRegistrado}) no se modifica.
					</FieldMessage>
				) : (
					<FieldMessage variant="help">
						Correo registrado del cliente.
					</FieldMessage>
				)}
			</fieldset>
			<DialogFooter>
				<Button
					type="button"
					variant="outline"
					onClick={onCancelar}
					disabled={enviando}
				>
					Cancelar
				</Button>
				<Button type="submit" loading={enviando} disabled={enviando}>
					Enviar
				</Button>
			</DialogFooter>
		</form>
	);
}

/**
 * Título y descripción del modal. Dentro de un Dialog usa sus piezas (aria);
 * el showcase pinta el contenido sin Dialog, así que aquí se decide por
 * contexto.
 */
const EnDialogContext = React.createContext(false);

function DialogHeaderEnLinea({
	titulo,
	descripcion,
}: {
	titulo: string;
	descripcion: string;
}) {
	const enDialog = React.useContext(EnDialogContext);
	if (enDialog) {
		return (
			<DialogHeader>
				<DialogTitle>{titulo}</DialogTitle>
				<DialogDescription>{descripcion}</DialogDescription>
			</DialogHeader>
		);
	}
	return (
		<div className={cn(dialogHeaderClassName, "pr-10")}>
			<h2 className={dialogTitleClassName}>{titulo}</h2>
			<p className={dialogDescriptionClassName}>{descripcion}</p>
		</div>
	);
}

/* ── Contenedor ────────────────────────────────────────────────────────────── */

const CORREO_INVALIDO = "Ingrese un correo válido. Ej.: nombre@dominio.com";

export function EstadoCuentaAcciones({
	casoCobroId,
	correoCliente,
	onEnviarWhatsapp,
	enviandoWhatsapp,
	soloLectura,
	className,
}: {
	casoCobroId: string | null | undefined;
	/** Correo del cliente en el CRM (puede venir vacío o de relleno). */
	correoCliente: string | null | undefined;
	/** Abre la confirmación del WhatsApp que ya maneja la pantalla. */
	onEnviarWhatsapp?: () => void;
	enviandoWhatsapp?: boolean;
	/** Solo consulta: deja la vista previa y oculta los envíos. */
	soloLectura?: boolean;
	className?: string;
}) {
	const [vistaAbierta, setVistaAbierta] = React.useState(false);
	const [correoAbierto, setCorreoAbierto] = React.useState(false);
	const [correo, setCorreo] = React.useState("");
	const [errorCorreo, setErrorCorreo] = React.useState<string | null>(null);

	const correoRegistrado =
		correoCliente && !correoDeRelleno(correoCliente)
			? correoCliente.trim()
			: null;

	// Cartera genera el PDF en cada llamada (Puppeteer + R2): se pide solo al
	// abrir el modal, nunca en segundo plano.
	const generar = useMutation({
		mutationFn: () =>
			client.generarEstadoCuentaPdf({ casoCobroId: casoCobroId ?? "" }),
	});

	const enviarCorreo = useMutation({
		mutationFn: (email: string) =>
			client.enviarEstadoCuentaEmail({
				casoCobroId: casoCobroId ?? "",
				email,
			}),
		onSuccess: (r) => {
			toast.success(`Estado de cuenta enviado a ${r.email}`);
			setCorreoAbierto(false);
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo enviar el estado de cuenta");
		},
	});

	if (!casoCobroId) return null;

	const abrirVista = () => {
		setVistaAbierta(true);
		generar.mutate();
	};
	const abrirCorreo = () => {
		if (enviarCorreo.isPending) return;
		setCorreo(correoRegistrado ?? "");
		setErrorCorreo(null);
		setCorreoAbierto(true);
	};
	const confirmarCorreo = () => {
		if (enviarCorreo.isPending) return;
		const valor = correo.trim();
		if (correoDeRelleno(valor)) {
			setErrorCorreo(CORREO_INVALIDO);
			return;
		}
		setErrorCorreo(null);
		enviarCorreo.mutate(valor);
	};

	return (
		<>
			<EstadoCuentaAccionesBarra
				className={className}
				onVistaPrevia={abrirVista}
				onWhatsapp={soloLectura ? undefined : onEnviarWhatsapp}
				enviandoWhatsapp={enviandoWhatsapp}
				onCorreo={soloLectura ? undefined : abrirCorreo}
				enviandoCorreo={enviarCorreo.isPending}
				sinCorreo={!correoRegistrado}
			/>

			<EnDialogContext.Provider value>
				<Dialog
					open={vistaAbierta}
					onOpenChange={(abierto) => {
						setVistaAbierta(abierto);
						if (!abierto) generar.reset();
					}}
				>
					<DialogContent className="sm:max-w-4xl">
						<VistaPreviaEstadoCuentaVista
							estado={
								generar.isSuccess
									? "listo"
									: generar.isError
										? "error"
										: "generando"
							}
							url={generar.data?.url}
							error={generar.error?.message}
							onReintentar={() => generar.mutate()}
							onCerrar={() => {
								setVistaAbierta(false);
								generar.reset();
							}}
						/>
					</DialogContent>
				</Dialog>

				<Dialog
					open={correoAbierto}
					onOpenChange={(abierto) => {
						if (!enviarCorreo.isPending) setCorreoAbierto(abierto);
					}}
				>
					<DialogContent className="sm:max-w-md">
						<EnviarCorreoEstadoCuentaVista
							correo={correo}
							onCorreo={(v) => {
								setCorreo(v);
								if (errorCorreo) setErrorCorreo(null);
							}}
							correoRegistrado={correoRegistrado}
							error={errorCorreo}
							enviando={enviarCorreo.isPending}
							onCancelar={() => setCorreoAbierto(false)}
							onEnviar={confirmarCorreo}
						/>
					</DialogContent>
				</Dialog>
			</EnDialogContext.Provider>
		</>
	);
}

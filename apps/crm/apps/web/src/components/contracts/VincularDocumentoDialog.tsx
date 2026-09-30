import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CheckCircle2,
	Clock,
	Copy,
	FileText,
	Link2,
	Loader2,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import {
	type FaltaVincular,
	ROL_EN_PALABRAS,
} from "server/src/lib/contrato-falta-vincular";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

/** Quiénes tienen que estar en el documento, como lo devuelve el servidor. */
export interface GuiaParaVincular {
	firmantes: Array<{
		role: string;
		nombre: string;
		correo: string;
		verificacion: string;
	}>;
	/** El contrato ya tiene documento en WeeTrust: vincular otro lo reemplaza. */
	reemplaza: boolean;
}

/** Lo que el servidor encontró en el documento pegado. */
export interface RevisionDelDocumento {
	documentID: string;
	estado: string;
	firmantes: Array<{
		role: string;
		nombre: string;
		correo: string;
		firmo: boolean;
	}>;
	faltan: Array<{ role: string; nombre: string; correo: string }>;
	desconocidos: string[];
	problema: string | null;
}

export interface ResultadoDeVincular {
	vinculado: boolean;
	revision: RevisionDelDocumento;
	/** Algo que quedó a medias y hay que hacer a mano (el documento viejo). */
	aviso: string | null;
	reemplazo: boolean;
	porcentajeEtapa?: number | null;
}

const rol = (role: string) => ROL_EN_PALABRAS[role] ?? role;

/**
 * Vincular con un contrato un documento armado a mano en WeeTrust.
 *
 * Sirve para el contrato subido a mano que no salió a firma —no se encontraron
 * los espacios— y para cambiarle el documento a uno que sí salió. Explica los
 * pasos en el orden en que se hacen, con la lista exacta de a quién agregar en
 * WeeTrust: el correo tiene que ser ése, porque por el correo se reconoce a
 * cada firmante al vincular.
 *
 * Antes de guardar, revisa: muestra a quiénes reconoció en el documento, quién
 * falta y por qué no se puede, si no se puede. Lo comparten ventas e
 * inversiones; cada una pasa sus llamadas.
 */
export function VincularDocumentoDialog({
	open,
	onOpenChange,
	contractName,
	pdfUrl,
	faltaVincular,
	claveDeGuia,
	cargarGuia,
	vincular,
	onVinculado,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	contractName: string;
	/** El PDF que hay que subir a WeeTrust. */
	pdfUrl?: string | null;
	/** Si el contrato quedó guardado sin salir a firma. */
	faltaVincular: FaltaVincular | null;
	/** Para la caché de la guía: el id del contrato. */
	claveDeGuia: string;
	cargarGuia: () => Promise<GuiaParaVincular>;
	vincular: (
		enlace: string,
		soloRevisar: boolean,
	) => Promise<ResultadoDeVincular>;
	onVinculado: (resultado: ResultadoDeVincular) => void;
}) {
	const [enlace, setEnlace] = useState("");
	// La revisión vale para el enlace con que se hizo: si lo cambian, hay que
	// volver a revisar antes de vincular.
	const [revisado, setRevisado] = useState<{
		enlace: string;
		revision: RevisionDelDocumento;
	} | null>(null);

	const guia = useQuery({
		queryKey: ["guia-para-vincular", claveDeGuia],
		queryFn: cargarGuia,
		enabled: open,
		retry: false,
	});

	const revisar = useMutation({
		mutationFn: () => vincular(enlace.trim(), true),
		onSuccess: (resultado) =>
			setRevisado({ enlace: enlace.trim(), revision: resultado.revision }),
		onError: (error: Error) => {
			setRevisado(null);
			toast.error(error.message);
		},
	});

	const confirmar = useMutation({
		mutationFn: () => vincular(enlace.trim(), false),
		onSuccess: (resultado) => {
			toast.success(
				resultado.reemplazo
					? "Documento agregado: el anterior se borró de WeeTrust"
					: "Documento agregado: el contrato ya está en firma",
			);
			if (resultado.aviso) toast.warning(resultado.aviso, { duration: 10_000 });
			cerrar();
			onVinculado(resultado);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const cerrar = () => {
		setEnlace("");
		setRevisado(null);
		onOpenChange(false);
	};

	const revision =
		revisado && revisado.enlace === enlace.trim() ? revisado.revision : null;
	const ocupado = revisar.isPending || confirmar.isPending;

	const copiar = (texto: string) => {
		navigator.clipboard.writeText(texto);
		toast.success("Copiado");
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(abierto) => (abierto ? onOpenChange(true) : cerrar())}
		>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Agregar manualmente de WeeTrust</DialogTitle>
					<DialogDescription>
						Para "{contractName}", con las firmas puestas a mano en WeeTrust.
					</DialogDescription>
				</DialogHeader>

				<div className="min-w-0 space-y-4 text-sm">
					{faltaVincular ? (
						<p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
							Este contrato no salió a firma: no se encontraron los espacios de
							firma en el PDF que subió jurídico. Nadie tiene enlaces todavía.
						</p>
					) : guia.data?.reemplaza ? (
						<p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
							Este contrato ya tiene un documento en WeeTrust. Al agregar otro,
							ése se borra: sus enlaces dejan de servir y lo que ya se haya
							firmado ahí se pierde.
						</p>
					) : null}

					<ol className="list-decimal space-y-3 pl-5">
						<li>
							<div className="flex flex-wrap items-center gap-2">
								<span>Bajá el PDF del contrato.</span>
								{pdfUrl && (
									<Button variant="outline" size="sm" asChild className="h-7">
										<a href={pdfUrl} target="_blank" rel="noopener noreferrer">
											<FileText className="mr-1 h-3 w-3" />
											Descargar PDF
										</a>
									</Button>
								)}
							</div>
						</li>
						<li>
							<p>
								Subilo a WeeTrust y agregá como firmantes a estas personas,{" "}
								<strong>con estos correos exactos</strong>: con el correo se
								reconoce a cada una al agregarlo.
							</p>
							{guia.isLoading ? (
								<p className="mt-2 flex items-center gap-1 text-muted-foreground text-xs">
									<Loader2 className="h-3 w-3 animate-spin" />
									Cargando firmantes…
								</p>
							) : guia.error ? (
								<p className="mt-2 text-destructive text-xs">
									{(guia.error as Error).message}
								</p>
							) : (
								<div className="mt-2 overflow-x-auto rounded-md border">
									<table className="w-full text-xs">
										<thead className="bg-muted/50 text-muted-foreground">
											<tr>
												<th className="px-2 py-1 text-left font-medium">
													Firma como
												</th>
												<th className="px-2 py-1 text-left font-medium">
													Nombre
												</th>
												<th className="px-2 py-1 text-left font-medium">
													Correo
												</th>
												<th className="px-2 py-1 text-left font-medium">
													Verificación
												</th>
											</tr>
										</thead>
										<tbody>
											{guia.data?.firmantes.map((f) => (
												<tr key={f.correo} className="border-t">
													<td className="px-2 py-1">{rol(f.role)}</td>
													<td className="px-2 py-1">{f.nombre}</td>
													<td className="px-2 py-1">
														<span className="inline-flex items-center gap-1">
															<span className="break-all">{f.correo}</span>
															<Button
																variant="ghost"
																size="sm"
																className="h-5 w-5 shrink-0 p-0"
																title="Copiar el correo"
																onClick={() => copiar(f.correo)}
															>
																<Copy className="h-3 w-3" />
															</Button>
														</span>
													</td>
													<td className="px-2 py-1">{f.verificacion}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
							<p className="mt-1 text-muted-foreground text-xs">
								La verificación no se puede comprobar desde acá: WeeTrust no
								dice cuál se pidió. Ponela al agregar a cada uno.
							</p>
						</li>
						<li>Poné la firma de cada uno en su lugar y mandalo a firmar.</li>
						<li>
							<p>
								Pegá acá el <strong>enlace de firma</strong> de cualquiera de
								ellos: es el que WeeTrust le manda por correo a cada firmante, y
								empieza con{" "}
								<code className="rounded bg-muted px-1">
									https://app.weetrust.mx/signatory/
								</code>
								. También sirve el ID del documento.
							</p>
							<div className="mt-2 flex gap-2">
								<div className="min-w-0 flex-1">
									<Label htmlFor="enlace-weetrust" className="sr-only">
										Enlace del documento en WeeTrust
									</Label>
									<Input
										id="enlace-weetrust"
										value={enlace}
										onChange={(e) => setEnlace(e.target.value)}
										placeholder="https://app.weetrust.mx/signatory/…"
										disabled={ocupado}
									/>
								</div>
								<Button
									variant="outline"
									disabled={!enlace.trim() || ocupado}
									onClick={() => revisar.mutate()}
								>
									{revisar.isPending && (
										<Loader2 className="mr-1 h-4 w-4 animate-spin" />
									)}
									Revisar
								</Button>
							</div>
						</li>
					</ol>

					{revision && (
						<div className="space-y-2 rounded-md border p-3">
							<p className="font-medium text-xs">
								En WeeTrust ({revision.estado}):
							</p>
							{revision.firmantes.length > 0 && (
								<ul className="space-y-1 text-xs">
									{revision.firmantes.map((f) => (
										<li key={f.correo} className="flex items-center gap-1.5">
											{f.firmo ? (
												<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
											) : (
												<Clock className="h-3.5 w-3.5 text-muted-foreground" />
											)}
											<span className="font-medium">{rol(f.role)}</span>
											<span className="text-muted-foreground">
												{f.nombre} · {f.firmo ? "ya firmó" : "pendiente"}
											</span>
										</li>
									))}
								</ul>
							)}
							{revision.faltan.length > 0 && !revision.problema && (
								<p className="flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-400">
									<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									No están en el documento:{" "}
									{revision.faltan
										.map((f) => `${f.nombre} (${rol(f.role)})`)
										.join(", ")}
									. Si este documento no los lleva, podés agregarlo igual.
								</p>
							)}
							{revision.problema && (
								<p className="flex items-start gap-1.5 text-destructive text-xs">
									<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									{revision.problema}
								</p>
							)}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={cerrar}
						disabled={confirmar.isPending}
					>
						Cancelar
					</Button>
					<Button
						disabled={!revision || Boolean(revision.problema) || ocupado}
						onClick={() => confirmar.mutate()}
						title={
							revision ? undefined : "Primero revisá el enlace del documento"
						}
					>
						{confirmar.isPending ? (
							<Loader2 className="mr-1 h-4 w-4 animate-spin" />
						) : (
							<Link2 className="mr-1 h-4 w-4" />
						)}
						Agregar
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

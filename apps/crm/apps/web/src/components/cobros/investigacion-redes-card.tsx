/**
 * CB-039 · Investigación en redes sociales del caso, en la Ficha 360.
 *
 * Arriba el botón "Registrar investigación" (solo en los buckets que permite
 * el servidor; fuera de ellos queda apagado con el motivo a la vista) y abajo
 * el historial: el hallazgo como protagonista, quién/cuándo en una línea
 * chica, el enlace como chip y las capturas en miniaturas que se abren en un
 * visor dentro de la ficha. El historial se ve en cualquier bucket.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	FileText,
	Link2,
	Loader2,
	Search,
} from "lucide-react";
import { useState } from "react";
import {
	etiquetaFuenteInvestigacion,
	etiquetaResultadoInvestigacion,
	textoBucketsInvestigacion,
} from "server/src/lib/investigaciones-redes-cobros";
import { InvestigacionRedesDialog } from "@/components/cobros/investigacion-redes-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { type client, orpc } from "@/utils/orpc";

type Investigacion = Awaited<
	ReturnType<typeof client.getInvestigacionesRedesCaso>
>["investigaciones"][number];
type Evidencia = Investigacion["evidencias"][number];

const POR_PAGINA = 20;
const MAX_INVESTIGACIONES = 100;
/** Miniaturas visibles antes del "+N". */
const MINIATURAS_VISIBLES = 3;
/** Más que esto (caracteres o renglones) se recorta con "Ver más". */
const HALLAZGOS_LARGO = 240;
const HALLAZGOS_RENGLONES = 4;

const fechaHora = (v: Date | string) =>
	new Date(v).toLocaleString("es-GT", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

/** "facebook.com/juan" en vez de la URL completa, para el chip. */
function textoEnlace(url: string): string {
	try {
		const u = new URL(url);
		const resto = `${u.pathname}${u.search}`.replace(/\/$/, "");
		return `${u.hostname.replace(/^www\./, "")}${resto}`;
	} catch {
		return url;
	}
}

const esImagen = (e: Evidencia) => e.mimeType.startsWith("image/");

/** Visor de capturas: una por una, con flechas, sin salir de la ficha. */
function VisorCapturas({
	imagenes,
	indice,
	onCambiar,
	onCerrar,
}: {
	imagenes: Array<Evidencia & { url: string }>;
	indice: number | null;
	onCambiar: (indice: number) => void;
	onCerrar: () => void;
}) {
	const actual = indice !== null ? imagenes[indice] : null;
	const total = imagenes.length;
	const ir = (delta: number) => {
		if (indice === null || total === 0) return;
		onCambiar((indice + delta + total) % total);
	};

	return (
		<Dialog open={actual !== null} onOpenChange={(a) => !a && onCerrar()}>
			{actual && (
				<DialogContent
					className="max-w-4xl gap-3"
					onKeyDown={(e) => {
						if (e.key === "ArrowLeft") ir(-1);
						if (e.key === "ArrowRight") ir(1);
					}}
				>
					<DialogTitle className="truncate pr-8 text-sm">
						{actual.nombreArchivo}
					</DialogTitle>
					<DialogDescription className="sr-only">
						Captura {(indice ?? 0) + 1} de {total}
					</DialogDescription>
					<div className="relative flex items-center justify-center rounded-md bg-muted">
						<img
							src={actual.url}
							alt={actual.nombreArchivo}
							className="max-h-[70vh] w-auto max-w-full object-contain"
						/>
						{total > 1 && (
							<>
								<Button
									type="button"
									size="icon"
									variant="secondary"
									aria-label="Captura anterior"
									className="absolute left-2 rounded-full"
									onClick={() => ir(-1)}
								>
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<Button
									type="button"
									size="icon"
									variant="secondary"
									aria-label="Captura siguiente"
									className="absolute right-2 rounded-full"
									onClick={() => ir(1)}
								>
									<ChevronRight className="h-4 w-4" />
								</Button>
							</>
						)}
					</div>
					<div className="flex items-center justify-between text-muted-foreground text-xs">
						<span>
							{(indice ?? 0) + 1} de {total}
						</span>
						<a
							href={actual.url}
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1 text-primary hover:underline"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Abrir original
						</a>
					</div>
				</DialogContent>
			)}
		</Dialog>
	);
}

function Capturas({ evidencias }: { evidencias: Evidencia[] }) {
	const [verTodas, setVerTodas] = useState(false);
	const [visor, setVisor] = useState<number | null>(null);

	const conUrl = evidencias.filter(
		(e): e is Evidencia & { url: string } => e.url !== null,
	);
	if (conUrl.length === 0) return null;

	const imagenes = conUrl.filter(esImagen);
	const ocultas = verTodas ? 0 : conUrl.length - MINIATURAS_VISIBLES;
	const visibles = verTodas ? conUrl : conUrl.slice(0, MINIATURAS_VISIBLES);

	return (
		<>
			<div className="flex flex-wrap gap-2 pt-1">
				{visibles.map((e) => {
					const clase =
						"flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border bg-muted transition hover:ring-2 hover:ring-primary/40";
					return esImagen(e) ? (
						<button
							key={e.id}
							type="button"
							className={clase}
							title={e.nombreArchivo}
							onClick={() => setVisor(imagenes.findIndex((i) => i.id === e.id))}
						>
							<img
								src={e.url}
								alt={e.nombreArchivo}
								loading="lazy"
								className="h-full w-full object-cover"
							/>
						</button>
					) : (
						<a
							key={e.id}
							href={e.url}
							target="_blank"
							rel="noreferrer noopener"
							className={cn(clase, "flex-col gap-1 p-1 text-center")}
							title={e.nombreArchivo}
						>
							<FileText className="h-7 w-7" />
							<span className="line-clamp-2 break-all text-[11px]">
								{e.nombreArchivo}
							</span>
						</a>
					);
				})}
				{ocultas > 0 && (
					<button
						type="button"
						className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed font-medium text-muted-foreground text-sm hover:bg-muted"
						onClick={() => setVerTodas(true)}
					>
						+{ocultas}
					</button>
				)}
			</div>
			<VisorCapturas
				imagenes={imagenes}
				indice={visor}
				onCambiar={setVisor}
				onCerrar={() => setVisor(null)}
			/>
		</>
	);
}

function Hallazgos({ texto }: { texto: string }) {
	const [expandido, setExpandido] = useState(false);
	const largo =
		texto.length > HALLAZGOS_LARGO ||
		texto.split("\n").length > HALLAZGOS_RENGLONES;

	return (
		<div>
			<p
				className={cn(
					"whitespace-pre-wrap text-base leading-snug",
					largo && !expandido && "line-clamp-3",
				)}
			>
				{texto}
			</p>
			{largo && (
				<button
					type="button"
					className="mt-1 text-primary text-xs hover:underline"
					onClick={() => setExpandido((v) => !v)}
				>
					{expandido ? "Ver menos" : "Ver más"}
				</button>
			)}
		</div>
	);
}

function FilaInvestigacion({ i }: { i: Investigacion }) {
	const conHallazgos = i.resultado === "con_hallazgos";
	return (
		<li className="space-y-2 rounded-md border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-semibold text-sm">
					{etiquetaFuenteInvestigacion(i.fuente, i.fuenteOtra)}
				</span>
				<Badge
					variant="secondary"
					className={cn(
						conHallazgos
							? "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
							: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
					)}
				>
					{etiquetaResultadoInvestigacion(i.resultado)}
				</Badge>
			</div>
			<Hallazgos texto={i.hallazgos} />
			{i.enlacePerfil && (
				<a
					href={i.enlacePerfil}
					target="_blank"
					rel="noreferrer noopener"
					title={i.enlacePerfil}
					className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-primary text-xs hover:bg-muted"
				>
					<Link2 className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">{textoEnlace(i.enlacePerfil)}</span>
				</a>
			)}
			<Capturas evidencias={i.evidencias} />
			<p className="text-muted-foreground text-xs">
				{i.registradaPor ?? "Usuario desconocido"}
				{i.bucketSnapshot !== null ? ` · B${i.bucketSnapshot}` : ""} ·{" "}
				{fechaHora(i.fechaInvestigacion)}
			</p>
		</li>
	);
}

export function InvestigacionRedesCard({
	casoCobroId,
}: {
	casoCobroId: string;
}) {
	const [dialogoAbierto, setDialogoAbierto] = useState(false);
	const [limite, setLimite] = useState(POR_PAGINA);

	const consulta = useQuery(
		orpc.getInvestigacionesRedesCaso.queryOptions({
			input: { casoCobroId, limite },
			placeholderData: keepPreviousData,
		}),
	);
	const datos = consulta.data;

	return (
		<Card>
			<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
				<CardTitle className="flex items-center gap-2 text-base">
					<Search className="h-4 w-4" />
					Investigación en redes sociales
				</CardTitle>
				<Button
					size="sm"
					onClick={() => setDialogoAbierto(true)}
					disabled={!datos?.permiteRegistrar}
				>
					Registrar investigación
				</Button>
			</CardHeader>
			<CardContent className="space-y-3">
				{datos && !datos.permiteRegistrar && datos.motivoBloqueo && (
					<p className="text-muted-foreground text-xs">{datos.motivoBloqueo}</p>
				)}
				{datos?.permiteRegistrar && (
					<p className="text-muted-foreground text-xs">
						Disponible en {textoBucketsInvestigacion()}. Solo información
						pública del cliente.
					</p>
				)}

				{consulta.isLoading ? (
					<div className="flex justify-center py-3">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : consulta.isError ? (
					<p className="text-destructive text-sm">
						No se pudo cargar el historial de investigaciones.
					</p>
				) : datos && datos.investigaciones.length > 0 ? (
					<>
						<ul className="space-y-2">
							{datos.investigaciones.map((i) => (
								<FilaInvestigacion i={i} key={i.id} />
							))}
						</ul>
						{datos.hayMas && limite < MAX_INVESTIGACIONES && (
							<Button
								disabled={consulta.isPlaceholderData}
								onClick={() =>
									setLimite((l) =>
										Math.min(l + POR_PAGINA, MAX_INVESTIGACIONES),
									)
								}
								size="sm"
								variant="outline"
							>
								Ver más investigaciones
							</Button>
						)}
						{limite >= MAX_INVESTIGACIONES && datos.hayMas && (
							<p className="text-muted-foreground text-xs">
								Mostrando las {MAX_INVESTIGACIONES} investigaciones más
								recientes.
							</p>
						)}
					</>
				) : (
					<p className="text-muted-foreground text-sm italic">
						Todavía no se registró ninguna investigación en este caso.
					</p>
				)}
			</CardContent>

			<InvestigacionRedesDialog
				open={dialogoAbierto}
				onOpenChange={setDialogoAbierto}
				casoCobroId={casoCobroId}
			/>
		</Card>
	);
}

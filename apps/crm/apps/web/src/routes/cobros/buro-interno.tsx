import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	History,
	Loader2,
	MoreHorizontal,
	Pencil,
	Plus,
	Search,
	ShieldBan,
	UserX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	ETIQUETA_ACCION,
	etiquetaCategoria,
	formatearFecha,
	formatearFechaHora,
	type RegistroBuroInterno,
} from "@/components/buro-interno/buro-interno-labels";
import { ConsultaBuroInterno } from "@/components/buro-interno/ConsultaBuroInterno";
import { RegistroBuroInternoDialog } from "@/components/buro-interno/RegistroBuroInternoDialog";
import { ReglasBuroInterno } from "@/components/buro-interno/ReglasBuroInterno";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/buro-interno")({
	component: BuroInternoPage,
});

const POR_PAGINA = 25;
const MOTIVO_MIN = 10;

type Estado = "activos" | "inactivos" | "todos";

function invalidarListado() {
	queryClient.invalidateQueries({ queryKey: orpc.listBuroInterno.key() });
}

function BajaDialog({
	registro,
	onClose,
}: {
	registro: RegistroBuroInterno | null;
	onClose: () => void;
}) {
	const [motivo, setMotivo] = useState("");

	const cerrar = () => {
		setMotivo("");
		onClose();
	};

	const baja = useMutation({
		mutationFn: () =>
			client.desactivarRegistroBuroInterno({
				id: registro?.id ?? "",
				motivo,
			}),
		onSuccess: () => {
			toast.success("Se quitó del buró interno");
			invalidarListado();
			cerrar();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<Dialog open={Boolean(registro)} onOpenChange={(open) => !open && cerrar()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Quitar del buró interno</DialogTitle>
					<DialogDescription>
						Vas a sacar a {registro?.nombres} {registro?.apellidos} de la lista
						negra.
					</DialogDescription>
				</DialogHeader>
				<ul className="list-disc space-y-1 pl-5 text-sm">
					<li>
						Deja de aparecer como alerta en el análisis de créditos nuevos y en
						las consultas.
					</li>
					<li>
						No se borra: queda en el filtro "Retirados", con quién lo quitó,
						cuándo y por qué.
					</li>
					<li>Si vuelve a haber problemas, se registra de nuevo.</li>
				</ul>
				<div className="space-y-2">
					<Label htmlFor="motivo-retiro">¿Por qué se quita? *</Label>
					<Textarea
						id="motivo-retiro"
						rows={3}
						placeholder="Ej.: canceló toda la deuda, se registró por error, era otra persona"
						value={motivo}
						onChange={(e) => setMotivo(e.target.value)}
					/>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={cerrar}>
						Cancelar
					</Button>
					<Button
						variant="destructive"
						disabled={motivo.trim().length < MOTIVO_MIN || baja.isPending}
						onClick={() => baja.mutate()}
					>
						{baja.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Quitar del buró interno
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function HistorialDialog({
	registro,
	onClose,
}: {
	registro: RegistroBuroInterno | null;
	onClose: () => void;
}) {
	const historial = useQuery({
		...orpc.getHistorialBuroInterno.queryOptions({
			input: { id: registro?.id ?? "" },
		}),
		enabled: Boolean(registro),
	});

	return (
		<Dialog
			open={Boolean(registro)}
			onOpenChange={(open) => !open && onClose()}
		>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Historial</DialogTitle>
					<DialogDescription>
						{registro?.nombres} {registro?.apellidos}
					</DialogDescription>
				</DialogHeader>
				{historial.isLoading ? (
					<Skeleton className="h-24 w-full" />
				) : (
					<ul className="max-h-96 space-y-3 overflow-y-auto">
						{historial.data?.map((evento) => (
							<li key={evento.id} className="rounded-md border p-3 text-sm">
								<div className="flex items-center justify-between gap-2">
									<Badge variant="secondary">
										{ETIQUETA_ACCION[evento.accion] ?? evento.accion}
									</Badge>
									<span className="text-muted-foreground text-xs">
										{formatearFechaHora(evento.createdAt)}
									</span>
								</div>
								<p className="mt-2 text-muted-foreground text-xs">
									{evento.realizadoPorNombre ?? "—"}
								</p>
								{evento.accion === "baja" &&
									typeof evento.detalle?.motivo === "string" && (
										<p className="mt-1">{evento.detalle.motivo}</p>
									)}
								{evento.accion === "edicion" &&
									typeof evento.detalle?.despues === "object" &&
									evento.detalle.despues !== null && (
										<p className="mt-1 text-muted-foreground text-xs">
											Cambió: {Object.keys(evento.detalle.despues).join(", ")}
										</p>
									)}
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}

function RegistrosTab({ puedeDarDeBaja }: { puedeDarDeBaja: boolean }) {
	const [busqueda, setBusqueda] = useState("");
	const [busquedaAplicada, setBusquedaAplicada] = useState("");
	const [estado, setEstado] = useState<Estado>("activos");
	const [pagina, setPagina] = useState(0);
	const [dialogoAlta, setDialogoAlta] = useState(false);
	const [editando, setEditando] = useState<RegistroBuroInterno | null>(null);
	const [dandoDeBaja, setDandoDeBaja] = useState<RegistroBuroInterno | null>(
		null,
	);
	const [viendoHistorial, setViendoHistorial] =
		useState<RegistroBuroInterno | null>(null);

	useEffect(() => {
		const t = setTimeout(() => {
			setBusquedaAplicada(busqueda.trim());
			setPagina(0);
		}, 400);
		return () => clearTimeout(t);
	}, [busqueda]);

	const listado = useQuery(
		orpc.listBuroInterno.queryOptions({
			input: {
				busqueda: busquedaAplicada || undefined,
				estado,
				limit: POR_PAGINA,
				offset: pagina * POR_PAGINA,
			},
		}),
	);

	const total = listado.data?.total ?? 0;
	const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

	// Si una baja deja vacía la página actual, volver a la última con registros
	useEffect(() => {
		if (!listado.data) return;
		const ultima = Math.max(0, Math.ceil(listado.data.total / POR_PAGINA) - 1);
		if (pagina > ultima) setPagina(ultima);
	}, [listado.data, pagina]);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-1 flex-wrap items-center gap-3">
					<div className="relative w-full max-w-sm">
						<Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
						<Input
							className="pl-9"
							placeholder="Nombre, DPI, SIFCO o teléfono"
							value={busqueda}
							onChange={(e) => setBusqueda(e.target.value)}
						/>
					</div>
					<Select
						value={estado}
						onValueChange={(v) => {
							setEstado(v as Estado);
							setPagina(0);
						}}
					>
						<SelectTrigger className="w-36">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="activos">Activos</SelectItem>
							<SelectItem value="inactivos">Retirados</SelectItem>
							<SelectItem value="todos">Todos</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<Button onClick={() => setDialogoAlta(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Agregar persona
				</Button>
			</div>

			<Card>
				<CardContent className="p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Persona</TableHead>
								<TableHead>Categoría</TableHead>
								<TableHead className="hidden lg:table-cell">Motivo</TableHead>
								<TableHead className="hidden md:table-cell">
									Registrado
								</TableHead>
								<TableHead className="w-[1%]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{listado.isLoading &&
								[0, 1, 2].map((i) => (
									<TableRow key={i}>
										<TableCell colSpan={5}>
											<Skeleton className="h-8 w-full" />
										</TableCell>
									</TableRow>
								))}

							{listado.data?.items.length === 0 && (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-10 text-center text-muted-foreground"
									>
										{busquedaAplicada
											? "Nadie coincide con la búsqueda."
											: "Todavía no hay personas en el buró interno."}
									</TableCell>
								</TableRow>
							)}

							{listado.data?.items.map((registro) => (
								<TableRow
									key={registro.id}
									className={registro.activo ? "" : "opacity-60"}
								>
									<TableCell>
										<p className="font-medium">
											{registro.nombres} {registro.apellidos}
										</p>
										<p className="text-muted-foreground text-xs">
											{[
												registro.dpi && `DPI ${registro.dpi}`,
												registro.numeroCreditoSifco &&
													`SIFCO ${registro.numeroCreditoSifco}`,
												registro.telefono && `Tel. ${registro.telefono}`,
											]
												.filter(Boolean)
												.join(" · ")}
										</p>
									</TableCell>
									<TableCell>
										<div className="flex flex-col items-start gap-1">
											<Badge variant="outline">
												{etiquetaCategoria(registro.categoria)}
											</Badge>
											{!registro.activo && (
												<>
													<Badge variant="secondary">Retirado</Badge>
													<p className="max-w-56 text-muted-foreground text-xs">
														Por {registro.desactivadoPorNombre ?? "—"} el{" "}
														{formatearFecha(registro.desactivadoAt)}
														{registro.motivoDesactivacion &&
															`: ${registro.motivoDesactivacion}`}
													</p>
												</>
											)}
										</div>
									</TableCell>
									<TableCell className="hidden max-w-md lg:table-cell">
										<p className="line-clamp-2 text-sm">{registro.motivo}</p>
									</TableCell>
									<TableCell className="hidden text-sm md:table-cell">
										<p>{formatearFecha(registro.createdAt)}</p>
										<p className="text-muted-foreground text-xs">
											{registro.creadoPorNombre ?? "—"}
										</p>
									</TableCell>
									<TableCell>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													aria-label="Acciones"
												>
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" className="w-56">
												<DropdownMenuItem
													onSelect={() => setViendoHistorial(registro)}
												>
													<History className="mr-2 h-4 w-4" />
													Ver historial
												</DropdownMenuItem>
												{registro.activo && (
													<DropdownMenuItem
														onSelect={() => setEditando(registro)}
													>
														<Pencil className="mr-2 h-4 w-4" />
														Editar datos o motivo
													</DropdownMenuItem>
												)}
												{registro.activo && puedeDarDeBaja && (
													<>
														<DropdownMenuSeparator />
														<DropdownMenuItem
															className="text-red-600 focus:text-red-600"
															onSelect={() => setDandoDeBaja(registro)}
														>
															<UserX className="mr-2 h-4 w-4" />
															Quitar del buró interno
														</DropdownMenuItem>
													</>
												)}
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{total > POR_PAGINA && (
				<div className="flex items-center justify-end gap-3 text-sm">
					<span className="text-muted-foreground">
						Página {pagina + 1} de {paginas} · {total} registros
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={pagina === 0}
						onClick={() => setPagina((p) => p - 1)}
					>
						Anterior
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={pagina + 1 >= paginas}
						onClick={() => setPagina((p) => p + 1)}
					>
						Siguiente
					</Button>
				</div>
			)}

			<RegistroBuroInternoDialog
				open={dialogoAlta || Boolean(editando)}
				registro={editando}
				onOpenChange={(open) => {
					if (!open) {
						setDialogoAlta(false);
						setEditando(null);
					}
				}}
				onGuardado={invalidarListado}
			/>
			<BajaDialog registro={dandoDeBaja} onClose={() => setDandoDeBaja(null)} />
			<HistorialDialog
				registro={viendoHistorial}
				onClose={() => setViendoHistorial(null)}
			/>
		</div>
	);
}

function BuroInternoPage() {
	const { data: session, isPending } = authClient.useSession();
	const userRole = session?.user?.role;

	if (isPending) {
		return (
			<div className="container mx-auto p-6">
				<Skeleton className="h-10 w-64" />
			</div>
		);
	}

	if (!userRole || !PERMISSIONS.canAccessBuroInterno(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						El buró interno es solo para el equipo de cobros.
					</p>
				</div>
			</div>
		);
	}

	const puedeSupervisar = PERMISSIONS.canManageBuroInterno(userRole);

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-start gap-3">
				<ShieldBan className="mt-1 h-7 w-7 text-red-600" />
				<div>
					<h1 className="font-bold text-3xl">Buró interno</h1>
					<p className="text-muted-foreground">
						Personas con las que no conviene volver a trabajar. Análisis las ve
						cuando llega una solicitud de ellas o de alguien que se les parece.
					</p>
				</div>
			</div>

			<Tabs defaultValue="registros">
				<TabsList>
					<TabsTrigger value="registros">Registros</TabsTrigger>
					<TabsTrigger value="consultar">Consultar</TabsTrigger>
					<TabsTrigger value="reglas">Reglas de coincidencia</TabsTrigger>
				</TabsList>
				<TabsContent value="registros" className="pt-4">
					<RegistrosTab puedeDarDeBaja={puedeSupervisar} />
				</TabsContent>
				<TabsContent value="consultar" className="pt-4">
					<ConsultaBuroInterno />
				</TabsContent>
				<TabsContent value="reglas" className="pt-4">
					<ReglasBuroInterno puedeEditar={puedeSupervisar} />
				</TabsContent>
			</Tabs>
		</div>
	);
}

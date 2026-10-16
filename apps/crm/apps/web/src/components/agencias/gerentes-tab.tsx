import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Plus, Power } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	avisoCuentaSuspendida,
	cerrarSiSePuede,
	type DatosCrearGerente,
	correoValido,
	esUltimoGerenteActivo,
	mensajeDeError,
	reintentoConfirmado,
	requiereConfirmacionPromocion,
} from "@/lib/gerentes-agencia";
import { client, orpc } from "@/utils/orpc";

type Gerente = Awaited<ReturnType<typeof client.getGerentesDeAgencia>>[number];

/** Pestaña «Gerentes» del detalle de una agencia. */
export function GerentesTab({ companyId }: { companyId: string }) {
	const queryClient = useQueryClient();
	const [creando, setCreando] = useState(false);
	const [verId, setVerId] = useState<string | null>(null);
	const [aCambiar, setACambiar] = useState<Gerente | null>(null);
	const [contrasena, setContrasena] = useState<string | null>(null);

	const gerentesQuery = useQuery(
		orpc.getGerentesDeAgencia.queryOptions({ input: { companyId } }),
	);
	const gerentes = gerentesQuery.data ?? [];

	const invalidar = () => {
		queryClient.invalidateQueries({ queryKey: orpc.getGerentesDeAgencia.key() });
		queryClient.invalidateQueries({ queryKey: orpc.getGerenteDeAgencia.key() });
	};

	const cambiarEstado = useMutation({
		mutationFn: (g: Gerente) =>
			client.editarGerenteDeAgencia({ companyId, userId: g.id, activa: !g.activa }),
		onSuccess: (_, g) => {
			invalidar();
			toast.success(g.activa ? "Gerente desactivado" : "Gerente activado");
			setACambiar(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const ultimo = aCambiar ? esUltimoGerenteActivo(gerentes, aCambiar.id) : false;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">
					Un gerente ve y administra a todo el equipo de esta agencia.
				</p>
				<Button size="sm" onClick={() => setCreando(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Nuevo gerente
				</Button>
			</div>

			{gerentesQuery.isPending ? (
				<div className="text-sm">Cargando gerentes...</div>
			) : gerentesQuery.error ? (
				<div className="text-red-500 text-sm">
					No se pudieron cargar los gerentes: {gerentesQuery.error.message}
				</div>
			) : gerentes.length === 0 ? (
				<p className="py-6 text-center text-muted-foreground text-sm">
					Esta agencia no tiene gerentes. Agrega el primero con «Nuevo gerente».
				</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Gerente</TableHead>
							<TableHead>Estado</TableHead>
							<TableHead className="text-right">Acciones</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{gerentes.map((g) => (
							<TableRow key={g.id}>
								<TableCell>
									<div className="font-medium">{g.nombre}</div>
									<div className="text-muted-foreground text-sm">{g.correo}</div>
								</TableCell>
								<TableCell>
									<Badge variant={g.activa ? "default" : "secondary"}>
										{g.activa ? "Activo" : "Inactivo"}
									</Badge>
									{g.cuentaSuspendida && (
										<Badge variant="destructive" className="ml-1">
											Cuenta suspendida
										</Badge>
									)}
								</TableCell>
								<TableCell className="space-x-2 text-right">
									<Button variant="outline" size="sm" onClick={() => setVerId(g.id)}>
										<Eye className="mr-1 h-4 w-4" />
										Ver
									</Button>
									<Button variant="outline" size="sm" onClick={() => setACambiar(g)}>
										<Power className="mr-1 h-4 w-4" />
										{g.activa ? "Desactivar" : "Activar"}
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<CrearGerenteDialog
				open={creando}
				onOpenChange={setCreando}
				companyId={companyId}
				alCrear={(temporal) => {
					invalidar();
					setCreando(false);
					if (temporal) setContrasena(temporal);
				}}
			/>

			<VerGerenteDialog
				companyId={companyId}
				userId={verId}
				onClose={() => setVerId(null)}
				alEditar={invalidar}
			/>

			<AlertDialog
				open={!!aCambiar}
				onOpenChange={(o) => {
					if (!o) cerrarSiSePuede(cambiarEstado.isPending, () => setACambiar(null));
				}}
			>
				<AlertDialogContent
					onEscapeKeyDown={(e) => {
						if (cambiarEstado.isPending) e.preventDefault();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{aCambiar?.activa ? "Desactivar" : "Activar"} a {aCambiar?.nombre}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{aCambiar?.activa
								? "Dejará de entrar a esta agencia en el tracker. Sus otras agencias no cambian."
								: "Volverá a entrar a esta agencia en el tracker."}
							{aCambiar && !aCambiar.activa && avisoCuentaSuspendida(aCambiar) && (
								<span className="mt-2 block font-medium text-amber-700">
									{avisoCuentaSuspendida(aCambiar)}
								</span>
							)}
							{ultimo && (
								<span className="mt-2 block font-medium text-red-600">
									Es el último gerente activo: la agencia se queda sin quien
									administre a su equipo.
								</span>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={cambiarEstado.isPending}>
							Cancelar
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={cambiarEstado.isPending}
							onClick={(e) => {
								e.preventDefault();
								if (aCambiar) cambiarEstado.mutate(aCambiar);
							}}
						>
							{aCambiar?.activa ? "Desactivar" : "Activar"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* La contraseña no se puede recuperar: solo se cierra con «Ya la copié». */}
			<Dialog open={!!contrasena} onOpenChange={() => {}}>
				<DialogContent
					showCloseButton={false}
					onEscapeKeyDown={(e) => e.preventDefault()}
					onInteractOutside={(e) => e.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle>Contraseña temporal</DialogTitle>
						<DialogDescription>
							Cópiala ahora: no se vuelve a mostrar. El gerente deberá cambiarla en
							su primer ingreso.
						</DialogDescription>
					</DialogHeader>
					<div className="flex gap-2">
						<Input readOnly value={contrasena ?? ""} className="font-mono" />
						<Button
							onClick={() => {
								navigator.clipboard
									.writeText(contrasena ?? "")
									.then(() => toast.success("Contraseña copiada"))
									.catch(() => toast.error("No se pudo copiar"));
							}}
						>
							<Copy className="mr-2 h-4 w-4" />
							Copiar
						</Button>
					</div>
					<div className="flex justify-end">
						<Button variant="outline" onClick={() => setContrasena(null)}>
							Ya la copié
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function CrearGerenteDialog({
	open,
	onOpenChange,
	companyId,
	alCrear,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	companyId: string;
	/** `temporal` viene vacío cuando el correo ya tenía cuenta. */
	alCrear: (temporal: string | null) => void;
}) {
	const [nombre, setNombre] = useState("");
	const [correo, setCorreo] = useState("");
	// Se guarda lo que se envió: Confirmar reintenta eso, no lo que el formulario
	// diga cuando se responda la advertencia.
	const [confirmar, setConfirmar] = useState<{
		mensaje: string;
		enviado: DatosCrearGerente;
	} | null>(null);

	const reset = () => {
		setNombre("");
		setCorreo("");
		setConfirmar(null);
	};

	const crear = useMutation({
		mutationFn: (datos: DatosCrearGerente) =>
			client.crearGerenteDeAgencia({ companyId, ...datos }),
		onSuccess: (r) => {
			if ("yaExistia" in r) {
				toast.success(
					"Ese correo ya tenía cuenta: ahora es gerente de la agencia y entra con su contraseña de siempre",
				);
				alCrear(null);
			} else {
				alCrear(r.contrasenaTemporal);
			}
			reset();
		},
		onError: (e, enviado) => {
			if (requiereConfirmacionPromocion(e)) {
				setConfirmar({ mensaje: e.message, enviado });
				return;
			}
			toast.error(mensajeDeError(e));
		},
	});

	// Única vía de cierre (X, Escape, clic afuera, Cancelar): con la petición en
	// vuelo no cierra, porque borraría el formulario y dejaría al usuario sin ver
	// el resultado (o la contraseña temporal).
	const cerrar = () =>
		cerrarSiSePuede(
			crear.isPending,
			() => onOpenChange(false),
			reset,
		);

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(o) => {
					if (o) onOpenChange(true);
					else cerrar();
				}}
			>
				<DialogContent
					showCloseButton={!crear.isPending}
					onEscapeKeyDown={(e) => {
						if (crear.isPending) e.preventDefault();
					}}
					onInteractOutside={(e) => {
						if (crear.isPending) e.preventDefault();
					}}
				>
					<DialogHeader>
						<DialogTitle>Nuevo gerente</DialogTitle>
						<DialogDescription>
							Si el correo ya tiene cuenta en el tracker, se le agrega esta agencia
							y entra con su contraseña.
						</DialogDescription>
					</DialogHeader>
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!nombre.trim()) return void toast.error("El nombre es obligatorio");
							if (!correoValido(correo)) return void toast.error("Correo inválido");
							crear.mutate({ nombre, correo, confirmarPromocion: false });
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="gerente-nombre">Nombre</Label>
							<Input
								id="gerente-nombre"
								value={nombre}
								onChange={(e) => setNombre(e.target.value)}
								disabled={crear.isPending}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="gerente-correo">Correo</Label>
							<Input
								id="gerente-correo"
								type="email"
								value={correo}
								onChange={(e) => setCorreo(e.target.value)}
								disabled={crear.isPending}
								required
							/>
						</div>
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								disabled={crear.isPending}
								onClick={cerrar}
							>
								Cancelar
							</Button>
							<Button type="submit" disabled={crear.isPending}>
								{crear.isPending ? "Creando..." : "Crear gerente"}
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Convertir en gerente?</AlertDialogTitle>
						<AlertDialogDescription>{confirmar?.mensaje}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (confirmar) crear.mutate(reintentoConfirmado(confirmar.enviado));
								setConfirmar(null);
							}}
						>
							Confirmar
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function VerGerenteDialog({
	companyId,
	userId,
	onClose,
	alEditar,
}: {
	companyId: string;
	userId: string | null;
	onClose: () => void;
	alEditar: () => void;
}) {
	const detalle = useQuery({
		...orpc.getGerenteDeAgencia.queryOptions({
			input: { companyId, userId: userId ?? "" },
		}),
		enabled: !!userId,
	});
	const [nombre, setNombre] = useState<string | null>(null);
	const g = detalle.data;
	const valor = nombre ?? g?.nombre ?? "";

	const guardar = useMutation({
		mutationFn: () =>
			client.editarGerenteDeAgencia({ companyId, userId: userId ?? "", nombre: valor }),
		onSuccess: () => {
			alEditar();
			toast.success("Nombre actualizado");
			setNombre(null);
		},
		onError: (e) => toast.error(mensajeDeError(e)),
	});

	return (
		<Dialog
			open={!!userId}
			onOpenChange={(o) => {
				if (!o) {
					cerrarSiSePuede(
						guardar.isPending,
						onClose,
						() => setNombre(null),
					);
				}
			}}
		>
			<DialogContent
				showCloseButton={!guardar.isPending}
				onEscapeKeyDown={(e) => {
					if (guardar.isPending) e.preventDefault();
				}}
				onInteractOutside={(e) => {
					if (guardar.isPending) e.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>Gerente</DialogTitle>
				</DialogHeader>
				{detalle.isPending ? (
					<div className="text-sm">Cargando...</div>
				) : detalle.error ? (
					<div className="text-red-500 text-sm">{detalle.error.message}</div>
				) : g ? (
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!valor.trim()) return void toast.error("El nombre es obligatorio");
							guardar.mutate();
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="gerente-ver-nombre">Nombre</Label>
							<Input
								id="gerente-ver-nombre"
								value={valor}
								onChange={(e) => setNombre(e.target.value)}
								disabled={guardar.isPending}
								required
							/>
						</div>
						<div className="space-y-1 text-sm">
							<div>
								<span className="text-muted-foreground">Correo: </span>
								{g.correo}
							</div>
							<div>
								<span className="text-muted-foreground">En esta agencia: </span>
								{g.activa ? "Activo" : "Inactivo"}
							</div>
						</div>
						<div className="flex justify-end">
							<Button
								type="submit"
								disabled={guardar.isPending || valor.trim() === g.nombre}
							>
								Guardar nombre
							</Button>
						</div>
					</form>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

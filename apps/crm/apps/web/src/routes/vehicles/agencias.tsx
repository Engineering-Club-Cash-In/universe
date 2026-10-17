import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building, Globe, Mail, MapPin, Pencil, Phone, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmpresaCrearDialog } from "@/components/agencias/empresa-crear-dialog";
import { EmpresaEditarDialog } from "@/components/agencias/empresa-editar-dialog";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/vehicles/agencias")({
	component: RouteComponent,
});

type Agencia = Awaited<ReturnType<typeof client.getAgencias>>[number];

function RouteComponent() {
	const {
		data: session,
		error: sessionError,
		isPending,
	} = authClient.useSession();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [busqueda, setBusqueda] = useState("");
	const [detalleId, setDetalleId] = useState<string | null>(null);
	const [editando, setEditando] = useState(false);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const rol = userProfile.data?.role;
	const puedeGestionar = !!rol && PERMISSIONS.canManageAgencies(rol);

	const agenciasQuery = useQuery({
		...orpc.getAgencias.queryOptions(),
		enabled: puedeGestionar && !!session?.user?.id,
	});

	const invalidar = () => {
		queryClient.invalidateQueries({ queryKey: orpc.getAgencias.key() });
		queryClient.invalidateQueries({ queryKey: orpc.getAgencia.key() });
	};

	useEffect(() => {
		if (shouldRedirectToLogin({ error: sessionError, isPending, session })) {
			navigate({ to: "/login" });
		} else if (session && rol && !puedeGestionar) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: solo admin y supervisor de ventas");
		}
	}, [session, sessionError, isPending, rol, puedeGestionar, navigate]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}
	if (!puedeGestionar) {
		return null;
	}

	const termino = busqueda.trim().toLowerCase();
	const agencias = (agenciasQuery.data ?? []).filter(
		(a) =>
			termino === "" ||
			a.name.toLowerCase().includes(termino) ||
			a.email?.toLowerCase().includes(termino) ||
			a.phone?.toLowerCase().includes(termino),
	);
	// El detalle se lee de la lista viva: al editar se refresca solo.
	const detalle = agenciasQuery.data?.find((a) => a.id === detalleId) ?? null;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Agencias</h1>
				<p className="text-muted-foreground">
					Crea y edita las agencias que usan el tracker
				</p>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Listado de agencias</CardTitle>
							<CardDescription>
								{agenciasQuery.data
									? `${agenciasQuery.data.length} agencias registradas`
									: "Cargando agencias..."}
							</CardDescription>
						</div>
						<EmpresaCrearDialog
							trigger={
								<Button>
									<Plus className="mr-2 h-4 w-4" />
									Nueva agencia
								</Button>
							}
							crear={(input) => client.crearAgencia(input)}
							alCrear={invalidar}
						/>
					</div>
				</CardHeader>
				<CardContent>
					<div className="relative mb-6">
						<Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Buscar por nombre, correo o teléfono..."
							value={busqueda}
							onChange={(e) => setBusqueda(e.target.value)}
							className="pl-8"
						/>
					</div>

					{agenciasQuery.isPending ? (
						<div>Cargando agencias...</div>
					) : agenciasQuery.error ? (
						<div className="text-red-500">
							No se pudieron cargar las agencias: {agenciasQuery.error.message}
						</div>
					) : agencias.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground">
							{termino
								? "Ninguna agencia coincide con la búsqueda."
								: "Todavía no hay agencias. Crea la primera con «Nueva agencia»."}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Agencia</TableHead>
									<TableHead>Contacto</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{agencias.map((a) => (
									<TableRow key={a.id}>
										<TableCell>
											<div className="flex items-center gap-2 font-medium">
												<Building className="h-4 w-4" />
												{a.name}
											</div>
											{a.address && (
												<div className="flex items-center gap-1 text-muted-foreground text-sm">
													<MapPin className="h-3 w-3" />
													{a.address}
												</div>
											)}
										</TableCell>
										<TableCell>
											{a.email && (
												<div className="flex items-center gap-1 text-sm">
													<Mail className="h-3 w-3" />
													{a.email}
												</div>
											)}
											{a.phone && (
												<div className="flex items-center gap-1 text-muted-foreground text-sm">
													<Phone className="h-3 w-3" />
													{a.phone}
												</div>
											)}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="outline"
												size="sm"
												onClick={() => {
													setDetalleId(a.id);
													setEditando(false);
												}}
											>
												Ver detalle
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={!!detalle && !editando}
				onOpenChange={(abierto) => {
					if (!abierto) setDetalleId(null);
				}}
			>
				<DialogContent className="max-w-xl">
					<DialogHeader>
						<DialogTitle>{detalle?.name}</DialogTitle>
					</DialogHeader>
					{detalle && (
						<div className="space-y-3 text-sm">
							<Dato icono={<Mail className="h-4 w-4" />} valor={detalle.email} />
							<Dato icono={<Phone className="h-4 w-4" />} valor={detalle.phone} />
							<Dato icono={<MapPin className="h-4 w-4" />} valor={detalle.address} />
							<Dato icono={<Globe className="h-4 w-4" />} valor={detalle.website} />
							{detalle.notes && (
								<p className="whitespace-pre-wrap text-muted-foreground">
									{detalle.notes}
								</p>
							)}
							<div className="flex justify-end pt-2">
								<Button onClick={() => setEditando(true)}>
									<Pencil className="mr-2 h-4 w-4" />
									Editar agencia
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			<EmpresaEditarDialog
				open={!!detalle && editando}
				onOpenChange={(abierto) => {
					if (!abierto) setEditando(false);
				}}
				empresa={detalle}
				editar={(input) => client.editarAgencia(input)}
				alEditar={invalidar}
			/>
		</div>
	);
}

function Dato({
	icono,
	valor,
}: {
	icono: React.ReactNode;
	valor: Agencia[keyof Agencia] | null | undefined;
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground">{icono}</span>
			{valor ? String(valor) : <span className="text-muted-foreground">Sin dato</span>}
		</div>
	);
}

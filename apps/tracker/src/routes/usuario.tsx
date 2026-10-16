import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Loader2, Lock, Pencil } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Encabezado } from "@/components/encabezado";
import { Ventana } from "@/components/ventana";
import { etiquetaDeRol } from "@/lib/perfil";
import {
	agenciasConAcciones,
	cambiosDeEdicion,
	estaActivo,
	LIMITES,
	puedeCerrarAlta,
	textoCambioEstado,
} from "@/lib/usuarios";
import { cn } from "@/lib/utils";
import { client, estadoDeConsulta, orpc, sinRepetirSiFalla } from "@/utils/orpc";

const inputClase =
	"w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-500";

type Edicion = {
	agenciaId: string;
	agencia: string;
	// Lo que había al abrir: se compara contra esto y no contra la consulta, que
	// el refetch puede actualizar con el cambio de otro gerente.
	nombre: string;
	telefono: string;
};
type Cambio = { agenciaId: string; agencia: string; activar: boolean };

export function UsuarioPage() {
	const { id } = useParams({ from: "/usuarios/$id" });
	const queryClient = useQueryClient();
	const consulta = useQuery({
		...orpc.getUsuarioDeMiAgencia.queryOptions({ input: { userId: id } }),
		// La página pinta su propia tarjeta (acceso / no encontrado): sin toast
		// duplicado ni consulta repetida cada minuto tras fallar.
		...sinRepetirSiFalla,
		meta: { sinAvisoDeError: true },
	});
	const [edicion, setEdicion] = useState<Edicion | null>(null);
	const [nombre, setNombre] = useState("");
	const [telefono, setTelefono] = useState("");
	const [cambio, setCambio] = useState<Cambio | null>(null);
	const cerrarEdicion = useCallback(() => setEdicion(null), []);
	const cerrarCambio = useCallback(() => setCambio(null), []);

	const refrescar = () => {
		queryClient.invalidateQueries({ queryKey: orpc.getUsuarioDeMiAgencia.key() });
		queryClient.invalidateQueries({ queryKey: orpc.getUsuariosDeMiAgencia.key() });
	};

	const editar = useMutation({
		mutationFn: (v: {
			agenciaId: string;
			nombre?: string;
			telefono?: string;
		}) => client.editarUsuarioDeMiAgencia({ userId: id, ...v }),
		onSuccess: () => {
			toast.success("Datos guardados");
			setEdicion(null);
			refrescar();
		},
		onError: (e) => toast.error(e.message || "No se pudo guardar"),
	});

	const cambiarEstado = useMutation({
		mutationFn: (v: { agenciaId: string; activa: boolean }) =>
			client.editarUsuarioDeMiAgencia({ userId: id, ...v }),
		onSuccess: (_, v) => {
			toast.success(
				textoCambioEstado(
					{ nombre: u?.nombre ?? "", cuentaSuspendida: u?.cuentaSuspendida ?? false },
					cambio?.agencia ?? "",
					v.activa,
				).toast,
			);
			setCambio(null);
			refrescar();
		},
		onError: (e) => toast.error(e.message || "No se pudo cambiar el estado"),
	});

	// Mismo criterio que el alta: con una escritura en vuelo la ventana no se
	// cierra por ninguna vía (X, Escape, clic en el fondo, Cancelar).
	const editando = !puedeCerrarAlta(editar.isPending);
	const cambiando = !puedeCerrarAlta(cambiarEstado.isPending);

	const u = consulta.data;
	const agencias = u ? agenciasConAcciones(u, u.permisos) : [];
	// Un refetch que falla con el usuario ya cargado no lo esconde.
	const estado = estadoDeConsulta(consulta);

	const abrirEdicion = (a: (typeof agencias)[number]) => {
		setNombre(u?.nombre ?? "");
		setTelefono(a.telefono ?? "");
		setEdicion({
			agenciaId: a.companyId,
			agencia: a.companyNombre,
			nombre: u?.nombre ?? "",
			telefono: a.telefono ?? "",
		});
	};

	const guardar = (e: React.FormEvent) => {
		e.preventDefault();
		if (!edicion || !u) return;
		const nombreNuevo = nombre.trim();
		if (u.permisos.puedeEditarNombre && !nombreNuevo) {
			toast.error("Escribe el nombre");
			return;
		}
		const agencia = agencias.find((a) => a.companyId === edicion.agenciaId);
		const cambios = cambiosDeEdicion(
			edicion,
			{ nombre, telefono },
			{
				puedeEditarNombre: u.permisos.puedeEditarNombre,
				puedeEditarTelefono: Boolean(agencia?.puedeEditarTelefono),
			},
		);
		if (!cambios) {
			setEdicion(null);
			return;
		}
		editar.mutate(cambios);
	};

	return (
		<div className="min-h-screen bg-slate-50">
			<Encabezado variante="caso" volverA="/usuarios" ancho="3xl" />

			<main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
				{consulta.isPending ? (
					<div className="flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Cargando usuario...
					</div>
				) : estado === "sin-acceso" ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<Lock className="mx-auto mb-2 h-6 w-6 text-slate-400" />
						<p className="font-medium text-slate-900">No tienes acceso</p>
						<p className="mt-1 text-slate-500 text-sm">
							Solo el gerente de la agencia puede ver a sus usuarios.
						</p>
					</div>
				) : estado === "no-encontrado" ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<p className="font-medium text-slate-900">
							No se encontró el usuario
						</p>
						<p className="mt-1 text-slate-500 text-sm">
							{consulta.error?.message}
						</p>
					</div>
				) : estado === "fallo" || !u ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<p className="font-medium text-slate-900">No se pudo cargar</p>
						<p className="mt-1 text-slate-500 text-sm">
							{consulta.error?.message}
						</p>
						<button
							type="button"
							onClick={() => consulta.refetch()}
							className="mt-4 rounded-lg bg-slate-900 px-3 py-2 font-medium text-sm text-white transition hover:bg-slate-800"
						>
							Reintentar
						</button>
					</div>
				) : (
					<>
						<section className="rounded-xl border border-slate-200 bg-white px-4 py-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<h1 className="truncate font-bold text-slate-900 text-xl">
										{u.nombre}
										{u.esYo && (
											<span className="ml-1.5 font-normal text-slate-500 text-base">
												(tú)
											</span>
										)}
									</h1>
									<p className="truncate text-slate-500 text-sm">{u.correo}</p>
								</div>
								<span
									className={cn(
										"shrink-0 rounded-full px-2.5 py-1 font-medium text-xs ring-1 ring-inset",
										estaActivo(u)
											? "bg-emerald-50 text-emerald-700 ring-emerald-200"
											: "bg-amber-50 text-amber-700 ring-amber-200",
									)}
								>
									{estaActivo(u) ? "Activo" : "Inactivo"}
								</span>
							</div>
							{!u.permisos.puedeEditarNombre && u.permisos.motivoNombre && (
								<p className="mt-2 text-slate-500 text-xs">
									{u.permisos.motivoNombre}
								</p>
							)}
						</section>

						<ul className="space-y-3">
							{agencias.map((a) => (
								<li
									key={a.companyId}
									className="space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-4"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="truncate font-medium text-slate-900 text-sm">
												{a.companyNombre}
											</p>
											<p className="text-slate-500 text-xs">
												{etiquetaDeRol(a.rol)}
												{" · "}
												{a.telefono || "Sin teléfono"}
											</p>
										</div>
										<span
											className={cn(
												"shrink-0 rounded-full px-2.5 py-1 font-medium text-xs ring-1 ring-inset",
												a.activa
													? "bg-emerald-50 text-emerald-700 ring-emerald-200"
													: "bg-amber-50 text-amber-700 ring-amber-200",
											)}
										>
											{a.activa ? "Activo" : "Inactivo"}
										</span>
									</div>
									{a.puedeActivar || a.puedeEditarTelefono ? (
										<div className="flex flex-wrap gap-2">
											<button
												type="button"
												onClick={() => abrirEdicion(a)}
												className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 text-sm transition hover:bg-slate-50"
											>
												<Pencil className="h-3.5 w-3.5" />
												Editar
											</button>
											{a.puedeActivar && (
												<button
													type="button"
													onClick={() =>
														setCambio({
															agenciaId: a.companyId,
															agencia: a.companyNombre,
															activar: !a.activa,
														})
													}
													className={cn(
														"rounded-lg px-3 py-1.5 font-medium text-sm transition",
														a.activa
															? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
															: "bg-slate-900 text-white hover:bg-slate-800",
													)}
												>
													{a.activa ? "Desactivar" : "Activar"}
												</button>
											)}
										</div>
									) : (
										a.motivo && (
											<p className="text-slate-500 text-xs">{a.motivo}</p>
										)
									)}
								</li>
							))}
						</ul>
					</>
				)}
			</main>

			<Ventana
				abierta={edicion !== null}
				onCerrar={cerrarEdicion}
				titulo="Editar usuario"
				subtitulo={edicion?.agencia}
				protegida={editando}
				sinCerrar={editando}
			>
				<form onSubmit={guardar} noValidate>
					{/* Con el guardado en vuelo ningún campo cambia: lo enviado es lo
					    que el usuario ve. Los disabled por permiso siguen aparte. */}
					<fieldset
						disabled={editar.isPending}
						className="m-0 min-w-0 space-y-3 border-0 p-0"
					>
						<label className="block space-y-1">
							<span className="font-medium text-slate-700 text-sm">Nombre</span>
							<input
								value={nombre}
								onChange={(e) => setNombre(e.target.value)}
								maxLength={LIMITES.nombre}
								disabled={!u?.permisos.puedeEditarNombre}
								className={inputClase}
							/>
							{!u?.permisos.puedeEditarNombre && u?.permisos.motivoNombre && (
								<span className="text-slate-500 text-xs">
									{u.permisos.motivoNombre}
								</span>
							)}
						</label>
						<label className="block space-y-1">
							<span className="font-medium text-slate-700 text-sm">Teléfono</span>
							<input
								type="tel"
								value={telefono}
								onChange={(e) => setTelefono(e.target.value)}
								maxLength={LIMITES.telefono}
								disabled={
									!agencias.find((a) => a.companyId === edicion?.agenciaId)
										?.puedeEditarTelefono
								}
								className={inputClase}
							/>
						</label>
						<button
							type="submit"
							disabled={editar.isPending}
							className="w-full rounded-lg bg-slate-900 px-3 py-2 font-medium text-sm text-white transition hover:bg-slate-800 disabled:opacity-50"
						>
							{editar.isPending ? "Guardando..." : "Guardar cambios"}
						</button>
					</fieldset>
				</form>
			</Ventana>

			<Ventana
				abierta={cambio !== null}
				onCerrar={cerrarCambio}
				titulo={cambio?.activar ? "Activar usuario" : "Desactivar usuario"}
				subtitulo={cambio?.agencia}
				protegida={cambiando}
				sinCerrar={cambiando}
			>
				<div className="space-y-4">
					<p className="text-slate-600 text-sm">
						{cambio &&
							textoCambioEstado(
								{ nombre: u?.nombre ?? "", cuentaSuspendida: u?.cuentaSuspendida ?? false },
								cambio.agencia,
								cambio.activar,
							).descripcion}
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={cerrarCambio}
							disabled={cambiando}
							className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-50"
						>
							Cancelar
						</button>
						<button
							type="button"
							disabled={cambiarEstado.isPending}
							onClick={() =>
								cambio &&
								cambiarEstado.mutate({
									agenciaId: cambio.agenciaId,
									activa: cambio.activar,
								})
							}
							className="flex-1 rounded-lg bg-slate-900 px-3 py-2 font-medium text-sm text-white transition hover:bg-slate-800 disabled:opacity-50"
						>
							{cambio?.activar ? "Activar" : "Desactivar"}
						</button>
					</div>
				</div>
			</Ventana>
		</div>
	);
}

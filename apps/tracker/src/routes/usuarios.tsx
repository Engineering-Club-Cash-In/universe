import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	Loader2,
	Lock,
	Search,
	Users,
} from "lucide-react";
import { useState } from "react";
import { Encabezado } from "@/components/encabezado";
import { TAMANOS_PAGINA } from "@/lib/paginacion";
import { etiquetaDeRol } from "@/lib/perfil";
import {
	insigniasEn,
	FILTROS_INICIALES,
	filtrarUsuarios,
	opcionesDeAgencia,
	paginarUsuarios,
} from "@/lib/usuarios";
import { cn } from "@/lib/utils";
import { estadoDeConsulta, orpc, sinRepetirSiFalla } from "@/utils/orpc";

const selectClase =
	"rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-slate-700 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900";

export function UsuariosPage() {
	const usuariosQuery = useQuery({
		...orpc.getUsuariosDeMiAgencia.queryOptions({ input: undefined }),
		// La página pinta su propia tarjeta de error ("No tienes acceso", etc.):
		// sin toast global duplicado ni consultas repetidas tras fallar.
		...sinRepetirSiFalla,
		meta: { sinAvisoDeError: true },
	});
	const [filtros, setFiltros] = useState(FILTROS_INICIALES);
	const [pagina, setPagina] = useState(1);
	const [porPagina, setPorPagina] = useState(TAMANOS_PAGINA[0]);

	const usuarios = usuariosQuery.data ?? [];
	const filtrados = filtrarUsuarios(usuarios, filtros);
	// La lista se refresca sola: si encoge, la página vigente puede quedar fuera de rango.
	const { paginaActual, totalPaginas, visibles } = paginarUsuarios(
		filtrados,
		pagina,
		porPagina,
	);
	const agencias = opcionesDeAgencia(usuarios);
	// Un error con la lista ya cargada (un refetch que falló) no la esconde.
	const estado = estadoDeConsulta(usuariosQuery);

	function cambiarFiltro(cambio: Partial<typeof filtros>) {
		setFiltros((f) => ({ ...f, ...cambio }));
		setPagina(1);
	}

	return (
		<div className="min-h-screen bg-slate-50">
			<Encabezado variante="caso" ancho="3xl" />

			<main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
				<h1 className="font-bold text-slate-900 text-xl">
					Usuarios de mi agencia
				</h1>

				{usuariosQuery.isPending ? (
					<div className="flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Cargando usuarios...
					</div>
				) : estado === "sin-acceso" ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<Lock className="mx-auto mb-2 h-6 w-6 text-slate-400" />
						<p className="font-medium text-slate-900">No tienes acceso</p>
						<p className="mt-1 text-slate-500 text-sm">
							Solo el gerente de la agencia puede ver a sus usuarios.
						</p>
					</div>
				) : estado !== "datos" ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<p className="font-medium text-slate-900">
							No se pudo cargar la lista
						</p>
						<p className="mt-1 text-slate-500 text-sm">
							{usuariosQuery.error?.message}
						</p>
						<button
							type="button"
							onClick={() => usuariosQuery.refetch()}
							className="mt-4 rounded-lg bg-slate-900 px-3 py-2 font-medium text-sm text-white transition hover:bg-slate-800"
						>
							Reintentar
						</button>
					</div>
				) : (
					<>
						<div className="space-y-2">
							<div className="relative">
								<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
								<input
									type="search"
									value={filtros.busqueda}
									onChange={(e) => cambiarFiltro({ busqueda: e.target.value })}
									placeholder="Buscar por nombre o correo"
									aria-label="Buscar por nombre o correo"
									className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-slate-900 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
								/>
							</div>
							<div className="flex flex-wrap gap-2">
								<select
									aria-label="Estado"
									value={filtros.estado}
									onChange={(e) =>
										cambiarFiltro({
											estado: e.target.value as typeof filtros.estado,
										})
									}
									className={selectClase}
								>
									<option value="todos">Todos los estados</option>
									<option value="activo">Activos</option>
									<option value="inactivo">Inactivos</option>
								</select>
								<select
									aria-label="Rol"
									value={filtros.rol}
									onChange={(e) =>
										cambiarFiltro({ rol: e.target.value as typeof filtros.rol })
									}
									className={selectClase}
								>
									<option value="todos">Todos los roles</option>
									<option value="gerente">Gerentes</option>
									<option value="usuario">Usuarios de agencia</option>
								</select>
								{agencias.length > 1 && (
									<select
										aria-label="Agencia"
										value={filtros.agencia}
										onChange={(e) => cambiarFiltro({ agencia: e.target.value })}
										className={selectClase}
									>
										<option value="todas">Todas las agencias</option>
										{agencias.map((a) => (
											<option key={a.id} value={a.id}>
												{a.nombre}
											</option>
										))}
									</select>
								)}
							</div>
						</div>

						{filtrados.length === 0 ? (
							<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
								<Users className="mx-auto mb-2 h-6 w-6 text-slate-400" />
								<p className="font-medium text-slate-900">
									{usuarios.length === 0
										? "Todavía no hay usuarios en tu agencia"
										: "Ningún usuario coincide con la búsqueda"}
								</p>
								{usuarios.length > 0 && (
									<button
										type="button"
										onClick={() => cambiarFiltro(FILTROS_INICIALES)}
										className="mt-3 text-slate-600 text-sm underline transition hover:text-slate-900"
									>
										Quitar filtros
									</button>
								)}
							</div>
						) : (
							<>
								<ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
									{visibles.map((u) => {
										const { rol, activo } =
											insigniasEn(u, filtros.agencia) ?? insigniasEn(u, "todas")!;
										return (
											<li key={u.id} className="space-y-1.5 px-4 py-3">
												<div className="flex items-start justify-between gap-3">
													<div className="min-w-0">
														<p className="truncate font-medium text-slate-900 text-sm">
															{u.nombre}
															{u.esYo && (
																<span className="ml-1.5 font-normal text-slate-500">
																	(tú)
																</span>
															)}
														</p>
														<p className="truncate text-slate-500 text-xs">
															{u.correo}
														</p>
													</div>
													<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
														<span
															className={cn(
																"rounded-full px-2.5 py-1 font-medium text-xs ring-1 ring-inset",
																rol === "gerente"
																	? "bg-slate-900 text-white ring-slate-900"
																	: "bg-slate-100 text-slate-600 ring-slate-200",
															)}
														>
															{etiquetaDeRol(rol)}
														</span>
														<span
															className={cn(
																"rounded-full px-2.5 py-1 font-medium text-xs ring-1 ring-inset",
																activo
																	? "bg-emerald-50 text-emerald-700 ring-emerald-200"
																	: "bg-amber-50 text-amber-700 ring-amber-200",
															)}
														>
															{activo ? "Activo" : "Inactivo"}
														</span>
													</div>
												</div>
												<p className="truncate text-slate-500 text-xs">
													{u.membresias.map((m) => m.companyNombre).join(", ")}
												</p>
											</li>
										);
									})}
								</ul>

								<nav className="flex flex-wrap items-center justify-between gap-3 pt-1 pb-2">
									<div className="flex items-center gap-2">
										<p className="text-slate-500 text-xs tabular-nums">
											{(paginaActual - 1) * porPagina + 1}–
											{Math.min(paginaActual * porPagina, filtrados.length)} de{" "}
											{filtrados.length}
										</p>
										<select
											value={porPagina}
											aria-label="Usuarios por página"
											onChange={(e) => {
												setPorPagina(Number(e.target.value));
												setPagina(1);
											}}
											className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-600 text-xs outline-none focus:border-slate-900"
										>
											{TAMANOS_PAGINA.map((n) => (
												<option key={n} value={n}>
													{n} por página
												</option>
											))}
										</select>
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => setPagina(Math.max(1, paginaActual - 1))}
											disabled={paginaActual === 1}
											className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
										>
											<ChevronLeft className="h-4 w-4" />
											<span className="hidden sm:inline">Anterior</span>
										</button>
										<span className="text-slate-600 text-sm tabular-nums">
											{paginaActual} / {totalPaginas}
										</span>
										<button
											type="button"
											onClick={() =>
												setPagina(Math.min(totalPaginas, paginaActual + 1))
											}
											disabled={paginaActual >= totalPaginas}
											className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 text-sm transition hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
										>
											<span className="hidden sm:inline">Siguiente</span>
											<ChevronRight className="h-4 w-4" />
										</button>
									</div>
								</nav>
							</>
						)}
					</>
				)}
			</main>
		</div>
	);
}

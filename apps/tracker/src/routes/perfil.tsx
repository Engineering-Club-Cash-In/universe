import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { Encabezado } from "@/components/encabezado";
import { etiquetaDeRol } from "@/lib/perfil";
import { cn } from "@/lib/utils";
import { opcionesMiPerfil } from "@/utils/opciones-perfil";
import { estadoDeConsulta } from "@/utils/orpc";

export function PerfilPage() {
	const perfilQuery = useQuery(opcionesMiPerfil());
	const perfil = perfilQuery.data;
	const estado = estadoDeConsulta(perfilQuery);

	return (
		<div className="min-h-screen bg-slate-50">
			<Encabezado variante="caso" />

			<main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
				<h1 className="font-bold text-slate-900 text-xl">Mi perfil</h1>
				{perfilQuery.isPending ? (
					<div className="flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Cargando perfil...
					</div>
				) : estado === "sin-acceso" ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<Lock className="mx-auto mb-2 h-6 w-6 text-slate-400" />
						<p className="font-medium text-slate-900">
							No tienes agencias activas
						</p>
						<p className="mt-1 text-slate-500 text-sm">
							Pídele a tu gerente que active tu acceso a una agencia.
						</p>
					</div>
				) : !perfil || estado !== "datos" ? (
					<div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
						<p className="font-medium text-slate-900">
							No se pudo cargar tu perfil
						</p>
						<p className="mt-1 text-slate-500 text-sm">
							{perfilQuery.error?.message}
						</p>
						<button
							type="button"
							onClick={() => perfilQuery.refetch()}
							className="mt-4 rounded-lg bg-slate-900 px-3 py-2 font-medium text-sm text-white transition hover:bg-slate-800"
						>
							Reintentar
						</button>
					</div>
				) : (
					<>
						<section className="rounded-xl border border-slate-200 bg-white p-5">
							<dl className="space-y-3 text-sm">
								<div>
									<dt className="text-slate-500 text-xs">Nombre</dt>
									<dd className="font-medium text-slate-900">{perfil.nombre}</dd>
								</div>
								<div>
									<dt className="text-slate-500 text-xs">Correo</dt>
									<dd className="font-medium text-slate-900">{perfil.correo}</dd>
								</div>
							</dl>
						</section>
						<section className="rounded-xl border border-slate-200 bg-white">
							<h2 className="border-slate-200 border-b px-5 py-3 font-medium text-slate-900 text-sm">
								Mis agencias
							</h2>
							<ul className="divide-y divide-slate-200">
								{perfil.agencias.map((a) => (
									<li
										key={a.id}
										className="flex items-center justify-between gap-3 px-5 py-3"
									>
										<span className="min-w-0 truncate text-slate-700 text-sm">
											{a.nombre}
										</span>
										<span
											className={cn(
												"shrink-0 rounded-full px-2.5 py-1 font-medium text-xs ring-1 ring-inset",
												a.rol === "gerente"
													? "bg-emerald-50 text-emerald-700 ring-emerald-200"
													: "bg-slate-100 text-slate-600 ring-slate-200",
											)}
										>
											{etiquetaDeRol(a.rol)}
										</span>
									</li>
								))}
							</ul>
						</section>
					</>
				)}
			</main>
		</div>
	);
}

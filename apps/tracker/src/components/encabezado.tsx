import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, LogOut, User, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logo } from "@/assets";
import { authClient, cerrarSesion } from "@/lib/auth-client";
import { esGerente } from "@/lib/perfil";
import { opcionesMiPerfil } from "@/utils/opciones-perfil";
import { esErrorDeAcceso } from "@/utils/orpc";

type Props = {
	// Listado: logo, título, correo y agencias. Caso: solo "Volver".
	variante: "listado" | "caso";
	agencias?: string;
	// Solo variante "caso": a dónde lleva "Volver" y qué tan ancho es el contenido.
	volverA?: "/" | "/usuarios";
	ancho?: "2xl" | "3xl";
};

function iniciales(texto: string | undefined) {
	const partes = (texto ?? "").trim().split(/[\s@.]+/).filter(Boolean);
	return (
		partes
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase())
			.join("") || "?"
	);
}

function MenuAvatar() {
	const { data: session } = authClient.useSession();
	// Un socio sin agencias activas recibe 403 aquí: el listado ya muestra su
	// propio aviso, así que esta consulta no repite el toast ni reintenta cada minuto.
	const perfilQuery = useQuery(opcionesMiPerfil());
	const [abierto, setAbierto] = useState(false);
	const contenedor = useRef<HTMLDivElement>(null);
	const identificadorSocio = session?.user.id ?? session?.user.email ?? null;

	useEffect(() => {
		if (!abierto) return;
		const fuera = (e: MouseEvent) => {
			if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
		};
		const escape = (e: KeyboardEvent) => {
			if (e.key === "Escape") setAbierto(false);
		};
		document.addEventListener("mousedown", fuera);
		document.addEventListener("keydown", escape);
		return () => {
			document.removeEventListener("mousedown", fuera);
			document.removeEventListener("keydown", escape);
		};
	}, [abierto]);

	// Con el acceso revocado (401/403) el perfil en caché ya no vale: no se ofrece
	// «Usuarios de mi agencia» aunque la última respuesta buena decía gerente.
	const verUsuarios =
		esGerente(perfilQuery.data) &&
		!(perfilQuery.isError && esErrorDeAcceso(perfilQuery.error));
	const nombre = perfilQuery.data?.nombre ?? session?.user.name;
	const itemClase =
		"flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 text-sm transition hover:bg-slate-50";

	return (
		<div ref={contenedor} className="relative shrink-0">
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={abierto}
				aria-label="Menú de la cuenta"
				onClick={() => setAbierto((v) => !v)}
				className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 font-medium text-white text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
			>
				{iniciales(nombre ?? session?.user.email)}
			</button>
			{abierto && (
				<div
					role="menu"
					className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1"
				>
					<div className="border-slate-200 border-b px-3 py-2">
						<p className="truncate font-medium text-slate-900 text-sm">
							{nombre}
						</p>
						<p className="truncate text-slate-500 text-xs">
							{session?.user.email}
						</p>
					</div>
					<Link role="menuitem" to="/perfil" className={itemClase}>
						<User className="h-4 w-4" />
						Mi perfil
					</Link>
					{verUsuarios && (
						<Link role="menuitem" to="/usuarios" className={itemClase}>
							<Users className="h-4 w-4" />
							Usuarios de mi agencia
						</Link>
					)}
					<button
						type="button"
						role="menuitem"
						onClick={() => cerrarSesion(identificadorSocio)}
						className={`${itemClase} border-slate-200 border-t`}
					>
						<LogOut className="h-4 w-4" />
						Salir
					</button>
				</div>
			)}
		</div>
	);
}

export function Encabezado({
	variante,
	agencias,
	volverA = "/",
	ancho = "2xl",
}: Props) {
	const { data: session } = authClient.useSession();

	if (variante === "caso") {
		return (
			<header className="border-slate-200 border-b bg-white">
				<div
					className={`mx-auto flex ${ancho === "3xl" ? "max-w-3xl" : "max-w-2xl"} items-center gap-3 px-4 py-4`}
				>
					<Link
						to={volverA}
						className="flex flex-1 items-center gap-1.5 text-slate-600 text-sm transition hover:text-slate-900"
					>
						<ArrowLeft className="h-4 w-4" />
						Volver
					</Link>
					<MenuAvatar />
				</div>
			</header>
		);
	}

	return (
		<header className="sticky top-0 z-10 border-slate-200 border-b bg-white">
			<div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
				<img src={logo} alt="CCI" className="h-8 w-auto shrink-0" />
				<div className="min-w-0 flex-1">
					<h1 className="truncate font-bold text-lg text-slate-900">
						Seguimiento de Créditos
					</h1>
					<p className="truncate text-slate-500 text-xs">
						{session?.user.email}
					</p>
				</div>
				<div className="min-w-0 flex-1 text-center">
					<p className="text-slate-400 text-[10px] uppercase tracking-wide">
						Agencia/predio
					</p>
					<p className="truncate font-medium text-slate-700 text-xs">
						{agencias}
					</p>
				</div>
				<MenuAvatar />
			</div>
		</header>
	);
}

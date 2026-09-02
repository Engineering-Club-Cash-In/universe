import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export function LoginPage() {
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as { redirect?: string };
	const { data: session } = authClient.useSession();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [mostrarPassword, setMostrarPassword] = useState(false);
	const [cargando, setCargando] = useState(false);

	useEffect(() => {
		if (session) navigate({ to: search.redirect || "/" });
	}, [session, navigate, search.redirect]);

	const enviar = async (evento: FormEvent) => {
		evento.preventDefault();
		setCargando(true);
		const { error } = await authClient.signIn.email({
			email,
			password,
			rememberMe: true,
		});

		if (error) {
			setCargando(false);
			toast.error(error.message || "No se pudo iniciar sesión");
			return;
		}

		setCargando(false);
		navigate({ to: search.redirect || "/" });
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
			<form
				onSubmit={enviar}
				className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
			>
				<div>
					<h1 className="font-bold text-2xl text-slate-900">
						Seguimiento de Créditos
					</h1>
					<p className="mt-1 text-slate-600 text-sm">
						Consulta en qué etapa va cada crédito de los vehículos.
					</p>
				</div>


				<div className="space-y-1.5">
					<label htmlFor="email" className="font-medium text-slate-700 text-sm">
						Correo electrónico
					</label>
					<input
						id="email"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
					/>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor="password"
						className="font-medium text-slate-700 text-sm"
					>
						Contraseña
					</label>
					<div className="relative">
						<input
							id="password"
							type={mostrarPassword ? "text" : "password"}
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
						/>
						<button
							type="button"
							onClick={() => setMostrarPassword((visible) => !visible)}
							aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
							className="-translate-y-1/2 absolute top-1/2 right-3 text-slate-500 hover:text-slate-900"
						>
							{mostrarPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
						</button>
					</div>
				</div>

				<button
					type="submit"
					disabled={cargando}
					className="flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-sm text-white transition hover:bg-slate-800 disabled:opacity-60"
				>
					{cargando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
					Iniciar sesión
				</button>
				<Link
					to="/cambiar-contrasena"
					className="block text-center text-slate-600 text-sm hover:text-slate-900"
				>
					Cambiar contraseña
				</Link>
			</form>
		</div>
	);
}

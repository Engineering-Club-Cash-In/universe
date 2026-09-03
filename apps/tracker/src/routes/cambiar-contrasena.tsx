import { useSearch } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { rutaDeRetorno } from "@/lib/rutas";
import { client } from "@/utils/orpc";

type CampoPasswordProps = {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	autoComplete: string;
};

function CampoPassword({
	id,
	label,
	value,
	onChange,
	autoComplete,
}: CampoPasswordProps) {
	const [visible, setVisible] = useState(false);

	return (
		<div className="space-y-1.5">
			<label htmlFor={id} className="font-medium text-slate-700 text-sm">
				{label}
			</label>
			<div className="relative">
				<input
					id={id}
					type={visible ? "text" : "password"}
					autoComplete={autoComplete}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					required
					className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
				/>
				<button
					type="button"
					onClick={() => setVisible((current) => !current)}
					aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
					className="-translate-y-1/2 absolute top-1/2 right-3 text-slate-500 hover:text-slate-900"
				>
					{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
				</button>
			</div>
		</div>
	);
}

export function CambiarContrasenaPage() {
	const search = useSearch({ strict: false }) as { redirect?: string };
	const { data: session } = authClient.useSession();
	const [email, setEmail] = useState("");
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [cargando, setCargando] = useState(false);

	useEffect(() => {
		if (session?.user.email && !email) setEmail(session.user.email);
	}, [session?.user.email, email]);

	const enviar = async (event: FormEvent) => {
		event.preventDefault();
		if (newPassword.length < 8) {
			toast.error("La nueva contraseña debe tener al menos 8 caracteres");
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.error("Las contraseñas nuevas no coinciden");
			return;
		}

		setCargando(true);
		try {
			if (!session) {
				const { error } = await authClient.signIn.email({
					email,
					password: currentPassword,
					rememberMe: true,
				});
				if (error) {
					throw new Error(
						error.message || "No se pudo validar la contraseña actual",
					);
				}
			}

			await client.changePartnerPassword({
				email,
				currentPassword,
				newPassword,
				confirmPassword,
			});
			toast.success("Contraseña actualizada correctamente");
			window.location.href = rutaDeRetorno(search.redirect);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "No se pudo cambiar la contraseña");
			setCargando(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
			<form
				onSubmit={enviar}
				className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
			>
				<div>
					<h1 className="font-bold text-2xl text-slate-900">Cambiar contraseña</h1>
					<p className="mt-1 text-slate-600 text-sm">
						Por seguridad, confirma tu contraseña actual y define una nueva.
					</p>
				</div>

				<div className="space-y-1.5">
					<label htmlFor="change-email" className="font-medium text-slate-700 text-sm">
						Correo electrónico
					</label>
					<input
						id="change-email"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
						className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
					/>
				</div>

				<CampoPassword
					id="current-password"
					label="Contraseña actual"
					value={currentPassword}
					onChange={setCurrentPassword}
					autoComplete="current-password"
				/>
				<CampoPassword
					id="new-password"
					label="Nueva contraseña"
					value={newPassword}
					onChange={setNewPassword}
					autoComplete="new-password"
				/>
				<CampoPassword
					id="confirm-password"
					label="Confirmar nueva contraseña"
					value={confirmPassword}
					onChange={setConfirmPassword}
					autoComplete="new-password"
				/>

				<button
					type="submit"
					disabled={cargando}
					className="flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-sm text-white transition hover:bg-slate-800 disabled:opacity-60"
				>
					{cargando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
					Actualizar contraseña
				</button>
			</form>
		</div>
	);
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Ventana } from "@/components/ventana";
import {
	agenciaDeAlta,
	altaProtegida,
	LIMITES,
	nombreConfirmado,
	puedeCerrarAlta,
	validarAlta,
} from "@/lib/usuarios";
import { client, orpc } from "@/utils/orpc";

const inputClase =
	"w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900";

type Agencia = { id: string; nombre: string };

/**
 * Alta de un usuario de agencia. La contraseña temporal sale una sola vez:
 * al cerrar la ventana no hay forma de volver a verla.
 */
export function AltaUsuario({
	abierta,
	onCerrar,
	agencias,
}: {
	abierta: boolean;
	onCerrar: () => void;
	agencias: Agencia[];
}) {
	const queryClient = useQueryClient();
	const [form, setForm] = useState({ nombre: "", correo: "", telefono: "" });
	const [agenciaElegida, setAgenciaElegida] = useState("");
	const agenciaId = agenciaDeAlta(agencias, agenciaElegida);
	const [errores, setErrores] = useState<{
		nombre?: string;
		correo?: string;
		telefono?: string;
	}>({});
	const [contrasena, setContrasena] = useState<string | null>(null);
	const [copiada, setCopiada] = useState(false);

	const crear = useMutation({
		mutationFn: (v: {
			agenciaId: string;
			nombre: string;
			correo: string;
			telefono?: string;
		}) => client.crearUsuarioDeMiAgencia(v),
		onSuccess: ({ contrasenaTemporal }) => {
			setContrasena(contrasenaTemporal);
			toast.success("Usuario creado");
			queryClient.invalidateQueries({
				queryKey: orpc.getUsuariosDeMiAgencia.key(),
			});
		},
		onError: (e) => toast.error(e.message || "No se pudo crear el usuario"),
	});

	// Ventana exige un onCerrar estable (su efecto depende de él y, si cambia en
	// cada render, el foco salta a la X con cada tecla). onCerrar llega del
	// padre: se guarda en una ref y `reset` de la mutación es estable.
	const onCerrarRef = useRef(onCerrar);
	useEffect(() => {
		onCerrarRef.current = onCerrar;
	});
	const { reset: resetCrear } = crear;
	const pendienteRef = useRef(crear.isPending);
	pendienteRef.current = crear.isPending;
	const cerrar = useCallback(() => {
		if (!puedeCerrarAlta(pendienteRef.current)) return;
		setForm({ nombre: "", correo: "", telefono: "" });
		setErrores({});
		setContrasena(null);
		setCopiada(false);
		resetCrear();
		onCerrarRef.current();
	}, [resetCrear]);

	const enviar = (e: React.FormEvent) => {
		e.preventDefault();
		const r = validarAlta(form);
		if (!r.ok) {
			setErrores(r.errores);
			return;
		}
		setErrores({});
		crear.mutate({ agenciaId, ...r.valor });
	};

	const copiar = async () => {
		if (!contrasena) return;
		try {
			await navigator.clipboard.writeText(contrasena);
			setCopiada(true);
		} catch {
			toast.error("No se pudo copiar. Selecciónala y cópiala a mano.");
		}
	};

	return (
		<Ventana
			abierta={abierta}
			onCerrar={cerrar}
			titulo={contrasena ? "Usuario creado" : "Nuevo usuario"}
			protegida={altaProtegida(crear.isPending, contrasena)}
			sinCerrar={!puedeCerrarAlta(crear.isPending)}
		>
			{contrasena ? (
				<div className="space-y-4">
					<p className="text-slate-600 text-sm">
						Comparte esta contraseña con {nombreConfirmado(crear.variables, form)}. Es temporal: la
						cambiará al entrar por primera vez.
					</p>
					<div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
						<code className="min-w-0 flex-1 break-all font-mono text-slate-900 text-sm select-all">
							{contrasena}
						</code>
						<button
							type="button"
							onClick={copiar}
							className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 text-sm transition hover:bg-slate-50"
						>
							{copiada ? (
								<Check className="h-4 w-4 text-emerald-600" />
							) : (
								<Copy className="h-4 w-4" />
							)}
							{copiada ? "Copiada" : "Copiar"}
						</button>
					</div>
					<p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 text-sm ring-1 ring-amber-200 ring-inset">
						No se vuelve a mostrar. Si la pierdes, el usuario deberá pedir un
						restablecimiento a Club Cash In.
					</p>
					<button
						type="button"
						onClick={cerrar}
						className="w-full rounded-lg bg-slate-900 px-3 py-2 font-medium text-sm text-white transition hover:bg-slate-800"
					>
						Listo
					</button>
				</div>
			) : (
				<form onSubmit={enviar} noValidate>
					{/* Mientras viaja el alta nada del formulario se puede editar. */}
					<fieldset
						disabled={crear.isPending}
						className="m-0 min-w-0 space-y-3 border-0 p-0"
					>
						{agencias.length > 1 && (
							<label className="block space-y-1">
								<span className="font-medium text-slate-700 text-sm">Agencia</span>
								<select
									value={agenciaId}
									onChange={(e) => setAgenciaElegida(e.target.value)}
									className={inputClase}
								>
									{agencias.map((a) => (
										<option key={a.id} value={a.id}>
											{a.nombre}
										</option>
									))}
								</select>
							</label>
						)}
						<label className="block space-y-1">
							<span className="font-medium text-slate-700 text-sm">Nombre</span>
							<input
								value={form.nombre}
								onChange={(e) => setForm({ ...form, nombre: e.target.value })}
								maxLength={LIMITES.nombre}
								className={inputClase}
								aria-invalid={!!errores.nombre}
							/>
							{errores.nombre && (
								<span className="text-rose-600 text-xs">{errores.nombre}</span>
							)}
						</label>
						<label className="block space-y-1">
							<span className="font-medium text-slate-700 text-sm">Correo</span>
							<input
								type="email"
								value={form.correo}
								onChange={(e) => setForm({ ...form, correo: e.target.value })}
								maxLength={LIMITES.correo}
								className={inputClase}
								aria-invalid={!!errores.correo}
							/>
							{errores.correo && (
								<span className="text-rose-600 text-xs">{errores.correo}</span>
							)}
						</label>
						<label className="block space-y-1">
							<span className="font-medium text-slate-700 text-sm">
								Teléfono (opcional)
							</span>
							<input
								type="tel"
								value={form.telefono}
								onChange={(e) => setForm({ ...form, telefono: e.target.value })}
								maxLength={LIMITES.telefono}
								className={inputClase}
								aria-invalid={!!errores.telefono}
							/>
							{errores.telefono && (
								<span className="text-rose-600 text-xs">{errores.telefono}</span>
							)}
						</label>
						<button
							type="submit"
							disabled={crear.isPending}
							className="w-full rounded-lg bg-slate-900 px-3 py-2 font-medium text-sm text-white transition hover:bg-slate-800 disabled:opacity-50"
						>
							{crear.isPending ? "Creando..." : "Crear usuario"}
						</button>
					</fieldset>
				</form>
			)}
		</Ventana>
	);
}

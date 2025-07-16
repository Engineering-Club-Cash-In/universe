import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { authClient } from "@/lib/auth-client";
import Loader from "./loader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export default function SignInForm() {
	const navigate = useNavigate();
	const { isPending } = authClient.useSession();
	const [isSigningIn, setIsSigningIn] = useState(false);

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		onSubmit: async ({ value }) => {
			setIsSigningIn(true);

			await authClient.signIn.email(
				{
					email: value.email,
					password: value.password,
				},
				{
					onSuccess: async () => {
						// Wait for session to be properly updated
						let retries = 0;
						const maxRetries = 10;

						while (retries < maxRetries) {
							const session = await authClient.getSession();
							if (session.data) {
								navigate({
									to: "/dashboard",
								});
								toast.success("Sesión iniciada exitosamente");
								setIsSigningIn(false);
								return;
							}
							await new Promise((resolve) => setTimeout(resolve, 100));
							retries++;
						}

						// Fallback: navigate anyway after max retries
						navigate({
							to: "/dashboard",
						});
						toast.success("Sesión iniciada exitosamente");
						setIsSigningIn(false);
					},
					onError: (error) => {
						toast.error(error.error.message);
						setIsSigningIn(false);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				email: z.string().email("Dirección de correo inválida"),
				password: z
					.string()
					.min(8, "La contraseña debe tener al menos 8 caracteres"),
			}),
		},
	});

	if (isPending || isSigningIn) {
		return (
			<div className="flex min-h-[400px] flex-col items-center justify-center">
				<Loader />
				{isSigningIn && (
					<p className="mt-4 text-muted-foreground text-sm">
						Iniciando sesión...
					</p>
				)}
			</div>
		);
	}

	return (
		<div className="mx-auto mt-10 w-full max-w-md p-6">
			<h1 className="mb-6 text-center font-bold text-3xl">Bienvenido</h1>

			<div className="space-y-4">
				<Button
					onClick={async () => {
						await authClient.signIn.social(
							{
								provider: "google",
								callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/dashboard`,
							},
							{
								onError: (error) => {
									toast.error(error.error.message);
								},
							},
						);
					}}
					variant="outline"
					className="w-full"
				>
					<svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
						<path
							fill="#4285F4"
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
						/>
						<path
							fill="#34A853"
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
						/>
						<path
							fill="#FBBC05"
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
						/>
						<path
							fill="#EA4335"
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
						/>
					</svg>
					Continuar con Google
				</Button>

				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground">
							O continuar con
						</span>
					</div>
				</div>
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="space-y-4"
			>
				<div>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Correo</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-red-500">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<div>
					<form.Field name="password">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>Contraseña</Label>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-red-500">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<form.Subscribe>
					{(state) => (
						<Button
							type="submit"
							className="w-full"
							disabled={!state.canSubmit || state.isSubmitting}
						>
							{state.isSubmitting ? "Enviando..." : "Iniciar Sesión"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}

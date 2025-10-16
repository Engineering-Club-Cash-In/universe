import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client } from "@/utils/orpc";

interface User {
	userId: string;
	name: string;
	email: string;
	role: string;
	hasCredentials: boolean;
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: User;
	onSave: () => void;
}

export function MiniAgentCredentialsModal({
	open,
	onOpenChange,
	user,
	onSave,
}: Props) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	const saveMutation = useMutation({
		mutationFn: async () => {
			if (!email || !password) {
				throw new Error("Email y contraseña son requeridos");
			}

			return client.adminSetMiniAgentCredentials({
				userId: user.userId,
				email,
				password,
			});
		},
		onSuccess: () => {
			toast.success("Credenciales guardadas correctamente");
			setEmail("");
			setPassword("");
			onSave();
		},
		onError: (error: Error) => {
			toast.error(`Error al guardar credenciales: ${error.message}`);
		},
	});

	const handleSave = () => {
		saveMutation.mutate();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>
						Configurar credenciales de MiniAgent
					</DialogTitle>
					<DialogDescription>
						Configura el email y contraseña de MiniAgent para {user.name}
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="email">Email de MiniAgent</Label>
						<Input
							id="email"
							type="email"
							placeholder="usuario@ejemplo.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="password">Contraseña de MiniAgent</Label>
						<Input
							id="password"
							type="password"
							placeholder="••••••••"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={saveMutation.isPending}
					>
						Cancelar
					</Button>
					<Button onClick={handleSave} disabled={saveMutation.isPending}>
						{saveMutation.isPending ? "Guardando..." : "Guardar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

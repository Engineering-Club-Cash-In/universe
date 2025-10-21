import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2 } from "lucide-react";
import { MiniAgentCredentialsModal } from "./miniagent-credentials-modal";

interface User {
	userId: string;
	name: string;
	email: string;
	role: string;
	hasCredentials: boolean;
}

interface Props {
	users: User[];
	onSave: () => void;
}

export function MiniAgentCredentialsTable({ users, onSave }: Props) {
	const [selectedUser, setSelectedUser] = useState<User | null>(null);
	const [isModalOpen, setIsModalOpen] = useState(false);

	const handleConfigure = (user: User) => {
		setSelectedUser(user);
		setIsModalOpen(true);
	};

	const handleClose = () => {
		setIsModalOpen(false);
		setSelectedUser(null);
	};

	const handleSave = () => {
		onSave();
		handleClose();
	};

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Nombre</TableHead>
						<TableHead>Email</TableHead>
						<TableHead>Rol</TableHead>
						<TableHead>Estado MiniAgent</TableHead>
						<TableHead className="text-right">Acciones</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{users.map((user) => (
						<TableRow key={user.userId}>
							<TableCell className="font-medium">{user.name}</TableCell>
							<TableCell>{user.email}</TableCell>
							<TableCell>
								<Badge variant="outline">{user.role}</Badge>
							</TableCell>
							<TableCell>
								{user.hasCredentials ? (
									<Badge variant="default">✓ Configurado</Badge>
								) : (
									<Badge variant="secondary">✗ Sin configurar</Badge>
								)}
							</TableCell>
							<TableCell className="text-right">
								<Button
									size="sm"
									variant="ghost"
									onClick={() => handleConfigure(user)}
								>
									<Pencil className="h-4 w-4 mr-2" />
									{user.hasCredentials ? "Editar" : "Configurar"}
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			{selectedUser && (
				<MiniAgentCredentialsModal
					open={isModalOpen}
					onOpenChange={setIsModalOpen}
					user={selectedUser}
					onSave={handleSave}
				/>
			)}
		</>
	);
}

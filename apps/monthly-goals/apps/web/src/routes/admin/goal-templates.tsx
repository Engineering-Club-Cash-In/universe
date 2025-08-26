import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-handler";

export const Route = createFileRoute("/admin/goal-templates")({
	component: GoalTemplatesPage,
});

function GoalTemplatesPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<any>(null);

	// Queries
	const goalTemplates = useQuery(orpc.goalTemplates.list.queryOptions());

	// Mutations
	const createMutation = useMutation(
		orpc.goalTemplates.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.goalTemplates.list.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Template de meta creado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear template de meta"));
			},
		})
	);

	const updateMutation = useMutation(
		orpc.goalTemplates.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.goalTemplates.list.key(),
				});
				setIsEditDialogOpen(false);
				setEditingTemplate(null);
				toast.success("Template de meta actualizado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al actualizar template de meta"));
			},
		})
	);

	const deleteMutation = useMutation(
		orpc.goalTemplates.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.goalTemplates.list.key(),
				});
				toast.success("Template de meta eliminado exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al eliminar template de meta"));
			},
		})
	);

	const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			description: formData.get("description") as string,
			defaultTarget: formData.get("defaultTarget") as string,
			unit: formData.get("unit") as string,
			successThreshold: formData.get("successThreshold") as string,
			warningThreshold: formData.get("warningThreshold") as string,
		};
		createMutation.mutate(data);
	};

	const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			description: formData.get("description") as string,
			defaultTarget: formData.get("defaultTarget") as string,
			unit: formData.get("unit") as string,
			successThreshold: formData.get("successThreshold") as string,
			warningThreshold: formData.get("warningThreshold") as string,
		};
		updateMutation.mutate({
			id: editingTemplate.id,
			data,
		});
	};

	const handleEdit = (template: any) => {
		setEditingTemplate(template);
		setIsEditDialogOpen(true);
	};

	const handleDelete = (template: any) => {
		if (confirm("¿Estás seguro de que quieres eliminar este template de meta?")) {
			deleteMutation.mutate({ id: template.id });
		}
	};

	const getThresholdColor = (value: string) => {
		const num = parseFloat(value);
		if (num >= 80) return "bg-green-100 text-green-800";
		if (num >= 50) return "bg-yellow-100 text-yellow-800";
		return "bg-red-100 text-red-800";
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Templates de Metas</h1>
				<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button>Crear Template</Button>
					</DialogTrigger>
					<DialogContent className="max-w-md">
						<DialogHeader>
							<DialogTitle>Crear Template de Meta</DialogTitle>
						</DialogHeader>
						<form onSubmit={handleCreateSubmit} className="space-y-4">
							<div>
								<Label htmlFor="name">Nombre</Label>
								<Input id="name" name="name" required />
							</div>
							<div>
								<Label htmlFor="description">Descripción</Label>
								<Textarea id="description" name="description" />
							</div>
							<div>
								<Label htmlFor="unit">Unidad</Label>
								<Input id="unit" name="unit" placeholder="ej: entregas, ventas, tickets" />
							</div>
							<div>
								<Label htmlFor="defaultTarget">Meta por Defecto</Label>
								<Input id="defaultTarget" name="defaultTarget" type="number" step="0.01" />
							</div>
							<div className="grid grid-cols-2 gap-4">
								<div>
									<Label htmlFor="successThreshold">Umbral de Éxito (%)</Label>
									<Input id="successThreshold" name="successThreshold" type="number" defaultValue="80" min="0" max="100" required />
								</div>
								<div>
									<Label htmlFor="warningThreshold">Umbral de Advertencia (%)</Label>
									<Input id="warningThreshold" name="warningThreshold" type="number" defaultValue="50" min="0" max="100" required />
								</div>
							</div>
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending ? "Creando..." : "Crear"}
							</Button>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Todos los Templates de Metas</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Nombre</TableHead>
								<TableHead>Descripción</TableHead>
								<TableHead>Unidad</TableHead>
								<TableHead>Meta por Defecto</TableHead>
								<TableHead>Umbral Éxito</TableHead>
								<TableHead>Umbral Advertencia</TableHead>
								<TableHead>Acciones</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{goalTemplates.isLoading ? (
								<TableRow>
									<TableCell colSpan={7} className="text-center py-4">
										Cargando templates de metas...
									</TableCell>
								</TableRow>
							) : goalTemplates.data?.map((template: any) => (
								<TableRow key={template.id}>
									<TableCell className="font-medium">{template.name}</TableCell>
									<TableCell>{template.description || "—"}</TableCell>
									<TableCell>{template.unit || "—"}</TableCell>
									<TableCell>{template.defaultTarget || "—"}</TableCell>
									<TableCell>
										<Badge className={getThresholdColor(template.successThreshold)}>
											{template.successThreshold}%
										</Badge>
									</TableCell>
									<TableCell>
										<Badge className={getThresholdColor(template.warningThreshold)}>
											{template.warningThreshold}%
										</Badge>
									</TableCell>
									<TableCell>
										<div className="flex space-x-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleEdit(template)}
											>
												Editar
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleDelete(template)}
												disabled={deleteMutation.isPending}
											>
												Eliminar
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{/* Edit Dialog */}
			<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Editar Template de Meta</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleEditSubmit} className="space-y-4">
						<div>
							<Label htmlFor="edit-name">Nombre</Label>
							<Input
								id="edit-name"
								name="name"
								defaultValue={editingTemplate?.name}
								required
							/>
						</div>
						<div>
							<Label htmlFor="edit-description">Descripción</Label>
							<Textarea
								id="edit-description"
								name="description"
								defaultValue={editingTemplate?.description}
							/>
						</div>
						<div>
							<Label htmlFor="edit-unit">Unidad</Label>
							<Input
								id="edit-unit"
								name="unit"
								defaultValue={editingTemplate?.unit}
								placeholder="ej: entregas, ventas, tickets"
							/>
						</div>
						<div>
							<Label htmlFor="edit-defaultTarget">Meta por Defecto</Label>
							<Input
								id="edit-defaultTarget"
								name="defaultTarget"
								type="number"
								step="0.01"
								defaultValue={editingTemplate?.defaultTarget}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<Label htmlFor="edit-successThreshold">Umbral de Éxito (%)</Label>
								<Input
									id="edit-successThreshold"
									name="successThreshold"
									type="number"
									min="0"
									max="100"
									defaultValue={editingTemplate?.successThreshold}
									required
								/>
							</div>
							<div>
								<Label htmlFor="edit-warningThreshold">Umbral de Advertencia (%)</Label>
								<Input
									id="edit-warningThreshold"
									name="warningThreshold"
									type="number"
									min="0"
									max="100"
									defaultValue={editingTemplate?.warningThreshold}
									required
								/>
							</div>
						</div>
						<Button type="submit" disabled={updateMutation.isPending}>
							{updateMutation.isPending ? "Actualizando..." : "Actualizar"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Phone, Plus, Save, Trash2, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc } from "@/utils/orpc";

interface ReferenciasViewProps {
	leadId: string;
}

type Referencia = Awaited<ReturnType<typeof client.getReferencias>>[number];

const parentescoLabels: Record<string, string> = {
	padre_madre: "Padre/Madre",
	hermano_a: "Hermano/a",
	hijo_a: "Hijo/a",
	conyuge: "Cónyuge",
	tio_a: "Tío/a",
	primo_a: "Primo/a",
	amigo_a: "Amigo/a",
	vecino_a: "Vecino/a",
	companero_trabajo: "Compañero de trabajo",
	otro: "Otro",
};

const parentescoOptions = [
	"padre_madre",
	"hermano_a",
	"hijo_a",
	"conyuge",
	"tio_a",
	"primo_a",
	"amigo_a",
	"vecino_a",
	"companero_trabajo",
	"otro",
] as const;

interface ReferenciaFormData {
	nombre: string;
	telefono: string;
	parentesco: string;
	notas: string;
}

const emptyFormData: ReferenciaFormData = {
	nombre: "",
	telefono: "",
	parentesco: "",
	notas: "",
};

export function ReferenciasView({ leadId }: ReferenciasViewProps) {
	const queryClient = useQueryClient();
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [selectedRef, setSelectedRef] = useState<Referencia | null>(null);
	const [formData, setFormData] = useState<ReferenciaFormData>(emptyFormData);

	const { data: referencias = [], isLoading } = useQuery({
		...orpc.getReferencias.queryOptions({
			input: { leadId },
		}),
	});

	const createMutation = useMutation({
		mutationFn: (data: Parameters<typeof client.createReferencia>[0]) =>
			client.createReferencia(data),
		onSuccess: () => {
			queryClient.invalidateQueries(
				orpc.getReferencias.queryOptions({ input: { leadId } }),
			);
			toast.success("Referencia agregada correctamente");
			setIsAddDialogOpen(false);
			setFormData(emptyFormData);
		},
		onError: (error) => {
			toast.error(`Error al agregar referencia: ${error.message}`);
		},
	});

	const updateMutation = useMutation({
		mutationFn: (data: Parameters<typeof client.updateReferencia>[0]) =>
			client.updateReferencia(data),
		onSuccess: () => {
			queryClient.invalidateQueries(
				orpc.getReferencias.queryOptions({ input: { leadId } }),
			);
			toast.success("Referencia actualizada correctamente");
			setIsEditDialogOpen(false);
			setSelectedRef(null);
			setFormData(emptyFormData);
		},
		onError: (error) => {
			toast.error(`Error al actualizar referencia: ${error.message}`);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => client.deleteReferencia({ id, leadId }),
		onSuccess: () => {
			queryClient.invalidateQueries(
				orpc.getReferencias.queryOptions({ input: { leadId } }),
			);
			toast.success("Referencia eliminada correctamente");
			setIsDeleteDialogOpen(false);
			setSelectedRef(null);
		},
		onError: (error) => {
			toast.error(`Error al eliminar referencia: ${error.message}`);
		},
	});

	const handleCreate = () => {
		if (!formData.nombre || !formData.telefono || !formData.parentesco) {
			toast.error("Nombre, teléfono y parentesco son requeridos");
			return;
		}
		createMutation.mutate({
			leadId,
			nombre: formData.nombre,
			telefono: formData.telefono,
			parentesco: formData.parentesco as (typeof parentescoOptions)[number],
			notas: formData.notas || undefined,
		});
	};

	const handleUpdate = () => {
		if (!selectedRef) return;
		if (!formData.nombre || !formData.telefono || !formData.parentesco) {
			toast.error("Nombre, teléfono y parentesco son requeridos");
			return;
		}
		updateMutation.mutate({
			id: selectedRef.id,
			leadId,
			nombre: formData.nombre,
			telefono: formData.telefono,
			parentesco: formData.parentesco as (typeof parentescoOptions)[number],
			notas: formData.notas || undefined,
		});
	};

	const handleOpenAdd = () => {
		setFormData(emptyFormData);
		setIsAddDialogOpen(true);
	};

	const handleEdit = (ref: Referencia) => {
		setSelectedRef(ref);
		setFormData({
			nombre: ref.nombre,
			telefono: ref.telefono,
			parentesco: ref.parentesco,
			notas: ref.notas || "",
		});
		setIsEditDialogOpen(true);
	};

	const handleDeleteClick = (ref: Referencia) => {
		setSelectedRef(ref);
		setIsDeleteDialogOpen(true);
	};

	const renderFormFields = () => (
		<div className="grid gap-4 py-4">
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="ref-nombre">
						Nombre <span className="text-red-500">*</span>
					</Label>
					<Input
						id="ref-nombre"
						value={formData.nombre}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, nombre: e.target.value }))
						}
						placeholder="Ej: María López"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="ref-telefono">
						Teléfono <span className="text-red-500">*</span>
					</Label>
					<Input
						id="ref-telefono"
						value={formData.telefono}
						onChange={(e) =>
							setFormData((prev) => ({ ...prev, telefono: e.target.value }))
						}
						placeholder="Ej: 5555-5555"
					/>
				</div>
			</div>
			<div className="space-y-2">
				<Label htmlFor="ref-parentesco">
					Parentesco <span className="text-red-500">*</span>
				</Label>
				<Select
					value={formData.parentesco}
					onValueChange={(value) =>
						setFormData((prev) => ({ ...prev, parentesco: value }))
					}
				>
					<SelectTrigger>
						<SelectValue placeholder="Seleccionar parentesco" />
					</SelectTrigger>
					<SelectContent>
						{parentescoOptions.map((p) => (
							<SelectItem key={p} value={p}>
								{parentescoLabels[p]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-2">
				<Label htmlFor="ref-notas">Notas</Label>
				<Textarea
					id="ref-notas"
					value={formData.notas}
					onChange={(e) =>
						setFormData((prev) => ({ ...prev, notas: e.target.value }))
					}
					placeholder="Notas adicionales sobre la referencia..."
					rows={2}
				/>
			</div>
		</div>
	);

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle className="flex items-center gap-2">
					<User className="h-5 w-5" />
					Referencias
				</CardTitle>
				<Button size="sm" onClick={handleOpenAdd}>
					<Plus className="mr-2 h-4 w-4" />
					Agregar
				</Button>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center py-4">
						<p className="text-muted-foreground text-sm">
							Cargando referencias...
						</p>
					</div>
				) : referencias.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-6">
						<User className="mb-2 h-8 w-8 text-muted-foreground" />
						<p className="text-muted-foreground text-sm">
							No hay referencias registradas
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{referencias.map((ref) => (
							<div
								key={ref.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<span className="font-medium">{ref.nombre}</span>
										<Badge variant="secondary">
											{parentescoLabels[ref.parentesco] || ref.parentesco}
										</Badge>
									</div>
									<div className="flex items-center gap-2 text-sm">
										<Phone className="h-3 w-3 text-muted-foreground" />
										<a
											href={`tel:${ref.telefono}`}
											className="text-primary hover:underline"
										>
											{ref.telefono}
										</a>
									</div>
									{ref.notas && (
										<p className="text-muted-foreground text-xs">{ref.notas}</p>
									)}
								</div>
								<div className="flex gap-1">
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleEdit(ref)}
									>
										<Edit2 className="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="text-red-500 hover:text-red-600"
										onClick={() => handleDeleteClick(ref)}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>

			{/* Dialog para agregar */}
			<Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Agregar Referencia</DialogTitle>
						<DialogDescription>
							Ingresa la información de la persona de referencia
						</DialogDescription>
					</DialogHeader>
					{renderFormFields()}
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
							Cancelar
						</Button>
						<Button onClick={handleCreate} disabled={createMutation.isPending}>
							{createMutation.isPending ? (
								"Guardando..."
							) : (
								<>
									<Save className="mr-2 h-4 w-4" />
									Guardar
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Dialog para editar */}
			<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Editar Referencia</DialogTitle>
						<DialogDescription>
							Modifica la información de la referencia
						</DialogDescription>
					</DialogHeader>
					{renderFormFields()}
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setIsEditDialogOpen(false)}
						>
							Cancelar
						</Button>
						<Button onClick={handleUpdate} disabled={updateMutation.isPending}>
							{updateMutation.isPending ? (
								"Guardando..."
							) : (
								<>
									<Save className="mr-2 h-4 w-4" />
									Actualizar
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Dialog para confirmar eliminación */}
			<Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Eliminar Referencia</DialogTitle>
						<DialogDescription>
							¿Estás seguro de que deseas eliminar a{" "}
							<span className="font-medium">{selectedRef?.nombre}</span>? Esta
							acción no se puede deshacer.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setIsDeleteDialogOpen(false)}
						>
							Cancelar
						</Button>
						<Button
							variant="destructive"
							onClick={() =>
								selectedRef && deleteMutation.mutate(selectedRef.id)
							}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}

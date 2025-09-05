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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/presentations/")({
	component: PresentationsIndexPage,
});

function PresentationsIndexPage() {
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

	// Queries
	const presentations = useQuery(orpc.presentations.list.queryOptions());

	// Mutations
	const createMutation = useMutation(
		orpc.presentations.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.presentations.list.key(),
				});
				setIsCreateDialogOpen(false);
				toast.success("Presentación creada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al crear presentación"));
			},
		})
	);

	const deleteMutation = useMutation(
		orpc.presentations.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.presentations.list.key(),
				});
				toast.success("Presentación eliminada exitosamente");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error, "Error al eliminar presentación"));
			},
		})
	);

	const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const data = {
			name: formData.get("name") as string,
			month: parseInt(formData.get("month") as string),
			year: parseInt(formData.get("year") as string),
		};
		createMutation.mutate(data);
	};

	const handleDelete = (presentation: any) => {
		if (confirm("¿Estás seguro de que quieres eliminar esta presentación?")) {
			deleteMutation.mutate({ id: presentation.id });
		}
	};

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "draft":
				return <Badge className="bg-gray-100 text-gray-800">Borrador</Badge>;
			case "ready":
				return <Badge className="bg-blue-100 text-blue-800">Lista</Badge>;
			case "presented":
				return <Badge className="bg-green-100 text-green-800">Presentada</Badge>;
			default:
				return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
		}
	};

	const currentYear = new Date().getFullYear();
	const months = [
		{ value: 1, label: "Enero" },
		{ value: 2, label: "Febrero" },
		{ value: 3, label: "Marzo" },
		{ value: 4, label: "Abril" },
		{ value: 5, label: "Mayo" },
		{ value: 6, label: "Junio" },
		{ value: 7, label: "Julio" },
		{ value: 8, label: "Agosto" },
		{ value: 9, label: "Septiembre" },
		{ value: 10, label: "Octubre" },
		{ value: 11, label: "Noviembre" },
		{ value: 12, label: "Diciembre" },
	];

	const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Gestión de Presentaciones</h1>
				<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button>Crear Presentación</Button>
					</DialogTrigger>
					<DialogContent className="space-y-6">
						<DialogHeader>
							<DialogTitle>Crear Nueva Presentación</DialogTitle>
						</DialogHeader>
						<form onSubmit={handleCreateSubmit} className="space-y-6">
							<div className="space-y-2">
								<Label htmlFor="name">Nombre de la Presentación</Label>
								<Input
									id="name"
									name="name"
									placeholder="ej: Reunión Mensual Agosto 2025"
									required
								/>
							</div>
							
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="month">Mes</Label>
									<Select name="month" defaultValue={new Date().getMonth() + 1 + ""}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{months.map((month) => (
												<SelectItem key={month.value} value={month.value.toString()}>
													{month.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								
								<div className="space-y-2">
									<Label htmlFor="year">Año</Label>
									<Select name="year" defaultValue={currentYear.toString()}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{years.map((year) => (
												<SelectItem key={year} value={year.toString()}>
													{year}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending ? "Creando..." : "Crear Presentación"}
							</Button>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Todas las Presentaciones</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Nombre</TableHead>
								<TableHead>Período</TableHead>
								<TableHead>Estado</TableHead>
								<TableHead>Creado por</TableHead>
								<TableHead>Fecha de Creación</TableHead>
								<TableHead>Acciones</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{presentations.isLoading ? (
								<TableRow>
									<TableCell colSpan={6} className="text-center py-4">
										Cargando presentaciones...
									</TableCell>
								</TableRow>
							) : presentations.data?.length === 0 ? (
								<TableRow>
									<TableCell colSpan={6} className="text-center py-4">
										No hay presentaciones creadas
									</TableCell>
								</TableRow>
							) : presentations.data?.map((presentation: any) => (
								<TableRow key={presentation.id}>
									<TableCell className="font-medium">{presentation.name}</TableCell>
									<TableCell>
										{months.find(m => m.value === presentation.month)?.label} {presentation.year}
									</TableCell>
									<TableCell>{getStatusBadge(presentation.status)}</TableCell>
									<TableCell>{presentation.createdByName}</TableCell>
									<TableCell>
										{new Date(presentation.createdAt).toLocaleDateString()}
									</TableCell>
									<TableCell>
										<div className="flex space-x-2">
											{presentation.status === "draft" && (
												<Button
													variant="outline"
													size="sm"
													asChild
												>
													<Link to="/presentations/$id/submit" params={{ id: presentation.id }}>
														Cargar Datos
													</Link>
												</Button>
											)}
											{presentation.status === "ready" && (
												<Button
													variant="outline"
													size="sm"
													asChild
												>
													<Link to="/presentations/$id/view" params={{ id: presentation.id }}>
														Ver Presentación
													</Link>
												</Button>
											)}
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleDelete(presentation)}
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
		</div>
	);
}
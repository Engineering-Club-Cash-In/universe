import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Trash2, User } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/utils/orpc";

const CLIENT_TYPE_LABELS: Record<string, string> = {
	individual: "Individual",
	empresa_individual: "Empresa Individual",
	sociedad_anonima: "Sociedad Anónima",
};

interface InvestorData {
	id: string;
	clientType: string;
	firstName: string;
	lastName: string;
	nit?: string | null;
	billingName?: string | null;
	corporation?: string | null;
	legalRepresentative?: string | null;
	paymentChannel?: string | null;
	phones?: string[] | null;
	email?: string | null;
	website?: string | null;
	address?: string | null;
	notes?: string | null;
}

interface InvestorProfileProps {
	investmentLeadId?: string;
	investor?: InvestorData | null;
}

const REQUIRED_FIELDS = [
	"firstName",
	"lastName",
	"clientType",
	"nit",
	"email",
] as const;

function isProfileComplete(data: Record<string, unknown>): boolean {
	return REQUIRED_FIELDS.every((f) => {
		const val = data[f];
		return val !== undefined && val !== null && val !== "";
	});
}

export function InvestorProfile({
	investmentLeadId,
	investor,
}: InvestorProfileProps) {
	const queryClient = useQueryClient();
	const isEditing = !!investor;
	const phoneIdCounter = useRef(
		investor?.phones?.length ? investor.phones.length : 1,
	);

	const [form, setForm] = useState({
		clientType: investor?.clientType ?? "individual",
		firstName: investor?.firstName ?? "",
		lastName: investor?.lastName ?? "",
		nit: investor?.nit ?? "",
		billingName: investor?.billingName ?? "",
		corporation: investor?.corporation ?? "",
		legalRepresentative: investor?.legalRepresentative ?? "",
		paymentChannel: investor?.paymentChannel ?? "",
		phones: (investor?.phones?.length
			? investor.phones.map((p, i) => ({ id: i, value: p }))
			: [{ id: 0, value: "" }]) as { id: number; value: string }[],
		email: investor?.email ?? "",
		website: investor?.website ?? "",
		address: investor?.address ?? "",
		notes: investor?.notes ?? "",
	});

	const needsCorporation =
		form.clientType === "empresa_individual" ||
		form.clientType === "sociedad_anonima";

	const profileComplete = isProfileComplete(form);

	const invalidateQueries = () => {
		queryClient.invalidateQueries({
			queryKey: ["getInvestmentOpportunityById"],
		});
	};

	const createMutation = useMutation({
		mutationFn: (data: typeof form) => {
			const phones = data.phones
				.map((p) => p.value)
				.filter((v) => v.trim() !== "");
			return client.createInvestor({
				investmentLeadId,
				clientType: data.clientType as
					| "individual"
					| "empresa_individual"
					| "sociedad_anonima",
				firstName: data.firstName,
				lastName: data.lastName,
				nit: data.nit || undefined,
				billingName: data.billingName || undefined,
				corporation: needsCorporation
					? data.corporation || undefined
					: undefined,
				legalRepresentative: needsCorporation
					? data.legalRepresentative || undefined
					: undefined,
				paymentChannel: data.paymentChannel || undefined,
				phones: phones.length > 0 ? phones : undefined,
				email: data.email || undefined,
				website: data.website || undefined,
				address: data.address || undefined,
				notes: data.notes || undefined,
			});
		},
		onSuccess: () => {
			toast.success("Inversionista creado exitosamente");
			invalidateQueries();
		},
		onError: () => toast.error("Error al crear inversionista"),
	});

	const updateMutation = useMutation({
		mutationFn: (data: typeof form) => {
			if (!investor) throw new Error("No investor to update");
			const phones = data.phones
				.map((p) => p.value)
				.filter((v) => v.trim() !== "");
			return client.updateInvestor({
				id: investor.id,
				clientType: data.clientType as
					| "individual"
					| "empresa_individual"
					| "sociedad_anonima",
				firstName: data.firstName,
				lastName: data.lastName,
				nit: data.nit || undefined,
				billingName: data.billingName || undefined,
				corporation: needsCorporation
					? data.corporation || undefined
					: undefined,
				legalRepresentative: needsCorporation
					? data.legalRepresentative || undefined
					: undefined,
				paymentChannel: data.paymentChannel || undefined,
				phones: phones.length > 0 ? phones : undefined,
				email: data.email || undefined,
				website: data.website || undefined,
				address: data.address || undefined,
				notes: data.notes || undefined,
			});
		},
		onSuccess: () => {
			toast.success("Inversionista actualizado exitosamente");
			invalidateQueries();
		},
		onError: () => toast.error("Error al actualizar inversionista"),
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.firstName.trim() || !form.lastName.trim()) {
			toast.error("Nombre y apellido son requeridos");
			return;
		}
		if (isEditing) {
			updateMutation.mutate(form);
		} else {
			createMutation.mutate(form);
		}
	};

	const isPending = createMutation.isPending || updateMutation.isPending;

	const addPhone = () => {
		const newId = phoneIdCounter.current++;
		setForm((f) => ({
			...f,
			phones: [...f.phones, { id: newId, value: "" }],
		}));
	};
	const removePhone = (id: number) =>
		setForm((f) => ({
			...f,
			phones: f.phones.filter((p) => p.id !== id),
		}));
	const updatePhone = (id: number, value: string) =>
		setForm((f) => ({
			...f,
			phones: f.phones.map((p) => (p.id === id ? { ...p, value } : p)),
		}));

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2 text-sm">
							<User className="h-4 w-4" />
							Perfil del Inversionista
						</CardTitle>
						<CardDescription className="text-xs">
							{isEditing
								? "Editar datos del inversionista"
								: "Crear perfil de inversionista"}
						</CardDescription>
					</div>
					{profileComplete ? (
						<Badge
							variant="outline"
							className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
						>
							<CheckCircle2 className="mr-1 h-3 w-3" />
							Perfil completo
						</Badge>
					) : (
						<Badge
							variant="outline"
							className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
						>
							Campos pendientes
						</Badge>
					)}
				</div>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit} className="space-y-6">
					{/* Datos Generales */}
					<div>
						<h4 className="mb-3 font-medium text-sm">Datos Generales</h4>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="clientType">Tipo de Cliente *</Label>
								<Select
									value={form.clientType}
									onValueChange={(v) =>
										setForm((f) => ({ ...f, clientType: v }))
									}
								>
									<SelectTrigger id="clientType">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Object.entries(CLIENT_TYPE_LABELS).map(([val, label]) => (
											<SelectItem key={val} value={val}>
												{label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div /> {/* spacer */}
							<div className="space-y-2">
								<Label htmlFor="firstName">Nombre *</Label>
								<Input
									id="firstName"
									value={form.firstName}
									onChange={(e) =>
										setForm((f) => ({ ...f, firstName: e.target.value }))
									}
									placeholder="Nombre"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="lastName">Apellido *</Label>
								<Input
									id="lastName"
									value={form.lastName}
									onChange={(e) =>
										setForm((f) => ({ ...f, lastName: e.target.value }))
									}
									placeholder="Apellido"
									required
								/>
							</div>
						</div>
					</div>

					<Separator />

					{/* Datos Fiscales */}
					<div>
						<h4 className="mb-3 font-medium text-sm">Datos Fiscales</h4>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="nit">NIT *</Label>
								<Input
									id="nit"
									value={form.nit}
									onChange={(e) =>
										setForm((f) => ({ ...f, nit: e.target.value }))
									}
									placeholder="1234567-8"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="billingName">Nombre de Facturación</Label>
								<Input
									id="billingName"
									value={form.billingName}
									onChange={(e) =>
										setForm((f) => ({ ...f, billingName: e.target.value }))
									}
									placeholder="Nombre para facturas"
								/>
							</div>
							{needsCorporation && (
								<>
									<div className="space-y-2">
										<Label htmlFor="corporation">Corporación</Label>
										<Input
											id="corporation"
											value={form.corporation}
											onChange={(e) =>
												setForm((f) => ({
													...f,
													corporation: e.target.value,
												}))
											}
											placeholder="Nombre de la empresa"
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="legalRep">Representante Legal</Label>
										<Input
											id="legalRep"
											value={form.legalRepresentative}
											onChange={(e) =>
												setForm((f) => ({
													...f,
													legalRepresentative: e.target.value,
												}))
											}
											placeholder="Nombre del representante"
										/>
									</div>
								</>
							)}
							<div className="space-y-2">
								<Label htmlFor="paymentChannel">Canal de Pago</Label>
								<Input
									id="paymentChannel"
									value={form.paymentChannel}
									onChange={(e) =>
										setForm((f) => ({ ...f, paymentChannel: e.target.value }))
									}
									placeholder="Ej: Transferencia, Cheque"
								/>
							</div>
						</div>
					</div>

					<Separator />

					{/* Contacto */}
					<div>
						<h4 className="mb-3 font-medium text-sm">Contacto</h4>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="email">Correo Electrónico *</Label>
								<Input
									id="email"
									type="email"
									value={form.email}
									onChange={(e) =>
										setForm((f) => ({ ...f, email: e.target.value }))
									}
									placeholder="correo@ejemplo.com"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="website">Sitio Web</Label>
								<Input
									id="website"
									value={form.website}
									onChange={(e) =>
										setForm((f) => ({ ...f, website: e.target.value }))
									}
									placeholder="https://..."
								/>
							</div>
							<div className="space-y-2 sm:col-span-2">
								<Label htmlFor="address">Dirección</Label>
								<Input
									id="address"
									value={form.address}
									onChange={(e) =>
										setForm((f) => ({ ...f, address: e.target.value }))
									}
									placeholder="Dirección completa"
								/>
							</div>
							<div className="space-y-2 sm:col-span-2">
								<div className="flex items-center justify-between">
									<Label>Teléfonos</Label>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={addPhone}
									>
										<Plus className="mr-1 h-3 w-3" />
										Agregar
									</Button>
								</div>
								<div className="space-y-2">
									{form.phones.map((phone) => (
										<div key={phone.id} className="flex items-center gap-2">
											<Input
												value={phone.value}
												onChange={(e) => updatePhone(phone.id, e.target.value)}
												placeholder="Número de teléfono"
											/>
											{form.phones.length > 1 && (
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="h-8 w-8 shrink-0"
													onClick={() => removePhone(phone.id)}
												>
													<Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
												</Button>
											)}
										</div>
									))}
								</div>
							</div>
						</div>
					</div>

					<Separator />

					{/* Notas */}
					<div>
						<h4 className="mb-3 font-medium text-sm">Notas</h4>
						<Textarea
							value={form.notes}
							onChange={(e) =>
								setForm((f) => ({ ...f, notes: e.target.value }))
							}
							placeholder="Notas adicionales sobre el inversionista..."
							rows={3}
						/>
					</div>

					{/* Submit */}
					<div className="flex justify-end">
						<Button type="submit" disabled={isPending}>
							{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing ? "Actualizar Perfil" : "Crear Inversionista"}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

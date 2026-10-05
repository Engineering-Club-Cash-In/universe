import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Search, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
	CATEGORIAS_BURO_INTERNO,
	type CandidatoBuroInterno,
	type CategoriaBuroInterno,
	type RegistroBuroInterno,
} from "./buro-interno-labels";

const MOTIVO_MIN = 10;

type Formulario = {
	leadId: string | null;
	nombres: string;
	apellidos: string;
	dpi: string;
	nit: string;
	telefono: string;
	direccion: string;
	numeroCreditoSifco: string;
	categoria: CategoriaBuroInterno;
	motivo: string;
};

const FORMULARIO_VACIO: Formulario = {
	leadId: null,
	nombres: "",
	apellidos: "",
	dpi: "",
	nit: "",
	telefono: "",
	direccion: "",
	numeroCreditoSifco: "",
	categoria: "mala_paga",
	motivo: "",
};

function desdeRegistro(registro: RegistroBuroInterno): Formulario {
	return {
		leadId: registro.leadId,
		nombres: registro.nombres,
		apellidos: registro.apellidos,
		dpi: registro.dpi ?? "",
		nit: registro.nit ?? "",
		telefono: registro.telefono ?? "",
		direccion: registro.direccion ?? "",
		numeroCreditoSifco: registro.numeroCreditoSifco ?? "",
		categoria: registro.categoria as CategoriaBuroInterno,
		motivo: registro.motivo,
	};
}

function desdeCandidato(candidato: CandidatoBuroInterno): Formulario {
	return {
		...FORMULARIO_VACIO,
		leadId: candidato.leadId,
		nombres: candidato.nombres,
		apellidos: candidato.apellidos,
		dpi: candidato.dpi ?? "",
		nit: candidato.nit ?? "",
		telefono: candidato.telefono ?? "",
		direccion: candidato.direccion ?? "",
		numeroCreditoSifco: candidato.numerosSifco[0] ?? "",
	};
}

function useDebounced<T>(valor: T, ms: number): T {
	const [debounced, setDebounced] = useState(valor);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(valor), ms);
		return () => clearTimeout(t);
	}, [valor, ms]);
	return debounced;
}

export function RegistroBuroInternoDialog({
	open,
	onOpenChange,
	registro,
	onGuardado,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Si viene, se edita; si no, se da de alta */
	registro?: RegistroBuroInterno | null;
	onGuardado: () => void;
}) {
	const editando = Boolean(registro);
	const [paso, setPaso] = useState<"buscar" | "formulario">("buscar");
	const [termino, setTermino] = useState("");
	const [formulario, setFormulario] = useState<Formulario>(FORMULARIO_VACIO);
	const [candidato, setCandidato] = useState<CandidatoBuroInterno | null>(null);
	const terminoDebounced = useDebounced(termino.trim(), 400);

	useEffect(() => {
		if (!open) return;
		if (registro) {
			setFormulario(desdeRegistro(registro));
			setPaso("formulario");
		} else {
			setFormulario(FORMULARIO_VACIO);
			setPaso("buscar");
		}
		setTermino("");
		setCandidato(null);
	}, [open, registro]);

	const busqueda = useQuery({
		...orpc.buscarCandidatosBuroInterno.queryOptions({
			input: { termino: terminoDebounced },
		}),
		enabled: open && paso === "buscar" && terminoDebounced.length >= 3,
	});

	const guardar = useMutation({
		mutationFn: async () => {
			const datos = {
				nombres: formulario.nombres,
				apellidos: formulario.apellidos,
				dpi: formulario.dpi || null,
				nit: formulario.nit || null,
				telefono: formulario.telefono || null,
				direccion: formulario.direccion || null,
				numeroCreditoSifco: formulario.numeroCreditoSifco || null,
				categoria: formulario.categoria,
				motivo: formulario.motivo,
			};
			return registro
				? client.actualizarRegistroBuroInterno({ id: registro.id, ...datos })
				: client.crearRegistroBuroInterno({
						...datos,
						leadId: formulario.leadId,
					});
		},
		onSuccess: () => {
			toast.success(
				editando ? "Registro actualizado" : "Persona agregada al buró interno",
			);
			onGuardado();
			onOpenChange(false);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const set = <K extends keyof Formulario>(campo: K, valor: Formulario[K]) =>
		setFormulario((f) => ({ ...f, [campo]: valor }));

	const puedeGuardar =
		formulario.nombres.trim().length >= 2 &&
		formulario.apellidos.trim().length >= 2 &&
		formulario.motivo.trim().length >= MOTIVO_MIN &&
		!guardar.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{editando ? "Editar registro" : "Agregar al buró interno"}
					</DialogTitle>
					<DialogDescription>
						{paso === "buscar"
							? "Buscá a la persona por número SIFCO, DPI, teléfono o nombre."
							: "Revisá los datos de la persona y explicá por qué se registra."}
					</DialogDescription>
				</DialogHeader>

				{paso === "buscar" ? (
					<div className="space-y-4">
						<div className="relative">
							<Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
							<Input
								autoFocus
								className="pl-9"
								placeholder="Número SIFCO, DPI, teléfono o nombre"
								value={termino}
								onChange={(e) => setTermino(e.target.value)}
							/>
						</div>

						{busqueda.isFetching && (
							<p className="flex items-center gap-2 text-muted-foreground text-sm">
								<Loader2 className="h-4 w-4 animate-spin" /> Buscando…
							</p>
						)}

						{busqueda.data &&
							busqueda.data.length === 0 &&
							!busqueda.isFetching && (
								<p className="text-muted-foreground text-sm">
									No se encontró a nadie con ese dato. Podés ingresarlo a mano.
								</p>
							)}

						{busqueda.data && busqueda.data.length > 0 && (
							<ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
								{busqueda.data.map((c) => (
									<li key={c.leadId ?? `cartera-${c.numerosSifco[0]}`}>
										<button
											type="button"
											disabled={c.yaRegistrado}
											onClick={() => {
												setCandidato(c);
												setFormulario(desdeCandidato(c));
												setPaso("formulario");
											}}
											className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
										>
											<div>
												<p className="font-medium">
													{c.nombres} {c.apellidos}
												</p>
												<p className="text-muted-foreground text-xs">
													{[
														c.dpi && `DPI ${c.dpi}`,
														c.telefono && `Tel. ${c.telefono}`,
														c.numerosSifco.length > 0 &&
															`SIFCO ${c.numerosSifco.join(", ")}`,
													]
														.filter(Boolean)
														.join(" · ") || "Sin DPI ni SIFCO"}
												</p>
											</div>
											<div className="flex shrink-0 gap-1">
												{c.origen === "cartera" && (
													<Badge variant="outline">Cartera</Badge>
												)}
												{c.yaRegistrado && (
													<Badge variant="destructive">Ya registrado</Badge>
												)}
											</div>
										</button>
									</li>
								))}
							</ul>
						)}

						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => {
									setCandidato(null);
									setFormulario(FORMULARIO_VACIO);
									setPaso("formulario");
								}}
							>
								<UserPlus className="mr-2 h-4 w-4" />
								Ingresar a mano
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (puedeGuardar) guardar.mutate();
						}}
					>
						{candidato?.origen === "cartera" && (
							<p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800 text-sm">
								Este cliente viene de cartera y no tiene lead en el CRM. El
								nombre llega en un solo campo: revisá que nombres y apellidos
								queden bien separados.
							</p>
						)}
						{formulario.leadId && (
							<p className="text-muted-foreground text-xs">
								Queda enlazado al lead del CRM.
							</p>
						)}

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="bi-nombres">Nombres *</Label>
								<Input
									id="bi-nombres"
									value={formulario.nombres}
									onChange={(e) => set("nombres", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="bi-apellidos">Apellidos *</Label>
								<Input
									id="bi-apellidos"
									value={formulario.apellidos}
									onChange={(e) => set("apellidos", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="bi-dpi">DPI</Label>
								<Input
									id="bi-dpi"
									inputMode="numeric"
									value={formulario.dpi}
									onChange={(e) => set("dpi", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="bi-nit">NIT</Label>
								<Input
									id="bi-nit"
									value={formulario.nit}
									onChange={(e) => set("nit", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="bi-telefono">Teléfono</Label>
								<Input
									id="bi-telefono"
									inputMode="tel"
									value={formulario.telefono}
									onChange={(e) => set("telefono", e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="bi-sifco">Número SIFCO</Label>
								<Input
									id="bi-sifco"
									value={formulario.numeroCreditoSifco}
									onChange={(e) => set("numeroCreditoSifco", e.target.value)}
								/>
								{candidato && candidato.numerosSifco.length > 1 && (
									<div className="flex flex-wrap gap-1">
										{candidato.numerosSifco.map((n) => (
											<button
												key={n}
												type="button"
												onClick={() => set("numeroCreditoSifco", n)}
											>
												<Badge
													variant={
														formulario.numeroCreditoSifco === n
															? "default"
															: "outline"
													}
												>
													{n}
												</Badge>
											</button>
										))}
									</div>
								)}
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="bi-direccion">Dirección</Label>
							<Input
								id="bi-direccion"
								value={formulario.direccion}
								onChange={(e) => set("direccion", e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label>Categoría *</Label>
							<Select
								value={formulario.categoria}
								onValueChange={(v) =>
									set("categoria", v as CategoriaBuroInterno)
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CATEGORIAS_BURO_INTERNO.map((c) => (
										<SelectItem key={c.value} value={c.value}>
											{c.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label htmlFor="bi-motivo">Motivo *</Label>
							<Textarea
								id="bi-motivo"
								rows={4}
								placeholder="Qué pasó con esta persona: créditos, meses de mora, recuperación, etc."
								value={formulario.motivo}
								onChange={(e) => set("motivo", e.target.value)}
							/>
							<p className="text-muted-foreground text-xs">
								Mínimo {MOTIVO_MIN} caracteres. Lo va a leer quien analice una
								solicitud nueva.
							</p>
						</div>

						<DialogFooter className="gap-2">
							{!editando && (
								<Button
									type="button"
									variant="ghost"
									onClick={() => setPaso("buscar")}
								>
									<ArrowLeft className="mr-2 h-4 w-4" />
									Volver a buscar
								</Button>
							)}
							<Button type="submit" disabled={!puedeGuardar}>
								{guardar.isPending && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								)}
								{editando ? "Guardar cambios" : "Agregar al buró interno"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc, queryClient } from "@/utils/orpc";
import {
	DESCRIPCION_SEVERIDAD,
	ETIQUETA_ORIGEN,
	ETIQUETA_SEVERIDAD,
	formatearFechaHora,
	type ReglaBuroInterno,
	SEVERIDADES,
	type Severidad,
} from "./buro-interno-labels";
import { SeveridadBadge } from "./CoincidenciasBuroInterno";

const ORIGENES = ["titular", "codeudor", "referencia"] as const;

type Borrador = {
	activa: boolean;
	severidad: Severidad;
	parametros: Record<string, unknown>;
};

function borradorDe(regla: ReglaBuroInterno): Borrador {
	return {
		activa: regla.activa,
		severidad: regla.severidad,
		parametros: { ...regla.parametros },
	};
}

function ParametroEditor({
	claveRegla,
	descriptor,
	valor,
	onChange,
	disabled,
}: {
	claveRegla: string;
	descriptor: ReglaBuroInterno["descriptoresParametros"][number];
	valor: unknown;
	onChange: (valor: unknown) => void;
	disabled: boolean;
}) {
	const id = `${claveRegla}-${descriptor.clave}`;
	const idBase = id;

	if (descriptor.tipo === "origenes") {
		const seleccionados = Array.isArray(valor) ? (valor as string[]) : [];
		return (
			<div className="space-y-2">
				<Label>{descriptor.etiqueta}</Label>
				<div className="flex flex-wrap gap-4">
					{ORIGENES.map((origen) => (
						<div key={origen} className="flex items-center gap-2">
							<Checkbox
								id={`${idBase}-${origen}`}
								disabled={disabled}
								checked={seleccionados.includes(origen)}
								onCheckedChange={(checked) =>
									onChange(
										checked
											? [...seleccionados, origen]
											: seleccionados.filter((o) => o !== origen),
									)
								}
							/>
							<Label htmlFor={`${idBase}-${origen}`} className="font-normal">
								{ETIQUETA_ORIGEN[origen]}
							</Label>
						</div>
					))}
				</div>
			</div>
		);
	}

	if (descriptor.tipo === "lista") {
		const lista = Array.isArray(valor) ? (valor as string[]) : [];
		return (
			<div className="space-y-2">
				<Label htmlFor={id}>{descriptor.etiqueta}</Label>
				<Textarea
					// Se remonta al guardar para mostrar la lista ya normalizada
					key={lista.join(",")}
					id={id}
					rows={3}
					disabled={disabled}
					defaultValue={lista.join(", ")}
					onBlur={(e) =>
						onChange(
							e.target.value
								.split(",")
								.map((v) => v.trim())
								.filter(Boolean),
						)
					}
				/>
				{descriptor.ayuda && (
					<p className="text-muted-foreground text-xs">
						{descriptor.ayuda}. Separados por coma.
					</p>
				)}
			</div>
		);
	}

	const esPorcentaje = descriptor.tipo === "porcentaje";
	const numero = typeof valor === "number" ? valor : 0;

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>
				{descriptor.etiqueta}
				{esPorcentaje && " (%)"}
			</Label>
			<Input
				id={id}
				type="number"
				className="w-32"
				disabled={disabled}
				min={esPorcentaje ? (descriptor.min ?? 0) * 100 : descriptor.min}
				max={esPorcentaje ? (descriptor.max ?? 1) * 100 : descriptor.max}
				step={1}
				value={esPorcentaje ? Math.round(numero * 100) : numero}
				onChange={(e) => {
					const n = Number(e.target.value);
					onChange(esPorcentaje ? n / 100 : n);
				}}
			/>
			{descriptor.ayuda && (
				<p className="text-muted-foreground text-xs">{descriptor.ayuda}</p>
			)}
		</div>
	);
}

function ReglaCard({
	regla,
	puedeEditar,
}: {
	regla: ReglaBuroInterno;
	puedeEditar: boolean;
}) {
	const [borrador, setBorrador] = useState<Borrador>(() => borradorDe(regla));

	useEffect(() => setBorrador(borradorDe(regla)), [regla]);

	const guardar = useMutation({
		mutationFn: () =>
			client.actualizarReglaBuroInterno({ clave: regla.clave, ...borrador }),
		onSuccess: () => {
			toast.success(`Regla "${regla.nombre}" actualizada`);
			queryClient.invalidateQueries({
				queryKey: orpc.getReglasBuroInterno.key(),
			});
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const cambio = JSON.stringify(borrador) !== JSON.stringify(borradorDe(regla));

	const numericos = regla.descriptoresParametros.filter(
		(d) => d.tipo === "porcentaje" || d.tipo === "entero",
	);
	const otros = regla.descriptoresParametros.filter(
		(d) => d.tipo === "origenes" || d.tipo === "lista",
	);
	const editorDe = (descriptor: (typeof numericos)[number]) => (
		<ParametroEditor
			key={descriptor.clave}
			claveRegla={regla.clave}
			descriptor={descriptor}
			valor={borrador.parametros[descriptor.clave]}
			disabled={!puedeEditar}
			onChange={(valor) =>
				setBorrador((b) => ({
					...b,
					parametros: { ...b.parametros, [descriptor.clave]: valor },
				}))
			}
		/>
	);

	return (
		<Card className={borrador.activa ? "" : "opacity-70"}>
			<CardHeader className="pb-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<CardTitle className="flex items-center gap-2 text-base">
							{regla.nombre}
							<SeveridadBadge severidad={borrador.severidad} />
						</CardTitle>
						<CardDescription>{regla.descripcion}</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id={`${regla.clave}-activa`}
							disabled={!puedeEditar}
							checked={borrador.activa}
							onCheckedChange={(checked) =>
								setBorrador((b) => ({ ...b, activa: checked === true }))
							}
						/>
						<Label htmlFor={`${regla.clave}-activa`}>Activa</Label>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-4 lg:grid-cols-[1fr_minmax(16rem,22rem)]">
					<section className="space-y-4 rounded-lg border bg-muted/30 p-4">
						<div>
							<h4 className="font-medium text-sm">Criterios de la regla</h4>
							<p className="text-muted-foreground text-xs">
								Cuándo se considera que hay coincidencia.
							</p>
						</div>
						{numericos.length > 0 && (
							<div className="flex flex-wrap gap-6">
								{numericos.map(editorDe)}
							</div>
						)}
						{otros.map(editorDe)}
					</section>

					<section className="space-y-3 rounded-lg border bg-muted/30 p-4">
						<div>
							<h4 className="font-medium text-sm">Nivel de alerta</h4>
							<p className="text-muted-foreground text-xs">
								Cómo la ve el analista cuando la regla se cumple.
							</p>
						</div>
						<Select
							disabled={!puedeEditar}
							value={borrador.severidad}
							onValueChange={(v) =>
								setBorrador((b) => ({ ...b, severidad: v as Severidad }))
							}
						>
							<SelectTrigger className="w-full" aria-label="Severidad">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SEVERIDADES.map((s) => (
									<SelectItem key={s} value={s}>
										{ETIQUETA_SEVERIDAD[s]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-sm">
							{DESCRIPCION_SEVERIDAD[borrador.severidad]}
						</p>
					</section>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
					<p className="text-muted-foreground text-xs">
						{regla.updatedByNombre
							? `Último cambio: ${regla.updatedByNombre}, ${formatearFechaHora(regla.updatedAt)}`
							: "Valores por defecto"}
					</p>
					{puedeEditar && (
						<Button
							size="sm"
							disabled={!cambio || guardar.isPending}
							onClick={() => guardar.mutate()}
						>
							{guardar.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Save className="mr-2 h-4 w-4" />
							)}
							Guardar
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

/** Reglas de coincidencia: qué se compara, qué tan grave es y con qué tolerancia */
export function ReglasBuroInterno({ puedeEditar }: { puedeEditar: boolean }) {
	const reglas = useQuery(orpc.getReglasBuroInterno.queryOptions());

	if (reglas.isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-muted-foreground text-sm">
				{puedeEditar
					? "Encendé, apagá o ajustá cada regla. Los cambios aplican de inmediato en el análisis y en las consultas, y quedan en la bitácora."
					: "Solo supervisión de cobros o administración puede cambiar las reglas."}{" "}
				Ninguna severidad frena la aprobación del crédito: solo define el color
				y el orden en que el analista ve la alerta.
			</p>
			{reglas.data?.map((regla) => (
				<ReglaCard key={regla.clave} regla={regla} puedeEditar={puedeEditar} />
			))}
		</div>
	);
}

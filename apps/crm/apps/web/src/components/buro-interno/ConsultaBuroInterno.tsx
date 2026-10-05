import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { client } from "@/utils/orpc";
import { CoincidenciasBuroInterno } from "./CoincidenciasBuroInterno";

const CAMPOS = [
	{ clave: "nombres", etiqueta: "Nombres" },
	{ clave: "apellidos", etiqueta: "Apellidos" },
	{ clave: "dpi", etiqueta: "DPI" },
	{ clave: "nit", etiqueta: "NIT" },
	{ clave: "telefono", etiqueta: "Teléfono" },
	{ clave: "direccion", etiqueta: "Dirección" },
] as const;

type Consulta = Record<(typeof CAMPOS)[number]["clave"], string>;

const CONSULTA_VACIA: Consulta = {
	nombres: "",
	apellidos: "",
	dpi: "",
	nit: "",
	telefono: "",
	direccion: "",
};

/**
 * Prueba a una persona contra el buró interno con las mismas reglas que usa
 * el análisis. Sirve para revisar a alguien antes de que exista la solicitud.
 */
export function ConsultaBuroInterno() {
	const [consulta, setConsulta] = useState<Consulta>(CONSULTA_VACIA);

	const consultar = useMutation({
		mutationFn: () =>
			client.consultarBuroInterno(
				Object.fromEntries(
					Object.entries(consulta).filter(([, v]) => v.trim().length > 0),
				),
			),
		onError: (error: Error) => toast.error(error.message),
	});

	const hayDatos = Object.values(consulta).some((v) => v.trim().length > 0);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Consultar una persona</CardTitle>
					<CardDescription>
						Ingresá los datos que tengas. Se aplican las mismas reglas que ve
						análisis; la consulta queda registrada en la bitácora.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (hayDatos) consultar.mutate();
						}}
					>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{CAMPOS.map((campo) => (
								<div key={campo.clave} className="space-y-2">
									<Label htmlFor={`consulta-${campo.clave}`}>
										{campo.etiqueta}
									</Label>
									<Input
										id={`consulta-${campo.clave}`}
										value={consulta[campo.clave]}
										onChange={(e) =>
											setConsulta((c) => ({
												...c,
												[campo.clave]: e.target.value,
											}))
										}
									/>
								</div>
							))}
						</div>
						<div className="flex gap-2">
							<Button type="submit" disabled={!hayDatos || consultar.isPending}>
								{consultar.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Search className="mr-2 h-4 w-4" />
								)}
								Consultar
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setConsulta(CONSULTA_VACIA);
									consultar.reset();
								}}
							>
								Limpiar
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			{consultar.data &&
				(consultar.data.length === 0 ? (
					<div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 text-sm">
						<CheckCircle2 className="h-4 w-4" />
						Sin coincidencias en el buró interno.
					</div>
				) : (
					<div className="space-y-3">
						<h3 className="font-semibold">
							{consultar.data.length === 1
								? "1 coincidencia"
								: `${consultar.data.length} coincidencias`}
						</h3>
						<CoincidenciasBuroInterno
							coincidencias={consultar.data}
							mostrarOrigen={false}
						/>
					</div>
				))}
		</div>
	);
}

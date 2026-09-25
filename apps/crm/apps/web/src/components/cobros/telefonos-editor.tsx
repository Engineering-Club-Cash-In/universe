/**
 * Lista editable de teléfonos para la tarjeta de contacto de la Ficha 360:
 * una fila por número, cada una con su botón para quitarla, y un botón a la
 * vista para agregar otra. Reemplaza el "escribir y presionar Enter" con
 * chips, que nadie descubría (Enter igual agrega una fila, para quien lo usa).
 */
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TelefonosEditorProps {
	id: string;
	label: string;
	requerido?: boolean;
	valores: string[];
	onChange: (valores: string[]) => void;
}

export function TelefonosEditor({
	id,
	label,
	requerido = false,
	valores,
	onChange,
}: TelefonosEditorProps) {
	// Índice de la fila que se acaba de agregar, para ponerle el foco.
	const [enfocar, setEnfocar] = useState<number | null>(null);
	const filas = useRef<(HTMLInputElement | null)[]>([]);

	useEffect(() => {
		if (enfocar === null) return;
		filas.current[enfocar]?.focus();
		setEnfocar(null);
	}, [enfocar]);

	const agregarFila = () => {
		onChange([...valores, ""]);
		setEnfocar(valores.length);
	};

	return (
		<div className="space-y-1.5">
			<Label htmlFor={`${id}-0`}>
				{label}
				{requerido && <span className="text-red-500"> *</span>}
			</Label>
			{valores.map((valor, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: filas editables sin id propio; se agregan y quitan por posición
					key={i}
					className="flex items-center gap-2"
				>
					<Input
						id={`${id}-${i}`}
						ref={(el) => {
							filas.current[i] = el;
						}}
						value={valor}
						inputMode="tel"
						placeholder="Ej: 5555-5555"
						onChange={(e) =>
							onChange(valores.map((v, j) => (j === i ? e.target.value : v)))
						}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								agregarFila();
							}
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="shrink-0 text-muted-foreground hover:text-red-600"
						aria-label={`Quitar ${valor || "teléfono"}`}
						// El principal no se queda sin filas: se vacía en vez de quitarse.
						onClick={() =>
							requerido && valores.length === 1
								? onChange([""])
								: onChange(valores.filter((_, j) => j !== i))
						}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			))}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-8 px-2 text-primary"
				onClick={agregarFila}
			>
				<Plus className="mr-1 h-4 w-4" />
				Agregar teléfono
			</Button>
		</div>
	);
}

/** Las filas vacías no se guardan. */
export function telefonosParaGuardar(valores: string[]): string[] {
	return valores.map((v) => v.trim()).filter(Boolean);
}

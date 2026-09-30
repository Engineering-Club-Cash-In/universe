/**
 * Fecha (y opcionalmente hora) con los componentes del UI: Popover + Calendar
 * + Selects. Reemplaza al `<input type="datetime-local">` nativo, cuyo picker
 * el navegador dibuja por fuera del diálogo y con su propio estilo.
 *
 * La hora va en pasos de 5 minutos: alcanza para una visita y es cómodo de
 * elegir con el dedo en el celular.
 */
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const HORAS = Array.from({ length: 24 }, (_, h) => h);
const MINUTOS = Array.from({ length: 12 }, (_, i) => i * 5);
const dosDigitos = (n: number) => String(n).padStart(2, "0");

/** La hora de ahora, redondeada hacia abajo a 5 minutos (lo que ofrece el selector). */
export function ahoraRedondeado(): Date {
	const d = new Date();
	d.setSeconds(0, 0);
	d.setMinutes(d.getMinutes() - (d.getMinutes() % 5));
	return d;
}

interface FechaHoraPickerProps {
	id?: string;
	value: Date | undefined;
	onChange: (fecha: Date | undefined) => void;
	/** false = solo el día (queda a mediodía, para que ningún huso lo mueva de día). */
	conHora?: boolean;
	placeholder?: string;
	/** Días que no se pueden elegir. */
	deshabilitar?: (dia: Date) => boolean;
	className?: string;
}

export function FechaHoraPicker({
	id,
	value,
	onChange,
	conHora = true,
	placeholder,
	deshabilitar,
	className,
}: FechaHoraPickerProps) {
	const [abierto, setAbierto] = useState(false);

	const conDia = (dia: Date): Date => {
		const d = new Date(dia);
		if (conHora) {
			// Se conserva la hora ya elegida; la primera vez, la de ahora.
			const base = value ?? ahoraRedondeado();
			d.setHours(base.getHours(), base.getMinutes(), 0, 0);
		} else {
			d.setHours(12, 0, 0, 0);
		}
		return d;
	};

	const conHoraMinuto = (hora: number, minuto: number) => {
		const d = new Date(value ?? new Date());
		d.setHours(hora, minuto, 0, 0);
		onChange(d);
	};

	const texto = value
		? format(value, conHora ? "EEE dd/MM/yyyy · HH:mm" : "EEE dd/MM/yyyy", {
				locale: es,
			})
		: (placeholder ?? (conHora ? "Elegí día y hora" : "Elegí el día"));

	return (
		<Popover open={abierto} onOpenChange={setAbierto}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					className={cn(
						"h-10 w-full justify-start text-left font-normal",
						!value && "text-muted-foreground",
						className,
					)}
				>
					<CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
					<span className="truncate">{texto}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar
					mode="single"
					selected={value}
					defaultMonth={value}
					onSelect={(dia) => {
						onChange(dia ? conDia(dia) : undefined);
						// Solo el día: con elegirlo ya está. Con hora, queda abierto
						// para ajustarla.
						if (dia && !conHora) setAbierto(false);
					}}
					disabled={deshabilitar}
					locale={es}
				/>
				{conHora && (
					<div className="flex items-center gap-2 border-t p-3">
						<span className="text-muted-foreground text-sm">Hora</span>
						<Select
							value={value ? String(value.getHours()) : undefined}
							onValueChange={(h) =>
								conHoraMinuto(Number(h), value?.getMinutes() ?? 0)
							}
							disabled={!value}
						>
							<SelectTrigger className="h-9 w-20" aria-label="Hora">
								<SelectValue placeholder="--" />
							</SelectTrigger>
							<SelectContent className="max-h-60">
								{HORAS.map((h) => (
									<SelectItem key={h} value={String(h)}>
										{dosDigitos(h)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<span>:</span>
						<Select
							value={
								value
									? String(value.getMinutes() - (value.getMinutes() % 5))
									: undefined
							}
							onValueChange={(m) =>
								conHoraMinuto(value?.getHours() ?? 0, Number(m))
							}
							disabled={!value}
						>
							<SelectTrigger className="h-9 w-20" aria-label="Minutos">
								<SelectValue placeholder="--" />
							</SelectTrigger>
							<SelectContent className="max-h-60">
								{MINUTOS.map((m) => (
									<SelectItem key={m} value={String(m)}>
										{dosDigitos(m)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							type="button"
							size="sm"
							className="ml-auto"
							onClick={() => setAbierto(false)}
						>
							Listo
						</Button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

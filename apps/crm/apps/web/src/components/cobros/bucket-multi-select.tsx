import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Command,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

type Bucket = { numero: number; prefijo: string; nombre: string };

export function BucketMultiSelect({
	buckets,
	value,
	onChange,
}: {
	buckets: Bucket[];
	value: number[] | null;
	onChange: (numeros: number[] | null) => void;
}) {
	const allNumeros = buckets.map((b) => b.numero);
	const selected = value === null ? allNumeros : value;
	// 0 marcados = mismo resultado que "todos" (downstream ya trata un array
	// vacío como sin filtro) — así deseleccionar el último no queda bloqueado
	// y el usuario puede simplemente marcar el único bucket que quiere, sin
	// tener que desmarcar el resto uno por uno primero.
	const isAll =
		value === null ||
		selected.length === 0 ||
		selected.length === allNumeros.length;

	function toggle(numero: number) {
		const base = value === null ? allNumeros : value;
		const next = base.includes(numero)
			? base.filter((x) => x !== numero)
			: [...base, numero];
		onChange(next.length === allNumeros.length ? null : next);
	}

	const label = isAll
		? "Todos los buckets"
		: selected.length === 1
			? (buckets.find((b) => b.numero === selected[0])?.prefijo ?? "1 bucket")
			: `${selected.length} buckets`;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" className="h-8 w-52 justify-between">
					<span className="truncate">{label}</span>
					<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-52 p-0" align="start">
				<Command>
					<CommandList>
						<CommandGroup>
							<CommandItem
								onSelect={() => onChange(null)}
								className="font-medium"
							>
								Seleccionar todos
							</CommandItem>
							<CommandItem
								onSelect={() => onChange([])}
								className="font-medium"
							>
								Deseleccionar todos
							</CommandItem>
							{buckets.map((b) => {
								const checked = selected.includes(b.numero);
								return (
									<CommandItem key={b.numero} onSelect={() => toggle(b.numero)}>
										<Checkbox checked={checked} className="mr-2" />
										<span className="truncate">
											{b.prefijo} — {b.nombre}
										</span>
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

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

type Asesor = { asesorId: number; nombre: string };

export function AsesorMultiSelect({
	asesores,
	value,
	onChange,
}: {
	asesores: Asesor[];
	value: number[] | null;
	onChange: (ids: number[] | null) => void;
}) {
	const allIds = asesores.map((a) => a.asesorId);
	const selected = value === null ? allIds : value;
	const isAll = value === null || selected.length === allIds.length;

	function toggle(id: number) {
		const base = value === null ? allIds : value;
		const next = base.includes(id)
			? base.filter((x) => x !== id)
			: [...base, id];
		if (next.length === 0) return; // mínimo 1
		onChange(next.length === allIds.length ? null : next);
	}

	const label = isAll
		? "Todos los asesores"
		: selected.length === 1
			? (asesores.find((a) => a.asesorId === selected[0])?.nombre ?? "1 asesor")
			: `${selected.length} asesores`;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" className="w-56 justify-between">
					<span className="truncate">{label}</span>
					<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-56 p-0" align="start">
				<Command>
					<CommandList>
						<CommandGroup>
							<CommandItem
								onSelect={() => onChange(null)}
								className="font-medium"
							>
								Seleccionar todos
							</CommandItem>
							{asesores.map((a) => {
								const checked = selected.includes(a.asesorId);
								const isLast = checked && selected.length === 1;
								return (
									<CommandItem
										key={a.asesorId}
										disabled={isLast}
										onSelect={() => !isLast && toggle(a.asesorId)}
									>
										<Checkbox checked={checked} className="mr-2" />
										<span className="truncate">{a.nombre}</span>
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

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

/**
 * CB-128 — filtro de usuarios del historial de agendas.
 *
 * Hermano de `asesor-multi-select.tsx` pero NO reutilizable a partir de él: ese
 * trabaja con `asesor_id: number` de cartera-back, y acá se filtra por
 * `user.id: string` del CRM (que es lo que guarda
 * `contactos_cobros.realizado_por`). Los dos catálogos se puentean por email y
 * ese puente es frágil — mezclarlos en un solo componente invitaría a usar el
 * id equivocado.
 *
 * Trae buscador porque el catálogo de usuarios de cobros crece con el equipo,
 * a diferencia de los buckets, que siempre son 6.
 */

export type UsuarioCobros = {
	id: string;
	name: string;
	role: string;
};

export function UsuarioCobrosMultiSelect({
	usuarios,
	value,
	onChange,
}: {
	usuarios: UsuarioCobros[];
	/**
	 * Selección actual; `null` = todos (sin filtro).
	 *
	 * Debe venir ya saneada contra `usuarios`: el componente la usa tal cual.
	 */
	value: string[] | null;
	onChange: (ids: string[] | null) => void;
}) {
	const allIds = usuarios.map((u) => u.id);
	// `value` llega YA saneado contra el catálogo vigente — el caller descarta
	// los ids que dejaron de existir antes de pasarlos (el catálogo no es fijo:
	// depende de los filtros activos, y la selección se persiste en
	// sessionStorage, así que un id guardado puede quedar huérfano).
	//
	// El saneo vive del lado del caller y no acá porque es el mismo valor que se
	// manda al backend: tenerlo en los dos lados permitía que el desplegable
	// mostrara un estado distinto al que de verdad estaba filtrando. Además solo
	// el caller sabe si el catálogo todavía está cargando, y filtrar contra una
	// lista vacía borraría una selección legítima.
	const vigentes = value;
	const selected = vigentes === null ? allIds : vigentes;
	// 0 marcados equivale a "todos": el backend trata el array vacío como sin
	// filtro, así que deseleccionar el último no deja la vista en blanco ni
	// bloquea al usuario. Mismo criterio que BucketMultiSelect.
	const isAll =
		vigentes === null ||
		selected.length === 0 ||
		selected.length === allIds.length;

	function toggle(id: string) {
		const base = vigentes === null ? allIds : vigentes;
		const next = base.includes(id)
			? base.filter((x) => x !== id)
			: [...base, id];
		onChange(next.length === allIds.length ? null : next);
	}

	const label = isAll
		? "Todos los usuarios"
		: selected.length === 1
			? (usuarios.find((u) => u.id === selected[0])?.name ?? "1 usuario")
			: `${selected.length} usuarios`;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" className="h-8 w-56 justify-between">
					<span className="truncate">{label}</span>
					<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-56 p-0" align="start">
				<Command>
					<CommandInput placeholder="Buscar usuario…" />
					<CommandList>
						<CommandEmpty>Sin resultados.</CommandEmpty>
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
							{usuarios.map((u) => (
								<CommandItem
									key={u.id}
									value={u.name}
									onSelect={() => toggle(u.id)}
								>
									<Checkbox
										checked={selected.includes(u.id)}
										className="mr-2"
									/>
									<span className="truncate">{u.name}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

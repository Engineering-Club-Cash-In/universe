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
	 * NO se valida contra `usuarios` acá ni en el caller: `usuarios` es un
	 * catálogo que se restringe por los DEMÁS filtros activos (bucket,
	 * resultado, tipo, SIFCO), así que un id puede faltar en él legítimamente
	 * —el usuario elegido simplemente no tiene gestiones bajo el filtro
	 * actual— y no por haber dejado de existir. Validar contra ese catálogo
	 * borraba selecciones válidas (ver la nota larga en `usuarioIdsVigentes`
	 * de `historial-agendas.tsx`). Efecto visible acá: un id seleccionado que
	 * no está en `usuarios` no aparece marcado en la lista y, si es la única
	 * selección, el label cae a "1 usuario" genérico en vez del nombre real —
	 * degradación cosmética, no funcional, y preferible a perder el filtro.
	 */
	value: string[] | null;
	onChange: (ids: string[] | null) => void;
}) {
	const allIds = usuarios.map((u) => u.id);
	const allIdsSet = new Set(allIds);
	const vigentes = value;
	const selected = vigentes === null ? allIds : vigentes;
	/**
	 * ¿`ids` cubre exactamente el catálogo visible (mismo CONJUNTO, no solo
	 * mismo largo)?
	 *
	 * `vigentes` puede traer ids que no están en `usuarios` (ver la nota larga
	 * del prop `value` — el catálogo se restringe por otros filtros activos, la
	 * selección no). Con una selección oculta como [Alice] y catálogo actual
	 * [Bob, Carol], comparar solo por longitud (`next.length ===
	 * allIds.length`) daba un falso positivo apenas la selección visible
	 * llegaba a 2 ids, aunque el conjunto real fuera distinto — en `toggle` eso
	 * convertía la selección en `null` ("todos") y ampliaba el filtro real al
	 * equipo completo en silencio, incluyendo a Carol, que nunca se eligió.
	 */
	function esElCatalogoCompleto(ids: readonly string[]): boolean {
		return ids.length === allIds.length && ids.every((x) => allIdsSet.has(x));
	}
	// 0 marcados equivale a "todos": el backend trata el array vacío como sin
	// filtro, así que deseleccionar el último no deja la vista en blanco ni
	// bloquea al usuario. Mismo criterio que BucketMultiSelect.
	const isAll =
		vigentes === null ||
		selected.length === 0 ||
		esElCatalogoCompleto(selected);

	function toggle(id: string) {
		const base = vigentes === null ? allIds : vigentes;
		const next = base.includes(id)
			? base.filter((x) => x !== id)
			: [...base, id];
		onChange(esElCatalogoCompleto(next) ? null : next);
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

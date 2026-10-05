import { ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	mensajeDeEnlaces,
	type PersonaConEnlaces,
} from "@/lib/enlaces-para-copiar";

/**
 * "Copiar enlaces": arma el mensaje con los enlaces que faltan firmar, de todos
 * o de una sola persona, y lo deja en el portapapeles.
 *
 * Todos juntos es para el grupo donde se le escribe a la gente; uno por uno,
 * para mandarle a cada quien sólo lo suyo. No se muestra si no falta nadie.
 */
export function CopiarEnlacesMenu({
	personas,
}: {
	personas: PersonaConEnlaces[];
}) {
	if (personas.length === 0) return null;

	const copiar = (quienes: PersonaConEnlaces[], de: string) => {
		navigator.clipboard.writeText(mensajeDeEnlaces(quienes));
		toast.success(`Enlaces ${de} copiados`);
	};
	const total = personas.reduce((n, p) => n + p.enlaces.length, 0);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground"
					title="Copiar los enlaces que faltan firmar, agrupados por persona"
				>
					<Copy className="mr-1 h-3 w-3" />
					Copiar enlaces
					<ChevronDown className="ml-0.5 h-3 w-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
					Sólo los que faltan firmar
				</DropdownMenuLabel>
				<DropdownMenuItem onClick={() => copiar(personas, "de todos")}>
					<span className="font-medium">Todos</span>
					<span className="ml-auto text-muted-foreground text-xs">
						{total} enlace(s)
					</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{personas.map((persona) => (
					<DropdownMenuItem
						key={persona.clave}
						onClick={() => copiar([persona], `de ${persona.nombre}`)}
					>
						<span className="min-w-0 truncate">
							<span className="font-medium">{persona.etiqueta}</span>{" "}
							<span className="text-muted-foreground">{persona.nombre}</span>
						</span>
						<span className="ml-auto shrink-0 text-muted-foreground text-xs">
							{persona.enlaces.length}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

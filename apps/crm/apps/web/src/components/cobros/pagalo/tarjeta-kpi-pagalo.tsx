import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TarjetaKpi({
	icono: Icono,
	label,
	valor,
	subtitulo,
}: {
	icono: LucideIcon;
	label: string;
	valor: string;
	subtitulo: string;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="font-medium text-sm">{label}</CardTitle>
				<Icono className="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div className="font-bold text-2xl">{valor}</div>
				<p className="text-muted-foreground text-xs">{subtitulo}</p>
			</CardContent>
		</Card>
	);
}

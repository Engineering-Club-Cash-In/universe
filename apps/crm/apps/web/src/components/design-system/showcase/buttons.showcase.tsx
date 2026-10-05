import { CircleCheck, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 10,
	title: "Botones",
	figma: "02 · Componentes › Botones (Button)",
	description:
		"Primary=default · Secondary=secondary · Ghost=outline · Text=link · Danger=destructive. Medium=default (42px), Small=sm (32px).",
};

const variants = [
	["Primary", "default"],
	["Secondary", "secondary"],
	["Ghost (outline)", "outline"],
	["Text (link)", "link"],
	["Danger", "destructive"],
	["ghost (sin borde)", "ghost"],
] as const;

export default function ButtonsShowcase() {
	return (
		<div className="space-y-6">
			{(["default", "sm"] as const).map((size) => (
				<ShowcaseGroup
					key={size}
					title={size === "default" ? "Medium" : "Small"}
				>
					{variants.map(([label, variant]) => (
						<ShowcaseRow key={variant} label={label}>
							<Button variant={variant} size={size}>
								Botón
							</Button>
							<Button variant={variant} size={size}>
								<CircleCheck />
								Botón
							</Button>
							<Button variant={variant} size={size} disabled>
								Botón
							</Button>
							<Button variant={variant} size={size} loading>
								Botón
							</Button>
						</ShowcaseRow>
					))}
				</ShowcaseGroup>
			))}
			<ShowcaseGroup title="Solo ícono">
				<ShowcaseRow label="icon / icon-sm">
					<Button size="icon" aria-label="Agregar">
						<Plus />
					</Button>
					<Button size="icon" variant="outline" aria-label="Agregar">
						<Plus />
					</Button>
					<Button size="icon-sm" variant="ghost" aria-label="Eliminar">
						<Trash2 />
					</Button>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}

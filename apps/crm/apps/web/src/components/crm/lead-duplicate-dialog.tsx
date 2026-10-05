import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import {
	getLeadDuplicatePresentation,
	type LeadDuplicateConflict,
} from "./lead-duplicate-conflict";

export function LeadDuplicateDialog({
	conflict,
	onClose,
	onViewLead,
}: {
	conflict: LeadDuplicateConflict | null;
	onClose: () => void;
	onViewLead: () => void;
}) {
	const presentation = conflict
		? getLeadDuplicatePresentation(conflict)
		: null;

	return (
		<Dialog open={Boolean(conflict)} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Este lead ya existe</DialogTitle>
					<DialogDescription>
						No se creó un lead nuevo porque el DPI ya está registrado.
					</DialogDescription>
				</DialogHeader>
				{conflict && presentation && (
					<div className="space-y-4">
						<div>
							<p className="font-medium">{conflict.leadName}</p>
							<Badge variant={conflict.isActive ? "default" : "secondary"}>
								{presentation.status}
							</Badge>
						</div>
						<div>
							<p className="text-muted-foreground text-sm">Asignación</p>
							<p className="font-medium">{conflict.assignedToName}</p>
							<p className="text-muted-foreground text-sm">
								{presentation.assignment}
							</p>
						</div>
					</div>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cerrar
					</Button>
					{presentation?.canViewLead && (
						<Button onClick={onViewLead}>Ver lead existente</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

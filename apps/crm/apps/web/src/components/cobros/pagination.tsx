import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Paginación simple reutilizable — mismo diseño que la de routes/cobros/$id.tsx. */
export function Pagination({
	currentPage,
	totalItems,
	itemsPerPage,
	onPageChange,
}: {
	currentPage: number;
	totalItems: number;
	itemsPerPage: number;
	onPageChange: (page: number) => void;
}) {
	const totalPages = Math.ceil(totalItems / itemsPerPage);

	if (totalPages <= 1) return null;

	return (
		<div className="flex items-center justify-between border-t pt-4">
			<p className="text-muted-foreground text-sm">
				Mostrando {(currentPage - 1) * itemsPerPage + 1} -{" "}
				{Math.min(currentPage * itemsPerPage, totalItems)} de {totalItems}
			</p>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage - 1)}
					disabled={currentPage === 1}
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<span className="text-sm">
					Página {currentPage} de {totalPages}
				</span>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage + 1)}
					disabled={currentPage === totalPages}
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
	ETIQUETA_PAQUETE_CARTAS,
	esCartaOPaquete,
	PAQUETE_CARTAS,
} from "server/src/lib/paquete-cartas";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Contract {
	id: string;
	contractType: string;
	contractName: string;
}

interface RegenerateContractsModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	contracts: Contract[];
	onRegenerate: (contractTypes: string[], newDate: Date) => Promise<void>;
	isLoading: boolean;
}

export function RegenerateContractsModal({
	open,
	onOpenChange,
	contracts,
	onRegenerate,
	isLoading,
}: RegenerateContractsModalProps) {
	const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
	const [newDate, setNewDate] = useState<Date | undefined>(new Date());

	// Tipos únicos de contratos. Las cartas —el paquete o, en oportunidades de
	// antes de unirlas, cada carta suelta— son una sola opción: se regeneran
	// todas juntas en un documento. Ofrecerlas por separado haría creer que se
	// puede rehacer una sola, y el paquete nuevo reemplazaría entero al anterior.
	const uniqueContractTypes = Array.from(
		new Map(
			contracts.map((c) =>
				esCartaOPaquete(c.contractType)
					? [
							PAQUETE_CARTAS,
							{
								...c,
								contractType: PAQUETE_CARTAS,
								contractName: ETIQUETA_PAQUETE_CARTAS,
							},
						]
					: [c.contractType, c],
			),
		).values(),
	);
	const incluyeCartas = selectedTypes.includes(PAQUETE_CARTAS);

	const handleToggleType = (contractType: string) => {
		setSelectedTypes((prev) =>
			prev.includes(contractType)
				? prev.filter((t) => t !== contractType)
				: [...prev, contractType],
		);
	};

	const handleSelectAll = () => {
		if (selectedTypes.length === uniqueContractTypes.length) {
			setSelectedTypes([]);
		} else {
			setSelectedTypes(uniqueContractTypes.map((c) => c.contractType));
		}
	};

	const handleRegenerate = async () => {
		if (!newDate || selectedTypes.length === 0) return;
		await onRegenerate(selectedTypes, newDate);
		setSelectedTypes([]);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<RefreshCw className="h-5 w-5" />
						Regenerar Contratos
					</DialogTitle>
					<DialogDescription>
						Selecciona los tipos de contratos a regenerar y la nueva fecha. Los
						contratos existentes del mismo tipo serán reemplazados.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Selector de fecha */}
					<div className="space-y-2">
						<span className="font-medium text-sm">
							Nueva fecha del contrato
						</span>
						<Popover>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									className={cn(
										"w-full justify-start text-left font-normal",
										!newDate && "text-muted-foreground",
									)}
								>
									<CalendarIcon className="mr-2 h-4 w-4" />
									{newDate ? (
										format(newDate, "PPP", { locale: es })
									) : (
										<span>Seleccionar fecha</span>
									)}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={newDate}
									onSelect={setNewDate}
									locale={es}
									initialFocus
								/>
							</PopoverContent>
						</Popover>
					</div>

					{/* Selector de tipos de contratos */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="font-medium text-sm">
								Tipos de contratos a regenerar
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleSelectAll}
								className="h-auto p-0 text-primary text-xs"
							>
								{selectedTypes.length === uniqueContractTypes.length
									? "Deseleccionar todos"
									: "Seleccionar todos"}
							</Button>
						</div>

						<div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
							{uniqueContractTypes.map((contract) => (
								<div
									key={contract.contractType}
									className="flex items-center space-x-2"
								>
									<Checkbox
										id={contract.contractType}
										checked={selectedTypes.includes(contract.contractType)}
										onCheckedChange={() =>
											handleToggleType(contract.contractType)
										}
									/>
									<label
										htmlFor={contract.contractType}
										className="cursor-pointer text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
									>
										{contract.contractName}
									</label>
								</div>
							))}
						</div>

						{selectedTypes.length > 0 && (
							<p className="text-muted-foreground text-xs">
								{selectedTypes.length} tipo(s) seleccionado(s)
							</p>
						)}

						{incluyeCartas && (
							<p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-blue-900 text-xs dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300">
								Las cartas se regeneran todas juntas, en un solo documento con
								un enlace por firmante. Reemplazan a las cartas anteriores de
								esta oportunidad.
							</p>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isLoading}
					>
						Cancelar
					</Button>
					<Button
						onClick={handleRegenerate}
						disabled={isLoading || selectedTypes.length === 0 || !newDate}
					>
						{isLoading ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Regenerando...
							</>
						) : (
							<>
								<RefreshCw className="mr-2 h-4 w-4" />
								Regenerar
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

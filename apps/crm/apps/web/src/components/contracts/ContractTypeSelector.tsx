import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface ContractType {
	id: string;
	name: string;
	description: string;
	category: "principal" | "garantia" | "otro";
	requiresBeneficiarios?: boolean;
}

interface ContractTypeSelectorProps {
	contractTypes: ContractType[];
	selectedContracts: string[];
	onSelectionChange: (selected: string[]) => void;
}

export function ContractTypeSelector({
	contractTypes,
	selectedContracts,
	onSelectionChange,
}: ContractTypeSelectorProps) {
	const handleToggle = (contractId: string) => {
		if (selectedContracts.includes(contractId)) {
			onSelectionChange(selectedContracts.filter((id) => id !== contractId));
		} else {
			onSelectionChange([...selectedContracts, contractId]);
		}
	};

	const handleSelectAll = (category: string) => {
		const categoryContracts = contractTypes
			.filter((c) => c.category === category)
			.map((c) => c.id);
		const allSelected = categoryContracts.every((id) =>
			selectedContracts.includes(id),
		);

		if (allSelected) {
			onSelectionChange(
				selectedContracts.filter((id) => !categoryContracts.includes(id)),
			);
		} else {
			const newSelection = [...selectedContracts];
			categoryContracts.forEach((id) => {
				if (!newSelection.includes(id)) {
					newSelection.push(id);
				}
			});
			onSelectionChange(newSelection);
		}
	};

	const principalContracts = contractTypes.filter(
		(c) => c.category === "principal",
	);
	const garantiaContracts = contractTypes.filter(
		(c) => c.category === "garantia",
	);
	const otrosContracts = contractTypes.filter((c) => c.category === "otro");

	const renderContractGroup = (
		title: string,
		category: string,
		contracts: ContractType[],
	) => {
		const allSelected = contracts.every((c) =>
			selectedContracts.includes(c.id),
		);

		return (
			<div className="space-y-3">
				<div className="flex items-center justify-between border-b pb-2">
					<h4 className="font-semibold">{title}</h4>
					<button
						type="button"
						onClick={() => handleSelectAll(category)}
						className="text-primary text-sm hover:underline"
					>
						{allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
					</button>
				</div>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					{contracts.map((contract) => (
						<div
							key={contract.id}
							className={`flex items-start space-x-3 rounded-lg border p-3 transition-colors ${
								selectedContracts.includes(contract.id)
									? "border-primary bg-primary/5"
									: "hover:bg-muted/50"
							}`}
						>
							<Checkbox
								id={contract.id}
								checked={selectedContracts.includes(contract.id)}
								onCheckedChange={() => handleToggle(contract.id)}
							/>
							<div className="flex-1 space-y-1">
								<Label
									htmlFor={contract.id}
									className="cursor-pointer font-medium text-sm"
								>
									{contract.name}
								</Label>
								<p className="text-muted-foreground text-xs">
									{contract.description}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>
		);
	};

	return (
		<div className="space-y-6">
			<div className="mb-4 text-sm text-muted-foreground">
				Seleccione los contratos que desea generar. Puede seleccionar múltiples
				contratos a la vez.
			</div>

			{principalContracts.length > 0 &&
				renderContractGroup(
					"Contratos Principales",
					"principal",
					principalContracts,
				)}

			{garantiaContracts.length > 0 &&
				renderContractGroup("Garantías", "garantia", garantiaContracts)}

			{otrosContracts.length > 0 &&
				renderContractGroup("Otros Documentos", "otro", otrosContracts)}

			<div className="mt-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3">
				<p className="text-amber-800 text-sm">
					<strong>{selectedContracts.length}</strong> contrato(s) seleccionado(s)
				</p>
			</div>
		</div>
	);
}

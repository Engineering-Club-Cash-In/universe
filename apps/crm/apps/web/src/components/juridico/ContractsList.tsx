import { FileX } from "lucide-react";
import { ContractCard } from "./ContractCard";

interface Contract {
	id: string;
	contractType: string;
	contractName: string;
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
	status: "pending" | "signed" | "cancelled";
	generatedAt: Date | string;
	opportunityId: string | null;
	leadId: string;
}

interface Opportunity {
	id: string;
	title: string;
	value: string | null;
}

interface ContractsListProps {
	contracts: Array<{
		contract: Contract;
		opportunity?: Opportunity | null;
	}>;
	onUpdate?: () => void;
}

export function ContractsList({ contracts, onUpdate }: ContractsListProps) {
	if (contracts.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-12 text-center">
				<FileX className="mb-3 h-12 w-12 text-gray-400" />
				<h3 className="mb-1 text-lg font-semibold text-gray-900">
					No hay contratos
				</h3>
				<p className="text-sm text-gray-500">
					Los contratos registrados aparecerán aquí
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{contracts.map(({ contract, opportunity }) => (
				<ContractCard
					key={contract.id}
					contract={contract}
					opportunity={opportunity}
					onUpdate={onUpdate}
				/>
			))}
		</div>
	);
}

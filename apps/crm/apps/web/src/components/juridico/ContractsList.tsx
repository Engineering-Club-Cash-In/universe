import { ChevronDown, ChevronRight, FileX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	estaAnulado,
	type FirmanteDeContrato,
} from "@/lib/contract-signers-display";
import { ContractCard } from "./ContractCard";

interface Contract {
	id: string;
	contractType: string;
	contractName: string;
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
	pdfLink?: string | null;
	status: "pending" | "signed" | "cancelled";
	/** El contrato que lo reemplaza; puede estar puesto aún en `pending`. */
	replacedByContractId?: string | null;
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
		/** Firmantes con su rol; vacío en los contratos generados antes. */
		signatories?: FirmanteDeContrato[];
	}>;
	onUpdate?: () => void;
	/** Reemplazar el documento de un contrato por uno corregido. */
	onReplace?: (contract: Contract) => void;
	onDelete?: (contractId: string) => Promise<void>;
	deletingContractId?: string | null;
}

export function ContractsList({
	contracts,
	onUpdate,
	onReplace,
	onDelete,
	deletingContractId,
}: ContractsListProps) {
	// Los anulados se conservan (dicen qué se descartó y si alguien lo había
	// firmado), pero van aparte: cada reemplazo deja uno y taparían los vigentes.
	const [verAnulados, setVerAnulados] = useState(false);

	if (contracts.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-gray-300 border-dashed py-12 text-center">
				<FileX className="mb-3 h-12 w-12 text-gray-400" />
				<h3 className="mb-1 font-semibold text-gray-900 text-lg">
					No hay contratos
				</h3>
				<p className="text-gray-500 text-sm">
					Los contratos registrados aparecerán aquí
				</p>
			</div>
		);
	}

	const vigentes = contracts.filter((c) => !estaAnulado(c.contract));
	const anulados = contracts.filter((c) => estaAnulado(c.contract));

	const tarjeta = ({
		contract,
		opportunity,
		signatories,
	}: ContractsListProps["contracts"][number]) => (
		<ContractCard
			key={contract.id}
			contract={contract}
			signatories={signatories}
			opportunity={opportunity}
			onUpdate={onUpdate}
			onReplace={onReplace ? () => onReplace(contract) : undefined}
			onDelete={onDelete}
			isDeleting={deletingContractId === contract.id}
		/>
	);

	return (
		<div className="space-y-4">
			{vigentes.length > 0 ? (
				vigentes.map(tarjeta)
			) : (
				<p className="text-muted-foreground text-sm">
					No hay contratos vigentes: todos fueron anulados o reemplazados.
				</p>
			)}

			{anulados.length > 0 && (
				<div className="space-y-4">
					<Button
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						onClick={() => setVerAnulados((v) => !v)}
					>
						{verAnulados ? (
							<ChevronDown className="mr-1 h-4 w-4" />
						) : (
							<ChevronRight className="mr-1 h-4 w-4" />
						)}
						{verAnulados
							? "Ocultar anulados"
							: `Ver anulados (${anulados.length})`}
					</Button>
					{verAnulados && (
						<div className="space-y-4 opacity-75">{anulados.map(tarjeta)}</div>
					)}
				</div>
			)}
		</div>
	);
}

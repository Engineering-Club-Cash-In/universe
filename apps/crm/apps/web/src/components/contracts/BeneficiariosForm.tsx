import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface Beneficiario {
	cuenta: string;
	monto: string;
}

interface BeneficiariosFormProps {
	beneficiarios: Beneficiario[];
	onChange: (beneficiarios: Beneficiario[]) => void;
}

export function BeneficiariosForm({
	beneficiarios,
	onChange,
}: BeneficiariosFormProps) {
	const handleAdd = () => {
		onChange([...beneficiarios, { cuenta: "", monto: "" }]);
	};

	const handleRemove = (index: number) => {
		const newBeneficiarios = beneficiarios.filter((_, i) => i !== index);
		onChange(newBeneficiarios);
	};

	const handleChange = (
		index: number,
		field: keyof Beneficiario,
		value: string,
	) => {
		const newBeneficiarios = beneficiarios.map((b, i) =>
			i === index ? { ...b, [field]: value } : b,
		);
		onChange(newBeneficiarios);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h4 className="font-medium">Beneficiarios</h4>
					<p className="text-muted-foreground text-sm">
						Agregar cuentas bancarias para el desembolso
					</p>
				</div>
				<Button type="button" variant="outline" size="sm" onClick={handleAdd}>
					<Plus className="mr-2 h-4 w-4" />
					Agregar
				</Button>
			</div>

			{beneficiarios.length === 0 ? (
				<div className="rounded-lg border border-dashed p-6 text-center">
					<p className="text-muted-foreground text-sm">
						No hay beneficiarios agregados. Haga clic en "Agregar" para añadir
						uno.
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{beneficiarios.map((beneficiario, index) => (
						<div
							key={index}
							className="flex items-end gap-3 rounded-lg border bg-muted/30 p-3"
						>
							<div className="flex-1 space-y-2">
								<Label htmlFor={`cuenta-${index}`}>Cuenta Bancaria</Label>
								<Input
									id={`cuenta-${index}`}
									value={beneficiario.cuenta}
									onChange={(e) => handleChange(index, "cuenta", e.target.value)}
									placeholder="Ej: Banco Industrial - 123456789"
								/>
							</div>
							<div className="w-48 space-y-2">
								<Label htmlFor={`monto-${index}`}>Monto (Q)</Label>
								<Input
									id={`monto-${index}`}
									type="number"
									value={beneficiario.monto}
									onChange={(e) => handleChange(index, "monto", e.target.value)}
									placeholder="0.00"
									step="0.01"
									min="0"
								/>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-10 w-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
								onClick={() => handleRemove(index)}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

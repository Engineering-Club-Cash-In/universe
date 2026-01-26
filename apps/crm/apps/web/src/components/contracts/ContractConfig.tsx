import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type Beneficiario, BeneficiariosForm } from "./BeneficiariosForm";

interface ContractDate {
	day: string;
	month: string;
	year: string;
}

interface ContractPreviewData {
	cliente?: {
		nombre?: string;
		dpi?: string;
		direccion?: string;
		nacionalidad?: string;
		estadoCivil?: string;
	};
	vehiculo?: {
		marca?: string;
		linea?: string;
		modelo?: string;
		color?: string;
		placa?: string;
		vin?: string;
	};
	credito?: {
		montoCredito?: string;
		plazo?: string;
		cuotaMensual?: string;
		tasaInteres?: string;
	};
}

interface ContractConfigProps {
	selectedContracts: string[];
	contractDate: ContractDate;
	beneficiarios: Beneficiario[];
	previewData?: ContractPreviewData | null;
	onDateChange: (date: ContractDate) => void;
	onBeneficiariosChange: (beneficiarios: Beneficiario[]) => void;
	showBeneficiarios?: boolean;
}

const MONTHS = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
const YEARS = Array.from({ length: 5 }, (_, i) =>
	String(new Date().getFullYear() + i - 1),
);

export function ContractConfig({
	contractDate,
	beneficiarios,
	previewData,
	onDateChange,
	onBeneficiariosChange,
	showBeneficiarios = true,
}: ContractConfigProps) {
	return (
		<div className="space-y-6">
			{/* Fecha del contrato */}
			<div className="space-y-4">
				<div>
					<h4 className="font-medium">Fecha del Contrato</h4>
					<p className="text-muted-foreground text-sm">
						Seleccione la fecha en que se firmará el contrato
					</p>
				</div>
				<div className="grid grid-cols-3 gap-4">
					<div className="space-y-2">
						<Label>Día</Label>
						<Select
							value={contractDate.day}
							onValueChange={(value) =>
								onDateChange({ ...contractDate, day: value })
							}
						>
							<SelectTrigger>
								<SelectValue placeholder="Día" />
							</SelectTrigger>
							<SelectContent>
								{DAYS.map((day) => (
									<SelectItem key={day} value={day}>
										{day}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label>Mes</Label>
						<Select
							value={contractDate.month}
							onValueChange={(value) =>
								onDateChange({ ...contractDate, month: value })
							}
						>
							<SelectTrigger>
								<SelectValue placeholder="Mes" />
							</SelectTrigger>
							<SelectContent>
								{MONTHS.map((month) => (
									<SelectItem key={month} value={month}>
										{month.charAt(0).toUpperCase() + month.slice(1)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label>Año</Label>
						<Select
							value={contractDate.year}
							onValueChange={(value) =>
								onDateChange({ ...contractDate, year: value })
							}
						>
							<SelectTrigger>
								<SelectValue placeholder="Año" />
							</SelectTrigger>
							<SelectContent>
								{YEARS.map((year) => (
									<SelectItem key={year} value={year}>
										{year}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			</div>

			{/* Preview de datos */}
			{previewData && (
				<div className="space-y-4">
					<div>
						<h4 className="font-medium">Datos a incluir en los contratos</h4>
						<p className="text-muted-foreground text-sm">
							Verifique que los datos sean correctos antes de generar
						</p>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						{/* Cliente */}
						{previewData.cliente && (
							<div className="rounded-lg border bg-muted/30 p-4">
								<h5 className="mb-3 font-semibold text-sm">
									Datos del Cliente
								</h5>
								<div className="space-y-2 text-sm">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Nombre:</span>
										<span className="font-medium">
											{previewData.cliente.nombre || "No disponible"}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">DPI:</span>
										<span className="font-mono">
											{previewData.cliente.dpi || "No disponible"}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Nacionalidad:</span>
										<span>
											{previewData.cliente.nacionalidad || "No disponible"}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Estado Civil:</span>
										<span>
											{previewData.cliente.estadoCivil || "No disponible"}
										</span>
									</div>
								</div>
							</div>
						)}

						{/* Vehículo */}
						{previewData.vehiculo && (
							<div className="rounded-lg border bg-muted/30 p-4">
								<h5 className="mb-3 font-semibold text-sm">
									Datos del Vehículo
								</h5>
								<div className="space-y-2 text-sm">
									<div className="flex justify-between">
										<span className="text-muted-foreground">Vehículo:</span>
										<span className="font-medium">
											{previewData.vehiculo.marca} {previewData.vehiculo.linea}{" "}
											{previewData.vehiculo.modelo}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Color:</span>
										<span>{previewData.vehiculo.color || "No disponible"}</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Placa:</span>
										<span className="font-mono">
											{previewData.vehiculo.placa || "No disponible"}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">VIN:</span>
										<span className="font-mono text-xs">
											{previewData.vehiculo.vin || "No disponible"}
										</span>
									</div>
								</div>
							</div>
						)}

						{/* Crédito */}
						{previewData.credito && (
							<div className="col-span-full rounded-lg border bg-muted/30 p-4">
								<h5 className="mb-3 font-semibold text-sm">
									Datos del Crédito
								</h5>
								<div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
									<div>
										<span className="text-muted-foreground">Monto:</span>
										<p className="font-medium text-green-600">
											Q{previewData.credito.montoCredito || "0"}
										</p>
									</div>
									<div>
										<span className="text-muted-foreground">Plazo:</span>
										<p className="font-medium">
											{previewData.credito.plazo || "0"} meses
										</p>
									</div>
									<div>
										<span className="text-muted-foreground">Cuota:</span>
										<p className="font-medium">
											Q{previewData.credito.cuotaMensual || "0"}
										</p>
									</div>
									<div>
										<span className="text-muted-foreground">Tasa:</span>
										<p className="font-medium">
											{previewData.credito.tasaInteres || "0"}%
										</p>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Beneficiarios */}
			{showBeneficiarios && (
				<BeneficiariosForm
					beneficiarios={beneficiarios}
					onChange={onBeneficiariosChange}
				/>
			)}
		</div>
	);
}

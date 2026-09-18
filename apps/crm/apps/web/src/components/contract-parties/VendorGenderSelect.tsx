import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { VendorGender } from "@/hooks/useVendorDpiLookup";

export function VendorGenderSelect({
	value,
	onChange,
	id,
	disabled,
}: {
	value: VendorGender | "" | null | undefined;
	onChange: (value: VendorGender) => void;
	id?: string;
	disabled?: boolean;
}) {
	return (
		<Select
			value={value || ""}
			onValueChange={(v) => onChange(v as VendorGender)}
			disabled={disabled}
		>
			<SelectTrigger id={id} className="w-full">
				<SelectValue placeholder="Selecciona el género" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="male">Masculino</SelectItem>
				<SelectItem value="female">Femenino</SelectItem>
			</SelectContent>
		</Select>
	);
}

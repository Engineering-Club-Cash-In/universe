import type * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 30,
	title: "Checkbox, radio y toggle",
	figma:
		"02 · Componentes › Checkbox (83:891) · Radio Button (83:910) · Toggle (83:929)",
	description:
		'Checkbox: checked / checked="indeterminate" / disabled; size sm (16px) para menús. Radio: RadioGroup + RadioGroupItem. Toggle = Switch. La etiqueta se compone al lado con gap-2.5 y peer-disabled:opacity-40.',
};

/** Control + etiqueta como en Figma: gap 10px, 14px text-fg; se atenúa con el control deshabilitado. */
function Labeled({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="inline-flex items-center gap-2.5">
			{children}
			<label
				htmlFor={id}
				className="type-body-base cursor-pointer text-fg peer-disabled:cursor-not-allowed peer-disabled:opacity-40"
			>
				{label}
			</label>
		</div>
	);
}

const checkboxStates = [
	["Default", false, false],
	["Checked", true, false],
	["Indeterminate", "indeterminate", false],
	["Disabled", false, true],
	["Disabled · Checked", true, true],
] as const;

export default function SelectionShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Checkbox">
				{checkboxStates.map(([label, checked, disabled]) => (
					<ShowcaseRow key={label} label={label} className="gap-16">
						<Labeled id={`cb-${label}`} label="Incluir en gestión">
							<Checkbox
								id={`cb-${label}`}
								defaultChecked={checked}
								disabled={disabled}
							/>
						</Labeled>
						<Checkbox
							aria-label="Incluir en gestión"
							defaultChecked={checked}
							disabled={disabled}
						/>
						<Checkbox
							size="sm"
							aria-label="Incluir en gestión"
							defaultChecked={checked}
							disabled={disabled}
						/>
					</ShowcaseRow>
				))}
				<ShowcaseRow label="Tamaños">
					<span className="type-caption text-fg-tertiary">
						default = 20px (Figma) · sm = 16px (opciones del Dropdown Multi)
					</span>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Radio Button">
				<ShowcaseRow label="Default · Selected">
					<RadioGroup defaultValue="sel" className="flex gap-16">
						<Labeled id="rb-disp" label="Opción disponible">
							<RadioGroupItem id="rb-disp" value="disp" />
						</Labeled>
						<Labeled id="rb-sel" label="Opción seleccionada">
							<RadioGroupItem id="rb-sel" value="sel" />
						</Labeled>
					</RadioGroup>
				</ShowcaseRow>
				<ShowcaseRow label="Disabled · DisabledSelected">
					<RadioGroup defaultValue="sel" disabled className="flex gap-16">
						<Labeled id="rb-disp-d" label="Opción disponible">
							<RadioGroupItem id="rb-disp-d" value="disp" />
						</Labeled>
						<Labeled id="rb-sel-d" label="Opción seleccionada">
							<RadioGroupItem id="rb-sel-d" value="sel" />
						</Labeled>
					</RadioGroup>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Toggle (Switch)">
				<ShowcaseRow label="Off · On" className="gap-16">
					<Labeled id="sw-off" label="Automatización inactiva">
						<Switch id="sw-off" />
					</Labeled>
					<Labeled id="sw-on" label="Automatización activa">
						<Switch id="sw-on" defaultChecked />
					</Labeled>
				</ShowcaseRow>
				<ShowcaseRow label="OffDisabled · OnDisabled" className="gap-16">
					<Labeled id="sw-off-d" label="Automatización inactiva">
						<Switch id="sw-off-d" disabled />
					</Labeled>
					<Labeled id="sw-on-d" label="Automatización activa">
						<Switch id="sw-on-d" defaultChecked disabled />
					</Labeled>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}

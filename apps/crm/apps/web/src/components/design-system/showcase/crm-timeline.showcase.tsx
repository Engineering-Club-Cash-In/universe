import {
	HistorialPromesaItem,
	HistorialPromesas,
} from "@/components/ds/historial-promesa";
import {
	Timeline,
	TimelineItem,
	type TimelineTipo,
} from "@/components/ds/timeline";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 120,
	title: "CRM · Timeline e historial",
	figma:
		"03 · Componentes CRM › Timeline Item · Timeline · Item / Historial de Promesas",
	description:
		"Timeline/Item por tipo de evento, la tarjeta «Historial de Cobranza» y la tabla del historial de promesas (encabezado + filas con Badge/Promesa).",
};

const tipos: TimelineTipo[] = [
	"Llamada",
	"WhatsApp",
	"Promesa",
	"Convenio",
	"Visita",
	"Sistema",
];

const evento = {
	usuario: "Carlos Ramírez",
	descripcion: "Cliente respondió, se comprometió a pagar el viernes.",
	fecha: "10 jul 2026",
	hora: "14:32",
};

export default function CrmTimelineShowcase() {
	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Timeline/Item">
				<ShowcaseRow label="tipo">
					<div className="grid w-full grid-cols-[repeat(2,minmax(0,469px))] gap-x-11 gap-y-8">
						{tipos.map((t) => (
							<TimelineItem key={t} tipo={t} {...evento} />
						))}
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Timeline">
				<ShowcaseRow label="Historial de Cobranza">
					<Timeline onVerTodo={() => {}}>
						<TimelineItem tipo="Promesa" {...evento} />
						<TimelineItem tipo="Llamada" {...evento} />
						<TimelineItem tipo="WhatsApp" {...evento} />
						<TimelineItem tipo="Sistema" {...evento} />
					</Timeline>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Item / Historial de Promesas">
				<ShowcaseRow label="Fila suelta">
					{/* contain:inline-size evita que el ancho fijo de la fila ensanche la página del catálogo. */}
					<div className="w-full overflow-x-auto [contain:inline-size]">
						<HistorialPromesaItem
							fechaCreacion="11 jul 2026"
							monto="Q 5,000.00"
							fechaCompromiso="15/07/2026"
							responsable="C. Ramírez"
							estado="Cumplida"
							resultado="Pago recibido a tiempo"
						/>
					</div>
				</ShowcaseRow>
				<ShowcaseRow label="Tabla compuesta">
					<HistorialPromesas className="w-full [contain:inline-size]">
						<HistorialPromesaItem
							fechaCreacion="16 jul 2026"
							monto="Q 2,500.00"
							fechaCompromiso="22/07/2026"
							responsable="C. Ramírez"
							estado="Vigente"
							resultado="En seguimiento"
						/>
						<HistorialPromesaItem
							fechaCreacion="11 jul 2026"
							monto="Q 5,000.00"
							fechaCompromiso="15/07/2026"
							responsable="C. Ramírez"
							estado="Incumplida"
							resultado="No se recibió el pago"
						/>
						<HistorialPromesaItem
							fechaCreacion="02 jul 2026"
							monto="Q 3,000.00"
							fechaCompromiso="05/07/2026"
							responsable="C. Ramírez"
							estado="Cumplida"
							resultado="Pago recibido a tiempo"
						/>
						<HistorialPromesaItem
							fechaCreacion="28 jun 2026"
							monto="Q 1,500.00"
							fechaCompromiso="30/06/2026"
							responsable="C. Ramírez"
							estado="Cancelada"
							resultado="Se reemplazó por un convenio"
						/>
					</HistorialPromesas>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}

import type * as React from "react";
import { useState } from "react";
import {
	MarcarAusenteVista,
	type MarcarAusenteVistaProps,
	type ModoAusencia,
	type MotivoAusencia,
	type RepartoAusencia,
} from "@/components/cobros/equipo/asignacion/marcar-ausente";
import { AsesorReactivadoVista } from "@/components/cobros/equipo/reactivar-dialogs";
import { dialogPanelClassName } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShowcaseGroup } from "./_layout";
import { POOL } from "./_mi-equipo-asignacion";

/**
 * «Mi equipo» › Disponibilidad (Figma «09 · Disponibilidad y redistribución»)
 * para `cobros-mi-equipo.showcase.tsx`: «Marcar ausente» en sus tres pasos
 * (motivo y qué pasa con la cartera → «Redistribución de cartera» →
 * «Cartera redistribuida» / «Ausencia registrada») y «Asesor reactivado».
 * Datos de ejemplo: Marta Gómez (B2 y B3, 34 créditos), el mismo equipo de
 * la pestaña Asesores.
 */

const nada = () => {};

/** Nueve asesores que reciben (Figma 3360:4254: «28 → 32 +4», «y 3 asesores más…»). */
const RECEPTORES: RepartoAusencia["receptores"] = [
	["Carlos Ramírez", 28, 32],
	["Andrea Solís", 30, 34],
	["Luis Fernández", 27, 31],
	["María López", 32, 36],
	["José Pérez", 30, 33],
	["Ana Díaz", 28, 31],
	["Diego Morales", 29, 32],
	["Lucía Méndez", 25, 29],
	["Pedro Castillo", 31, 34],
].map(([nombre, antes, despues], i) => ({
	asesorId: 100 + i,
	nombre: nombre as string,
	antes: antes as number,
	despues: despues as number,
}));

const REPARTO: RepartoAusencia = {
	cuentas: 32,
	conservadas: 2,
	bloqueadas: 0,
	venceEn: "2099-01-01T00:00:00.000Z",
	receptores: RECEPTORES,
};

const BASE: MarcarAusenteVistaProps = {
	paso: "formulario",
	cargando: false,
	errorCarga: false,
	onReintentar: nada,
	titulares: POOL,
	titular: "3",
	onTitular: nada,
	titularInfo: { nombre: "Marta Gómez", buckets: [2, 3], creditos: 34 },
	avisoTitular: null,
	suplente: "1",
	onSuplente: nada,
	suplentes: POOL.filter((a) => a.asesor_id === 1 || a.asesor_id === 2),
	nombreSuplente: "Carlos Ramírez",
	motivo: "vacaciones",
	onMotivo: nada,
	modo: "suplente",
	onModo: nada,
	reparto: null,
	previewVencida: false,
	onRecalcular: nada,
	desde: "2026-10-19",
	hasta: "2026-10-30",
	onDesde: nada,
	onHasta: nada,
	hoy: "2026-10-15",
	error: null,
	errorServidor: null,
	pendiente: false,
	onCancelar: nada,
	onContinuar: nada,
	onVolver: nada,
	onConfirmar: nada,
	resultado: null,
	onListo: nada,
};

function PanelModal({ children }: { children: React.ReactNode }) {
	return (
		<div className={cn(dialogPanelClassName, "w-full max-w-120")}>
			{children}
		</div>
	);
}

/** Los tres pasos, interactivos (sin servidor). */
function DemoMarcarAusente() {
	const [paso, setPaso] =
		useState<MarcarAusenteVistaProps["paso"]>("formulario");
	const [motivo, setMotivo] = useState<MotivoAusencia>("vacaciones");
	const [modo, setModo] = useState<ModoAusencia>("suplente");
	const [desde, setDesde] = useState(BASE.desde);
	const [hasta, setHasta] = useState(BASE.hasta);
	const [suplente, setSuplente] = useState("1");
	const nombreSuplente =
		POOL.find((a) => String(a.asesor_id) === suplente)?.nombre ?? null;
	return (
		<PanelModal>
			<MarcarAusenteVista
				{...BASE}
				paso={paso}
				motivo={motivo}
				onMotivo={(m) => {
					setMotivo(m);
					if (m === "incidente") setModo("equipo");
				}}
				modo={modo}
				onModo={setModo}
				desde={desde}
				onDesde={setDesde}
				hasta={hasta}
				onHasta={setHasta}
				suplente={suplente}
				onSuplente={setSuplente}
				nombreSuplente={nombreSuplente}
				error={
					modo === "suplente" && !suplente
						? "Seleccione al compañero que atenderá su agenda."
						: null
				}
				reparto={REPARTO}
				onContinuar={() => setPaso(modo === "equipo" ? "revision" : "exito")}
				onVolver={() => setPaso("formulario")}
				onConfirmar={() => setPaso("exito")}
				resultado={{ cuentas: 32, receptores: RECEPTORES.length }}
				onListo={() => setPaso("formulario")}
			/>
		</PanelModal>
	);
}

/** Grupos de «Marcar ausente» y «Asesor reactivado». */
export function GruposDisponibilidad() {
	return (
		<>
			<ShowcaseGroup title="Marcar ausente · los tres pasos (interactivo; Figma 3359:4251, 3367:4244, 3360:4254 y 3360:4312)">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<DemoMarcarAusente />
					<PanelModal>
						<MarcarAusenteVista
							{...BASE}
							titular=""
							titularInfo={null}
							suplente=""
							suplentes={[]}
							nombreSuplente={null}
							error="Seleccione al asesor que se ausenta."
						/>
					</PanelModal>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Marcar ausente · paso 1 con «Incidente» (solo se reparte) y sin compañero que cubra sus buckets">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<PanelModal>
						<MarcarAusenteVista {...BASE} motivo="incidente" modo="equipo" />
					</PanelModal>
					<PanelModal>
						<MarcarAusenteVista
							{...BASE}
							motivo="permiso"
							suplente=""
							suplentes={[]}
							nombreSuplente={null}
							error="Seleccione al compañero que atenderá su agenda."
						/>
					</PanelModal>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Marcar ausente · paso 2 «Redistribución de cartera»: normal, vencida y bloqueada">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<PanelModal>
						<MarcarAusenteVista
							{...BASE}
							paso="revision"
							motivo="incidente"
							modo="equipo"
							reparto={REPARTO}
						/>
					</PanelModal>
					<PanelModal>
						<MarcarAusenteVista
							{...BASE}
							paso="revision"
							motivo="permiso"
							modo="equipo"
							previewVencida
							reparto={{
								...REPARTO,
								conservadas: 0,
								receptores: RECEPTORES.slice(0, 3),
							}}
						/>
					</PanelModal>
					<PanelModal>
						<MarcarAusenteVista
							{...BASE}
							paso="revision"
							motivo="incidente"
							modo="equipo"
							reparto={{
								...REPARTO,
								bloqueadas: 12,
								receptores: RECEPTORES.slice(0, 2),
							}}
						/>
					</PanelModal>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Marcar ausente · paso 3: «Cartera redistribuida» y «Ausencia registrada» (Figma 3360:4312)">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<PanelModal>
						<MarcarAusenteVista
							{...BASE}
							paso="exito"
							motivo="incidente"
							modo="equipo"
							resultado={{ cuentas: 32, receptores: 9 }}
						/>
					</PanelModal>
					<PanelModal>
						<MarcarAusenteVista {...BASE} paso="exito" />
					</PanelModal>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Asesor reactivado (Figma 3366:4235): con reparto al equipo y con suplente">
				<div className="flex flex-wrap items-start gap-6 py-4">
					<PanelModal>
						<AsesorReactivadoVista
							nombre="Diego Morales"
							resultado={{
								devueltas: 31,
								retenidas: [
									{ motivo: "cambio_de_dueno" },
									{ motivo: "cambio_de_dueno" },
									{ motivo: "fuera_del_funnel" },
								],
							}}
							onCerrar={nada}
						/>
					</PanelModal>
					<PanelModal>
						<AsesorReactivadoVista nombre="Marta Gómez" onCerrar={nada} />
					</PanelModal>
				</div>
			</ShowcaseGroup>
		</>
	);
}

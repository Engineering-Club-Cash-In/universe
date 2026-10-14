import {
	Briefcase,
	Clock,
	CreditCard,
	History,
	Home,
	LockOpen,
	Mail,
	Phone,
	Users,
} from "lucide-react";
import * as React from "react";
import { CuentaNexa } from "@/components/cobros/cuenta-nexa";
import { SolicitarDocumentoVista } from "@/components/cobros/ficha/documentos-caso";
import {
	DatosPersonalesCard,
	DireccionCard,
	EncabezadoModulo,
	PersonaContacto,
} from "@/components/cobros/ficha/ficha-modulos";
import {
	AsistenteIA,
	CuotaPlanFila,
	DocumentosFicha,
	HistorialGestiones,
	PendienteBackend,
	ResumenCuentaCard,
	RotuloSeccion,
	SeccionHistorial,
} from "@/components/cobros/ficha/ficha-pestanas";
import {
	CardContactoResumen,
	CardEstadoCobro,
	CardSeguroFicha,
	FilaSeguimiento,
	FranjaSeguimiento,
} from "@/components/cobros/ficha/ficha-resumen";
import { NotificacionesGpsVista } from "@/components/cobros/gps-eventos-historial";
import { UbicacionesClaveLista } from "@/components/cobros/gps-ubicaciones-clave-card";
import { UbicacionesFrecuentesVista } from "@/components/cobros/ubicaciones/frecuentes-vista";
import type {
	ConsultaGps,
	GpsVehiculoOutput,
} from "@/components/cobros/ubicaciones/gps-derivar";
import {
	GpsUbicacionVista,
	type HistorialGps,
} from "@/components/cobros/ubicaciones/gps-ubicacion-vista";
import { PanelVacio } from "@/components/cobros/ubicaciones/panel";
import {
	VehiculoEdicionForm,
	VehiculoResumen,
} from "@/components/cobros/ubicaciones/vehiculo-resumen";
import {
	type DireccionVisitas,
	VisitasUbicacionVista,
} from "@/components/cobros/ubicaciones/visitas-vista";
import {
	PestanasUbicacion,
	type PestanaUbicacion,
} from "@/components/cobros/vehiculo-gps-tabs";
import { BucketBadge, MoraBadge, PromesaBadge } from "@/components/ds/badges";
import { CardCobro, CardPromesa } from "@/components/ds/cards-cobranza";
import { CrmPill } from "@/components/ds/cards-credito";
import { FichaSaveBar } from "@/components/ds/ficha-edicion";
import { HeaderCredito } from "@/components/ds/header-credito";
import { Timeline, TimelineItem } from "@/components/ds/timeline";
import { MapView, SegmentedNav } from "@/components/ds/ubicaciones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dialogPanelClassName } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 320,
	title: "Cobros · Ficha 360",
	figma: "CRM Ventas › Asesor Junior › 04 · Consulta · Ficha 360 (1887:4118)",
	description:
		"La Ficha 360 rediseñada (/cobros/$id) con datos de ejemplo: encabezado, Resumen, Contacto (con un correo largo), Ubicaciones, Edición (direcciones editables), Historial, Estado de cuenta, Documentos (con el modal de solicitud) y Asistente IA. Los bloques sin backend se ven como «Pronto».",
};

function Marco({ children }: { children: React.ReactNode }) {
	return (
		<div className="space-y-5 overflow-hidden rounded-2xl border border-line-subtle bg-canvas p-6">
			{children}
		</div>
	);
}

function Encabezado({ tab = "resumen" }: { tab?: string }) {
	return (
		<>
			<HeaderCredito
				cliente="Cristian Hernández López"
				numeroCredito="01010214106280"
				bucket={
					<BucketBadge bucket="B1" formato="Completa">
						Alerta Temprana
					</BucketBadge>
				}
				mora={<MoraBadge mora="Mora30" />}
				estadoChip={
					<CrmPill kind="chip" tone="info">
						Sin acuerdo
					</CrmPill>
				}
				acciones={
					<div className="flex flex-wrap gap-2">
						<Button variant="outline">Registrar Contacto</Button>
						<Button variant="outline">Promesa / Convenio</Button>
						<Button variant="outline">Más acciones</Button>
						<Button>Registrar Pago</Button>
					</div>
				}
				asesor="Caren Rivera"
				saldo="Q41,600.00"
				fechaPago="15 de cada mes"
				diasMora={30}
				ultimaActualizacion="6 oct 2026 · 14:32"
				datosExtra={[
					{ label: "Capital activo", valor: "Q38,900.00" },
					{ label: "Cuotas restantes", valor: "13 de 48" },
					{ label: "Vehículo", valor: "Toyota Hilux 2021 · P-472GST" },
					{
						label: "Cuenta Nexa",
						valor: <CuentaNexa cuenta="CASHIN502123456789" />,
					},
				]}
			/>
			<Tabs value={tab}>
				<TabsList>
					<TabsTrigger value="resumen">Resumen</TabsTrigger>
					<TabsTrigger value="historial" count={8}>
						Historial
					</TabsTrigger>
					<TabsTrigger value="estado-cuenta">Estado de cuenta</TabsTrigger>
					<TabsTrigger value="ubicaciones">Ubicaciones</TabsTrigger>
					<TabsTrigger value="documentos">Documentos</TabsTrigger>
					<TabsTrigger value="referencias" count={4}>
						Referencias
					</TabsTrigger>
					<TabsTrigger value="asistente">Asistente IA</TabsTrigger>
				</TabsList>
			</Tabs>
		</>
	);
}

const CORREO_LARGO = "cristian.hernandez7081994@gmail.com";

export default function CobrosFicha360Showcase() {
	return (
		<div className="space-y-8">
			<ShowcaseGroup title="Resumen">
				<Marco>
					<Encabezado />
					<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
						<div className="min-w-0 space-y-4">
							<FranjaSeguimiento contactabilidad="alta" diasSinGestion={3} />
							<FilaSeguimiento
								intentos={2}
								ultimoIntento="11 ago 2026"
								proximo={{ estado: "Hoy" }}
							/>
							<CardEstadoCobro
								estado={{ etiqueta: "En mora", tone: "danger" }}
								diasMora={30}
								bucket="bucket B1"
								filas={[
									{ label: "Cuotas vencidas", valor: "1" },
									{ label: "Cuotas pagadas", valor: "35 / 48" },
									{ label: "Último mes pagado", valor: "jul 2026" },
									{ label: "Fecha de pago", valor: "15 de cada mes" },
									{ label: "Cuota mensual", valor: "Q3,200.00" },
								]}
							>
								<div className="flex flex-wrap items-center gap-1.5 pt-1">
									<span className="text-fg-secondary text-xs">Etiquetas:</span>
									<Badge className="bg-yellow-100 text-yellow-800">
										Compromiso de Pago
									</Badge>
								</div>
							</CardEstadoCobro>
							<CardPromesa
								estado={<PromesaBadge promesa="Vigente" />}
								monto="Q3,400.00"
								fechaCompromiso="12/08/2026"
								responsable="Caren Rivera"
							/>
							<CardCobro
								conceptos={[
									{
										label: "1 cuota vencida",
										detalle: "Q3,200.00 c/u",
										monto: "Q3,200.00",
									},
									{
										label: "Mora acumulada",
										detalle:
											"Sube alrededor de Q6.40 por día, y puede aumentar hasta Q192.00 más en los próximos 30 días.",
										monto: "Q200.00",
									},
								]}
								total="Q3,400.00"
								contexto={[
									"Cuota mensual Q3,200.00",
									"30 días en mora",
									"Total parcial (Mora + Cuota) Q3,400.00",
								]}
							/>
							<Timeline className="max-w-none" onVerTodo={() => undefined}>
								<TimelineItem
									tipo="Promesa"
									usuario="Caren Rivera"
									descripcion="Cliente se comprometió a pagar Q3,400 el 12 de agosto."
									fecha="15 jul 2026"
									hora="10:00"
								/>
								<TimelineItem
									tipo="Llamada"
									usuario="Caren Rivera"
									descripcion="Cliente respondió y confirmó su intención de pago."
									fecha="15 jul 2026"
									hora="09:40"
								/>
								<TimelineItem
									tipo="WhatsApp"
									usuario="Sistema"
									descripcion="Se envió recordatorio de pago por WhatsApp."
									fecha="14 jul 2026"
									hora="12:15"
								/>
							</Timeline>
						</div>
						<div className="min-w-0 space-y-4">
							<CardContactoResumen
								onVerTodo={() => undefined}
								datos={[
									{
										icono: <Phone aria-hidden />,
										label: "Teléfono principal",
										valores: ["46325381", "23703800"].map((t) => ({
											texto: t,
											href: `tel:${t}`,
										})),
									},
									{
										icono: <Mail aria-hidden />,
										label: "Correo",
										valores: [{ texto: CORREO_LARGO, href: "#" }],
									},
									{
										icono: <Home aria-hidden />,
										label: "Residencia",
										valores: [
											{
												texto:
													"7AV 2-56 Fuentes del Valle Norte 4, Zona 18, Chinautla",
											},
										],
									},
									{
										icono: <Briefcase aria-hidden />,
										label: "Trabajo",
										valores: [],
									},
								]}
								aviso="1 número nuevo sin guardar · 3 referencias con teléfono"
							/>
							<CardSeguroFicha
								aseguradora="Seguros G&T"
								tipoSeguro="—"
								telefonoEmergencia="1-801-SEGURO"
								coberturas="—"
								poliza="AUTO-2024-118822"
								montoAsegurado="Q120,000.00"
								vencimiento="30 jun 2027"
							/>
						</div>
					</div>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Contacto (correo largo)">
				<Marco>
					<EncabezadoModulo
						onVolver={() => undefined}
						titulo="Contacto"
						subtitulo="Personas asociadas al crédito · Crédito #01010214106280"
					/>
					<div className="max-w-xl">
						<PersonaContacto
							nombre="Cristian Hernández López"
							rol="Titular"
							onEditar={() => undefined}
							filas={[
								{
									icono: <Mail aria-hidden />,
									label: "Correo",
									valores: [
										{ texto: CORREO_LARGO, href: `mailto:${CORREO_LARGO}` },
									],
								},
								{
									icono: <Phone aria-hidden />,
									label: "Teléfono principal",
									valores: ["46325381", "23703800", "38160906"].map((t) => ({
										texto: t,
										href: `tel:${t}`,
									})),
								},
								{
									icono: <Home aria-hidden />,
									label: "Residencia",
									valores: [
										{
											texto:
												"7AV 2-56 FUENTES DEL VALLE NORTE 4, 7 AVENIDA 2-56, Zona 18 Chinautla, Guatemala",
										},
									],
								},
								{
									icono: <Briefcase aria-hidden />,
									label: "Trabajo",
									valores: [],
								},
							]}
						>
							<p className="text-muted-foreground text-xs">
								La solicitud de crédito no tiene datos laborales.
							</p>
						</PersonaContacto>
					</div>
					<PersonaContacto
						nombre="María José de la Cruz Pérez"
						rol="Codeudor 1"
						filas={[
							{
								icono: <Mail aria-hidden />,
								label: "Correo",
								valores: [{ texto: "mariajose.cruz@gmail.com" }],
							},
							{
								icono: <Phone aria-hidden />,
								label: "Teléfono principal",
								valores: [{ texto: "5587-1203", href: "tel:55871203" }],
							},
							{
								icono: <Home aria-hidden />,
								label: "Residencia",
								valores: [{ texto: "4a. calle 3-12, zona 2, Mixco" }],
							},
							{
								icono: <Briefcase aria-hidden />,
								label: "Trabajo",
								valores: [],
							},
						]}
					/>
					<PendienteBackend titulo="Codeudores">
						No se pudieron cargar los codeudores. Si el crédito no tiene una
						oportunidad vinculada en el CRM, no hay codeudores que mostrar.
					</PendienteBackend>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · GPS con última consulta (sin subpestañas)">
				<Marco>
					<Encabezado tab="ubicaciones" />
					<VehiculoDemo gps="vinculado" />
					<TabsUbicacionDemo inicial="gps" />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · GPS con las consultas anteriores expandidas">
				<Marco>
					<TabsUbicacionDemo inicial="gps" gps={<GpsDemo abiertas />} />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · GPS sin consultas">
				<Marco>
					<TabsUbicacionDemo
						inicial="gps"
						gps={<GpsDemo historial={{ estado: "listo", entradas: [] }} />}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · GPS sin unidad vinculada">
				<Marco>
					<VehiculoDemo gps="sin-gps" />
					<TabsUbicacionDemo
						inicial="gps"
						gps={
							<GpsDemo
								historial={{
									estado: "listo",
									entradas: [consultaDemo("s1", SIN_VINCULO, 0.4)],
								}}
							/>
						}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · GPS cargando y con error">
				<Marco>
					<GpsDemo historial={{ estado: "cargando" }} />
					<GpsDemo
						historial={{
							estado: "error",
							mensaje: "No tiene acceso a este caso de cobros.",
							onReintentar: () => undefined,
						}}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · Ubicaciones frecuentes (última consulta y sin consultas)">
				<Marco>
					<TabsUbicacionDemo inicial="ubicaciones" />
					<FrecuentesDemo vacio />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · Visitas (verificada y sin visita)">
				<Marco>
					<TabsUbicacionDemo inicial="visitas" />
					<VisitasUbicacionVista
						direcciones={[
							{
								clave: "residencia",
								direccionRegistrada: "12 calle 4-55, Zona 10, Guatemala",
								verificacion: null,
							},
							{
								clave: "trabajo",
								direccionRegistrada: null,
								verificacion: null,
							},
						]}
						bloqueoVisita="Las visitas se registran de B2 a B4."
						onRegistrarVisita={() => undefined}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · Notificaciones (con eventos y vacío)">
				<Marco>
					<TabsUbicacionDemo inicial="notificaciones" />
					<NotificacionesGpsVista estado="listo" eventos={[]} />
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones · Vehículo (edición y crédito migrado)">
				<Marco>
					<VehiculoResumen
						titulo="Toyota Hilux 2021"
						placa="P-472GST"
						tipo="Pick-up"
						datos={[]}
						onEditar={() => undefined}
						edicion={
							<VehiculoEdicionForm
								form={{
									make: "Toyota",
									model: "Hilux",
									year: 2021,
									licensePlate: "P-472GST",
								}}
								onChange={() => undefined}
								onGuardar={() => undefined}
								onCancelar={() => undefined}
								guardando={false}
							/>
						}
					/>
					<VehiculoResumen
						titulo="Vehículo sin datos"
						placa={null}
						datos={[]}
						migrado
						onEditar={() => undefined}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Edición de la información del cliente">
				<Marco>
					<EncabezadoModulo
						onVolver={() => undefined}
						titulo="Editar información del cliente"
						derecha={
							<SegmentedNav
								value="info"
								onValueChange={() => undefined}
								opciones={[
									{ value: "info", label: "Información del cliente" },
									{ value: "cambios", label: "Historial de cambios" },
								]}
							/>
						}
					/>
					<div className="grid gap-5 lg:grid-cols-2">
						<DatosPersonalesCard
							datos={[
								{ label: "Nombre completo", valor: "Cristian Hernández López" },
								{ label: "Documento (DPI)", valor: "2547 88190 0101" },
								{ label: "Fecha de nacimiento", valor: null },
								{ label: "Sexo", valor: null },
								{ label: "Estado civil", valor: null },
							]}
						/>
						<div className="space-y-5">
							<DireccionCard
								titulo="Dirección de residencia"
								filas={[
									{
										label: "Dirección",
										valor: "7AV 2-56 FUENTES DEL VALLE NORTE 4, Zona 18",
										onChange: () => undefined,
										placeholder: "Ej.: 5a. avenida 10-20, zona 1",
									},
								]}
								nota="Si deja el campo vacío, se vuelve a usar la dirección registrada del cliente."
							/>
							<DireccionCard
								titulo="Dirección de trabajo"
								filas={[
									{
										label: "Empresa",
										valor: "Distribuidora El Sol, S.A.",
										onChange: () => undefined,
									},
									{
										label: "Dirección",
										valor:
											"12 calle 1-25, zona 10, Edificio Géminis 10, torre norte",
										onChange: () => undefined,
									},
									{ label: "Teléfono del trabajo", valor: "2385-4400" },
									{ label: "Horario", valor: null },
								]}
								nota="Si deja la empresa o la dirección vacías, se vuelve a usar la de la solicitud de crédito. El teléfono y el horario son de la solicitud (solo lectura)."
							/>
						</div>
					</div>
					<FichaSaveBar
						mensaje="Hay cambios sin guardar en el correo y las direcciones"
						onCancelar={() => undefined}
						onGuardar={() => undefined}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Historial actual">
				<Marco>
					<Encabezado tab="historial" />
					<SeccionHistorial
						titulo="Historial del crédito"
						conteo={3}
						icono={<Clock />}
						descripcion="Llamadas, mensajes y visitas registradas por el equipo"
					>
						<HistorialGestiones
							items={[
								{
									id: "1",
									cuando: "20 jul 2026 · 10:30",
									// W1: entrante, con quién se habló y el teléfono.
									titulo: "Llamada entrante",
									badge: (
										<Badge className="bg-green-100 text-green-800">
											Contactado
										</Badge>
									),
									subtitulo: "Por: Caren Rivera",
									contacto: {
										participante: "Habló con: Juan Pérez López (codeudor)",
										telefono: "5555-1234",
									},
									tono: "logrado",
									nota: "Cliente perdió el empleo temporalmente; retomará pagos en agosto.",
									detalles: [
										{
											label: "Seguimiento programado",
											valor: "5 ago 2026 · 10:30 · por WhatsApp",
										},
										{ label: "Próximo paso", valor: "Llamar el 5 de agosto" },
									],
								},
								{
									id: "2",
									cuando: "08 jul 2026 · 11:05",
									titulo: "Llamada",
									badge: (
										<Badge className="bg-yellow-100 text-yellow-800">
											No Contesta
										</Badge>
									),
									subtitulo: "Por: Caren Rivera",
									contacto: {
										participante: "Intentó con: Ana Contreras (titular)",
										telefono: "4444-9876",
									},
									tono: "sin-contacto",
								},
								{
									id: "3",
									cuando: "28 jun 2026 · 09:00",
									titulo: "WhatsApp",
									badge: (
										<Badge className="bg-red-100 text-red-800">
											Rechaza Pagar
										</Badge>
									),
									subtitulo: "Por: Caren Rivera",
									tono: "fallido",
									nota: "Prefiere ser contactado después de las 6:00 pm.",
								},
							]}
						/>
					</SeccionHistorial>
					<SeccionHistorial
						titulo="Vida del crédito"
						conteo={null}
						icono={<History />}
						descripcion="Entradas y salidas de bucket, reestructuras y convenios"
						estado="error"
						onReintentar={() => undefined}
					/>
					<SeccionHistorial
						titulo="Links de pago"
						conteo={0}
						icono={<CreditCard />}
						descripcion="Todos los links Págalo generados para este crédito"
						estado="vacio"
						vacio="Sin links de pago generados para este crédito."
					/>
					<SeccionHistorial
						titulo="Referencias"
						conteo={0}
						icono={<Users />}
						derecha={<Button size="sm">Agregar</Button>}
						estado="vacio"
						vacio="No hay referencias registradas: ni en cobros, ni en la solicitud de crédito, ni cofirmantes."
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Estado de cuenta">
				<Marco>
					<Button size="lg" className="w-full">
						Enviar por WhatsApp
					</Button>
					<ResumenCuentaCard
						saldoTotal="Q42,000.00"
						filas={[
							{ label: "Saldo vencido", valor: "Q1,850.00", tono: "danger" },
							{ label: "Cuotas restantes", valor: "36 de 48" },
							{ label: "Próximo pago", valor: "07/08/2026" },
						]}
					/>
					<div>
						<RotuloSeccion>Plan de pagos</RotuloSeccion>
						<CuotaPlanFila
							titulo="Cuota 13 de 48"
							estado="vencida"
							monto="Q1,850.00"
							montoDetalle="+Q120.00 mora"
							lineas={["Venció 07/07/2026", "Total: Q1,970.00"]}
						>
							<p className="text-xs">Pagos aplicados (1)…</p>
						</CuotaPlanFila>
						<CuotaPlanFila
							titulo="Cuota 12 de 48"
							estado="pagada"
							monto="Q1,850.00"
							lineas={["Vence 07/06/2026", "Pagó 03/06/2026 · Q1,850.00"]}
						/>
					</div>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Documentos">
				<Marco>
					<DocumentosFicha
						enviar={[
							{
								clave: "tarjeta-circulacion",
								nombre: "Tarjeta de circulación",
								descripcion: "Documento vehicular",
								onClick: () => undefined,
								cargando: true,
							},
							{
								clave: "seguro",
								nombre: "Información de seguro",
								descripcion: "Póliza vigente",
								estado: { etiqueta: "Sin archivo", tone: "neutral" },
								motivoDeshabilitado:
									"Este crédito no tiene ese documento cargado.",
							},
							{
								clave: "estado-cuenta",
								nombre: "Estado de cuenta",
								descripcion: "Resumen del crédito, por WhatsApp",
								onClick: () => undefined,
							},
							{
								clave: "carta-notarial",
								nombre: "Carta notarial",
								descripcion: "Registrar el envío de la carta",
								onClick: () => undefined,
							},
						]}
						solicitar={[
							{
								clave: "contrato",
								nombre: "Contrato de crédito",
								descripcion: "PDF · Documento legal",
								onClick: () => undefined,
							},
							{
								clave: "carta-poder",
								nombre: "Carta poder",
								descripcion: "Requiere firma del titular",
								estado: { etiqueta: "Solicitado", tone: "warning" },
								motivoDeshabilitado:
									"Ya hay una solicitud pendiente de este documento.",
							},
							{
								clave: "cambio-placas",
								nombre: "Cambio de placas",
								descripcion: "Trámite vehicular",
								onClick: () => undefined,
							},
							{
								clave: "expertaje",
								nombre: "Expertaje",
								descripcion: "Avalúo del vehículo",
								onClick: () => undefined,
							},
						]}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Documentos · Solicitar al supervisor (modal)">
				<div
					className={cn(dialogPanelClassName, "max-w-md")}
					data-testid="modal-solicitar-documento"
				>
					<SolicitarDocumentoVista
						documento="Contrato de crédito"
						comentario="El cliente necesita el contrato para un trámite en el banco."
						onComentario={() => undefined}
						error="Ya hay una solicitud pendiente de «Contrato de crédito» para este caso."
						pendiente={false}
						onCancelar={() => undefined}
						onSolicitar={() => undefined}
					/>
				</div>
			</ShowcaseGroup>

			<ShowcaseGroup title="Asistente IA">
				<Marco>
					<AsistenteIA
						resumen={{
							texto:
								"Crédito con 23 días de mora y una cuota vencida. La última gestión fue una llamada sin contacto el 8 oct. El cliente cumplió su última promesa de pago en septiembre.",
							etiquetas: ["Mora temprana", "Promesa cumplida"],
							generadoEn: "2026-10-08T20:28:26.119Z",
						}}
						onPreguntar={async () => ({
							respuesta: "Debe pagar Q6,038.34 para ponerse al día.",
						})}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Asistente IA (apagado)">
				<Marco>
					<AsistenteIA resumen={null} />
				</Marco>
			</ShowcaseGroup>
		</div>
	);
}

/* ── Ubicaciones: datos de ejemplo ──────────────────────────────────────────── */

const MAPA_DEMO = (
	<MapView className="h-52 w-full sm:h-64 lg:h-auto lg:min-h-64 lg:flex-1" />
);

const HACE = (horas: number) => new Date(Date.now() - horas * 3_600_000);

const telemetriaDemo = (
	lat: number,
	horasPosicion: number,
	velocidad = 0,
): GpsVehiculoOutput => ({
	estado: "vinculado",
	auditada: true,
	unitId: 4721,
	unitName: "P-472GST HILUX",
	vinculoOrigen: "persistido",
	placa: "P-472GST",
	telemetria: {
		latitude: lat,
		longitude: -90.5069,
		speedKmh: velocidad,
		isIgnitionOn: velocidad > 0,
		mileageKm: 84_213,
		engineHours: 2_310,
		ultimaSenalAt: HACE(horasPosicion),
		ultimaPosicionAt: HACE(horasPosicion),
	},
});

const SIN_VINCULO: GpsVehiculoOutput = {
	estado: "sin_vinculo",
	auditada: true,
	motivo: "sin_coincidencia",
	placa: "P-472GST",
	candidatos: [],
};

function consultaDemo(
	id: string,
	snapshot: GpsVehiculoOutput | null,
	horas: number,
	opciones: {
		motivo?: string;
		usuario?: string;
		origen?: string;
		repeticiones?: number;
	} = {},
): ConsultaGps {
	const createdAt = HACE(horas);
	const motivo =
		opciones.motivo ?? "Cliente no contesta, ubicar antes de la visita";
	const usuario = opciones.usuario ?? "Caren Rivera";
	return {
		id,
		motivo,
		origen: opciones.origen ?? "telemetria",
		unitName: "P-472GST HILUX",
		userNombre: usuario,
		createdAt,
		snapshot,
		consultas: Array.from({ length: opciones.repeticiones ?? 1 }, (_, i) => ({
			id: `${id}-${i}`,
			motivo: i === 0 ? motivo : "Seguimiento de promesa incumplida",
			userNombre: i === 0 ? usuario : "Samuel Gamboa",
			createdAt: HACE(horas + i * 20),
		})),
	};
}

const HISTORIAL_GPS: HistorialGps = {
	estado: "listo",
	entradas: [
		consultaDemo("g1", telemetriaDemo(14.5951, 0.15), 0.1, { repeticiones: 2 }),
		consultaDemo("g2", null, 26, {
			origen: "ubicaciones_clave",
			motivo: "Preparar visita de recuperación",
			usuario: "Samuel Gamboa",
		}),
		consultaDemo("g3", telemetriaDemo(14.6312, 30, 42), 30, {
			motivo: "Confirmar si el vehículo circula en horario laboral",
		}),
		consultaDemo(
			"g4",
			{
				estado: "no_disponible",
				auditada: true,
				error: {
					code: "WIALON_TIMEOUT",
					message: "Wialon no respondió a tiempo.",
				},
				referencia: "gps-7f3a91",
			},
			52,
			{ motivo: "Verificar ubicación por denuncia de venta" },
		),
		consultaDemo("g5", telemetriaDemo(14.6011, 75), 75),
		consultaDemo("g6", telemetriaDemo(14.6044, 99), 99),
		consultaDemo("g7", telemetriaDemo(14.6099, 120), 120),
	],
};

function GpsDemo({
	historial = HISTORIAL_GPS,
	abiertas = false,
}: {
	historial?: HistorialGps;
	abiertas?: boolean;
}) {
	return (
		<GpsUbicacionVista
			anterioresAbiertas={abiertas}
			historial={historial}
			enVivo={null}
			historialActualizado={false}
			esSupervisor={false}
			onConsultar={() => undefined}
			idCampo="motivo-gps-demo"
			mapa={MAPA_DEMO}
		/>
	);
}

const LUGARES_DEMO = [
	{
		id: "u1",
		lat: 14.5951,
		lon: -90.5069,
		radioM: 80,
		tipo: "probable_casa" as const,
		horasTotales: 412,
		diasDistintos: 52,
		visitas: 58,
		patron: { noches: 41, nochesTotales: 52, nocturna: 300, laboral: 60 },
		ultimaVisita: HACE(10),
		primeraVisita: HACE(24 * 60),
		calculadoAt: HACE(8),
		confirmadaDomicilio: true,
	},
	{
		id: "u2",
		lat: 14.6011,
		lon: -90.5132,
		radioM: 60,
		tipo: "probable_trabajo" as const,
		horasTotales: 186,
		diasDistintos: 31,
		visitas: 33,
		patron: { laboral: 160, nocturna: 0 },
		ultimaVisita: HACE(30),
		primeraVisita: HACE(24 * 58),
		calculadoAt: HACE(8),
	},
	{
		id: "u3",
		lat: 14.6211,
		lon: -90.5301,
		radioM: 50,
		tipo: "recurrente" as const,
		horasTotales: 24,
		diasDistintos: 8,
		visitas: 9,
		patron: { visitasPorDiaSemana: [0, 0, 0, 0, 0, 0, 8] },
		ultimaVisita: HACE(80),
		primeraVisita: HACE(24 * 50),
		calculadoAt: HACE(8),
	},
];

function FrecuentesDemo({ vacio = false }: { vacio?: boolean }) {
	return (
		<UbicacionesFrecuentesVista
			historial={
				vacio
					? { estado: "listo", entradas: [] }
					: {
							estado: "listo",
							entradas: [
								{
									id: "f1",
									motivo: "Preparar visita de recuperación",
									userNombre: "Samuel Gamboa",
									createdAt: HACE(26),
									snapshot: { ubicaciones: LUGARES_DEMO },
								},
								{
									id: "f2",
									motivo: "Cliente indica que cambió de residencia",
									userNombre: "Caren Rivera",
									createdAt: HACE(24 * 9),
									snapshot: { ubicaciones: LUGARES_DEMO.slice(0, 1) },
								},
							],
						}
			}
			enVivo={null}
			historialActualizado={false}
			onConsultar={() => undefined}
			idCampo={vacio ? "motivo-frecuentes-vacio" : "motivo-frecuentes-demo"}
			renderLugares={(lugares) => (
				<UbicacionesClaveLista ubicaciones={lugares} />
			)}
		/>
	);
}

const VISITAS_DEMO: DireccionVisitas[] = [
	{
		clave: "residencia",
		direccionRegistrada: "12 calle 4-55, Zona 10, Guatemala",
		verificacion: {
			direccion: "12 calle 4-55, Zona 10, Guatemala",
			mapa: (
				<MapView className="h-52 w-full sm:h-60 lg:h-auto lg:min-h-60 lg:flex-1" />
			),
			fotos: [{}, {}, {}, {}, {}],
			comentarios:
				"Se confirmó que el titular reside en la dirección indicada. Casa de dos niveles, portón negro. Atendió un familiar directo.",
			resultado: "Promesa de pago",
			fecha: "12 jun 2026",
			responsable: "Carlos Ramírez",
		},
	},
	{
		clave: "trabajo",
		direccionRegistrada: "Distribuidora El Sol, 12 calle 1-25, zona 10",
		verificacion: null,
	},
];

function VehiculoDemo({ gps }: { gps: "vinculado" | "sin-gps" }) {
	return (
		<VehiculoResumen
			titulo="Toyota Hilux 2021"
			placa="P-472GST"
			tipo="Pick-up"
			gps={
				gps === "vinculado" ? (
					<CrmPill kind="chip" tone="success">
						GPS vinculado
					</CrmPill>
				) : (
					<CrmPill kind="chip" tone="warning">
						Sin GPS vinculado
					</CrmPill>
				)
			}
			onEditar={() => undefined}
			datos={[
				{ label: "Motor", valor: "2GD-4829173" },
				{ label: "Chasis", valor: "MR0HA3CD100783402" },
				{ label: "Pasajeros", valor: "5" },
				{ label: "Uso", valor: "Particular" },
				{ label: "Póliza de seguro", valor: "AUTO-2024-118822" },
				{ label: "Monto asegurado", valor: "Q120,000" },
				{ label: "Vencimiento del seguro", valor: "30/6/2027" },
			]}
		/>
	);
}

function TabsUbicacionDemo({
	inicial,
	gps = <GpsDemo />,
}: {
	inicial: PestanaUbicacion;
	gps?: React.ReactNode;
}) {
	const [pestana, setPestana] = React.useState<PestanaUbicacion>(inicial);
	return (
		<PestanasUbicacion
			value={pestana}
			onValueChange={setPestana}
			gps={gps}
			frecuentes={<FrecuentesDemo />}
			visitas={
				<VisitasUbicacionVista
					direcciones={VISITAS_DEMO}
					onRegistrarVisita={() => undefined}
					onFotoClick={() => undefined}
				/>
			}
			notificaciones={
				<NotificacionesGpsVista
					estado="listo"
					eventos={[
						{
							id: "e1",
							tipo: "desconexion_energia",
							wialonUnitId: 4721,
							ocurridoAt: HACE(5),
							lat: 14.5951,
							lon: -90.5069,
							velocidadKmh: 0,
							notificado: true,
						},
						{
							id: "e2",
							tipo: "sin_reportar",
							wialonUnitId: 4721,
							ocurridoAt: HACE(50),
							lat: null,
							lon: null,
							velocidadKmh: null,
							notificado: false,
						},
					]}
				/>
			}
			conteoNotificaciones={2}
			apagado={
				<PanelVacio
					icono={<LockOpen />}
					titulo="Este crédito no tiene inmovilización de unidad disponible"
					descripcion="El apagado se habilita en B2, B3 y B4 para unidades con GPS vinculado."
				/>
			}
		/>
	);
}

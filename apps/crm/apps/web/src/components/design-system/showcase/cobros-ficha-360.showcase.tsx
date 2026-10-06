import {
	Briefcase,
	Clock,
	CreditCard,
	Home,
	Mail,
	Phone,
	Users,
} from "lucide-react";
import type * as React from "react";
import {
	DatosPersonalesCard,
	DireccionCard,
	EncabezadoModulo,
	PersonaContacto,
	UbicacionVerificada,
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
import { BucketBadge, MoraBadge, PromesaBadge } from "@/components/ds/badges";
import {
	CardCobro,
	CardPromesa,
} from "@/components/ds/cards-cobranza";
import { CrmPill } from "@/components/ds/cards-credito";
import { FichaSaveBar } from "@/components/ds/ficha-edicion";
import { HeaderCredito } from "@/components/ds/header-credito";
import { Timeline, TimelineItem } from "@/components/ds/timeline";
import { MapView, SegmentedNav } from "@/components/ds/ubicaciones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShowcaseGroup, type ShowcaseMeta } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 320,
	title: "Cobros · Ficha 360",
	figma: "CRM Ventas › Asesor Junior › 04 · Consulta · Ficha 360 (1887:4118)",
	description:
		"La Ficha 360 rediseñada (/cobros/$id) con datos de ejemplo: encabezado, Resumen, Contacto (con un correo largo), Ubicaciones, Edición, Historial, Estado de cuenta, Documentos y Asistente IA. Los bloques sin backend se ven como «Pronto».",
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
					<PendienteBackend titulo="Codeudores">
						Los codeudores del crédito y sus datos de contacto se mostrarán
						aquí. Pendiente de backend (tarea F2).
					</PendienteBackend>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ubicaciones verificadas (con visita y sin visita)">
				<Marco>
					<EncabezadoModulo onVolver={() => undefined}>
						<SegmentedNav
							className="w-full"
							value="verificadas"
							onValueChange={() => undefined}
							opciones={[
								{ value: "verificadas", label: "Ubicaciones verificadas" },
								{ value: "vehiculo", label: "Ubicación del vehículo" },
							]}
						/>
					</EncabezadoModulo>
					<UbicacionVerificada
						persona="Cristian Hernández López"
						verificacion={{
							direccion: "12 calle 4-55, Zona 10, Guatemala",
							mapa: <MapView className="h-64 w-full" />,
							fotos: [{}, {}, {}, {}, {}],
							comentarios:
								"Se confirmó que el titular reside en la dirección indicada. Casa de dos niveles, portón negro.",
							resultado: "Promesa de pago",
							pie: "Verificada el 12 jun 2026 · Responsable: Carlos Ramírez",
						}}
					/>
					<UbicacionVerificada
						persona="Cristian Hernández López"
						verificacion={null}
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
						<DireccionCard
							titulo="Dirección de residencia"
							filas={[
								{
									label: "Dirección",
									valor: "7AV 2-56 FUENTES DEL VALLE NORTE 4, Zona 18",
								},
							]}
							nota="La edición de direcciones queda pendiente de backend (tarea F8)."
						/>
					</div>
					<FichaSaveBar
						mensaje="El correo tiene cambios sin guardar"
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
									titulo: "Llamada",
									badge: (
										<Badge className="bg-green-100 text-green-800">
											Contactado
										</Badge>
									),
									subtitulo: "Por: Caren Rivera",
									tono: "logrado",
									nota: "Cliente perdió el empleo temporalmente; retomará pagos en agosto.",
									detalles: [
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
								clave: "tc",
								nombre: "Tarjeta de circulación",
								descripcion: "Documento vehicular",
							},
							{
								clave: "ec",
								nombre: "Estado de cuenta",
								descripcion: "Resumen del crédito, por WhatsApp",
								onClick: () => undefined,
							},
						]}
						solicitar={[
							{
								clave: "contrato",
								nombre: "Contrato de crédito",
								descripcion: "PDF · Documento legal",
							},
						]}
					/>
				</Marco>
			</ShowcaseGroup>

			<ShowcaseGroup title="Asistente IA (pendiente)">
				<Marco>
					<AsistenteIA resumen={null} />
				</Marco>
			</ShowcaseGroup>
		</div>
	);
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	DOMINIO_CORREO_CRM,
	type RolAsesor,
} from "server/src/lib/alta-baja-asesor";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { orpcAparte } from "@/utils/orpc";
import {
	AltaAsesorVista,
	type CarteraAlta,
	type PasoAlta,
	type ResultadoAlta,
} from "./alta-asesor-vista";
import { refrescarEquipo } from "./datos";
import { MarcoAltaBaja } from "./piezas";

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Crear asesor» (botón del encabezado de Mi equipo, `?accion=alta`). Datos:
 *   - supervisores        → getSupervisoresCobros
 *   - «Siguiente: cartera» → previsualizarAltaAsesor (usuario del CRM, equipo
 *                            del nivel y recomendación; no escribe)
 *   - «Crear asesor»      → crearAsesorCobros (usuario del CRM → asesor y pool
 *                            en cartera → cartera inicial). Repetirlo con los
 *                            mismos datos retoma lo que falte.
 */
export function AltaAsesorDialog({
	abierto,
	onCerrar,
}: {
	abierto: boolean;
	onCerrar: () => void;
}) {
	const [ocupado, setOcupado] = useState(false);
	return (
		<MarcoAltaBaja
			abierto={abierto}
			ocupado={ocupado}
			titulo="Crear asesor"
			descripcion="Registre al asesor, su rol y su supervisor, y elija cuántos créditos recibe del equipo."
			onCerrar={onCerrar}
		>
			{abierto ? (
				<FormularioAlta onOcupado={setOcupado} onCerrar={onCerrar} />
			) : null}
		</MarcoAltaBaja>
	);
}

function FormularioAlta({
	onOcupado,
	onCerrar,
}: {
	onOcupado: (ocupado: boolean) => void;
	onCerrar: () => void;
}) {
	const navigate = useNavigate();
	const { data: sesion } = authClient.useSession();
	const [paso, setPaso] = useState<PasoAlta>("datos");
	const [nombre, setNombre] = useState("");
	const [correo, setCorreo] = useState("");
	const [rol, setRol] = useState<RolAsesor>("junior");
	const [supervisorId, setSupervisorId] = useState("");
	const [cartera, setCartera] = useState<CarteraAlta | null>(null);
	const [bloqueo, setBloqueo] = useState<string | null>(null);
	const [creditos, setCreditos] = useState(0);
	const [resultado, setResultado] = useState<ResultadoAlta | null>(null);

	const supervisores = useQuery(
		orpcAparte.getSupervisoresCobros.queryOptions(),
	);
	// Por defecto, quien da de alta (si es supervisor de cobros).
	useEffect(() => {
		if (supervisorId || !supervisores.data) return;
		const propio = supervisores.data.find((s) => s.userId === sesion?.user.id);
		if (propio) setSupervisorId(propio.userId);
	}, [supervisores.data, sesion?.user.id, supervisorId]);

	const previsualizar = useMutation({
		...orpcAparte.previsualizarAltaAsesor.mutationOptions(),
		retry: false,
		onSuccess: (data) => {
			setBloqueo(data.bloqueo);
			if (data.bloqueo) return;
			setCartera({
				usuario: data.usuario,
				asesorExistente: data.asesorExistente,
				equipo: data.equipo,
				recomendacion: data.recomendacion,
			});
			setCreditos(
				Math.max(
					data.recomendacion.recomendado,
					data.asesorExistente?.carga ?? 0,
				),
			);
			setPaso("cartera");
		},
	});
	const crear = useMutation({
		...orpcAparte.crearAsesorCobros.mutationOptions(),
		retry: false,
		onSuccess: (data) => {
			setResultado({
				asesorId: data.asesorId,
				nombre: data.nombre,
				rol: data.rol,
				asignados: data.asignados,
				usuario: data.usuario,
			});
			setPaso("creado");
			toast.success("Asesor creado", {
				description: `${data.nombre} recibió ${data.asignados} créditos.`,
			});
		},
		// Aun con error, algo pudo quedar hecho (usuario o asesor): se refresca.
		onSettled: () => void refrescarEquipo(),
	});
	const pendiente = previsualizar.isPending || crear.isPending;
	useEffect(() => onOcupado(pendiente), [pendiente, onOcupado]);

	// Cualquier cambio en los datos invalida la cartera calculada.
	const cambiar = () => {
		setBloqueo(null);
		setCartera(null);
		previsualizar.reset();
		crear.reset();
	};

	const correoLimpio = correo.trim().toLowerCase();
	const errorDatos = !nombre.trim()
		? "Ingrese el nombre completo del asesor."
		: !CORREO.test(correoLimpio)
			? "Ingrese el correo del asesor."
			: !correoLimpio.endsWith(DOMINIO_CORREO_CRM)
				? `El correo debe ser ${DOMINIO_CORREO_CRM}.`
				: supervisores.data?.length && !supervisorId
					? "Seleccione el supervisor."
					: null;

	return (
		<AltaAsesorVista
			paso={paso}
			nombre={nombre}
			onNombre={(v) => {
				setNombre(v);
				cambiar();
			}}
			correo={correo}
			onCorreo={(v) => {
				setCorreo(v);
				cambiar();
			}}
			rol={rol}
			onRol={(r) => {
				setRol(r);
				cambiar();
			}}
			supervisores={
				supervisores.isError
					? []
					: (supervisores.data?.map((s) => ({
							userId: s.userId,
							nombre: s.nombre,
						})) ?? null)
			}
			supervisorId={supervisorId}
			onSupervisor={setSupervisorId}
			errorDatos={
				supervisores.isError
					? "No se pudieron cargar los supervisores. Cierre y vuelva a intentarlo."
					: errorDatos
			}
			bloqueo={bloqueo}
			errorServidor={(previsualizar.error ?? crear.error)?.message ?? null}
			pendiente={pendiente}
			cartera={cartera}
			creditos={creditos}
			onCreditos={setCreditos}
			resultado={resultado}
			onCancelar={onCerrar}
			onSiguiente={() =>
				previsualizar.mutate({
					nombre: nombre.trim(),
					email: correoLimpio,
					rol,
				})
			}
			onAtras={() => {
				crear.reset();
				setPaso("datos");
			}}
			onCrear={() =>
				crear.mutate({
					nombre: nombre.trim(),
					email: correoLimpio,
					rol,
					supervisorId: supervisorId || undefined,
					creditos,
				})
			}
			onVerAsesor={() => {
				if (!resultado) return;
				void navigate({
					to: "/cobros/equipo/$asesorId",
					params: { asesorId: String(resultado.asesorId) },
				});
			}}
			onCerrar={onCerrar}
		/>
	);
}

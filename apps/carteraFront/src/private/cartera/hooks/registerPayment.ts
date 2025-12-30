/* eslint-disable @typescript-eslint/no-explicit-any */
import {   z } from "zod";
import { useFormik } from "formik";
import {
  createPago,
  getCreditoByNumero,
  liquidatePagosInversionistasService,
  reversePagosInversionistasService,
  uploadFileService,
  type CancelacionCredito,
  type Credito,
  type Usuario,
} from "../services/services";
import { useEffect, useState } from "react"; 
import { useMutation } from "@tanstack/react-query";
import { useResetCredit } from "./resetCredit";
import { useAuth } from "@/Provider/authProvider";
export const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0.01),
  fecha_pago: z.string(), // "YYYY-MM-DD"
  llamada: z.string().max(100).optional(),
  renuevo_o_nuevo: z.string().max(50).optional(),
  otros: z.number().min(0), 
  monto_boleta_cuota: z.number().optional(),
  credito_sifco: z.string().max(50).optional(),
  observaciones: z.string().max(500).optional(),
  abono_directo_capital: z.number().optional(),
  cuotaApagar: z.number().int(),
  url_boletas: z.array(z.string().max(500)),
  banco_id: z.number().int().positive(), // 👈 NUEVO
  numeroAutorizacion: z.string().max(100).optional(), // 👈 NUEVO
    registerBy: z.string().max(100)
});

export type PagoFormValues = z.infer<typeof pagoSchema>;
 
function zodToFormikValidate(schema: z.ZodSchema<any>) {
  return (values: any) => {
    const result = schema.safeParse(values);
    if (result.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      errors[issue.path[0]] = issue.message;
    }
    return errors;
  };
}

export function usePagoForm() {
  
const { mutate: resetCredit } = useResetCredit();
const [resetBuscador, setResetBuscador] = useState(false);
  const [modalMode, setModalMode] = useState<"excedente" | "pagada">(
    "excedente"
  );
  const [loadingCredito, setLoadingCredito] = useState(false);
  const [dataCredito, setDataCredito] = useState<any>(null);
  const [errorCredito, setErrorCredito] = useState<string | null>(null);
  const [cuotaActualInfo, setCuotaActualInfo] = useState<{
    numero: number;
    pagada: boolean;
    validationStatus?: 'no_required' | 'pending' | 'validated' | 'capital' | 'reset';
    data?: any;
  } | null>(null);
  const [mora, setMora] = useState<number>(0);
  const [cuotasAtrasadasInfo, setCuotasAtrasadasInfo] = useState<{
    total: number;
    cuotas: any[];
    cuotaMasAntigua?: number;
  } | null>(null);
const [convenioActivoInfo, setConvenioActivoInfo] = useState<{
  convenio_id: number;
  credito_id: number;
  monto_total_convenio: string;
  cuota_mensual: string;
  pagos_realizados: number;
  pagos_pendientes: number;
  activo: boolean;
  completado: boolean;
  cuotasEnConvenio: any[];
  pagosConvenio: any[];
  cuotasConvenioMensuales: any[]; // 🔥 NUEVO
  cuotaConvenioAPagar: string; // 🔥 NUEVO
} | null>(null);
  const [cuotasPendientesInfo, setCuotasPendientesInfo] = useState<{
    total: number;
    cuotas: any[];
    cuotaMasAntigua?: number;
  } | null>(null);
  // Modal de exceso
  const [modalExcesoOpen, setModalExcesoOpen] = useState(false);
  const [saldo_a_favorUser, setSaldoAFavorUser] = useState(0);
  const [excedente, setExcedente] = useState(0);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  // Declarar cuotaSeleccionada antes de usarla en initialValues
  const [cuotaSeleccionada, setCuotaSeleccionada] = useState<
    number | undefined
  >();
  const [archivosParaSubir, setArchivosParaSubir] = useState<File[]>([]);
  const { user } = useAuth(); // 
  console.log(user)
  // Formik
  const formik = useFormik<PagoFormValues>({
    initialValues: {
      credito_id: 0,
      usuario_id: 0,
      monto_boleta: 0,
      fecha_pago: "",
      llamada: "",
      renuevo_o_nuevo: "",
      otros: 0, 
      monto_boleta_cuota: undefined,
      credito_sifco: "",
      observaciones: "",
      abono_directo_capital: 0,
      cuotaApagar: cuotaSeleccionada ?? 0,
      url_boletas: [],
      banco_id: 0, // 👈 NUEVO
      numeroAutorizacion: undefined, // 👈 NUEVO
       registerBy: user?.email || ""
    },
    validate: zodToFormikValidate(pagoSchema),
    onSubmit: async (values, { setSubmitting, setStatus, resetForm }) => {
      try {
        if ((creditoCanceladoInfo!== null && creditoCanceladoInfo !== undefined ) ) {
         await handleResetCredito();
          return;

        }
        console.log(cuotaSeleccionada, " cuotaSeleccionada");
        const cuotaApagarValue =
          typeof cuotaSeleccionada === "number" ? cuotaSeleccionada : 0;
        formik.setFieldValue("cuotaApagar", cuotaApagarValue);
        if (archivosParaSubir.length === 0) {
          alert("Debes seleccionar al menos un archivo de boleta (máx. 3).");
          return;
        }
        if (archivosParaSubir.length > 3) {
          alert("Solo puedes subir hasta 3 archivos de boleta.");
          return;
        }

        // Sube los archivos y llena el array de filenames
        const url_boletas: string[] = [];
        for (const archivo of archivosParaSubir) {
          const { filename } = await uploadFileService(archivo);
          url_boletas.push(filename);
        }

        const valuesToSend = {
          ...values,
          cuotaApagar:
            typeof cuotaSeleccionada === "number" ? cuotaSeleccionada : 0,
          url_boletas,
        };
        console.log("Valores a enviar:", valuesToSend);
         
        const response = await createPago(valuesToSend); // Esto es la respuesta completa
        alert(response.message || "¡Pago registrado correctamente!");
    

        setStatus({ success: true });
        resetForm();
        setDataCredito(null); // Limpiar datos del crédito
        setCuotaActualInfo(null);
        setCuotasAtrasadasInfo(null);
        setCuotasPendientesInfo(null);
        setModalExcesoOpen(false); // Cerrar modal de exceso
        setExcedente(0); // Reiniciar excedente
        setCuotaActualInfo(null); // Reiniciar cuota actual
        setFileToUpload(null); // Reiniciar archivo a subir
        setArchivosParaSubir([]);
        setResetBuscador(true);
      } catch (error: any) {
        const backendMessage =
          error?.response?.data?.message || "Error desconocido";
        alert(`No se pudo registrar el pago:\n${backendMessage}`);
        setStatus({ success: false, error: backendMessage });
      } finally {
        setSubmitting(false);
      }
    },
  });
  const [creditoCanceladoInfo, setCreditoCanceladoInfo] = useState<{
    credito: Credito;
    usuario: Usuario;
    cancelacion: CancelacionCredito | null;
  } | null>(null);
  // Función para buscar crédito y setear los campos
    const fetchCredito = async (numero_credito_sifco: string) => {
    setLoadingCredito(true);
    setErrorCredito(null);
    try {
      const result = await getCreditoByNumero(numero_credito_sifco);
      setDataCredito(result);

      // FLUJO CANCELADO
      if (result.flujo === "CANCELADO") {
        setCreditoCanceladoInfo({
          credito: result.credito,
          usuario: result.usuario,
          cancelacion: result.cancelacion,
        });
        setDataCredito(result);
        setCuotaActualInfo(null);
        setCuotasAtrasadasInfo(null);
        setCuotasPendientesInfo(null);
        setCuotaSeleccionada(0);
        setSaldoAFavorUser(0);
        setArchivosParaSubir([]);
        setResetBuscador(true);
        setConvenioActivoInfo(null); // 👈 AGREGA ESTO

        const today = new Date();
        const fechaHoy = today.toISOString().split("T")[0];
        formik.setValues((prev) => ({
          ...prev,
          credito_id: result.credito.credito_id,
          usuario_id: result.credito.usuario_id,
          credito_sifco: result.credito.numero_credito_sifco,
          fecha_pago: fechaHoy,
          llamada: "",
          monto_boleta: Number(result.cancelacion?.monto_cancelacion || 0),
          numero_cuota: 0,
        }));

        return;
      }

      // FLUJO ACTIVO
      setCuotaSeleccionada(result.cuotasAtrasadas?.[0]?.numero_cuota ?? 0);
      setMora(result.moraActual || 0);
      
      // 👇 AGREGA INFO DE CONVENIO
      if (result.convenioActivo) {
        setConvenioActivoInfo({
         ...result.convenioActivo
        });
      } else {
        setConvenioActivoInfo(null);
      }

      setCuotaActualInfo({
        numero: result.cuotaActual,
        pagada: !!result.cuotaActualPagada,
        validationStatus: result.cuotaActualStatus,
        data:
          result.cuotasPagadas.find(
            (c: any) => c.numero_cuota === result.cuotaActual
          ) ||
          result.cuotasAtrasadas.find(
            (c: any) => c.numero_cuota === result.cuotaActual
          ) ||
          null,
      });

      setCuotasAtrasadasInfo({
        total: result.cuotasAtrasadas.length,
        cuotas: result.cuotasAtrasadas,
        cuotaMasAntigua:
          result.cuotasAtrasadas.length > 0
            ? result.cuotasAtrasadas[0].numero_cuota
            : undefined,
      });

      setCuotasPendientesInfo({
        total: result.cuotasPendientes.length,
        cuotas: result.cuotasPendientes,
        cuotaMasAntigua:
          result.cuotasPendientes.length > 0
            ? result.cuotasPendientes[0].numero_cuota
            : undefined,
      });

      if (result?.credito && result?.usuario) {
        const today = new Date();
        const fechaHoy = today.toISOString().split("T")[0];
        setSaldoAFavorUser(result.usuario.saldo_a_favor || 0);
        formik.setValues((prev) => ({
          ...prev,
          credito_id: result.credito.credito_id,
          usuario_id: result.credito.usuario_id,
          credito_sifco: result.credito.numero_credito_sifco,
          fecha_pago: fechaHoy,
          llamada: "",
          numero_cuota: result.cuotaActual,
        }));
      }
    } catch (err: any) {
      setErrorCredito(
        err?.response?.data?.message || "Error consultando crédito"
      );
      setDataCredito(null);
      setCuotaActualInfo(null);
      setCuotasAtrasadasInfo(null);
      setCuotasPendientesInfo(null);
      setCuotaSeleccionada(0);
      setSaldoAFavorUser(0);
      setConvenioActivoInfo(null); // 👈 AGREGA ESTO
    } finally {
      setLoadingCredito(false);
    }
  };
  const [openBadDebt, setOpenBadDebt] = useState(false);
  const [montoBaseBadDebt, setMontoBaseBadDebt] = useState(0);
  // Handler que revisa el excedente ANTES del submit
  
useEffect(() => {
  if (openBadDebt) {
    console.log("Modal de incobrable abierto, monto base:", montoBaseBadDebt);
    setMontoBaseBadDebt(montoBaseBadDebt);
  }
}, [openBadDebt]);
const handleFormSubmit = (e: React.FormEvent) => {
  e.preventDefault();

  // ===== MANEJO DE CRÉDITO CANCELADO =====
  if (creditoCanceladoInfo) {
    const { monto_boleta } = formik.values;
    const monto_cancelacion = Number(
      creditoCanceladoInfo.cancelacion?.monto_cancelacion || 0
    );

    if (monto_boleta < 0) {
      alert(
        "El monto de la boleta debe ser mayor a cero y debe ser mayor que la suma de otros y mora"
      );
      return;
    }

    if (monto_boleta < monto_cancelacion) {
      const resta = monto_cancelacion - monto_boleta;
      setMontoBaseBadDebt(resta);
      setOpenBadDebt(true);
      return;
    }

    formik.handleSubmit();
    return;
  }

  // ===== VALIDACIÓN: DEBE TENER CUOTA SELECCIONADA =====
  if (!cuotaSeleccionada || cuotaSeleccionada === 0) {
    alert("⚠️ Por favor selecciona una cuota a pagar del menú desplegable");
    return;
  }

  // ===== CRÉDITO ACTIVO =====
  const { monto_boleta, otros } = formik.values;
  const cuota = Number(dataCredito?.credito?.cuota || 0);
  const otrosNum = Number(otros || 0);

  const montoBoletaReal =
    Number(monto_boleta) -
    otrosNum -
    mora -
    (Number(convenioActivoInfo?.cuotaConvenioAPagar) || 0);
  const montoBoletaSinMora =
    Number(monto_boleta) - otrosNum - (Number(convenioActivoInfo?.cuotaConvenioAPagar) || 0);

  if (montoBoletaSinMora < 0) {
    alert(
      "El monto de la boleta debe ser mayor a cero y debe ser mayor que la suma de otros y mora"
    );
    return;
  }

  // 👇 SIEMPRE USA LA CUOTA SELECCIONADA POR EL USUARIO
  const cuotaAPagar: number = cuotaSeleccionada;
  
  console.log("=== CUOTA DETERMINADA ===");
  console.log("Cuota seleccionada por usuario:", cuotaSeleccionada);
  console.log("Cuota a usar:", cuotaAPagar);

  // ===== MANEJO DE EXCEDENTES =====
  const montoRedondeado = Math.round(montoBoletaReal * 100) / 100;
  const cuotaRedondeada = Math.round(cuota * 100) / 100;

  // Si hay excedente, abre el modal
  if (montoRedondeado > cuotaRedondeada) {
    setModalMode("excedente");
    setExcedente(montoRedondeado - cuotaRedondeada);
    setModalExcesoOpen(true);
    return;
  }

  // Si la cuota actual ya está pagada y el monto no es exacto
  if (cuotaActualInfo?.pagada && montoRedondeado !== cuotaRedondeada) {
    // Si tiene "otros" y la suma cuadra
    if (otrosNum > 0 && monto_boleta === otrosNum) {
      // Todo bien, continuar
    } else {
      // Hay un desbalance
      setExcedente(montoBoletaReal);
      setModalMode("pagada");
      setModalExcesoOpen(true);
      return;
    }
  }

  // 👇 SETEA LA CUOTA EN FORMIK Y HACE SUBMIT
  console.log("=== ANTES DEL SUBMIT ===");
  console.log("formik.values.cuotaApagar ANTES:", formik.values.cuotaApagar);
  
  formik.values.cuotaApagar = cuotaAPagar;
  
  console.log("formik.values.cuotaApagar DESPUÉS:", formik.values.cuotaApagar);
  console.log("=====================");
  
  formik.handleSubmit();
};
  // Acciones del modal
const handleAbonoCapital = () => {
  // ✅ Validar que haya cuota seleccionada
  if (!cuotaSeleccionada || cuotaSeleccionada === 0) {
    alert("⚠️ Debes seleccionar una cuota antes de continuar");
    setModalExcesoOpen(false);
    return;
  }

  console.log("=== ABONO A CAPITAL ===");
  console.log("Excedente:", excedente);
  console.log("Cuota seleccionada:", cuotaSeleccionada);
  
  // 👇 USA LA CUOTA SELECCIONADA
  formik.values.abono_directo_capital = excedente;
  formik.values.cuotaApagar = cuotaSeleccionada;
  
  setModalExcesoOpen(false);
  formik.handleSubmit();
};
const handleAbonoSiguienteCuota = () => {
  // ✅ Validar que haya cuota seleccionada
  if (!cuotaSeleccionada || cuotaSeleccionada === 0) {
    alert("⚠️ Debes seleccionar una cuota antes de continuar");
    setModalExcesoOpen(false);
    return;
  }

  console.log("=== ABONO SIGUIENTE CUOTA ===");
  console.log("Cuota seleccionada:", cuotaSeleccionada);
  
  // 👇 USA LA CUOTA SELECCIONADA
  formik.values.abono_directo_capital = 0;
  formik.values.cuotaApagar = cuotaSeleccionada;
  
  console.log("Cuota a pagar final:", formik.values.cuotaApagar);
  
  setModalExcesoOpen(false);
  formik.handleSubmit();
};
 

const handleAbonoOtros = () => {
  // ✅ Validar que haya cuota seleccionada
  if (!cuotaSeleccionada || cuotaSeleccionada === 0) {
    alert("⚠️ Debes seleccionar una cuota antes de continuar");
    setModalExcesoOpen(false);
    return;
  }

  const nuevosOtros = Number(formik.values.otros || 0) + Number(excedente || 0);
  
  console.log("=== ABONO A OTROS ===");
  console.log("Nuevos otros:", nuevosOtros);
  console.log("Cuota seleccionada:", cuotaSeleccionada);
  
  // 👇 USA LA CUOTA SELECCIONADA
  formik.values.otros = nuevosOtros;
  formik.values.abono_directo_capital = 0;
  formik.values.cuotaApagar = cuotaSeleccionada;
  
  setModalExcesoOpen(false);
  formik.handleSubmit();
};
  function useLiquidatePagosInversionistas() {
    return useMutation({
      mutationFn: liquidatePagosInversionistasService,
      onSuccess: () => {
        alert("Pagos liquidados correctamente");
        setModalExcesoOpen(false);

        if (formik.values.credito_sifco) {
          fetchCredito(formik.values.credito_sifco); // Refrescar crédito
        }
      },
      onError: (err: any) => {
        alert(err?.response?.data?.message || "Error al liquidar pagos");
      },
    });
  }

  function useReversePagosInversionistas() {
    return useMutation({
      mutationFn: reversePagosInversionistasService,
      onSuccess: () => {
        alert("Pago reversado correctamente");
      },
      onError: (err: any) => {
        alert(
          "Error al reversar pago: " +
            (err?.response?.data?.message || "Error desconocido")
        );
      },
    });
  }
  const liquidatePago = useLiquidatePagosInversionistas();
  const [liquidandoId, setLiquidandoId] = useState<number | null>(null);
  function handleLiquidar(pago_id: number, credito_id: number, cuota?: number) {
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks

      setLiquidandoId(pago_id);
      liquidatePago.mutate(
        { pago_id, credito_id, cuota },
        {
          onSettled: () => setLiquidandoId(null),
        }
      );

      // Aquí podrías hacer un refetch/queryClient.invalidateQueries para actualizar
    } catch (error) {
      alert("Error al liquidar el pago");
      console.error("Error liquidando pago:", error);
    }
  }
  const reversePago = useReversePagosInversionistas();

  // Handler:
  function handleReverse(pago_id: number, credito_id: number, reverseAccounting: boolean) {
    reversePago.mutate({ pago_id, credito_id, reverseAccounting }, {});
  }
async function handleResetCredito() {
 
  console.log(cuotaSeleccionada, " cuotaSeleccionada");
        const cuotaApagarValue =
          typeof cuotaSeleccionada === "number" ? cuotaSeleccionada : 0;
        formik.setFieldValue("cuotaApagar", cuotaApagarValue);
        if (archivosParaSubir.length === 0) {
          alert("Debes seleccionar al menos un archivo de boleta (máx. 3).");
          return;
        }
        if (archivosParaSubir.length > 3) {
          alert("Solo puedes subir hasta 3 archivos de boleta.");
          return;
        }

        // Sube los archivos y llena el array de filenames
        const url_boletas: string[] = [];
        for (const archivo of archivosParaSubir) {
          const { filename } = await uploadFileService(archivo);
          url_boletas.push(filename);
        }

  resetCredit({
    creditId: Number(creditoCanceladoInfo?.credito.credito_id), // o el ID real que usas
    montoIncobrable: montoBaseBadDebt,  
    montoBoleta: formik.values.monto_boleta,
    url_boletas: url_boletas ,
    cuota: cuotaActualInfo?.numero || 0,
  }, {
    onSuccess: (data) => {
      alert(data.message || "Crédito reiniciado y pago creado exitosamente.");
      
        formik.resetForm();
        setDataCredito(null); // Limpiar datos del crédito
        setCuotaActualInfo(null);
        setCuotasAtrasadasInfo(null);
        setCuotasPendientesInfo(null);
        setModalExcesoOpen(false); // Cerrar modal de exceso
        setExcedente(0); // Reiniciar excedente
        setCuotaActualInfo(null); // Reiniciar cuota actual
        setFileToUpload(null); // Reiniciar archivo a subir
      // Puedes hacer un refetch o limpiar el form aquí
    },
    onError: (error) => {
      alert("Error al reiniciar crédito: " + (error?.message || error));
    }
  });
}
  return {
    formik,
    fetchCredito,
    dataCredito,
    loadingCredito,
    errorCredito,
    cuotaActualInfo,
    cuotasAtrasadasInfo,
    cuotasPendientesInfo,
    useReversePagosInversionistas,
    // Para el modal de excedente:
    handleFormSubmit,
    modalExcesoOpen,
    setModalExcesoOpen,
    excedente,
    handleAbonoCapital,
    handleAbonoSiguienteCuota, 
    handleAbonoOtros,
    useLiquidatePagosInversionistas,
    modalMode,
    handleLiquidar,
    liquidandoId,
    handleReverse,
    reversePago,
    setCuotaSeleccionada,
    setFileToUpload,
    fileToUpload,
    saldo_a_favorUser,
    creditoCanceladoInfo,
    openBadDebt,
    setOpenBadDebt,
    montoBaseBadDebt,
    archivosParaSubir,
    handleResetCredito,
    setArchivosParaSubir,
    resetBuscador,
    setResetBuscador,
    mora,
    convenioActivoInfo
  };
}

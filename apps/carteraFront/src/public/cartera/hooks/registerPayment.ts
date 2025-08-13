/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
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
export const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0.01),
  fecha_pago: z.string(), // "YYYY-MM-DD"
  llamada: z.string().max(100).optional(),
  renuevo_o_nuevo: z.string().max(50).optional(),
  otros: z.number().min(0),
  mora: z.number().min(0),
  monto_boleta_cuota: z.number().optional(),
  credito_sifco: z.string().max(50).optional(),
  observaciones: z.string().max(500).optional(),
  abono_directo_capital: z.number().optional(),
  cuotaApagar: z.number().int(),
  url_boletas: z.array(z.string().max(500)),
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

  const [modalMode, setModalMode] = useState<"excedente" | "pagada">(
    "excedente"
  );
  const [loadingCredito, setLoadingCredito] = useState(false);
  const [dataCredito, setDataCredito] = useState<any>(null);
  const [errorCredito, setErrorCredito] = useState<string | null>(null);
  const [cuotaActualInfo, setCuotaActualInfo] = useState<{
    numero: number;
    pagada: boolean;
    data?: any;
  } | null>(null);

  const [cuotasAtrasadasInfo, setCuotasAtrasadasInfo] = useState<{
    total: number;
    cuotas: any[];
    cuotaMasAntigua?: number;
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
      mora: 0,
      monto_boleta_cuota: undefined,
      credito_sifco: "",
      observaciones: "",
      abono_directo_capital: 0,
      cuotaApagar: cuotaSeleccionada ?? 0,
      url_boletas: [],
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

      // FLUJO CANCELADO: solo info de crédito, usuario y cancelación
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
        setArchivosParaSubir([]); // Limpia los archivos después del submit
        // Si quieres, podrías resetear el form aquí si lo necesitas
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
          // Puedes dejar número de cuota vacío o en 0 porque no aplica, pero igual lo puedes dejar fijo
          numero_cuota: 0,
        }));

        return; // No sigas con el resto
      }

      // FLUJO ACTIVO: el mismo de siempre
      setCuotaSeleccionada(result.cuotasAtrasadas?.[0]?.numero_cuota ?? 0);

      setCuotaActualInfo({
        numero: result.cuotaActual,
        pagada: !!result.cuotaActualPagada,
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

      // Solo abrir modal de incobrable si la boleta es menor que la cancelación
      if (monto_boleta < monto_cancelacion) {
        console.log(
          "Monto boleta menor que monto cancelación, abriendo modal incobrable"
        );
        const resta = monto_cancelacion - monto_boleta;
        console.log("Resta:", resta);
        setMontoBaseBadDebt(resta); // Lo que falta cubrir, o el total incobrable

        setOpenBadDebt(true); // Abre el modal incobrable
        return;
      }

      // Si NO es incobrable, puedes hacer el submit normal
      formik.handleSubmit();
      return;
    }
    const { monto_boleta, otros, mora } = formik.values;
    const cuota = Number(dataCredito?.credito?.cuota || 0);

    // Si no existen, ponemos 0
    const otrosNum = Number(otros || 0);
    const moraNum = Number(mora || 0);

    // Calcula el monto real de la boleta
    const montoBoletaReal = Number(monto_boleta) - otrosNum - moraNum;
    if (montoBoletaReal < 0) {
      alert(
        "El monto de la boleta debe ser mayor a cero y debe ser mayor que la suma de otros y mora"
      );
      return;
    }

    if (cuotaActualInfo?.pagada) {
      if (montoBoletaReal === cuota) {
        if (cuotaSeleccionada == 0) {
          alert(
            "Si quiere pagar la cuota completa, debe seleccionar una cuota válida"
          );
          return;
        }
        formik.handleSubmit();
        return;
      }
      if (otrosNum > 0 || moraNum > 0) {
        const sumaTotal = otrosNum + moraNum;

        if (monto_boleta !== sumaTotal) {
          setExcedente(montoBoletaReal);
          setModalMode("pagada");
          setModalExcesoOpen(true);
          return;
        }

        setCuotaSeleccionada(cuotaActualInfo?.numero); // Reiniciar cuota seleccionada
        formik.handleSubmit();
        return;
      }
      setExcedente(montoBoletaReal);
      setModalMode("pagada");
      setModalExcesoOpen(true);
      return;
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks

    if (montoBoletaReal > cuota) {
      setModalMode("excedente");
      setExcedente(montoBoletaReal - cuota);
      setModalExcesoOpen(true);
      // No submit todavía
    } else {
      // Enviar normalmente
      setCuotaSeleccionada(cuotaActualInfo?.numero); // Reiniciar cuota seleccionada
      formik.handleSubmit();
    }
  };

  // Acciones del modal
  const handleAbonoCapital = () => {
    formik.setFieldValue("abono_directo_capital", excedente);
    console.log("Abono a capital:", excedente);
    console.log("Valores del formulario:", formik.values);
    setModalExcesoOpen(false);
    setCuotaSeleccionada(cuotaActualInfo?.numero); // Reiniciar cuota seleccionada
    formik.handleSubmit();
  };
  const handleAbonoSiguienteCuota = () => {
    formik.setFieldValue("abono_directo_capital", 0);
    setModalExcesoOpen(false);
    console.log(cuotaSeleccionada, " cuotaSeleccionada en abonoSiguienteCuota");
    if (
      cuotaSeleccionada === undefined ||
      cuotaSeleccionada === null ||
      cuotaSeleccionada === 0
    ) {
      alert("debe seleccionar una cuota");
      return;
    }
    formik.handleSubmit();
  };
  const handleAbonoMora = () => {
    // Toma el valor actual de mora y suma el excedente
    const nuevaMora = Number(formik.values.mora || 0) + Number(excedente || 0);
    formik.setFieldValue("mora", nuevaMora);
    setCuotaSeleccionada(cuotaActualInfo?.numero); // Reiniciar cuota seleccionada
    formik.setFieldValue("abono_directo_capital", 0);
    setModalExcesoOpen(false);
    formik.handleSubmit();
  };

  const handleAbonoOtros = () => {
    // Toma el valor actual de otros y suma el excedente
    const nuevosOtros =
      Number(formik.values.otros || 0) + Number(excedente || 0);
    formik.setFieldValue("otros", nuevosOtros);
    setCuotaSeleccionada(cuotaActualInfo?.numero); // Reiniciar cuota seleccionada
    formik.setFieldValue("abono_directo_capital", 0);
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
  function handleReverse(pago_id: number, credito_id: number) {
    reversePago.mutate({ pago_id, credito_id }, {});
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
    handleAbonoMora,
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
  };
}

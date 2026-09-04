// components/InvestorModal.tsx
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { AxiosError } from "axios";
import { useInvestor } from "../hooks/investor";
import { useBancos } from "../hooks/bancos";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { InvestorPayload } from "../services/services";
import { avisoAccesoPortal } from "./accesoPortal";
import { ModalReinversionCombinada } from "./ModalReinversionCombinada";
import {
  errorRepLegal,
  esEmpresaInicial,
  requiereConfirmacionBorrado,
  valorRepLegalAEnviar,
} from "./repLegalEmpresa";

interface InvestorModalProps {
  open: boolean;
  onClose: () => void;
  mode: "create" | "update";
  initialData?: InvestorPayload;
}

export function InvestorModal({ open, onClose, mode, initialData }: InvestorModalProps) {
  const { insertInvestor } = useInvestor();
  const { bancos, loading: loadingBancos, loadBancos } = useBancos();
  const queryClient = useQueryClient();
  const [showCombinada, setShowCombinada] = useState(false);
  const [prevTipoReinversion, setPrevTipoReinversion] = useState<string>(
    initialData?.tipo_reinversion ?? "sin_reinversion"
  );
  // "¿Es empresa?" no tiene columna: se deriva de si la fila ya trae
  // `dpi_rep_legal`. `repLegalOriginal` guarda el valor con el que se abrió el
  // modal para saber si al guardar se le estaría quitando el representante a
  // alguien que sí lo tenía.
  const [esEmpresa, setEsEmpresa] = useState(
    esEmpresaInicial(initialData?.dpi_rep_legal)
  );
  const [repLegalOriginal, setRepLegalOriginal] = useState(
    initialData?.dpi_rep_legal ?? ""
  );
  // Payload en espera de que el operador confirme el borrado del representante.
  const [payloadPorConfirmar, setPayloadPorConfirmar] = useState<
    Parameters<typeof insertInvestor.mutate>[0] | null
  >(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<InvestorPayload>({
    defaultValues: {
      nombre: "",
      dpi: undefined,
      dpi_rep_legal: "",
      emite_factura: false,
      descuenta_impuestos: false,
      reinversion: false,
      banco: null,
      tipo_cuenta: "",
      numero_cuenta: "",
      re_inversion: "sin_reinversion",
      moneda: "quetzales",
      tipo_reinversion: "sin_reinversion",
      monto_reinversion: 0,
      email: "",
    },
  });

  // 🔥 Cargar bancos cuando se abre el modal
  useEffect(() => {
    if (open && bancos.length === 0) {
      loadBancos();
    }
  }, [open, bancos.length, loadBancos]);

  // ✅ Resetea cuando cambie initialData o mode
  useEffect(() => {
    if (mode === "update" && initialData) {
      console.log("Reseteando con initialData:", initialData);
      reset(initialData);
      setPrevTipoReinversion(initialData.tipo_reinversion ?? "sin_reinversion");
      setEsEmpresa(esEmpresaInicial(initialData.dpi_rep_legal));
      setRepLegalOriginal(initialData.dpi_rep_legal ?? "");
      setPayloadPorConfirmar(null);
    } else if (mode === "create") {
      setEsEmpresa(false);
      setRepLegalOriginal("");
      setPayloadPorConfirmar(null);
      reset({
        nombre: "",
        dpi: undefined,
        dpi_rep_legal: "",
        emite_factura: false,
        descuenta_impuestos: false,
        reinversion: false,
        banco: null,
        tipo_cuenta: "",
        numero_cuenta: "",
        re_inversion: "sin_reinversion",
        moneda: "quetzales",
        tipo_reinversion: "sin_reinversion",
        monto_reinversion: 0,
        email: "",
      });
    }
  }, [initialData, mode, reset]);

  const onSubmit = (data: InvestorPayload) => {
    // Con "¿Es empresa?" marcado el DPI del representante es obligatorio. Se
    // valida acá (y no como regla de `register`) porque el input se desmonta al
    // desmarcar el interruptor y la regla registrada quedaría con el valor
    // viejo de `esEmpresa`, bloqueando un envío que ya es válido.
    const errorRep = errorRepLegal(esEmpresa, data.dpi_rep_legal);
    if (errorRep) {
      setError("dpi_rep_legal", { type: "required", message: errorRep });
      return;
    }

    // En modo crear se manda `operation: "CREATE"` para que cartera use la
    // creación estricta: si el nombre/DPI/correo choca con un inversionista que
    // ya existe, responde 409 en vez de caer en el upsert legacy y convertir el
    // alta en un UPDATE sobre esa otra fila. Sin esto, "crear" podía pisarle el
    // `dpi_rep_legal` a otra persona —y con él su acceso al portal— mientras la
    // UI decía "creado correctamente".
    // Convertir dpi y banco a número si vienen como string
    const payload = {
      ...data,
      ...(mode === "create" ? { operation: "CREATE" as const } : {}),
      // El alta de back office SÍ pide acceso al portal. Sin esta llave cartera
      // no crea cuenta ni manda la contraseña: es el permiso explícito que
      // impide que el registro público de auth-google (que arma un payload fijo
      // y no puede colarla) se fabrique una cuenta con el DPI que quiera. En
      // modo editar es inocua: cartera solo provisiona las filas que INSERTA.
      provisionar_portal: true,
      // Llave siempre presente: vacío = borrar. Es seguro en ambos modos porque
      // la creación estricta garantiza que el alta jamás escribe sobre otra fila.
      // Sin "¿Es empresa?" marcado no se manda nada del representante (null).
      dpi_rep_legal: valorRepLegalAEnviar(esEmpresa, data.dpi_rep_legal),
      dpi: data.dpi ? Number(data.dpi) : null,
      banco: data.banco ? Number(data.banco) : null,
      monto_reinversion: data.monto_reinversion ? Number(data.monto_reinversion) : 0,
      re_inversion: data.tipo_reinversion ?? data.re_inversion ?? "sin_reinversion",
    };

    // Desmarcar "¿Es empresa?" en alguien que YA tenía representante borra su
    // acceso al portal, y esa persona no está frente a la pantalla para
    // enterarse: se pide confirmación explícita antes de guardar.
    if (requiereConfirmacionBorrado(repLegalOriginal, esEmpresa)) {
      setPayloadPorConfirmar(payload);
      return;
    }
    enviarPayload(payload);
  };

  const enviarPayload = (payload: Parameters<typeof insertInvestor.mutate>[0]) => {
    console.log("Submitting payload:", payload);

    // Mismo endpoint para crear y editar: en crear va con creación estricta,
    // en editar el `inversionista_id` del payload apunta la fila a actualizar.
    insertInvestor.mutate(payload, {
      onSuccess: (respuesta) => {
        const base =
          mode === "create"
            ? "Inversionista creado correctamente"
            : "Inversionista actualizado correctamente";

        // El alta puede salir perfecta y el acceso al portal no. Con el toast
        // verde de siempre, quien captura cerraría el modal creyendo que todo
        // salió y el inversionista quedaría con una cuenta que no sabe que
        // tiene —o sin cuenta— y nadie se enteraría hasta el resumen del día
        // siguiente. Editar no provisiona, así que aquí solo habla el alta.
        const aviso = avisoAccesoPortal(respuesta?.provisioning?.[0]);
        const mensaje = aviso ? `${base}. ${aviso.texto}` : base;
        if (aviso?.tono === "advertencia") {
          // Dura más que el toast normal: es lo que hay que leer y actuar.
          toast.warning(mensaje, { duration: 15000 });
        } else {
          toast.success(mensaje);
        }
        queryClient.invalidateQueries({ queryKey: ["investors"] });
        queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
        queryClient.invalidateQueries({ queryKey: ["investor-totals"] });
        setPayloadPorConfirmar(null);
        reset();
        onClose();
      },
      onError: (error: Error) => {
        setPayloadPorConfirmar(null);
        // Cuando el DPI del representante no existe como inversionista, cartera
        // manda el código de máquina `rep_legal_inexistente`. Ese fallo es de un
        // campo concreto, así que se muestra en el input y no en un toast suelto
        // donde el usuario tendría que adivinar cuál dato corregir.
        const payload =
          error instanceof AxiosError
            ? (error.response?.data as
                | { error?: string; message?: string; errores?: string[] }
                | undefined)
            : undefined;
        const detalle: string | undefined =
          payload?.errores?.[0] ?? payload?.message;
        if (payload?.error === "rep_legal_inexistente" && detalle) {
          setError("dpi_rep_legal", { type: "server", message: detalle });
          return;
        }
        // Las colisiones de la creación estricta llegan como 409 con un código
        // de máquina. `error.message` de axios ahí es "Request failed with
        // status code 409", inútil para el operador: se muestra el texto de
        // cartera ("Ya existe un inversionista con ese email", etc.) marcando
        // además el input culpable.
        const CAMPO_POR_DUPLICADO = {
          duplicate_dpi: "dpi",
          duplicate_email: "email",
          duplicate_nombre: "nombre",
        } as const;
        const campoDuplicado =
          payload?.error &&
          payload.error in CAMPO_POR_DUPLICADO
            ? CAMPO_POR_DUPLICADO[
                payload.error as keyof typeof CAMPO_POR_DUPLICADO
              ]
            : undefined;
        if (campoDuplicado) {
          const mensaje = detalle ?? "Ya existe un inversionista con ese dato";
          setError(campoDuplicado, { type: "server", message: mensaje });
          toast.error(`Error al crear el inversionista. ${mensaje}`);
          return;
        }
        const motivo = detalle ?? error.message ?? "";
        toast.error(
          mode === "create"
            ? `Error al crear el inversionista. ${motivo}`
            : `Error al actualizar el inversionista. ${motivo}`
        );
      },
    });
  };

  // El monto de reinversión es editable en variable, excedente y combinada
  // (en combinada puede que haya que ajustar ese monto manualmente).
  const tipoReinversion = watch("tipo_reinversion");
  const montoEditable =
    tipoReinversion === "reinversion_variable" ||
    tipoReinversion === "reinversion_excedente" ||
    tipoReinversion === "reinversion_combinada";

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9998] p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md md:max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-6 text-blue-700 text-center">
          {mode === "create" ? "Crear Inversionista" : "Editar Inversionista"}
        </h2>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Nombre */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Nombre</label>
              <input
                {...register("nombre")}
                className="bg-white text-blue-900 placeholder-gray-400 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="Ej. Juan Pérez"
              />
            </div>

            {/* DPI */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">DPI</label>
              <input
                {...register("dpi")}
                type="number"
                className="bg-white text-blue-900 placeholder-gray-400 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="1234567890101"
                maxLength={13}
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Correo Electrónico</label>
              <input
                {...register("email")}
                type="email"
                className="bg-white text-blue-900 placeholder-gray-400 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="ejemplo@correo.com"
              />
            </div>

            {/* Banco */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Banco</label>
              <select
                {...register("banco")}
                className="bg-white text-blue-900 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                disabled={loadingBancos}
              >
                <option value="">
                  {loadingBancos ? "Cargando bancos..." : "Seleccione un banco"}
                </option>
                {bancos.map((banco) => (
                  <option key={banco.banco_id} value={banco.banco_id}>
                    {banco.nombre}
                  </option>
                ))}
              </select>
              {loadingBancos && (
                <p className="text-xs text-gray-500 mt-1">Cargando bancos...</p>
              )}
            </div>

            {/* Tipo de cuenta */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Tipo de cuenta</label>
              <select
                {...register("tipo_cuenta")}
                className="bg-white text-blue-900 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
              >
                <option value="">Seleccione una opción</option>
                <option value="AHORRO">Ahorros</option>
                <option value="AHORRO Q">Ahorros Q</option>
                <option value="AHORRO $">Ahorros $</option>
                <option value="MONETARIA">Monetaria</option>
                <option value="MONETARIA Q">Monetaria Q</option>
                <option value="MONETARIA $">Monetaria $</option>
              </select>
            </div>

            {/* Número de cuenta */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Número de cuenta</label>
              <input
                {...register("numero_cuenta")}
                className="bg-white text-blue-900 placeholder-gray-400 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                placeholder="123456789"
              />
            </div>

            {/* ¿Es empresa? → DPI del representante legal */}
            <div>
              <label className="flex items-center gap-2 text-blue-900 text-sm mb-1 h-[26px]">
                <input
                  type="checkbox"
                  checked={esEmpresa}
                  onChange={(e) => {
                    setEsEmpresa(e.target.checked);
                    // La validación del campo cuelga del interruptor: al
                    // desmarcar, el "obligatorio" pendiente deja de aplicar.
                    clearErrors("dpi_rep_legal");
                  }}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                ¿Es empresa?
              </label>
              {esEmpresa && (
                <>
                  <label className="block text-sm text-blue-800 mb-1">
                    DPI del representante legal
                  </label>
                  <input
                    {...register("dpi_rep_legal", {
                      onChange: (e) => {
                        const soloDigitos = e.target.value.replace(/\D/g, "").slice(0, 20);
                        setValue("dpi_rep_legal", soloDigitos);
                        // Al corregir el DPI, el rechazo del backend deja de aplicar.
                        clearErrors("dpi_rep_legal");
                      },
                    })}
                    type="text"
                    inputMode="numeric"
                    maxLength={20}
                    aria-invalid={!!errors.dpi_rep_legal}
                    className={`bg-white text-blue-900 placeholder-gray-400 border rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition ${
                      errors.dpi_rep_legal
                        ? "border-red-400 bg-red-50"
                        : "border-gray-300"
                    }`}
                    placeholder="DPI de quien representa a la empresa"
                  />
                  {errors.dpi_rep_legal && (
                    <p className="text-red-500 text-sm mt-1">
                      {errors.dpi_rep_legal.message}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Tipo de Reinversión */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Tipo de Reinversión</label>
              <div className="flex gap-2">
                <select
                  {...register("tipo_reinversion", {
                    onChange: (e) => {
                      const prev = watch("tipo_reinversion") ?? "sin_reinversion";
                      const val = e.target.value;
                      if (
                        val !== "reinversion_variable" &&
                        val !== "reinversion_excedente" &&
                        val !== "reinversion_combinada"
                      ) {
                        setValue("monto_reinversion", 0);
                      }
                      if (val === "reinversion_combinada") {
                        setPrevTipoReinversion(prev === "reinversion_combinada" ? "sin_reinversion" : prev);
                        setShowCombinada(true);
                      }
                    },
                  })}
                  className="bg-white text-blue-900 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                >
                  <option value="sin_reinversion">Sin Reinversión</option>
                  <option value="reinversion_capital">Reinversión Capital</option>
                  <option value="reinversion_total">Interés Compuesto</option>
                  <option value="reinversion_variable">Reinversión Variable</option>
                  <option value="reinversion_excedente">Reinversión Excedente</option>
                  <option value="reinversion_combinada">Reinversión Combinada</option>
                </select>
                {watch("tipo_reinversion") === "reinversion_combinada" && mode === "update" && initialData?.inversionista_id && (
                  <button
                    type="button"
                    onClick={() => setShowCombinada(true)}
                    className="px-3 py-2 rounded-lg bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold text-sm transition whitespace-nowrap border border-purple-300"
                  >
                    Configurar
                  </button>
                )}
              </div>
            </div>

            {/* Monto Reinversión */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">
                {tipoReinversion === "reinversion_excedente"
                  ? "Monto a Recibir"
                  : "Monto Reinversión"}
              </label>
              <input
                {...register("monto_reinversion", { valueAsNumber: true })}
                type="number"
                step="any"
                min={0}
                disabled={!montoEditable}
                className={`border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition ${
                  !montoEditable
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-white text-blue-900 placeholder-gray-400"
                }`}
                placeholder="0.00"
              />
              {tipoReinversion === "reinversion_excedente" && (
                <p className="mt-1 text-xs text-blue-600">
                  El inversionista recibe este monto fijo; el sobrante de su cuota se reinvierte.
                </p>
              )}
            </div>

            {/* Moneda */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Moneda Preferida</label>
              <select
                {...register("moneda")}
                className="bg-white text-blue-900 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
              >
                <option value="quetzales">Quetzales (Q)</option>
                <option value="dolares">Dólares ($)</option>
              </select>
            </div>

            {/* Checkbox */}
            <div className="flex items-center gap-4 mt-2">
              <label className="flex items-center gap-2 text-blue-900 text-sm">
                <input
                  type="checkbox"
                  {...register("emite_factura")}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                Emite Factura
              </label>
              <label className="flex items-center gap-2 text-blue-900 text-sm">
                <input
                  type="checkbox"
                  {...register("descuenta_impuestos")}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                Descuenta impuestos
              </label>
            </div>
          </div>

          {/* Botones */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition disabled:opacity-50"
              disabled={insertInvestor.isPending}
            >
              {insertInvestor.isPending
                ? mode === "create"
                  ? "Creando..."
                  : "Actualizando..."
                : mode === "create"
                ? "Crear"
                : "Actualizar"}
            </button>
          </div>
        </form>
      </div>

      {/* Confirmación — quitar el representante legal borra su acceso al portal */}
      {payloadPorConfirmar && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-red-700 mb-3">
              Quitar el representante legal
            </h3>
            <p className="text-sm text-gray-700">
              Este inversionista tiene registrado el DPI{" "}
              <span className="font-semibold">{repLegalOriginal}</span> como
              representante legal. Al guardar sin "¿Es empresa?" ese dato se
              borra y <span className="font-semibold">esa persona pierde el
              acceso al portal</span>.
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setPayloadPorConfirmar(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => enviarPayload(payloadPorConfirmar)}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition disabled:opacity-50"
                disabled={insertInvestor.isPending}
              >
                {insertInvestor.isPending
                  ? "Guardando..."
                  : "Sí, quitar el representante"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Reinversión Combinada */}
      {mode === "update" && initialData?.inversionista_id && (
        <ModalReinversionCombinada
          open={showCombinada}
          onClose={() => {
            setShowCombinada(false);
            // Si cancela, regresar al tipo de reinversión que tenía antes
            const currentVal = watch("tipo_reinversion");
            if (currentVal === "reinversion_combinada") {
              setValue("tipo_reinversion", prevTipoReinversion);
              setValue("re_inversion", prevTipoReinversion);
            }
          }}
          inversionistaId={initialData.inversionista_id}
          inversionistaNombre={initialData.nombre}
          // Monto del form (posiblemente sin guardar) para habilitar
          // Excedente/Variable en el setup por primera vez.
          montoReinversion={Number(watch("monto_reinversion") ?? 0)}
          onSaved={() => {
            // Guardar el inversionista con reinversion_combinada y cerrar todo
            const currentFormData = watch();
            const payload = {
              ...currentFormData,
              dpi: currentFormData.dpi ? Number(currentFormData.dpi) : null,
              dpi_rep_legal: valorRepLegalAEnviar(
                esEmpresa,
                currentFormData.dpi_rep_legal
              ),
              banco: currentFormData.banco ? Number(currentFormData.banco) : null,
              monto_reinversion: currentFormData.monto_reinversion ? Number(currentFormData.monto_reinversion) : 0,
              tipo_reinversion: "reinversion_combinada",
              re_inversion: "reinversion_combinada",
            };
            // Esta ruta también puede terminar borrando el `dpi_rep_legal` (si el
            // operador desmarcó "¿Es empresa?" antes de configurar la
            // combinada): pasa por la misma confirmación que el guardado normal.
            if (requiereConfirmacionBorrado(repLegalOriginal, esEmpresa)) {
              setPayloadPorConfirmar(payload);
              return;
            }
            insertInvestor.mutate(payload, {
              onSuccess: () => {
                toast.success("Inversionista actualizado con reinversión combinada.");
                queryClient.invalidateQueries({ queryKey: ["investors"] });
                queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
                queryClient.invalidateQueries({ queryKey: ["investor-totals"] });
                reset();
                onClose();
              },
              onError: (error: Error) => {
                toast.error(`Error al actualizar inversionista: ${error.message || ""}`);
              },
            });
          }}
        />
      )}
    </div>,
    document.body
  );
}
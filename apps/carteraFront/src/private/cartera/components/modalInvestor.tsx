// components/InvestorModal.tsx
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { useInvestor } from "../hooks/investor";
import { useBancos } from "../hooks/bancos";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { InvestorPayload } from "../services/services";
import { ModalReinversionCombinada } from "./ModalReinversionCombinada";

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

  const { register, handleSubmit, reset, watch, setValue } = useForm<InvestorPayload>({
    defaultValues: {
      nombre: "",
      dpi: undefined,
      emite_factura: false,
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
    } else if (mode === "create") {
      reset({
        nombre: "",
        dpi: undefined,
        emite_factura: false,
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
    // Convertir dpi y banco a número si vienen como string
    const payload = {
      ...data,
      dpi: data.dpi ? Number(data.dpi) : null,
      banco: data.banco ? Number(data.banco) : null,
      monto_reinversion: data.monto_reinversion ? Number(data.monto_reinversion) : 0,
      re_inversion: data.tipo_reinversion ?? data.re_inversion ?? "sin_reinversion",
    };
    console.log("Submitting payload:", payload);

    // 🔥 SIMPLIFICADO: Siempre usa insertInvestor (hace upsert automático)
    insertInvestor.mutate(payload, {
      onSuccess: () => {
        toast.success(
          mode === "create"
            ? "Inversionista creado correctamente"
            : "Inversionista actualizado correctamente"
        );
        queryClient.invalidateQueries({ queryKey: ["investors"] });
        queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
        queryClient.invalidateQueries({ queryKey: ["investor-totals"] });
        reset();
        onClose();
      },
      onError: (error: Error) => {
        toast.error(
          mode === "create"
            ? `Error al crear el inversionista. ${error.message || ""}`
            : `Error al actualizar el inversionista. ${error.message || ""}`
        );
      },
    });
  };

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

            {/* Tipo de Reinversión */}
            <div>
              <label className="block text-sm text-blue-800 mb-1">Tipo de Reinversión</label>
              <div className="flex gap-2">
                <select
                  {...register("tipo_reinversion", {
                    onChange: (e) => {
                      const prev = watch("tipo_reinversion") ?? "sin_reinversion";
                      const val = e.target.value;
                      if (val !== "reinversion_variable") {
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
                  <option value="reinversion_interes">Reinversión Interés</option>
                  <option value="reinversion_total">Reinversión Total</option>
                  <option value="reinversion_variable">Reinversión Variable</option>
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
              <label className="block text-sm text-blue-800 mb-1">Monto Reinversión</label>
              <input
                {...register("monto_reinversion", { valueAsNumber: true })}
                type="number"
                step="any"
                min={0}
                disabled={watch("tipo_reinversion") !== "reinversion_variable"}
                className={`border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition ${
                  watch("tipo_reinversion") !== "reinversion_variable"
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-white text-blue-900 placeholder-gray-400"
                }`}
                placeholder="0.00"
              />
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
          onSaved={() => {
            // Guardar el inversionista con reinversion_combinada y cerrar todo
            const currentFormData = watch();
            const payload = {
              ...currentFormData,
              dpi: currentFormData.dpi ? Number(currentFormData.dpi) : null,
              banco: currentFormData.banco ? Number(currentFormData.banco) : null,
              monto_reinversion: currentFormData.monto_reinversion ? Number(currentFormData.monto_reinversion) : 0,
              tipo_reinversion: "reinversion_combinada",
              re_inversion: "reinversion_combinada",
            };
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
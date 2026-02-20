// components/InvestorModal.tsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useInvestor } from "../hooks/investor";
import { useBancos } from "../hooks/bancos";
import { useQueryClient } from "@tanstack/react-query";
import type { InvestorPayload } from "../services/services";

interface InvestorModalProps {
  open: boolean;
  onClose: () => void;
  mode: "create" | "update";
  initialData?: InvestorPayload;
}

export function InvestorModal({ open, onClose, mode, initialData }: InvestorModalProps) {
  const { insertInvestor } = useInvestor(); // 🔥 Solo usamos insertInvestor (hace upsert)
  const { bancos, loading: loadingBancos, loadBancos } = useBancos();
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset } = useForm<InvestorPayload>({
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
      });
    }
  }, [initialData, mode, reset]);

  const onSubmit = (data: InvestorPayload) => {
    // Convertir dpi y banco a número si vienen como string
    const payload = {
      ...data,
      dpi: data.dpi ? Number(data.dpi) : null,
      banco: data.banco ? Number(data.banco) : null,
    };
    console.log("Submitting payload:", payload);

    // 🔥 SIMPLIFICADO: Siempre usa insertInvestor (hace upsert automático)
    insertInvestor.mutate(payload, {
      onSuccess: () => {
        const mensaje = mode === "create" 
          ? "✅ Inversionista creado correctamente." 
          : "✅ Inversionista actualizado correctamente.";
        alert(mensaje);
        queryClient.invalidateQueries({ queryKey: ["investors"] });
        queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
        queryClient.invalidateQueries({ queryKey: ["investor-totals"] });
        reset();
        onClose();
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onError: (error: any) => {
        const mensaje = mode === "create"
          ? "❌ Error al crear el inversionista."
          : "❌ Error al actualizar el inversionista.";
        alert(`${mensaje}\n${error.message || ""}`);
      },
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-6 text-blue-700 text-center">
          {mode === "create" ? "Crear Inversionista" : "Editar Inversionista"}
        </h2>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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

          {/* 🔥 Banco - Dinámico desde API */}
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
            <select
              {...register("re_inversion")}
              className="bg-white text-blue-900 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            >
              <option value="sin_reinversion">Sin Reinversión</option>
              <option value="reinversion_capital">Reinversión Capital</option>
              <option value="reinversion_interes">Reinversión Interés</option>
            </select>
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
    </div>
  );
}
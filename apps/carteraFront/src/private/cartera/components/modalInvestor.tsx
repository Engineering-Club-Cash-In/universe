// components/InvestorModal.tsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useInvestor } from "../hooks/investor";
import { useQueryClient } from "@tanstack/react-query";
import type { InvestorPayload } from "../services/services";

interface InvestorModalProps {
  open: boolean;
  onClose: () => void;
  mode: "create" | "update";
  initialData?: InvestorPayload;
}

export function InvestorModal({ open, onClose, mode, initialData }: InvestorModalProps) {
  const { insertInvestor, updateInvestor } = useInvestor();
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset } = useForm<InvestorPayload>({
    defaultValues: {
      nombre: "",
      emite_factura: false,
      tipo_reinversion: "sin_reinversion", // ⭐ Cambiado
      banco: "",
      tipo_cuenta: "",
      numero_cuenta: "",
    },
  });

  // ✅ ESTO ES LO CLAVE - Resetea cuando cambie initialData o mode
  useEffect(() => {
    if (mode === "update" && initialData) {
      console.log("Reseteando con initialData:", initialData);
      reset(initialData);
    } else if (mode === "create") {
      reset({
        nombre: "",
        emite_factura: false,
        tipo_reinversion: "sin_reinversion", // ⭐ Cambiado
        banco: "",
        tipo_cuenta: "",
        numero_cuenta: "",
      });
    }
  }, [initialData, mode, reset]);

  const onSubmit = (data: InvestorPayload) => {
    if (mode === "create") {
      insertInvestor.mutate(data, {
        onSuccess: () => {
          alert("✅ Inversionista creado correctamente.");
          queryClient.invalidateQueries({ queryKey: ["investors"] });
          reset(); // ✅ Limpia el form
          onClose();
        },
        onError: () => {
          alert("❌ Error al crear el inversionista.");
        },
      });
    } else {
      updateInvestor.mutate(
        { ...data, inversionista_id: initialData?.inversionista_id },
        {
          onSuccess: () => {
            alert("✅ Inversionista actualizado correctamente.");
            queryClient.invalidateQueries({ queryKey: ["investors"] });
            onClose();
          },
          onError: () => {
            alert("❌ Error al actualizar el inversionista.");
          },
        }
      );
    }
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
              required
            />
          </div>

          {/* Banco */}
          <div>
            <label className="block text-sm text-blue-800 mb-1">Banco</label>
            <select
              {...register("banco")}
              className="bg-white text-blue-900 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            >
              <option value="">Seleccione un banco</option>
              <option value="GyT">GyT</option>
              <option value="BAM">BAM</option>
              <option value="BI">BI</option>
              <option value="BANRURAL">BANRURAL</option>
              <option value="PROMERICA">PROMERICA</option>
              <option value="BANTRAB">BANTRAB</option>
              <option value="BAC">BAC</option>
              <option value="NEXA">NEXA</option>
              <option value="INDUSTRIAL">INDUSTRIAL</option>
              <option value="INTERBANCO">INTERBANCO</option>
              <option value="INTERBANCO/RICHARD">INTERBANCO/RICHARD</option>
              <option value="BI/MENFER S.A.">BI/MENFER S.A.</option>
            </select>
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
              <option value="MONETARIA">Monetaria</option>
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

          {/* ⭐ NUEVO: Tipo de Reinversión */}
          <div>
            <label className="block text-sm text-blue-800 mb-1">Tipo de Reinversión</label>
            <select
              {...register("tipo_reinversion")}
              className="bg-white text-blue-900 border border-gray-300 rounded-lg px-4 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            >
              <option value="sin_reinversion">Sin Reinversión</option>
              <option value="reinversion_capital">Reinversión Capital</option>
              <option value="reinversion_interes">Reinversión Interés</option>
              <option value="reinversion_total">Reinversión Total</option>
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
              disabled={insertInvestor.isPending || updateInvestor.isPending}
            >
              {mode === "create"
                ? insertInvestor.isPending
                  ? "Creando..."
                  : "Crear"
                : updateInvestor.isPending
                ? "Actualizando..."
                : "Actualizar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
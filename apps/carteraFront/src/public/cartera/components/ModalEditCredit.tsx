/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormik } from "formik";
import { Plus, Trash2 } from "lucide-react";
import { useUpdateCredit } from "../hooks/updateCredit";
import type {
  InversionistaPayload,
  UpdateCreditBody,
} from "../services/services";

// Tipos locales
interface InvestorItem extends InversionistaPayload {}
interface InvestorOption {
  inversionista_id: number;
  nombre: string;
}

interface ModalEditCreditProps {
  open: boolean;
  onClose: () => void;
  initialValues: Omit<UpdateCreditBody, "inversionistas">;
  investorsInitial?: InvestorItem[];
  onSuccess: () => void;
  investorsOptions: InvestorOption[];
}

const creditFields = [
  "capital",
  "porcentaje_interes",
  "plazo",
  "no_poliza",
  "observaciones",
  "mora",
  "cuota",
  "numero_credito_sifco",
  "otros", // nuevo campo
  "seguro_10_cuotas", // nuevo campo
  "membresias_pago", // nuevo campo
] as const;

type CreditField = (typeof creditFields)[number];
const fieldLabels: Record<CreditField, string> = {
  capital: "Capital",
  porcentaje_interes: "Interés (%)",
  plazo: "Plazo",
  no_poliza: "No. Póliza",
  observaciones: "Observaciones",
  mora: "Mora",
  cuota: "Cuota",
  numero_credito_sifco: "No. Crédito SIFCO",
  otros: "Otros (Q)",
  seguro_10_cuotas: "Seguro 10 cuotas",
  membresias_pago: "Membresías pago",
};
export function ModalEditCredit({
  open,
  onClose,
  initialValues,
  investorsInitial,
  onSuccess,
  investorsOptions,
}: ModalEditCreditProps) {
  const { mutate: updateCredit, isPending } = useUpdateCredit();

  // Preparamos los valores iniciales de inversionistas asegurando que siempre tienen todos los campos necesarios
  const parsedInvestors =
    investorsInitial?.map((inv) => ({
      inversionista_id: Number(inv.inversionista_id),
      monto_aportado: Number(inv.monto_aportado),
      porcentaje_cash_in: Number(inv.porcentaje_cash_in),
      porcentaje_inversion: Number(inv.porcentaje_inversion),
      cuota_inversionista: Number(inv.cuota_inversionista ?? 0), // NUEVO
    })) || [];

  const formik = useFormik({
    initialValues: {
      ...initialValues,
      investors: parsedInvestors,
    },
    enableReinitialize: true,
    onSubmit: (values) => {
      if (Object.keys(formik.errors).length > 0) {
        window.alert(
          "Por favor corrige los siguientes errores:\n\n" +
            Object.entries(formik.errors)
              .map(([field, error]) =>
                Array.isArray(error)
                  ? error.map((e) => `- ${field}: ${e}`).join("\n")
                  : `- ${field}: ${error}`
              )
              .join("\n")
        );
        return;
      }
      const payload: UpdateCreditBody = {
        // Asegúrate que cada campo numérico va como Number:
        capital: Number(values.capital),
        porcentaje_interes: Number(values.porcentaje_interes),
        plazo: Number(values.plazo),

        observaciones: values.observaciones ?? "",
        mora: Number(values.mora ?? 0),
        credito_id: Number(values.credito_id),
        cuota: Number(values.cuota) || 0,
        numero_credito_sifco:
          values.numero_credito_sifco !== undefined &&
          values.numero_credito_sifco !== null
            ? String(values.numero_credito_sifco)
            : undefined,
        otros: Number(values.otros ?? 0),
        seguro_10_cuotas: Number(values.seguro_10_cuotas ?? 0),
        membresias_pago: Number(values.membresias_pago ?? 0),

        inversionistas: values.investors.map((i: InvestorItem) => ({
          inversionista_id: Number(i.inversionista_id),
          monto_aportado: Number(i.monto_aportado),
          porcentaje_cash_in: Number(i.porcentaje_cash_in),
          porcentaje_inversion: Number(i.porcentaje_inversion),
          cuota_inversionista: Number(i.cuota_inversionista ?? 0),
        })),
      };
      updateCredit(payload, {
        onSuccess: () => {
          onSuccess();
          onClose();
        },
        onError: (error: any) => {
          const mensaje =
            error?.response?.data?.message ||
            "Ocurrió un error inesperado al guardar los cambios.";
          window.alert("Error en el guardado:\n\n" + mensaje);
        },
      });
    },
  });

  const addInvestor = () => {
    formik.setFieldValue("investors", [
      ...formik.values.investors,
      {
        inversionista_id: 0,
        monto_aportado: 0,
        porcentaje_cash_in: 0,
        porcentaje_inversion: 0,
      },
    ]);
  };

  const removeInvestor = (index: number) => {
    const updated = [...formik.values.investors];
    updated.splice(index, 1);
    formik.setFieldValue("investors", updated);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-3xl w-full bg-white text-gray-800 shadow-2xl border border-blue-100 p-0"
        style={{
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Cabecera */}
        <DialogHeader className="sticky top-0 bg-white z-10 px-6 pt-6 pb-2 border-b border-blue-100">
          <DialogTitle className="text-blue-700 font-bold text-xl">
            Editar Crédito e Inversionistas
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable content */}
        <div
          className="flex-1 overflow-y-auto px-6 pb-4"
          style={{ maxHeight: "66vh", minHeight: 0 }}
        >
          <form
            onSubmit={formik.handleSubmit}
            className="flex flex-col"
            style={{ minHeight: 0 }}
          >
            {/* Datos del crédito */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-blue-800 mb-2">
                Información del Crédito
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {creditFields.map((name) => (
                  <div key={name} className="flex flex-col gap-1">
                    <Label className="text-gray-700 font-medium">
                      {fieldLabels[name]}
                    </Label>
                    <Input
                      type={
                        [
                          "observaciones",
                          "no_poliza",
                          "numero_credito_sifco",
                        ].includes(name)
                          ? "text"
                          : "number"
                      }
                      name={name}
                      value={formik.values[name] ?? ""}
                      onChange={formik.handleChange}
                      className="bg-blue-50 border-blue-200 text-gray-800"
                      min={
                        [
                          "observaciones",
                          "no_poliza",
                          "numero_credito_sifco",
                        ].includes(name)
                          ? undefined
                          : 0
                      }
                      step="any"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Inversionistas con scroll interno */}
            <div className="space-y-4 mt-4">
              <h3 className="text-lg font-bold text-blue-800 mb-2">
                Inversionistas Asociados
              </h3>
              {formik.values.investors.length === 0 && (
                <div className="text-sm text-gray-500 mb-2">
                  No hay inversionistas agregados.
                </div>
              )}
              {formik.values.investors.map((inv, index) => (
                <div
                  key={index}
                  className="border rounded-xl p-4 bg-blue-50 flex flex-col gap-2"
                >
                  <div className="flex flex-wrap gap-4 items-center">
                    <div className="flex-1 min-w-[160px]">
                      <Label>Inversionista</Label>
                      <select
                        name={`investors.${index}.inversionista_id`}
                        value={inv.inversionista_id}
                        onChange={formik.handleChange}
                        className="w-full border rounded px-3 py-2 bg-white"
                      >
                        <option value={0}>Seleccione un inversionista</option>
                        {investorsOptions.map((opt) => (
                          <option
                            key={opt.inversionista_id}
                            value={opt.inversionista_id}
                          >
                            {opt.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-36 min-w-[120px]">
                      <Label>Monto Aportado</Label>
                      <Input
                        type="number"
                        name={`investors.${index}.monto_aportado`}
                        value={inv.monto_aportado}
                        onChange={formik.handleChange}
                      />
                    </div>
                    <div className="w-36 min-w-[120px]">
                      <Label>Cash In (%)</Label>
                      <Input
                        type="number"
                        name={`investors.${index}.porcentaje_cash_in`}
                        value={inv.porcentaje_cash_in}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          formik.setFieldValue(
                            `investors.${index}.porcentaje_cash_in`,
                            val
                          );
                          formik.setFieldValue(
                            `investors.${index}.porcentaje_inversion`,
                            100 - val
                          );
                        }}
                        min={0}
                        max={100}
                      />
                    </div>
                    <div className="w-36 min-w-[120px]">
                      <Label>Inversión (%)</Label>
                      <Input
                        type="number"
                        name={`investors.${index}.porcentaje_inversion`}
                        value={inv.porcentaje_inversion}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          formik.setFieldValue(
                            `investors.${index}.porcentaje_inversion`,
                            val
                          );
                          formik.setFieldValue(
                            `investors.${index}.porcentaje_cash_in`,
                            100 - val
                          );
                        }}
                        min={0}
                        max={100}
                      />
                    </div>
                    <div className="w-36 min-w-[120px]">
                      <Label>Cuota Inversionista</Label>
                      <Input
                        type="number"
                        name={`investors.${index}.cuota_inversionista`}
                        value={inv.cuota_inversionista ?? ""}
                        onChange={formik.handleChange}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 mt-6 border-red-500 text-red-600 hover:bg-red-50"
                      onClick={() => removeInvestor(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                onClick={addInvestor}
                variant="outline"
                className="w-full border-blue-500 text-blue-700 hover:bg-blue-50 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar Inversionista
              </Button>
            </div>
          </form>
        </div>
        {/* FOOTER FIJO */}
        <DialogFooter className="mt-auto px-6 pt-2 pb-4 flex gap-4 justify-between border-t border-blue-100">
          <Button
            variant="outline"
            type="button"
            onClick={onClose}
            className="w-1/2 border-blue-600 text-blue-700 hover:bg-blue-50 hover:border-blue-800 font-bold"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="w-1/2 bg-blue-700 text-white font-bold hover:bg-blue-800"
            disabled={isPending}
            onClick={() => formik.handleSubmit()}
          >
            {isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

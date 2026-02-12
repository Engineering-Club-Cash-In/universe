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
import { toast } from "sonner";
import { useUpdateCredit } from "../hooks/updateCredit";
import { useRecalculateQuota } from "../hooks/recalculateQuota";
import type {
  InversionistaPayload,
  UpdateCreditBody,
} from "../services/services";
import { InvestorsList } from "./InvestorsList";

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
  investorsMirrorInitial?: InvestorItem[]; // 🆕 Nueva prop para datos iniciales espejo
  onSuccess: () => void;
  investorsOptions: InvestorOption[];
  advisorsOptions: { asesor_id: number; nombre: string }[];
}

const creditFields = [
  "capital",
  "porcentaje_interes",
  "plazo",
  "no_poliza",
  "observaciones",
  "asesor_id",
  "cuota",
  "numero_credito_sifco",
  "otros",
  "seguro_10_cuotas",
  "membresias_pago",
  "formato_credito",
] as const;

type CreditField = (typeof creditFields)[number];
const fieldLabels: Record<CreditField, string> = {
  capital: "Capital",
  porcentaje_interes: "Interés (%)",
  plazo: "Plazo",
  no_poliza: "No. Póliza",
  observaciones: "Observaciones",
  cuota: "Cuota",
  numero_credito_sifco: "No. Crédito SIFCO",
  otros: "Otros (Q)",
  seguro_10_cuotas: "Seguro 10 cuotas",
  membresias_pago: "Membresías pago",
  asesor_id: "Asesor",
  formato_credito: "Formato Crédito",
};

const userFields = [
  "nombre",
  "nit",
  "direccion",
  "saldo_a_favor",
] as const;

type UserField = (typeof userFields)[number];
const userFieldLabels: Record<UserField, string> = {
  nombre: "Nombre",
  nit: "NIT",
  direccion: "Dirección",
  saldo_a_favor: "Saldo a Favor (Q)",
};

export function ModalEditCredit({
  open,
  onClose,
  initialValues,
  investorsInitial,
  investorsMirrorInitial,
  onSuccess,
  investorsOptions,
  advisorsOptions,
}: ModalEditCreditProps) {
  const { mutate: updateCredit, isPending } = useUpdateCredit();
  const { mutate: recalculateQuota, isPending: isRecalculating } =
    useRecalculateQuota();

  // Preparamos los valores iniciales
  const parseInvestors = (list?: InvestorItem[]) =>
    list?.map((inv) => ({
      inversionista_id: Number(inv.inversionista_id),
      monto_aportado: Number(inv.monto_aportado),
      porcentaje_cash_in: Number(inv.porcentaje_cash_in),
      porcentaje_inversion: Number(inv.porcentaje_inversion),
    })) || [];

  const parsedInvestors = parseInvestors(investorsInitial);
  // 🔥 Sincronización Real (Por ID de Inversionista)
  // Buscamos explícitamente el espejo que corresponda al mismo ID de inversionista.
  const parsedInvestorsMirror = parsedInvestors.map((inv) => {
    const mirrorItem = investorsMirrorInitial?.find(
      (m) => Number(m.inversionista_id) === Number(inv.inversionista_id)
    );

    if (mirrorItem) {
      return {
        inversionista_id: Number(mirrorItem.inversionista_id),
        monto_aportado: Number(mirrorItem.monto_aportado),
        porcentaje_cash_in: Number(mirrorItem.porcentaje_cash_in),
        porcentaje_inversion: Number(mirrorItem.porcentaje_inversion),
      };
    }
    // Si no hay espejo para ese inversionista, devolvemos objeto vacío
    return {
      inversionista_id: 0,
      monto_aportado: 0,
      porcentaje_cash_in: 0,
      porcentaje_inversion: 0,
    };
  });

  const formik = useFormik({
    initialValues: {
      ...initialValues,
      investors: parsedInvestors,
      investorsMirror: parsedInvestorsMirror, // 🆕 Campo para espejo
    },
    enableReinitialize: true,
    validate: (values) => {
      const errors: any = {};
      const capital = Number(values.capital || 0);

      // 🔥 VALIDACIÓN 1: Inversionistas Principales
      if (values.investors.length > 0) {
        const sumaMontos = values.investors.reduce(
          (sum, inv) => sum + Number(inv.monto_aportado || 0),
          0
        );

        if (Math.abs(sumaMontos - capital) > 0.01) {
          errors.investors = `La suma de montos aportados (Q${sumaMontos.toFixed(
            2
          )}) debe ser igual al capital (Q${capital.toFixed(2)})`;
        }
      }

      // 🔥 VALIDACIÓN 2: Inversionistas Espejo (solo validamos si HAY datos reales)
      // Si la suma es 0, asumimos que no se está usando el espejo (o está vacío)
      const sumaMontosMirror = values.investorsMirror.reduce(
        (sum, inv) => sum + Number(inv.monto_aportado || 0),
        0
      );

      if (sumaMontosMirror > 0 && Math.abs(sumaMontosMirror - capital) > 0.01) {
        errors.investorsMirror = `(Espejo) Suma: Q${sumaMontosMirror.toFixed(
          2
        )} ≠ Capital: Q${capital.toFixed(2)}`;
      }

      return errors;
    },
    onSubmit: (values) => {
      if (Object.keys(formik.errors).length > 0) {
        Object.entries(formik.errors).forEach(([, error]) => {
          if (Array.isArray(error)) {
            error.forEach((e) => toast.error(String(e)));
          } else {
            toast.error(String(error));
          }
        });
        return;
      }

      // Filtrar espejo vacíos antes de enviar
      const espejoFinal = values.investorsMirror.filter(
        (inv) => Number(inv.monto_aportado) > 0 || Number(inv.inversionista_id) > 0
      );

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

        // Campos de usuario
        nombre: values.nombre ?? undefined,
        nit: values.nit ?? undefined,
        direccion: values.direccion ?? undefined,
        saldo_a_favor:
          values.saldo_a_favor !== undefined && values.saldo_a_favor !== null
            ? Number(values.saldo_a_favor)
            : undefined,

        // Formato de crédito
        formato_credito: values.formato_credito ?? undefined,

        // Lista Principal
        inversionistas: values.investors.map((i: InvestorItem) => ({
          inversionista_id: Number(i.inversionista_id),
          monto_aportado: Number(i.monto_aportado),
          porcentaje_cash_in: Number(i.porcentaje_cash_in),
          porcentaje_inversion: Number(i.porcentaje_inversion),
        })),

        // Lista Espejo
        inversionistas_espejo: espejoFinal.map((i: InvestorItem) => ({
          inversionista_id: Number(i.inversionista_id),
          monto_aportado: Number(i.monto_aportado),
          porcentaje_cash_in: Number(i.porcentaje_cash_in),
          porcentaje_inversion: Number(i.porcentaje_inversion),
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
          toast.error(mensaje);
        },
      });
    },
  });

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
        <DialogHeader className="sticky top-0 bg-white z-10 px-6 pt-6 pb-2 border-b border-blue-100 flex flex-row items-center justify-between">
          <DialogTitle className="text-blue-700 font-bold text-xl">
            Editar Crédito e Inversionistas
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable content container */}
        <div
          className="flex-1 overflow-y-auto px-6 pb-4"
          style={{ maxHeight: "75vh" }}
        >
          <Button
            type="button"
            disabled={
              isRecalculating || !initialValues?.numero_credito_sifco
            }
            className="w-full my-4 bg-green-600 text-white font-bold hover:bg-green-700"
            onClick={() => {
              const sifco = String(
                initialValues?.numero_credito_sifco ?? ""
              );
              if (!sifco) return;
              recalculateQuota(
                { numero_credito_sifco: sifco },
                {
                  onSuccess: () => {
                    onSuccess();
                  },
                }
              );
            }}
          >
            {isRecalculating ? "Recalculando..." : "Recalcular Cuota"}
          </Button>

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
                {creditFields.map((name) => {
                  if (name === "asesor_id") {
                    return (
                      <div key={name} className="flex flex-col gap-1">
                        <Label className="text-gray-700 font-medium">
                          {fieldLabels[name]}
                        </Label>
                        <select
                          name={name}
                          value={formik.values[name] ?? ""}
                          onChange={formik.handleChange}
                          className="w-full border rounded-lg px-3 py-2 bg-blue-50 border-blue-200 text-gray-800 h-10"
                        >
                          <option value="">Seleccione un asesor</option>
                          {advisorsOptions.map((adv) => (
                            <option
                              key={adv.asesor_id}
                              value={adv.asesor_id}
                            >
                              {adv.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  if (name === "formato_credito") {
                    return (
                      <div key={name} className="flex flex-col gap-1">
                        <Label className="text-gray-700 font-medium">
                          {fieldLabels[name]}
                        </Label>
                        <select
                          name={name}
                          value={formik.values[name] ?? ""}
                          onChange={formik.handleChange}
                          className="w-full border rounded-lg px-3 py-2 bg-blue-50 border-blue-200 text-gray-800 h-10"
                        >
                          <option value="">Seleccione formato</option>
                          <option value="Pool">Pool</option>
                          <option value="Individual">Individual</option>
                        </select>
                      </div>
                    );
                  }

                  return (
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
                            "formato_credito",
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
                            "formato_credito",
                          ].includes(name)
                            ? undefined
                            : 0
                        }
                        step="any"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Datos del usuario */}
            <div className="space-y-4 mt-4">
              <h3 className="text-lg font-bold text-blue-800 mb-2">
                Datos del Usuario
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {userFields.map((name) => (
                  <div key={name} className="flex flex-col gap-1">
                    <Label className="text-gray-700 font-medium">
                      {userFieldLabels[name]}
                    </Label>
                    <Input
                      type={name === "saldo_a_favor" ? "number" : "text"}
                      name={name}
                      value={formik.values[name] ?? ""}
                      onChange={formik.handleChange}
                      className="bg-blue-50 border-blue-200 text-gray-800"
                      min={name === "saldo_a_favor" ? 0 : undefined}
                      step="any"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 🔥 LISTA UNIFICADA DE INVERSIONISTAS (CON ESPEJO INTEGRADO) */}
            <InvestorsList
              investors={formik.values.investors}
              investorsMirror={formik.values.investorsMirror} // Pasamos los espejos
              investorsOptions={investorsOptions}
              formik={formik}
              fieldName="investors" // Base name, el componente manejará el espejo internamente
              labelTitle="Inversionistas Asociados"
              errorMessage={formik.errors.investors as string}
              errorMessageMirror={formik.errors.investorsMirror as string}
            />
          </form>
        </div>

        {/* FOOTER FIJO */}
        <DialogFooter className="mt-auto px-6 pt-2 pb-4 flex gap-4 justify-between border-t border-blue-100 bg-white">
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
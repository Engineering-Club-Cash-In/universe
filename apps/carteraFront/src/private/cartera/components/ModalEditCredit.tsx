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
import { Fragment, useRef, useState, useMemo } from "react";
import { Combobox, Transition } from "@headlessui/react";
import { ChevronsUpDown, Check } from "lucide-react";
import { toast } from "sonner";
import { useUpdateCredit } from "../hooks/updateCredit";
import { useRecalculateQuota } from "../hooks/recalculateQuota";
import type {
  InversionistaPayload,
  UpdateCreditBody,
} from "../services/services";
import { updateSaldoReinversionService } from "../services/services";
import { InvestorsList } from "./InvestorsList";

// Tipos locales
interface InvestorItem extends InversionistaPayload {}
interface InvestorOption {
  inversionista_id: number;
  nombre: string;
  saldo_reinversion?: string | null;
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

  // Ref para acumular los cambios de saldo reinversion desde InvestorsList
  const saldoChangesRef = useRef<Record<number, number>>({});
  const [nuevaCuota, setNuevaCuota] = useState<number | null>(null);
  const [asesorQuery, setAsesorQuery] = useState("");

  const filteredAdvisors = useMemo(
    () =>
      asesorQuery === ""
        ? advisorsOptions
        : advisorsOptions.filter((a) =>
            a.nombre.toLowerCase().includes(asesorQuery.toLowerCase())
          ),
    [advisorsOptions, asesorQuery]
  );

  const parseParticipantDate = (dateString?: string | Date | null) => {
    return dateString ? new Date(dateString).toISOString().split('T')[0] : "2025-12-01";
  };

  // Preparamos los valores iniciales
  const parseInvestors = (list?: InvestorItem[]) =>
    list?.map((inv) => ({
      inversionista_id: Number(inv.inversionista_id),
      monto_aportado: Number(inv.monto_aportado),
      porcentaje_cash_in: Number(inv.porcentaje_cash_in),
      porcentaje_inversion: Number(inv.porcentaje_inversion),
      fecha_inicio_participacion: parseParticipantDate(inv.fecha_inicio_participacion),
      cuota_inversionista: Number(inv.cuota_inversionista || 0),
    })) || [];

  const parsedInvestors = parseInvestors(investorsInitial);
  // 🔥 Sincronización Real (Por ID de Inversionista)
  // Buscamos explícitamente el espejo que corresponda al mismo ID de inversionista.
  const parsedInvestorsMirror = parsedInvestors.map((inv) => {
    const mirrorItem = investorsMirrorInitial?.find(
      (m) => Number(m.inversionista_id) === Number(inv.inversionista_id)
    );

    if (mirrorItem) {
      // El espejo está sincronizado con el padre: usar los valores ACTUALES del principal
      // para monto_aportado, cuota y porcentajes. Solo confirmamos que el espejo existe.
      return {
        inversionista_id: Number(mirrorItem.inversionista_id),
        monto_aportado: inv.monto_aportado,           // ← Siempre del padre actual
        porcentaje_cash_in: inv.porcentaje_cash_in,   // ← Siempre del padre actual
        porcentaje_inversion: inv.porcentaje_inversion, // ← Siempre del padre actual
        fecha_inicio_participacion: parseParticipantDate(mirrorItem.fecha_inicio_participacion),
        cuota_inversionista: inv.cuota_inversionista, // ← Siempre del padre actual
      };
    }
    // Si no hay espejo para ese inversionista en DB, sincronizar desde el principal
    return {
      inversionista_id: inv.inversionista_id,
      monto_aportado: inv.monto_aportado,
      porcentaje_cash_in: inv.porcentaje_cash_in,
      porcentaje_inversion: inv.porcentaje_inversion,
      fecha_inicio_participacion: inv.fecha_inicio_participacion,
      cuota_inversionista: inv.cuota_inversionista,
    };
  });

  const formik = useFormik({
    initialValues: {
      ...initialValues,
      investors: parsedInvestors,
      investorsMirror: parsedInvestorsMirror, // 🆕 Campo para espejo
    },
    enableReinitialize: true,
    // validate: (values) => {
    //   const errors: any = {};
    //   const capital = Number(values.capital || 0);

    //   // 🔥 VALIDACIÓN 1: Inversionistas Principales
    //   if (values.investors.length > 0) {
    //     const sumaMontos = values.investors.reduce(
    //       (sum, inv) => sum + Number(inv.monto_aportado || 0),
    //       0
    //     );

    //     if (Math.abs(sumaMontos - capital) > 0.01) {
    //       errors.investors = `La suma de montos aportados (Q${sumaMontos.toFixed(
    //         2
    //       )}) debe ser igual al capital (Q${capital.toFixed(2)})`;
    //     }
    //   }

    //   return errors;
    // },
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
        asesor_id: Number(values.asesor_id) || undefined,

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

        // Abono capital
        permite_abono_capital: !!values.permite_abono_capital,

        // Lista Principal
        inversionistas: values.investors.map((i: InvestorItem) => ({
          inversionista_id: Number(i.inversionista_id),
          monto_aportado: Number(i.monto_aportado),
          porcentaje_cash_in: Number(i.porcentaje_cash_in),
          porcentaje_inversion: Number(i.porcentaje_inversion),
          fecha_inicio_participacion: i.fecha_inicio_participacion,
          cuota_inversionista: Number(i.cuota_inversionista || 0),
        })),

        // Lista Espejo
        inversionistas_espejo: espejoFinal.map((i: InvestorItem) => ({
          inversionista_id: Number(i.inversionista_id),
          monto_aportado: Number(i.monto_aportado),
          porcentaje_cash_in: Number(i.porcentaje_cash_in),
          porcentaje_inversion: Number(i.porcentaje_inversion),
          fecha_inicio_participacion: i.fecha_inicio_participacion,
          cuota_inversionista: Number(i.cuota_inversionista || 0),
        })),
      };
      updateCredit(payload, {
        onSuccess: async () => {
          // Persistir cambios de saldo reinversion
          const changes = saldoChangesRef.current;
          const ids = Object.keys(changes);
          if (ids.length > 0) {
            try {
              await Promise.all(
                ids.map((id) =>
                  updateSaldoReinversionService({
                    inversionista_id: Number(id),
                    saldo_reinversion: changes[Number(id)],
                  })
                )
              );
              toast.success("Saldos de reinversion actualizados");
            } catch {
              toast.error("Error actualizando saldos de reinversion");
            }
          }
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
        onInteractOutside={(e) => e.preventDefault()}
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
                  onSuccess: (data: any) => {
                    console.log("Recalculate response:", data);
                    const raw = data?.cuota ?? data?.nueva_cuota ?? data?.newQuota ?? data?.data?.cuota ?? data?.data?.nueva_cuota ?? data?.result?.cuota;
                    const cuotaRecalculada = Number(Number(raw || 0).toFixed(2));
                    if (cuotaRecalculada > 0) {
                      setNuevaCuota(cuotaRecalculada);
                      formik.setFieldValue("cuota", cuotaRecalculada);
                    } else {
                      const currentCuota = Number(formik.values.cuota || 0);
                      if (currentCuota > 0) {
                        setNuevaCuota(currentCuota);
                      }
                    }
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
                        <Combobox
                          value={formik.values[name] as any ?? ""}
                          onChange={(value: any) => {
                            formik.setFieldValue(name, Number(value));
                            setAsesorQuery("");
                          }}
                        >
                          <div className="relative">
                            <div className="relative w-full">
                              <Combobox.Input
                                className="w-full border rounded-lg pl-3 pr-10 py-2 bg-blue-50 border-blue-200 text-gray-800 h-10 font-medium focus:ring-2 focus:ring-blue-400 focus:border-blue-500 focus:outline-none placeholder:text-gray-400 transition-all"
                                displayValue={(id: any) =>
                                  id === ""
                                    ? ""
                                    : advisorsOptions.find((a) => a.asesor_id === Number(id))?.nombre || ""
                                }
                                onChange={(e) => setAsesorQuery(e.target.value)}
                                onFocus={(e) => e.target.select()}
                                placeholder="Buscar asesor..."
                              />
                              <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3">
                                <ChevronsUpDown className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
                              </Combobox.Button>
                            </div>
                            <Transition
                              as={Fragment as any}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                              afterLeave={() => setAsesorQuery("")}
                            >
                              <Combobox.Options className="absolute z-50 mt-2 w-full max-h-60 overflow-auto rounded-xl bg-white py-2 shadow-2xl border-2 border-blue-200 focus:outline-none">
                                {filteredAdvisors.length === 0 && asesorQuery !== "" ? (
                                  <div className="relative cursor-default select-none py-4 px-4 text-center text-gray-500 text-sm">
                                    No se encontró asesor
                                  </div>
                                ) : (
                                  filteredAdvisors.map((adv) => (
                                    <Combobox.Option
                                      key={adv.asesor_id}
                                      value={adv.asesor_id}
                                      className={({ active, selected }) =>
                                        `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                                          active
                                            ? "bg-blue-50 text-blue-900"
                                            : selected
                                              ? "bg-blue-50 text-blue-900"
                                              : "bg-white text-gray-700 hover:bg-gray-50"
                                        }`
                                      }
                                    >
                                      {({ selected }) => (
                                        <>
                                          <span className={`block truncate ${selected ? "font-bold" : "font-medium"}`}>
                                            {adv.nombre}
                                          </span>
                                          {selected && (
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-green-600">
                                              <Check className="h-5 w-5" />
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </Combobox.Option>
                                  ))
                                )}
                              </Combobox.Options>
                            </Transition>
                          </div>
                        </Combobox>
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
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => { formik.handleChange(e); if (name === "cuota") setNuevaCuota(null); }}
                        onBlur={(e) => {
                          formik.handleBlur(e);
                          if (!["observaciones", "no_poliza", "numero_credito_sifco", "formato_credito"].includes(name)) {
                            const val = Number(e.target.value);
                            formik.setFieldValue(name, Number(val.toFixed(2)));
                          }
                        }}
                        className={`border-blue-200 text-gray-800 ${name === "cuota" && nuevaCuota !== null ? "bg-green-50 border-green-400 ring-2 ring-green-200" : "bg-blue-50"}`}
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
                      {name === "cuota" && nuevaCuota !== null && (
                        <span className="text-xs font-semibold text-green-600 mt-1 flex items-center gap-1">
                          Nueva cuota recalculada: Q{nuevaCuota.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Opciones del crédito */}
            <div className="mt-4 p-4 rounded-xl border border-blue-100 bg-blue-50/50">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-gray-800 font-bold text-sm">
                    Permite Abono a Capital
                  </Label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Si está activo, el cliente puede abonar a capital aunque tenga cuotas atrasadas
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!formik.values.permite_abono_capital}
                  onClick={() =>
                    formik.setFieldValue(
                      "permite_abono_capital",
                      !formik.values.permite_abono_capital
                    )
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    formik.values.permite_abono_capital
                      ? "bg-green-500"
                      : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      formik.values.permite_abono_capital
                        ? "translate-x-5"
                        : "translate-x-0"
                    }`}
                  />
                </button>
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
                      onFocus={(e) => e.target.select()}
                      onChange={formik.handleChange}
                      onBlur={(e) => {
                        formik.handleBlur(e);
                        if (name === "saldo_a_favor") {
                          const val = Number(e.target.value);
                          formik.setFieldValue(name, Number(val.toFixed(2)));
                        }
                      }}
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
              onSaldoChanges={(changes) => { saldoChangesRef.current = changes; }}
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
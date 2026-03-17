/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, BookCopy, Wallet } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { DatePickerMUI } from "./calendar";
import type { InversionistaPayload } from "../services/services";

type TipoInversion = "compra_cartera" | "reinversion";

function getDefaultFechaInicio(tipo: TipoInversion): string {
  const now = new Date();
  if (tipo === "compra_cartera") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  // Reinversión: 3 meses atrás
  const d = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}



interface InvestorOption {
  inversionista_id: number;
  nombre: string;
  saldo_reinversion?: string | null;
}

interface InvestorsListProps {
  investors: InversionistaPayload[];
  investorsMirror: InversionistaPayload[]; // 🆕 Lista espejo
  investorsOptions: InvestorOption[];
  formik: any;
  fieldName: string; // "investors"
  labelTitle: string;
  errorMessage?: string | string[];
  errorMessageMirror?: string | string[];
  onSaldoChanges?: (changes: Record<number, number>) => void;
}

export function InvestorsList({
  investors,
  investorsMirror,
  investorsOptions,
  formik,
  fieldName,
  labelTitle,
  errorMessage,
  errorMessageMirror,
  onSaldoChanges,
}: InvestorsListProps) {
  // Estado local para saber qué items tienen el espejo expandido
  const [expandedMirrors, setExpandedMirrors] = useState<Set<number>>(new Set());
  const [investorQueries, setInvestorQueries] = useState<Record<number, string>>({});
  const [mirrorQueries, setMirrorQueries] = useState<Record<number, string>>({});

  // Track nuevos inversionistas y su tipo de inversión
  const [newInvestorIndices, setNewInvestorIndices] = useState<Set<number>>(new Set());
  const [tipoInversionMap, setTipoInversionMap] = useState<Record<number, TipoInversion>>({});

  // Track saldo_reinversion overrides por inversionista_id (para mostrar el saldo actualizado en UI)
  const [saldoOverrides, setSaldoOverrides] = useState<Record<number, number>>({});
  // Ref para guardar el monto_aportado ORIGINAL por index (el valor al abrir el modal)
  const initialMontoRef = useRef<Record<number, number>>({});

  const getOriginalSaldo = (inversionistaId: number): number => {
    const opt = investorsOptions.find((o) => o.inversionista_id === Number(inversionistaId));
    return Number(opt?.saldo_reinversion ?? 0);
  };

  const getSaldoReinversion = (inversionistaId: number): number => {
    if (saldoOverrides[inversionistaId] !== undefined) return saldoOverrides[inversionistaId];
    return getOriginalSaldo(inversionistaId);
  };

  const handleMontoAportadoChange = (index: number, newValue: number) => {
    const invId = Number(investors[index]?.inversionista_id);

    // Guardar el monto original solo la primera vez que se edita
    if (initialMontoRef.current[index] === undefined) {
      initialMontoRef.current[index] = Number(investors[index]?.monto_aportado ?? 0);
    }

    formik.setFieldValue(`${fieldName}.${index}.monto_aportado`, newValue);

    if (invId > 0) {
      const saldoOriginal = getOriginalSaldo(invId);
      if (saldoOriginal > 0) {
        // Diferencia total desde el monto original
        const diffTotal = Math.max(0, newValue - initialMontoRef.current[index]);
        const nuevoSaldo = Math.max(0, saldoOriginal - diffTotal);
        const newOverrides = { ...saldoOverrides, [invId]: nuevoSaldo };
        setSaldoOverrides(newOverrides);
        onSaldoChanges?.(newOverrides);
      }
    }
  };

  const toggleMirror = (index: number) => {
    const newSet = new Set(expandedMirrors);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedMirrors(newSet);
  };

  const addInvestor = () => {
    const tipoDefault: TipoInversion = "compra_cartera";
    const fecha = getDefaultFechaInicio(tipoDefault);
    const newInvestor = {
      inversionista_id: 0,
      monto_aportado: 0,
      porcentaje_cash_in: 0,
      porcentaje_inversion: 0,
      fecha_inicio_participacion: fecha,
    };

    const newIndex = investors.length;
    formik.setFieldValue("investors", [...investors, { ...newInvestor }]);
    formik.setFieldValue("investorsMirror", [
      ...investorsMirror,
      { ...newInvestor },
    ]);

    // Marcar como nuevo y asignar tipo por defecto
    setNewInvestorIndices((prev) => new Set(prev).add(newIndex));
    setTipoInversionMap((prev) => ({ ...prev, [newIndex]: tipoDefault }));
    // Auto-expandir espejo para que vea que se mete en ambas
    setExpandedMirrors((prev) => new Set(prev).add(newIndex));
  };

  const removeInvestor = (indexToRemove: number) => {
    // 1. Actualizar estado de expansión y tracking de nuevos (Shift Logic)
    const newExpandedSet = new Set<number>();
    const newNewIndices = new Set<number>();
    const newTipoMap: Record<number, TipoInversion> = {};

    expandedMirrors.forEach((i) => {
      if (i < indexToRemove) newExpandedSet.add(i);
      else if (i > indexToRemove) newExpandedSet.add(i - 1);
    });
    newInvestorIndices.forEach((i) => {
      if (i < indexToRemove) newNewIndices.add(i);
      else if (i > indexToRemove) newNewIndices.add(i - 1);
    });
    Object.entries(tipoInversionMap).forEach(([key, val]) => {
      const k = Number(key);
      if (k < indexToRemove) newTipoMap[k] = val;
      else if (k > indexToRemove) newTipoMap[k - 1] = val;
    });

    setExpandedMirrors(newExpandedSet);
    setNewInvestorIndices(newNewIndices);
    setTipoInversionMap(newTipoMap);

    // 2. Borrar del array principal
    const updated = [...investors];
    updated.splice(indexToRemove, 1);
    formik.setFieldValue("investors", updated);

    // 3. Borrar del array espejo (si existe)
    if (investorsMirror && investorsMirror.length > indexToRemove) {
      const updatedMirror = [...investorsMirror];
      updatedMirror.splice(indexToRemove, 1);
      formik.setFieldValue("investorsMirror", updatedMirror);
    }
  };

  // Sincronizar espejo con padre para inversionistas nuevos
  useEffect(() => {
    newInvestorIndices.forEach((idx) => {
      const padre = investors[idx];
      if (!padre) return;
      const espejo = investorsMirror[idx];
      // Solo sincronizar si hay diferencia
      if (
        espejo?.inversionista_id !== padre.inversionista_id ||
        espejo?.monto_aportado !== padre.monto_aportado ||
        espejo?.porcentaje_cash_in !== padre.porcentaje_cash_in ||
        espejo?.porcentaje_inversion !== padre.porcentaje_inversion ||
        espejo?.fecha_inicio_participacion !== padre.fecha_inicio_participacion
      ) {
        formik.setFieldValue(`investorsMirror.${idx}`, { ...padre });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investors]);

  const handleTipoInversionChange = (index: number, tipo: TipoInversion) => {
    setTipoInversionMap((prev) => ({ ...prev, [index]: tipo }));
    const fecha = getDefaultFechaInicio(tipo);
    formik.setFieldValue(`${fieldName}.${index}.fecha_inicio_participacion`, fecha);
    // Sync espejo
    formik.setFieldValue(`investorsMirror.${index}.fecha_inicio_participacion`, fecha);
  };

  // Safe checks
  const listToRender = investors || [];
  const listMirror = investorsMirror || [];

  return (
    <div className="space-y-4 mt-4">
      <h3 className="text-lg font-bold text-blue-800 mb-2">{labelTitle}</h3>
      {listToRender.length === 0 && (
        <div className="text-sm text-gray-500 mb-2">
          No hay inversionistas agregados.
        </div>
      )}
      {listToRender.map((inv, index) => {
        const isMirrorExpanded = expandedMirrors.has(index);
        const invMirror = listMirror[index] || {}; // Fallback safe
        const isNew = newInvestorIndices.has(index);
        const tipoInversion = tipoInversionMap[index];

        return (
          <div
            key={index}
            className="border rounded-xl p-4 bg-blue-50 flex flex-col gap-3 transition-all duration-300"
          >
            {/* Radio: Compra de Cartera / Reinversión (solo nuevos) */}
            {isNew && (
              <div className="flex items-center gap-6 pb-2 border-b border-blue-200">
                <span className="text-sm font-semibold text-blue-900">Tipo:</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`tipo_inversion_${index}`}
                    value="compra_cartera"
                    checked={tipoInversion === "compra_cartera"}
                    onChange={() => handleTipoInversionChange(index, "compra_cartera")}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-blue-800">Compra de Cartera</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`tipo_inversion_${index}`}
                    value="reinversion"
                    checked={tipoInversion === "reinversion"}
                    onChange={() => handleTipoInversionChange(index, "reinversion")}
                    className="accent-purple-600"
                  />
                  <span className="text-sm text-purple-800">Reinversión</span>
                </label>
              </div>
            )}

            {/* 🟦 SECCIÓN PRINCIPAL (FISCAL/OFICIAL) */}
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-blue-900 font-semibold">Inversionista (Fiscal)</Label>
                <Combobox
                  value={inv.inversionista_id}
                  onChange={(value: any) => {
                    formik.setFieldValue(`${fieldName}.${index}.inversionista_id`, Number(value));
                    setInvestorQueries((prev) => ({ ...prev, [index]: "" }));
                  }}
                >
                  <div className="relative mt-1">
                    <div className="relative w-full">
                      <Combobox.Input
                        className="w-full border rounded pl-3 pr-10 py-2 bg-white h-10 font-medium focus:ring-2 focus:ring-blue-400 focus:border-blue-500 focus:outline-none placeholder:text-gray-400 transition-all"
                        displayValue={(id: any) =>
                          id === 0 || id === ""
                            ? ""
                            : investorsOptions.find((o) => o.inversionista_id === Number(id))?.nombre || ""
                        }
                        onChange={(e) => setInvestorQueries((prev) => ({ ...prev, [index]: e.target.value }))}
                        onFocus={(e) => e.target.select()}
                        placeholder="Buscar inversionista..."
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
                      afterLeave={() => setInvestorQueries((prev) => ({ ...prev, [index]: "" }))}
                    >
                      <Combobox.Options className="absolute z-50 mt-2 w-full max-h-60 overflow-auto rounded-xl bg-white py-2 shadow-2xl border-2 border-blue-200 focus:outline-none">
                        {(() => {
                          const q = (investorQueries[index] || "").toLowerCase();
                          const filtered = q === ""
                            ? investorsOptions
                            : investorsOptions.filter((o) => o.nombre.toLowerCase().includes(q));
                          if (filtered.length === 0) {
                            return (
                              <div className="relative cursor-default select-none py-4 px-4 text-center text-gray-500 text-sm">
                                No se encontró inversionista
                              </div>
                            );
                          }
                          return filtered.map((opt) => (
                            <Combobox.Option
                              key={opt.inversionista_id}
                              value={opt.inversionista_id}
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
                                    {opt.nombre}
                                  </span>
                                  {selected && (
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-green-600">
                                      <Check className="h-5 w-5" />
                                    </span>
                                  )}
                                </>
                              )}
                            </Combobox.Option>
                          ));
                        })()}
                      </Combobox.Options>
                    </Transition>
                  </div>
                </Combobox>
              </div>
              <div className="w-32">
                <Label className="text-blue-900">Monto</Label>
                <Input
                  className="mt-1"
                  type="number"
                  name={`${fieldName}.${index}.monto_aportado`}
                  value={inv.monto_aportado}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => handleMontoAportadoChange(index, Number(e.target.value))}
                />
              </div>
              <div className="w-24">
                <Label className="text-blue-900">Cash In %</Label>
                <Input
                  className="mt-1"
                  type="number"
                  name={`${fieldName}.${index}.porcentaje_cash_in`}
                  value={inv.porcentaje_cash_in}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    formik.setFieldValue(
                      `${fieldName}.${index}.porcentaje_cash_in`,
                      val
                    );
                    formik.setFieldValue(
                      `${fieldName}.${index}.porcentaje_inversion`,
                      parseFloat((100 - val).toFixed(10))
                    );
                  }}
                />
              </div>
              <div className="w-24">
                <Label className="text-blue-900">Inv %</Label>
                <Input
                  className="mt-1"
                  type="number"
                  name={`${fieldName}.${index}.porcentaje_inversion`}
                  value={inv.porcentaje_inversion}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    formik.setFieldValue(
                      `${fieldName}.${index}.porcentaje_inversion`,
                      val
                    );
                    formik.setFieldValue(
                      `${fieldName}.${index}.porcentaje_cash_in`,
                      parseFloat((100 - val).toFixed(10))
                    );
                  }}
                />
              </div>
              <div className="w-40 flex flex-col justify-end">
                <Label className="text-blue-900 mb-1">Inicio Participación</Label>
                {isNew && tipoInversion === "reinversion" ? (
                  <div className="h-10 mt-1 flex items-center px-3 bg-gray-100 border border-gray-200 rounded-md text-sm text-gray-600 cursor-not-allowed">
                    {inv.fecha_inicio_participacion || "—"}
                    <span className="ml-1 text-xs text-gray-400">(auto)</span>
                  </div>
                ) : (
                  <div className="h-10 mt-1 [&_.MuiInputBase-root]:h-10 [&_.MuiInputBase-root]:text-sm [&_.MuiInputBase-root]:bg-white [&_.MuiOutlinedInput-notchedOutline]:border-gray-200 [&_.MuiOutlinedInput-notchedOutline]:rounded-md hover:[&_.MuiOutlinedInput-notchedOutline]:border-gray-300 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-blue-500 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-2">
                    <DatePickerMUI
                      disableFuture={false}
                      value={inv.fecha_inicio_participacion || ""}
                      onChange={(val) => {
                        formik.setFieldValue(`${fieldName}.${index}.fecha_inicio_participacion`, val);
                        // Sync espejo si es nuevo
                        if (isNew) {
                          formik.setFieldValue(`investorsMirror.${index}.fecha_inicio_participacion`, val);
                        }
                      }}
                    />
                  </div>
                )}
              </div>

               {/* Botones de Acción */}
               <div className="flex gap-2 mb-0.5">
                <Button
                    type="button"
                    variant={isMirrorExpanded ? "secondary" : "ghost"}
                    size="icon"
                    className={`h-10 w-10 border ${isMirrorExpanded ? "bg-purple-100 border-purple-300 text-purple-700" : "border-gray-300 text-gray-500 hover:text-purple-600 hover:bg-purple-50"} ${isNew ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={() => !isNew && toggleMirror(index)}
                    title={isNew ? "Espejo sincronizado (nuevo inversionista)" : isMirrorExpanded ? "Ocultar Espejo" : "Mostrar Espejo"}
                    disabled={isNew}
                >
                    <BookCopy className="w-4 h-4" />
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-10 border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 hover:border-red-300 p-0"
                    onClick={() => removeInvestor(index)}
                >
                    <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Saldo Reinversion */}
            {(() => {
              const invId = Number(inv.inversionista_id);
              const opt = investorsOptions.find((o) => o.inversionista_id === invId);
              const saldoOriginal = Number(opt?.saldo_reinversion ?? 0);
              // Mostrar si el inversionista tiene/tenia saldo > 0
              if (saldoOriginal <= 0 && saldoOverrides[invId] === undefined) return null;
              const saldo = getSaldoReinversion(invId);
              return (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                  saldo > 0
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-gray-50 border-gray-200"
                }`}>
                  <Wallet className={`w-4 h-4 shrink-0 ${saldo > 0 ? "text-emerald-600" : "text-gray-400"}`} />
                  <span className={`text-sm font-semibold ${saldo > 0 ? "text-emerald-800" : "text-gray-500"}`}>
                    Saldo de reinversion:
                  </span>
                  <span className={`text-sm font-bold ${saldo > 0 ? "text-emerald-900" : "text-gray-600"}`}>
                    Q{saldo.toFixed(2)}
                  </span>
                </div>
              );
            })()}

            {/* 🟪 SECCIÓN ESPEJO (EXPANDIBLE) */}
            {isMirrorExpanded && (
              <div className={`mt-2 pl-4 pr-4 py-4 rounded-lg border border-l-4 animate-in fade-in slide-in-from-top-2 duration-200 ${
                isNew
                  ? "bg-purple-50/30 border-purple-200 border-l-purple-300 opacity-75"
                  : "bg-purple-50/50 border-purple-200 border-l-purple-400"
              }`}>
                <div className="flex items-center gap-2 mb-3">
                    <BookCopy className="w-4 h-4 text-purple-600" />
                    <h4 className="font-bold text-sm text-purple-800">
                      Datos Espejo (Interno)
                      {isNew && (
                        <span className="ml-2 text-xs font-normal text-purple-500">
                          — Sincronizado con padre (no editable)
                        </span>
                      )}
                    </h4>
                </div>

                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <Label className="text-purple-900 font-semibold text-xs">Inversionista Espejo</Label>
                        <select
                        name={`investorsMirror.${index}.inversionista_id`}
                        value={invMirror.inversionista_id}
                        onChange={formik.handleChange}
                        disabled={isNew}
                        className={`w-full border rounded px-3 py-2 h-9 mt-1 text-sm border-purple-200 focus:ring-purple-500 ${
                          isNew ? "bg-gray-100 cursor-not-allowed text-gray-500" : "bg-white"
                        }`}
                        >
                          <div className="relative mt-1">
                            <div className="relative w-full">
                              <Combobox.Input
                                className="w-full border rounded pl-3 pr-10 py-2 bg-white h-9 text-sm font-medium border-purple-200 focus:ring-2 focus:ring-purple-400 focus:border-purple-500 focus:outline-none placeholder:text-gray-400 transition-all"
                                displayValue={(id: any) =>
                                  id === 0 || id === ""
                                    ? ""
                                    : investorsOptions.find((o) => o.inversionista_id === Number(id))?.nombre || ""
                                }
                                onChange={(e) => setMirrorQueries((prev) => ({ ...prev, [index]: e.target.value }))}
                                onFocus={(e) => e.target.select()}
                                placeholder="Buscar inversionista..."
                              />
                              <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3">
                                <ChevronsUpDown className="h-4 w-4 text-gray-400 hover:text-gray-600 transition-colors" />
                              </Combobox.Button>
                            </div>
                            <Transition
                              as={Fragment as any}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                              afterLeave={() => setMirrorQueries((prev) => ({ ...prev, [index]: "" }))}
                            >
                              <Combobox.Options className="absolute z-50 mt-2 w-full max-h-60 overflow-auto rounded-xl bg-white py-2 shadow-2xl border-2 border-purple-200 focus:outline-none">
                                {(() => {
                                  const q = (mirrorQueries[index] || "").toLowerCase();
                                  const filtered = q === ""
                                    ? investorsOptions
                                    : investorsOptions.filter((o) => o.nombre.toLowerCase().includes(q));
                                  if (filtered.length === 0) {
                                    return (
                                      <div className="relative cursor-default select-none py-4 px-4 text-center text-gray-500 text-sm">
                                        No se encontró inversionista
                                      </div>
                                    );
                                  }
                                  return filtered.map((opt) => (
                                    <Combobox.Option
                                      key={opt.inversionista_id}
                                      value={opt.inversionista_id}
                                      className={({ active, selected }) =>
                                        `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                                          active
                                            ? "bg-purple-50 text-purple-900"
                                            : selected
                                              ? "bg-purple-50 text-purple-900"
                                              : "bg-white text-gray-700 hover:bg-gray-50"
                                        }`
                                      }
                                    >
                                      {({ selected }) => (
                                        <>
                                          <span className={`block truncate ${selected ? "font-bold" : "font-medium"}`}>
                                            {opt.nombre}
                                          </span>
                                          {selected && (
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-green-600">
                                              <Check className="h-5 w-5" />
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </Combobox.Option>
                                  ));
                                })()}
                              </Combobox.Options>
                            </Transition>
                          </div>
                        </Combobox>
                    </div>
                    <div className="w-32">
                        <Label className="text-purple-900 text-xs">Monto Espejo</Label>
                        <Input
                        className={`mt-1 h-9 text-sm border-purple-200 ${isNew ? "bg-gray-100 cursor-not-allowed" : ""}`}
                        type="number"
                        name={`investorsMirror.${index}.monto_aportado`}
                        value={invMirror.monto_aportado}
                        onFocus={(e) => e.target.select()}
                        onChange={formik.handleChange}
                        disabled={isNew}
                        />
                    </div>
                    <div className="w-24">
                        <Label className="text-purple-900 text-xs">Cash In %</Label>
                        <Input
                        className={`mt-1 h-9 text-sm border-purple-200 ${isNew ? "bg-gray-100 cursor-not-allowed" : ""}`}
                        type="number"
                        name={`investorsMirror.${index}.porcentaje_cash_in`}
                        value={invMirror.porcentaje_cash_in}
                        onFocus={(e) => e.target.select()}
                        disabled={isNew}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            formik.setFieldValue(`investorsMirror.${index}.porcentaje_cash_in`, val);
                            formik.setFieldValue(`investorsMirror.${index}.porcentaje_inversion`, parseFloat((100 - val).toFixed(10)));
                        }}
                        />
                    </div>
                    <div className="w-24">
                        <Label className="text-purple-900 text-xs">Inv %</Label>
                        <Input
                        className={`mt-1 h-9 text-sm border-purple-200 ${isNew ? "bg-gray-100 cursor-not-allowed" : ""}`}
                        type="number"
                        name={`investorsMirror.${index}.porcentaje_inversion`}
                        value={invMirror.porcentaje_inversion}
                        onFocus={(e) => e.target.select()}
                        disabled={isNew}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            formik.setFieldValue(`investorsMirror.${index}.porcentaje_inversion`, val);
                            formik.setFieldValue(`investorsMirror.${index}.porcentaje_cash_in`, parseFloat((100 - val).toFixed(10)));
                        }}
                        />
                    </div>
                    <div className="w-40 flex flex-col justify-end">
                        <Label className="text-purple-900 text-xs mb-1">Inicio Participación</Label>
                        {isNew ? (
                          <div className="h-9 mt-1 flex items-center px-3 bg-gray-100 border border-purple-200 rounded-md text-sm text-gray-500 cursor-not-allowed">
                            {invMirror.fecha_inicio_participacion || "—"}
                          </div>
                        ) : (
                          <div className="h-9 mt-1 [&_.MuiInputBase-root]:h-9 [&_.MuiInputBase-root]:text-sm [&_.MuiInputBase-root]:bg-white [&_.MuiOutlinedInput-notchedOutline]:border-purple-200 [&_.MuiOutlinedInput-notchedOutline]:rounded-md hover:[&_.MuiOutlinedInput-notchedOutline]:border-purple-300 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-purple-500 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-2">
                            <DatePickerMUI
                              disableFuture={false}
                              value={invMirror.fecha_inicio_participacion || ""}
                              onChange={(val) => {
                                formik.setFieldValue(`investorsMirror.${index}.fecha_inicio_participacion`, val);
                              }}
                            />
                          </div>
                        )}
                    </div>
                    <div className="w-10"></div> {/* Spacer para alinear con botones de arriba */}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        onClick={addInvestor}
        variant="outline"
        className="w-full border-blue-500 text-blue-700 hover:bg-blue-50 flex items-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Agregar Inversionista
      </Button>

      {/* 🔥 MOSTRAR ERRORES */}
      {errorMessage && typeof errorMessage === "string" && (
        <div className="text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-lg p-3">
          ⚠️ {errorMessage}
        </div>
      )}
      {errorMessageMirror && typeof errorMessageMirror === "string" && (
        <div className="text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-lg p-3">
          ⚠️ {errorMessageMirror}
        </div>
      )}
    </div>
  );
}

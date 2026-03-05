/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, BookCopy, Wallet } from "lucide-react";
import { useRef, useState } from "react";
import { DatePickerMUI } from "./calendar";
import type { InversionistaPayload } from "../services/services";



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
    // Agregamos a ambas listas para mantener sincronía
    const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
    const newInvestor = {
      inversionista_id: 0,
      monto_aportado: 0,
      porcentaje_cash_in: 0,
      porcentaje_inversion: 0,
      fecha_inicio_participacion: today,
    };

    formik.setFieldValue("investors", [...investors, { ...newInvestor }]);
    formik.setFieldValue("investorsMirror", [
      ...investorsMirror,
      { ...newInvestor },
    ]);
  };

  const removeInvestor = (indexToRemove: number) => {
    // 1. Actualizar estado de expansión (Shift Logic)
    const newExpandedSet = new Set<number>();
    expandedMirrors.forEach((expandedIndex) => {
      if (expandedIndex < indexToRemove) {
        newExpandedSet.add(expandedIndex);
      } else if (expandedIndex > indexToRemove) {
        newExpandedSet.add(expandedIndex - 1);
      }
      // Si es igual, se ignora (se borra)
    });
    setExpandedMirrors(newExpandedSet);

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

        return (
          <div
            key={index}
            className="border rounded-xl p-4 bg-blue-50 flex flex-col gap-3 transition-all duration-300"
          >
            {/* 🟦 SECCIÓN PRINCIPAL (FISCAL/OFICIAL) */}
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-blue-900 font-semibold">Inversionista (Fiscal)</Label>
                <select
                  name={`${fieldName}.${index}.inversionista_id`}
                  value={inv.inversionista_id}
                  onChange={formik.handleChange}
                  className="w-full border rounded px-3 py-2 bg-white h-10 mt-1"
                >
                  <option value={0}>Seleccione un inversionista</option>
                  {investorsOptions.map((opt) => (
                    <option key={opt.inversionista_id} value={opt.inversionista_id}>
                      {opt.nombre}
                    </option>
                  ))}
                </select>
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
                <div className="h-10 mt-1 [&_.MuiInputBase-root]:h-10 [&_.MuiInputBase-root]:text-sm [&_.MuiInputBase-root]:bg-white [&_.MuiOutlinedInput-notchedOutline]:border-gray-200 [&_.MuiOutlinedInput-notchedOutline]:rounded-md hover:[&_.MuiOutlinedInput-notchedOutline]:border-gray-300 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-blue-500 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-2">
                  <DatePickerMUI
                    disableFuture={false}
                    value={inv.fecha_inicio_participacion || ""}
                    onChange={(val) => {
                      formik.setFieldValue(`${fieldName}.${index}.fecha_inicio_participacion`, val);
                    }}
                  />
                </div>
              </div>

               {/* Botones de Acción */}
               <div className="flex gap-2 mb-0.5">
                <Button
                    type="button"
                    variant={isMirrorExpanded ? "secondary" : "ghost"}
                    size="icon"
                    className={`h-10 w-10 border ${isMirrorExpanded ? "bg-purple-100 border-purple-300 text-purple-700" : "border-gray-300 text-gray-500 hover:text-purple-600 hover:bg-purple-50"}`}
                    onClick={() => toggleMirror(index)}
                    title={isMirrorExpanded ? "Ocultar Espejo" : "Mostrar Espejo"}
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
              <div className="mt-2 pl-4 pr-4 py-4 bg-purple-50/50 rounded-lg border border-purple-200 border-l-4 border-l-purple-400 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-2 mb-3">
                    <BookCopy className="w-4 h-4 text-purple-600" />
                    <h4 className="font-bold text-sm text-purple-800">Datos Espejo (Interno)</h4>
                </div>
                
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <Label className="text-purple-900 font-semibold text-xs">Inversionista Espejo</Label>
                        <select
                        name={`investorsMirror.${index}.inversionista_id`}
                        value={invMirror.inversionista_id}
                        onChange={formik.handleChange}
                        className="w-full border rounded px-3 py-2 bg-white h-9 mt-1 text-sm border-purple-200 focus:ring-purple-500"
                        >
                        <option value={0}>Seleccione (Opcional)</option>
                        {investorsOptions.map((opt) => (
                            <option key={opt.inversionista_id} value={opt.inversionista_id}>
                            {opt.nombre}
                            </option>
                        ))}
                        </select>
                    </div>
                    <div className="w-32">
                        <Label className="text-purple-900 text-xs">Monto Espejo</Label>
                        <Input
                        className="mt-1 h-9 text-sm border-purple-200"
                        type="number"
                        name={`investorsMirror.${index}.monto_aportado`}
                        value={invMirror.monto_aportado}
                        onFocus={(e) => e.target.select()}
                        onChange={formik.handleChange}
                        />
                    </div>
                    <div className="w-24">
                        <Label className="text-purple-900 text-xs">Cash In %</Label>
                        <Input
                        className="mt-1 h-9 text-sm border-purple-200"
                        type="number"
                        name={`investorsMirror.${index}.porcentaje_cash_in`}
                        value={invMirror.porcentaje_cash_in}
                        onFocus={(e) => e.target.select()}
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
                        className="mt-1 h-9 text-sm border-purple-200"
                        type="number"
                        name={`investorsMirror.${index}.porcentaje_inversion`}
                        value={invMirror.porcentaje_inversion}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            formik.setFieldValue(`investorsMirror.${index}.porcentaje_inversion`, val);
                            formik.setFieldValue(`investorsMirror.${index}.porcentaje_cash_in`, parseFloat((100 - val).toFixed(10)));
                        }}
                        />
                    </div>
                    <div className="w-40 flex flex-col justify-end">
                        <Label className="text-purple-900 text-xs mb-1">Inicio Participación</Label>
                        <div className="h-9 mt-1 [&_.MuiInputBase-root]:h-9 [&_.MuiInputBase-root]:text-sm [&_.MuiInputBase-root]:bg-white [&_.MuiOutlinedInput-notchedOutline]:border-purple-200 [&_.MuiOutlinedInput-notchedOutline]:rounded-md hover:[&_.MuiOutlinedInput-notchedOutline]:border-purple-300 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-purple-500 [&_.Mui-focused_.MuiOutlinedInput-notchedOutline]:border-2">
                          <DatePickerMUI
                            disableFuture={false}
                            value={invMirror.fecha_inicio_participacion || ""}
                            onChange={(val) => {
                              formik.setFieldValue(`investorsMirror.${index}.fecha_inicio_participacion`, val);
                            }}
                          />
                        </div>
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

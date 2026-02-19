/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, BookCopy } from "lucide-react";
import { useState } from "react";
import { DatePickerMUI } from "./calendar";
import type { InversionistaPayload } from "../services/services";

interface InvestorOption {
  inversionista_id: number;
  nombre: string;
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
}: InvestorsListProps) {
  // Estado local para saber qué items tienen el espejo expandido
  const [expandedMirrors, setExpandedMirrors] = useState<Set<number>>(new Set());

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
    const newInvestor = {
      inversionista_id: 0,
      monto_aportado: 0,
      porcentaje_cash_in: 0,
      porcentaje_inversion: 0,
      fecha_inicio_participacion: "2025-12-01",
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
                  onChange={formik.handleChange}
                />
              </div>
              <div className="w-24">
                <Label className="text-blue-900">Cash In %</Label>
                <Input
                  className="mt-1"
                  type="number"
                  name={`${fieldName}.${index}.porcentaje_cash_in`}
                  value={inv.porcentaje_cash_in}
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

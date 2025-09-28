import { CreditCard, PlusCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { FormikProps } from "formik"; 
import type { CreditFormValues } from "../hooks/registerCredit";

export function OtrosField({ formik }: { formik: FormikProps<CreditFormValues> }) {
  const [isOpen, setIsOpen] = useState(false);

  // Rubros temporales dentro del modal
  const [rubros, setRubros] = useState<{ nombre_rubro: string; monto: number }[]>(
    formik.values.rubros || []
  );

  // Cada vez que cambien los rubros, actualizamos el total en "otros"
  useEffect(() => {
    const total = rubros.reduce((sum, r) => sum + r.monto, 0);
    formik.setFieldValue("otros", total);
    formik.setFieldValue("rubros", rubros);
  }, [rubros]);

  return (
    <div className="grid gap-1 w-full">
      <Label className="text-gray-900 font-medium mb-1 flex items-center">
        <CreditCard className="text-blue-500 mr-2 w-5 h-5" />
        Otros
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="otros"
          name="otros"
          type="number"
          value={formik.values.otros}
          readOnly
          className="w-full border rounded-lg px-3 py-2 bg-gray-100 text-gray-900"
        />

  <TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        <PlusCircle className="w-5 h-5" />
      </button>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      className="bg-white text-gray-900 shadow-md border border-gray-200 px-3 py-2 rounded-lg"
    >
      Para llenar el campo <b>Otros</b> debe ingresar rubros
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
      </div>

      {/* Modal para agregar rubros */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-white text-gray-900 shadow-lg rounded-xl border border-gray-200">
          <DialogHeader>
            <DialogTitle>Agregar Rubros</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {rubros.map((rubro, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  type="text"
                  placeholder="Nombre rubro"
                  value={rubro.nombre_rubro}
                  onChange={(e) => {
                    const newRubros = [...rubros];
                    newRubros[idx].nombre_rubro = e.target.value;
                    setRubros(newRubros);
                  }}
                />
                <Input
                  type="number"
                  placeholder="Monto"
                  value={rubro.monto}
                  onChange={(e) => {
                    const newRubros = [...rubros];
                    newRubros[idx].monto = Number(e.target.value);
                    setRubros(newRubros);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const newRubros = [...rubros];
                    newRubros.splice(idx, 1);
                    setRubros(newRubros);
                  }}
                >
                  Eliminar
                </Button>
              </div>
            ))}
            <Button
              type="button"
              className="bg-blue-600 text-white"
              onClick={() =>
                setRubros([...rubros, { nombre_rubro: "", monto: 0 }])
              }
            >
              + Agregar Rubro
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

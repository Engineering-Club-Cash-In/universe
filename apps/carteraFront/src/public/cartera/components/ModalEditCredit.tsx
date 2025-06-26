/* eslint-disable @typescript-eslint/no-explicit-any */
 
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFormik } from "formik";

// Puedes personalizar los campos aquí según tu modelo de crédito
const creditFields = [
  { name: "capital", label: "Capital", type: "number" },
  { name: "porcentaje_interes", label: "Interés (%)", type: "number" },
  { name: "plazo", label: "Plazo (meses)", type: "number" },
  { name: "no_poliza", label: "Póliza", type: "text" },
  { name: "observaciones", label: "Observaciones", type: "text" },
];

interface ModalEditCreditProps {
  open: boolean;
  onClose: () => void;
  initialValues: Record<string, any>;
  onSave: (values: Record<string, any>) => Promise<void>;
}

export function ModalEditCredit({ open, onClose, initialValues, onSave }: ModalEditCreditProps) {
  const formik = useFormik({
    initialValues: initialValues || {},
    enableReinitialize: true,
    onSubmit: async (values) => {
      await onSave(values);
      onClose();
    },
  });

return (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent className="max-w-lg bg-white text-gray-800 shadow-2xl border border-blue-100">
      <DialogHeader>
        <DialogTitle className="text-blue-700 font-bold text-xl">
          Editar Crédito
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={formik.handleSubmit} className="space-y-4 py-2">
        {creditFields.map((field) => (
          <div key={field.name} className="flex flex-col gap-1">
            <label className="text-gray-700 font-medium">{field.label}</label>
            <Input
              type={field.type}
              name={field.name}
              value={formik.values[field.name] ?? ""}
              onChange={formik.handleChange}
              className="bg-blue-50 border-blue-200 text-gray-800"
            />
          </div>
        ))}
        <DialogFooter className="mt-6 flex gap-4 justify-between">
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
          >
            Guardar cambios
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);

}

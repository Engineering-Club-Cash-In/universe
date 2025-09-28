/* eslint-disable @typescript-eslint/no-explicit-any */
// src/components/AdvisorsManager.tsx
import {  useState } from "react";
 
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button"; 
import { useAdvisors } from "../hooks/advisor";
import { useIsMobile } from "../hooks/useIsMobile";
 
// ========== Interfaces ==========
export interface Advisor {
  asesor_id: number;
  nombre: string;
  activo: boolean;
  email?: string;
}



// ========== Componente Principal ==========
export default function AdvisorsManager() {
  const { advisors, loading, addAdvisor, editAdvisor } = useAdvisors();
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<Advisor | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    email: "",
    password: "",
    activo: true,
  });

  const handleOpen = (advisor?: Advisor) => {
    if (advisor) {
      setEditing(advisor);
      setForm({
        nombre: advisor.nombre,
        email: advisor.email || "",
        password: "",
        activo: advisor.activo,
      });
    } else {
      setEditing(null);
      setForm({ nombre: "", email: "", password: "", activo: true });
    }
    setIsOpen(true);
  };

const handleSubmit = async () => {
  try {
    if (editing) {
      await editAdvisor(editing.asesor_id, form);
      window.alert(`✅ Asesor actualizado correctamente: ${form.nombre}`);
    } else {
      await addAdvisor(form);
      window.alert(`✅ Asesor creado correctamente: ${form.nombre}`);
    }

    setIsOpen(false); // cerrar modal solo si fue exitoso
  } catch (error: any) {
    console.error("Error al guardar asesor:", error);
    window.alert(
      `❌ Error al guardar asesor: ${error?.message || "Intenta nuevamente."}`
    );
  }
};
  return (
   <div
      className={`
   fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8
    ${isMobile ? "" : "overflow-x-auto"}
  `}
    >
      <div className="p-6 bg-white rounded-md shadow-md w-full max-w-5xl">
        <h2 className="text-2xl font-bold text-blue-600 mb-4">
          Gestión de Asesores
        </h2>

        <Button
          onClick={() => handleOpen()}
          className="mb-4 bg-blue-600 text-white"
        >
          + Nuevo Asesor
        </Button>

        {loading ? (
          <p className="text-black">Cargando asesores...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border border-gray-200 text-sm text-black">
              <thead className="bg-blue-100">
                <tr>
                  <th className="p-2 text-left">ID</th>
                  <th className="p-2 text-left">Nombre</th>
                  <th className="p-2 text-left">Email</th>
                  <th className="p-2 text-left">Activo</th>
                  <th className="p-2 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {advisors.map((a) => (
                  <tr key={a.asesor_id} className="border-t">
                    <td className="p-2">{a.asesor_id}</td>
                    <td className="p-2">{a.nombre}</td>
                    <td className="p-2">{a.email || "-"}</td>
                    <td className="p-2">{a.activo ? "Sí" : "No"}</td>
                    <td className="p-2 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpen(a)}
                        className="text-blue-600 border-blue-600"
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal */}
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="sm:max-w-md bg-white text-black">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Editar Asesor" : "Crear Asesor"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nombre</Label>
                <Input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="text-black"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="text-black"
                />
              </div>
              <div>
                <Label>Contraseña</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="text-black"
                />
              </div>
              <div>
                <Label>Activo</Label>
                <select
                  className="border rounded-md p-2 w-full text-black"
                  value={form.activo ? "true" : "false"}
                  onChange={(e) =>
                    setForm({ ...form, activo: e.target.value === "true" })
                  }
                >
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
              <Button
                onClick={handleSubmit}
                className="w-full bg-blue-600 text-white"
              >
                {editing ? "Actualizar" : "Crear"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// src/components/UsersManager.tsx
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { useIsMobile } from "../hooks/useIsMobile";
import { useAdminData } from "../hooks/advisor";

// Interfaces
export interface PlatformUser {
  id: number;
  email: string;
  role: "ASESOR" | "CONTA";
  is_active: boolean;
  profile?: {
    nombre?: string;
  };
}

// ================= Componente =================
export default function UsersManager() {
  const {
    platformUsers,
    loadingPlatformUsers,
    addAdvisor,
    editAdvisor,
    addConta,
    editConta,
  } = useAdminData();

  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [userType, setUserType] = useState<"ASESOR" | "CONTA">("ASESOR");

  const [form, setForm] = useState({
    nombre: "",
    email: "",
    password: "",
    activo: true,
  });

  const handleOpen = (user?: PlatformUser) => {
    if (user) {
      setEditing(user);
      setUserType(user.role);

      setForm({
        nombre: user.profile?.nombre || "",
        email: user.email,
        password: "",
        activo: user.is_active,
      });
    } else {
      setEditing(null);
      setForm({
        nombre: "",
        email: "",
        password: "",
        activo: true,
      });
    }
    setIsOpen(true);
  };

  const handleSubmit = async () => {
    try {
      if (editing) {
        // editar
        if (editing.role === "ASESOR") {
          await editAdvisor({ id: editing.id, advisor: form });
        } else if (editing.role === "CONTA") {
          await editConta({ contaId: editing.id, updates: form });
        }
        window.alert(`✅ Usuario actualizado correctamente: ${form.nombre}`);
      } else {
        // crear
        if (userType === "ASESOR") {
          await addAdvisor(form);
        } else {
          await addConta(form);
        }
        window.alert(`✅ Usuario creado correctamente: ${form.nombre}`);
      }

      setIsOpen(false);
      // 🚀 React Query refresca automáticamente la tabla
    } catch (error: any) {
      console.error("Error al guardar usuario:", error);
      window.alert(
        `❌ Error al guardar usuario: ${error?.message || "Intenta nuevamente."}`
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
      <div className="p-6 bg-white rounded-md shadow-md w-full max-w-6xl">
        <h2 className="text-2xl font-bold text-blue-600 mb-4">
          Gestión de Usuarios (Asesores & Contabilidad)
        </h2>

        <Button
          onClick={() => handleOpen()}
          className="mb-4 bg-blue-600 text-white"
        >
          + Nuevo Usuario
        </Button>

        {loadingPlatformUsers ? (
          <p className="text-black">Cargando usuarios...</p>
        ) : (
          <>
            {/* Desktop → Tabla */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border border-gray-200 text-sm text-black">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Nombre</th>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-left">Activo</th>
                    <th className="p-2 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {platformUsers.map((u) => (
                    <tr key={u.id} className="border-t hover:bg-gray-50">
                      <td className="p-2">{u.role}</td>
                      <td className="p-2">{u.profile?.nombre || "-"}</td>
                      <td className="p-2">{u.email}</td>
                      <td className="p-2">{u.is_active ? "Sí" : "No"}</td>
                      <td className="p-2 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpen(u)}
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

            {/* Mobile → Lista */}
            <div className="md:hidden space-y-3">
              {platformUsers.map((u) => (
                <div
                  key={u.id}
                  className="border rounded-lg p-3 shadow-sm bg-gray-50 text-gray-800"
                >
                  <p className="text-sm font-semibold text-blue-600">
                    {u.role} — {u.profile?.nombre || "-"}
                  </p>
                  <p className="text-xs">Email: {u.email}</p>
                  <p className="text-xs">
                    Activo:{" "}
                    <span
                      className={`font-semibold ${
                        u.is_active ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {u.is_active ? "Sí" : "No"}
                    </span>
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-blue-600 border-blue-600 flex-1"
                      onClick={() => handleOpen(u)}
                    >
                      Editar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Modal */}
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="sm:max-w-md bg-white text-black shadow-lg border border-gray-200">
            <DialogHeader>
              <DialogTitle>
                {editing
                  ? `Editar ${editing.role === "ASESOR" ? "Asesor" : "Conta"}`
                  : `Crear ${userType === "ASESOR" ? "Asesor" : "Conta"}`}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {!editing && (
                <div>
                  <Label>Tipo de usuario</Label>
                  <select
                    className="border rounded-md p-2 w-full text-black bg-white"
                    value={userType}
                    onChange={(e) =>
                      setUserType(e.target.value as "ASESOR" | "CONTA")
                    }
                  >
                    <option value="ASESOR">Asesor</option>
                    <option value="CONTA">Conta</option>
                  </select>
                </div>
              )}
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
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  className="text-black"
                />
              </div>
              <div>
                <Label>Activo</Label>
                <select
                  className="border rounded-md p-2 w-full text-black bg-white"
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

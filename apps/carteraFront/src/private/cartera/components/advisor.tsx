/* eslint-disable @typescript-eslint/no-unused-vars */
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
    telefono?: string; // 🔥 NUEVO
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
    apellido: "",
    telefono: "", // 🔥 NUEVO
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
        apellido: "",
        telefono: user.profile?.telefono || "", // 🔥 NUEVO
        email: user.email,
        password: "",
        activo: user.is_active,
      });
    } else {
      setEditing(null);
      setForm({
        nombre: "",
        apellido: "",
        telefono: "", // 🔥 NUEVO
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
          // 🔥 Para CONTA no enviamos telefono
          const { telefono, ...contaForm } = form;
          await editConta({ contaId: editing.id, updates: contaForm });
        }
        window.alert(`✅ Usuario actualizado correctamente: ${form.nombre}`);
      } else {
        // crear
        if (userType === "ASESOR") {
          await addAdvisor(form);
        } else {
          // 🔥 Para CONTA no enviamos telefono
          const { telefono, ...contaForm } = form;
          await addConta(contaForm);
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
                    <th className="p-2 text-left">Teléfono</th> {/* 🔥 NUEVA COLUMNA */}
                    <th className="p-2 text-left">Activo</th>
                    <th className="p-2 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {platformUsers.map((u) => (
                    <tr key={u.id} className="border-t hover:bg-gray-50">
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          u.role === "ASESOR" 
                            ? "bg-blue-100 text-blue-700" 
                            : "bg-purple-100 text-purple-700"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-2">{u.profile?.nombre || "-"}</td>
                      <td className="p-2">{u.email}</td>
                      <td className="p-2"> {/* 🔥 NUEVA CELDA */}
                        {u.role === "ASESOR" 
                          ? (u.profile?.telefono || "-") 
                          : <span className="text-gray-400 text-xs">N/A</span>
                        }
                      </td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          u.is_active 
                            ? "bg-green-100 text-green-700" 
                            : "bg-red-100 text-red-700"
                        }`}>
                          {u.is_active ? "Sí" : "No"}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpen(u)}
                          className="text-blue-600 border-blue-600 hover:bg-blue-50"
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
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      u.role === "ASESOR" 
                        ? "bg-blue-100 text-blue-700" 
                        : "bg-purple-100 text-purple-700"
                    }`}>
                      {u.role}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      u.is_active 
                        ? "bg-green-100 text-green-700" 
                        : "bg-red-100 text-red-700"
                    }`}>
                      {u.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  
                  <p className="text-sm font-semibold text-blue-600 mb-1">
                    {u.profile?.nombre || "-"}
                  </p>
                  <p className="text-xs text-gray-600">📧 {u.email}</p>
                  
                  {/* 🔥 NUEVO: Mostrar teléfono solo si es ASESOR */}
                  {u.role === "ASESOR" && u.profile?.telefono && (
                    <p className="text-xs text-gray-600">📱 {u.profile.telefono}</p>
                  )}
                  
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-blue-600 border-blue-600 flex-1 hover:bg-blue-50"
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
              <DialogTitle className="text-blue-700">
                {editing
                  ? `Editar ${editing.role === "ASESOR" ? "Asesor" : "Contador"}`
                  : `Crear ${userType === "ASESOR" ? "Asesor" : "Contador"}`}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {!editing && (
                <div>
                  <Label className="text-gray-700">Tipo de usuario</Label>
                  <select
                    className="border rounded-md p-2 w-full text-black bg-white focus:ring-2 focus:ring-blue-500"
                    value={userType}
                    onChange={(e) =>
                      setUserType(e.target.value as "ASESOR" | "CONTA")
                    }
                  >
                    <option value="ASESOR">Asesor</option>
                    <option value="CONTA">Contador</option>
                  </select>
                </div>
              )}
              
              <div>
                <Label className="text-gray-700">Nombre</Label>
                <Input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="text-black"
                  placeholder="Ej. Juan Pérez"
                />
              </div>

              {/* 🔥 NUEVO: Campo teléfono solo para ASESORES */}
              {(userType === "ASESOR" || editing?.role === "ASESOR") && (
                <div>
                  <Label className="text-gray-700">
                    Teléfono <span className="text-gray-400 text-xs">(opcional)</span>
                  </Label>
                  <Input
                    value={form.telefono}
                    onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                    className="text-black"
                    placeholder="Ej. 1234-5678"
                  />
                </div>
              )}
              
              <div>
                <Label className="text-gray-700">Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="text-black"
                  placeholder="correo@example.com"
                />
              </div>
              
              <div>
                <Label className="text-gray-700">
                  Contraseña {editing && <span className="text-gray-400 text-xs">(dejar vacío para no cambiar)</span>}
                </Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  className="text-black"
                  placeholder={editing ? "••••••••" : "Ingrese contraseña"}
                />
              </div>
              
              <div>
                <Label className="text-gray-700">Estado</Label>
                <select
                  className="border rounded-md p-2 w-full text-black bg-white focus:ring-2 focus:ring-blue-500"
                  value={form.activo ? "true" : "false"}
                  onChange={(e) =>
                    setForm({ ...form, activo: e.target.value === "true" })
                  }
                >
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              </div>
              
              <Button
                onClick={handleSubmit}
                className="w-full bg-blue-600 text-white hover:bg-blue-700"
              >
                {editing ? "Actualizar Usuario" : "Crear Usuario"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
import { useState, useEffect } from "react";
import { InputIcon, IconAddress, IconPhone, IconPerson } from "@/components";
import { useQuery } from "@tanstack/react-query";
import { ModalConfirmChange } from "./ModalConfirmChange";

interface ProfileData {
  dpi?: string;
  phone?: string;
  address?: string;
  profileCompleted: boolean;
}

interface InfoPersonProps {
  userId: string;
  userName?: string;
  userEmail: string;
  userImage?: string;
}

type EditField = "dpi" | "phone" | "address" | null;

export const InfoPerson = ({ userId }: InfoPersonProps) => {
  const [dpi, setDpi] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [editingField, setEditingField] = useState<EditField>(null);

  const baseURL = import.meta.env.VITE_API_URL || "http://localhost:3000";

  // Obtener perfil
  const { data: profileData, refetch } = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const response = await fetch(`${baseURL}/api/profile/${userId}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Error al cargar el perfil");
      const result = await response.json();
      return result.data as ProfileData;
    },
    enabled: !!userId,
  });

  // Actualizar campos cuando se carga el perfil
  useEffect(() => {
    if (profileData) {
      setDpi(profileData.dpi || "");
      setPhone(profileData.phone || "");
      setAddress(profileData.address || "");
    }
  }, [profileData]);

  const handleOpenModal = (field: EditField) => {
    setEditingField(field);
  };

  const handleCloseModal = () => {
    setEditingField(null);
  };

  const handleSuccess = () => {
    refetch();
  };

  const getCurrentValue = () => {
    switch (editingField) {
      case "dpi":
        return dpi;
      case "phone":
        return phone;
      case "address":
        return address;
      default:
        return "";
    }
  };

  const IconEdit = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
    >
      <path
        d="M9.65247 7.01343C10.5113 8.3461 11.6533 9.47999 13.0011 10.3308L7.52258 15.8103C7.09769 16.2352 6.88519 16.4479 6.62415 16.5876C6.36309 16.7273 6.06795 16.7862 5.47864 16.9041L3.23547 17.3533C2.90288 17.4198 2.73633 17.4528 2.64172 17.3582C2.54718 17.2635 2.5801 17.097 2.64661 16.7644L3.09583 14.5212C3.21369 13.9319 3.27255 13.6368 3.41223 13.3757C3.55194 13.1147 3.76468 12.9022 4.18958 12.4773L9.65247 7.01343ZM12.964 3.73022C13.6761 3.19432 14.6571 3.19434 15.3693 3.73022C15.4815 3.81467 15.5987 3.93228 15.8331 4.16675C16.0676 4.40125 16.1852 4.51841 16.2697 4.63062C16.8056 5.34277 16.8056 6.32371 16.2697 7.03589C16.1852 7.14809 16.0676 7.26526 15.8331 7.49976L14.4591 8.8728C13.0602 8.08668 11.9034 6.93963 11.1066 5.55933L12.5001 4.16675C12.7346 3.93226 12.8518 3.81467 12.964 3.73022Z"
        fill="#9499EC"
      />
    </svg>
  );

  const isProfileComplete = profileData?.profileCompleted ?? false;

  return (
    <div className="space-y-8">
      {/* Estado del perfil */}
      {!isProfileComplete && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <svg
              className="w-6 h-6 text-yellow-400 shrink-0 mt-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-yellow-400 font-semibold mb-2">
                Perfil Incompleto
              </p>
              <p className="text-yellow-200/80 text-sm">
                Por favor completa todos los campos de tu información personal
                para que podamos procesar tus solicitudes.
              </p>
            </div>
          </div>
        </div>
      )}

      {isProfileComplete && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <svg
              className="w-6 h-6 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-green-400 font-semibold">Perfil Completo</p>
          </div>
        </div>
      )}

      {/* Información Personal */}
      <div className="">
        <h2 className="text-header-body mb-6">Información Personal</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* DPI */}
          <div className="text-[#6B7280]">
            <label className="text-sm text-white/65 mb-2 block">
              DPI (Documento Personal de Identificación)
            </label>
            <InputIcon
              icon={<IconPerson />}
              placeholder="Ingresa tu DPI"
              value={dpi}
              onChange={(e) => setDpi(e.target.value)}
              type="text"
              name="dpi"
            />
            <button
              onClick={() => handleOpenModal("dpi")}
              className="text-primary text-sm mt-2 hover:underline flex items-center gap-1"
            >
              <IconEdit />
              Editar DPI
            </button>
          </div>

          {/* Teléfono */}
          <div>
            <label className="text-sm text-white/65 mb-2 block">Teléfono</label>
            <InputIcon
              icon={<IconPhone className="w-6 h-6" />}
              placeholder="Ingresa tu teléfono"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              name="phone"
            />
            <button
              onClick={() => handleOpenModal("phone")}
              className="text-primary text-sm mt-2 hover:underline flex items-center gap-1"
            >
              <IconEdit />
              Editar Teléfono
            </button>
          </div>

          {/* Dirección */}
          <div>
            <label className="text-sm text-white/65 mb-2 block">
              Dirección
            </label>
            <InputIcon
              icon={<IconAddress className="w-6 h-6" />}
              placeholder="Ingresa tu dirección completa"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              type="text"
              name="address"
            />
            <button
              onClick={() => handleOpenModal("address")}
              className="text-primary text-sm mt-2 hover:underline flex items-center gap-1"
            >
              <IconEdit />
              Editar Dirección
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Edición */}
      <ModalConfirmChange
        isOpen={!!editingField}
        field={editingField}
        userId={userId}
        initialValue={getCurrentValue()}
        onClose={handleCloseModal}
        onSuccess={handleSuccess}
      />
    </div>
  );
};

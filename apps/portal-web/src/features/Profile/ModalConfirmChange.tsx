import { useState, useEffect } from "react";
import { InputIcon, Button, IconAddress, IconPhone, IconUser } from "@/components";
import { useMutation } from "@tanstack/react-query";

type FieldType = 'dpi' | 'phone' | 'address';

interface ModalConfirmChangeProps {
  isOpen: boolean;
  field: FieldType | null;
  userId: string;
  initialValue: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const ModalConfirmChange = ({
  isOpen,
  field,
  userId,
  initialValue,
  onClose,
  onSuccess,
}: ModalConfirmChangeProps) => {
  const [tempValue, setTempValue] = useState(initialValue);
  const baseURL = import.meta.env.VITE_API_URL || "http://localhost:3000";

  // Actualizar tempValue cuando cambia initialValue
  useEffect(() => {
    setTempValue(initialValue);
  }, [initialValue]);

  // Mutation para actualizar DPI
  const updateDpiMutation = useMutation({
    mutationFn: async (newDpi: string) => {
      const response = await fetch(`${baseURL}/api/profile/${userId}/dpi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dpi: newDpi }),
      });
      if (!response.ok) throw new Error("Error al actualizar DPI");
      return response.json();
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  // Mutation para actualizar tel�fono
  const updatePhoneMutation = useMutation({
    mutationFn: async (newPhone: string) => {
      const response = await fetch(`${baseURL}/api/profile/${userId}/phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: newPhone }),
      });
      if (!response.ok) throw new Error("Error al actualizar tel�fono");
      return response.json();
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  // Mutation para actualizar direcci�n
  const updateAddressMutation = useMutation({
    mutationFn: async (newAddress: string) => {
      const response = await fetch(`${baseURL}/api/profile/${userId}/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ address: newAddress }),
      });
      if (!response.ok) throw new Error("Error al actualizar direcci�n");
      return response.json();
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  const handleConfirmChange = async () => {
    if (!field) return;

    try {
      switch (field) {
        case 'dpi':
          await updateDpiMutation.mutateAsync(tempValue);
          break;
        case 'phone':
          await updatePhoneMutation.mutateAsync(tempValue);
          break;
        case 'address':
          await updateAddressMutation.mutateAsync(tempValue);
          break;
      }
    } catch (error) {
      console.error("Error al actualizar:", error);
    }
  };

  const isSaving =
    updateDpiMutation.isPending ||
    updatePhoneMutation.isPending ||
    updateAddressMutation.isPending;

  const getFieldLabel = () => {
    switch (field) {
      case 'dpi':
        return 'DPI';
      case 'phone':
        return 'Teléfono';
      case 'address':
        return 'Dirección';
      default:
        return '';
    }
  };

  const getFieldIcon = () => {
    switch (field) {
      case 'dpi':
        return <IconUser className="w-6 h-6" />;
      case 'phone':
        return <IconPhone className="w-6 h-6" />;
      case 'address':
        return <IconAddress className="w-6 h-6" />;
      default:
        return null;
    }
  };

  const getFieldPlaceholder = () => {
    switch (field) {
      case 'dpi':
        return 'Ingresa tu DPI';
      case 'phone':
        return 'Ingresa tu teléfono';
      case 'address':
        return 'Ingresa tu dirección completa';
      default:
        return '';
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !field) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-8 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-6">Editar {getFieldLabel()}</h3>

        <div className="mb-6">
          <InputIcon
            icon={getFieldIcon()}
            placeholder={getFieldPlaceholder()}
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            type={field === 'phone' ? 'tel' : 'text'}
            name={field}
          />
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleConfirmChange}
            isLoading={isSaving}
            size="sm"
            className={!tempValue.trim() ? "opacity-50 cursor-not-allowed" : ""}
          >
            {isSaving ? "Guardando..." : "Confirmar"}
          </Button>
        </div>
      </div>
    </div>
  );
};

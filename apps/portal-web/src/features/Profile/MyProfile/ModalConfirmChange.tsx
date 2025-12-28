import { useState, useEffect } from "react";
import { InputIcon, Button, IconAddress, IconPhone, IconUser } from "@/components";
import { useMutation } from "@tanstack/react-query";
import { updateLead } from "../services";
import { useAuth } from "@/lib";

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
  initialValue,
  onClose,
  onSuccess,
}: ModalConfirmChangeProps) => {
  const [tempValue, setTempValue] = useState(initialValue);
  const [serverError, setServerError] = useState<string>("");
  const { token, user } = useAuth();

  // Actualizar tempValue cuando cambia initialValue
  useEffect(() => {
    setTempValue(initialValue);
    setServerError("");
  }, [initialValue]);

  // Mutation unificada para actualizar cualquier campo
  const updateMutation = useMutation({
    mutationFn: ({ field, value }: { field: FieldType; value: string }) => {
      const email = user?.email;
      if (!email) throw new Error("Email no disponible");

      interface UpdateLeadPayload {
        email: string;
        dpi?: string;
        phone?: string;
        address?: string;
      }

      const payload: UpdateLeadPayload = { email };
      if (field === 'dpi') payload.dpi = value;
      if (field === 'phone') payload.phone = value;
      if (field === 'address') payload.address = value;

      return updateLead(payload, token || null);
    },
    onSuccess: () => {
      setServerError("");
      onSuccess();
      onClose();
    },
    onError: (error) => {
      const errorMessage = error?.message || "Error al actualizar la información";
      setServerError(errorMessage);
    },
  });

  const handleConfirmChange = async () => {
    if (!field) return;
    setServerError("");

    try {
      await updateMutation.mutateAsync({ field, value: tempValue });
    } catch (error) {
      console.error("Error al actualizar:", error);
    }
  };

  const isSaving = updateMutation.isPending;

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
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-dark backdrop-blur-md border border-white/20 rounded-2xl p-8 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-6">Editar {getFieldLabel()}</h3>

        <div className="mb-6">
          <InputIcon
            icon={getFieldIcon()}
            placeholder={getFieldPlaceholder()}
            value={tempValue}
            onChange={(e) => {
              setTempValue(e.target.value);
              if (serverError) setServerError("");
            }}
            type={field === 'phone' ? 'tel' : 'text'}
            name={field}
          />
          {serverError && (
            <div className="text-red-500 text-sm mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
              {serverError}
            </div>
          )}
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

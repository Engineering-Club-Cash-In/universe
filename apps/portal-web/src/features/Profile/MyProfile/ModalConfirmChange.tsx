import { useState, useEffect } from "react";
import { InputIcon, Button, IconAddress, IconPhone, IconUser, Select } from "@/components";
import { useMutation, useQuery } from "@tanstack/react-query";
import { updateLead } from "../services";
import { createInvestor, getBancos } from "../services/investorService";
import { useAuth } from "@/lib";
import { authClient } from "@/lib/auth";

type FieldType = 'dpi' | 'phone' | 'address' | 'banco_id' | 'tipo_cuenta' | 'numero_cuenta';

interface ModalConfirmChangeProps {
  isOpen: boolean;
  field: FieldType | null;
  initialValue: string;
  onClose: () => void;
  onSuccess: () => void;
  profileData?: any;
}

export const ModalConfirmChange = ({
  isOpen,
  field,
  initialValue,
  onClose,
  onSuccess,
  profileData
}: ModalConfirmChangeProps) => {
  const [tempValue, setTempValue] = useState(initialValue);
  const [serverError, setServerError] = useState<string>("");
  const { user } = useAuth();

  const isInvestorField = field && ['banco_id', 'tipo_cuenta', 'numero_cuenta'].includes(field);

  // Obtener catálogo de bancos solo si el campo es banco
  const { data: bancos } = useQuery({
    queryKey: ["bancos"],
    queryFn: getBancos,
    enabled: isOpen && field === 'banco_id',
  });

  // Actualizar tempValue cuando cambia initialValue
  useEffect(() => {
    setTempValue(initialValue);
    setServerError("");
  }, [initialValue]);

  // Mutation unificada para actualizar cualquier campo
  const updateMutation = useMutation({
    mutationFn: async ({ field, value }: { field: FieldType; value: string }) => {
      const email = user?.email;
      const dpi = user?.dpi;

      // Si es campo de inversionista, actualizar en Cartera
      if (isInvestorField) {
        if (!dpi) throw new Error("DPI no disponible");

        const payload: any = {
          dpi: parseInt(dpi),
        };

        // Solo enviar el campo que se está actualizando
        if (field === 'banco_id') payload.banco_id = Number(value);
        if (field === 'tipo_cuenta') payload.tipo_cuenta = value;
        if (field === 'numero_cuenta') payload.numero_cuenta = value;

        return createInvestor({...profileData, ...payload });
      }

      // Si es campo de cliente, actualizar en CRM
      if (!email) throw new Error("Email no disponible");

      interface UpdateLeadPayload {
        email: string;
        dpi?: string;
        phone?: string;
        address?: string;
      }

      const payload: UpdateLeadPayload = { email };
      if (field === 'dpi') {
        // eslint-disable-next-line
        // @ts-ignore
        await authClient.updateUser({ dpi: value });
        payload.dpi = value;
      }
      if (field === 'phone') payload.phone = value;
      if (field === 'address') payload.address = value;

      return updateLead(payload);
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
      case 'banco_id':
        return 'Banco';
      case 'tipo_cuenta':
        return 'Tipo de Cuenta';
      case 'numero_cuenta':
        return 'Número de Cuenta';
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
      case 'banco_id':
        return 'Selecciona tu banco';
      case 'tipo_cuenta':
        return 'Selecciona tipo de cuenta';
      case 'numero_cuenta':
        return 'Ingresa tu número de cuenta';
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
          {/* Campo Select para Banco */}
          {field === 'banco_id' && (
            <Select
              variant="light"
              value={tempValue}
              onChange={(value) => {
                console.log(value)
                setTempValue(value);
                if (serverError) setServerError("");
              }}
              options={
                bancos?.map((b) => ({
                  value: b.banco_id.toString(),
                  label: b.nombre,
                })) || []
              }
              placeholder={getFieldPlaceholder()}
            />
          )}

          {/* Campo Select para Tipo de Cuenta */}
          {field === 'tipo_cuenta' && (
            <Select
              variant="light"
              value={tempValue}
              onChange={(value) => {
                setTempValue(value);
                if (serverError) setServerError("");
              }}
              options={[
                { value: "MONETARIA", label: "Monetaria" },
                { value: "AHORRO", label: "Ahorro" },
              ]}
              placeholder={getFieldPlaceholder()}
            />
          )}

          {/* Campo Input para otros campos */}
          {field !== 'banco_id' && field !== 'tipo_cuenta' && (
            <InputIcon
              icon={getFieldIcon()}
              placeholder={getFieldPlaceholder()}
              value={tempValue}
              onChange={(e) => {
                setTempValue(e.target.value);
                if (serverError) setServerError("");
              }}
              type={field === 'phone' ? 'tel' : 'text'}
              name={field || ''}
            />
          )}

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
            className={!tempValue?.trim() ? "opacity-50 cursor-not-allowed" : ""}
          >
            {isSaving ? "Guardando..." : "Confirmar"}
          </Button>
        </div>
      </div>
    </div>
  );
};

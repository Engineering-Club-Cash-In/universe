import { useState } from "react";
import { InputIcon, Button, IconPerson } from "@/components";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib";
import { authClient } from "@/lib/auth";
import { registerExternalUser } from "../services";

interface CompleteProfileFormProps {
  onSuccess: () => void;
}

export const CompleteProfileForm = ({
  onSuccess,
}: CompleteProfileFormProps) => {
  const { user } = useAuth();
  const [dpi, setDpi] = useState("");
  const [userType, setUserType] = useState<"CLIENT" | "INVESTOR">("CLIENT");
  const [error, setError] = useState("");

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!dpi || dpi.length !== 13) {
        throw new Error("El DPI debe tener 13 dígitos");
      }

      // 1. Actualizar usuario en better-auth
      await authClient.updateUser({
        dpi: dpi,
        role: userType,
      } as any);

      await registerExternalUser({
        userType: userType,
        fullName: user?.name || user?.email.split("@")[0] || "",
        email: user?.email ?? "",
        dpi: dpi,
      });
    },
    onSuccess: () => {
      setError("");
      onSuccess();
    },
    onError: (err: any) => {
      setError(err?.message || "Error al completar el perfil");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    await completeMutation.mutateAsync();
  };

  return (
    <div className="bg-red-500/10 border-2 border-red-500/50 rounded-2xl p-8 max-w-2xl mx-auto">
      <div className="flex items-start gap-4 mb-6">
        <svg
          className="w-8 h-8 text-red-400 shrink-0 mt-1"
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
          <h2 className="text-xl font-bold text-red-400 mb-2">
            Información Requerida
          </h2>
          <p className="text-red-200/90">
            Para continuar usando la plataforma, necesitamos que completes la
            siguiente información importante.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Tipo de Usuario */}
        <div>
          <label className="text-white font-medium mb-3 block">
            ¿Qué deseas hacer? *
          </label>
          <div className="flex flex-col lg:flex-row gap-4">
            <label
              className={`flex-1 flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                userType === "CLIENT"
                  ? "border-primary bg-primary/10"
                  : "border-white/20 hover:border-white/40"
              }`}
            >
              <input
                type="radio"
                name="userType"
                value="CLIENT"
                checked={userType === "CLIENT"}
                onChange={() => setUserType("CLIENT")}
                className="w-4 h-4 accent-primary"
              />
              <div className="text-left">
                <p className="font-semibold">Solicitar Crédito</p>
                <p className="text-xs text-white/65">
                  Para financiar tu vehículo
                </p>
              </div>
            </label>

            <label
              className={`flex-1 flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${
                userType === "INVESTOR"
                  ? "border-primary bg-primary/10"
                  : "border-white/20 hover:border-white/40"
              }`}
            >
              <input
                type="radio"
                name="userType"
                value="INVESTOR"
                checked={userType === "INVESTOR"}
                onChange={() => setUserType("INVESTOR")}
                className="w-4 h-4 accent-primary"
              />
              <div className="text-left">
                <p className="font-semibold">Invertir</p>
                <p className="text-xs text-white/65">
                  Para generar rendimientos
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* DPI */}
        <div>
          <label className="text-white font-medium mb-2 block">
            DPI (13 dígitos) *
          </label>
          <InputIcon
            icon={<IconPerson />}
            placeholder="Ingresa tu DPI"
            value={dpi}
            onChange={(e) => {
              setDpi(e.target.value);
              setError("");
            }}
            type="text"
            name="dpi"
            maxLength={13}
          />
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            isLoading={completeMutation.isPending}
            size="lg"
            className={
              !dpi || dpi.length !== 13 ? "opacity-50 cursor-not-allowed" : ""
            }
          >
            {completeMutation.isPending
              ? "Guardando..."
              : "Guardar y Continuar"}
          </Button>
        </div>
      </form>
    </div>
  );
};

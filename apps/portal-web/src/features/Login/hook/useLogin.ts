import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authService } from "../services/authService";
import type { LoginCredentials } from "@/lib/auth";

export const useLogin = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<LoginCredentials>({
    email: "",
    password: "",
    rememberMe: false,
  });

  // Mutation para el login
  const loginMutation = useMutation({
    mutationFn: authService.login,
    onSuccess: (data) => {
      // Guardar token en localStorage
      localStorage.setItem("auth-token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      // Redirigir al perfil
      navigate({ to: "/profile" });
    },
    onError: (error: Error) => {
      console.error("Error en login:", error);
      // Aquí podrías mostrar un toast o mensaje de error
    },
  });

  // Handlers del formulario
  const handleEmailChange = (value: string) => {
    setFormData((prev) => ({ ...prev, email: value }));
  };

  const handlePasswordChange = (value: string) => {
    setFormData((prev) => ({ ...prev, password: value }));
  };

  const handleRememberMeChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, rememberMe: checked }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(formData);
  };

  const handleGoogleLogin = () => {
    // TODO: Implementar login con Google usando better-auth
    console.log("Google login - Por implementar");
  };

  return {
    formData,
    handleEmailChange,
    handlePasswordChange,
    handleRememberMeChange,
    handleSubmit,
    handleGoogleLogin,
    isLoading: loginMutation.isPending,
    error: loginMutation.error,
  };
};

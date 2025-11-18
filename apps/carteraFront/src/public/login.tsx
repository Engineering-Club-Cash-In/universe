/* eslint-disable no-useless-escape */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import axios from "axios";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/Provider/authProvider";
import { useNavigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_BACK_URL || "http://localhost:7000";

// Regex para email
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Regex para password (mínimo 8, mayúscula, minúscula, número, especial)
const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{8,}$/;

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Recuperar email guardado
  useEffect(() => {
    const savedEmail = localStorage.getItem("rememberEmail");
    if (savedEmail) {
      setEmail(savedEmail);
      setRemember(true);
    }
  }, []);

  const validateInputs = () => {
    if (!emailRegex.test(email)) {
      setError("⚠️ Ingresa un correo electrónico válido (ejemplo@correo.com).");
      return false;
    }
    if (!passwordRegex.test(password)) {
      setError(
        "⚠️ La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula, un número y un símbolo."
      );
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 🔒 Validaciones antes de llamar al backend
    if (!validateInputs()) return;

    setLoading(true);

    try {
      const res = await axios.post(`${API_URL}/auth/login`, {
        email,
        password,
      });

      if (res.data.success) {
        if (remember) {
          localStorage.setItem("rememberEmail", email);
        } else {
          localStorage.removeItem("rememberEmail");
        }

        // 👀 login espera (user, accessToken, refreshToken)
        login(
          res.data.data.user,
          res.data.data.accessToken,
          res.data.data.refreshToken
        );

        navigate("/", { replace: true });
      } else {
        setError(res.data.error || "Credenciales inválidas");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Error en el login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md border border-gray-200"
      >
        {/* 🔥 Logo */}
        <div className="flex flex-col items-center mb-4">
          <img
            src="/logo-cashin.png"
            alt="Club Cashin Logo"
            className="h-12 mb-2"
            style={{ objectFit: "contain" }}
          />
          {/* 🔥 Título personalizado */}
          <h1 className="text-2xl font-bold text-blue-600 text-center">
            Cartera de Créditos
          </h1>
        </div>

        {error && (
          <div className="mb-4 text-red-600 text-sm text-center">{error}</div>
        )}

        <div className="mb-4">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            placeholder="ejemplo@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 text-gray-900 placeholder-gray-400 bg-gray-50 
                   border border-gray-300 focus:border-blue-500 
                   focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mb-6">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            placeholder="********"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 text-gray-900 placeholder-gray-400 bg-gray-50 
                   border border-gray-300 focus:border-blue-500 
                   focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Checkbox recordar */}
        <div className="flex items-center mb-6">
          <input
            id="remember"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mr-2 accent-blue-600 w-4 h-4"
          />
          <label
            htmlFor="remember"
            className="text-gray-700 select-none cursor-pointer"
          >
            Recordar mi correo
          </label>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          {loading ? "Ingresando..." : "Ingresar"}
        </Button>
      </form>
    </div>
  );
}

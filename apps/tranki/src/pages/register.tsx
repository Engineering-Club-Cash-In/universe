import FirstImage from "/assets/register/1.webp";
import SecondImage from "/assets/register/2.webp";
import ThirdImage from "/assets/register/3.webp";
import CCILogo from "/assets/landing/cci-logo.svg";
import IGLogo from "/assets/register/ig.svg";
import TwitterLogo from "/assets/register/x.svg";
import FacebookLogo from "/assets/register/fb.svg";
import LinkedInLogo from "/assets/register/in.svg";
import YoutubeLogo from "/assets/register/yt.svg";

import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { register } from "../services/eden";
import { createCrmPerson, getRenapData } from "../services/eden";
export default function Register() {
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(window.location.search);
  const initialDpi = searchParams.get("dpi") || "";

  const images = [FirstImage, SecondImage, ThirdImage];
  const [selectedImage] = useState(() => {
    const randomIndex = Math.floor(Math.random() * images.length);
    return images[randomIndex];
  });

  const [formData, setFormData] = useState({
    dpi: initialDpi,
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState({
    dpi: "",
    email: "",
    password: "",
  });

  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  const validateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");

    const newErrors = {
      dpi: "",
      email: "",
      password: "",
    };

    // DPI validation
    if (formData.dpi.length !== 13) {
      newErrors.dpi = "El DPI debe tener 13 dígitos";
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      newErrors.email = "Formato de correo electrónico inválido";
    }

    // Password validation
    if (formData.password !== formData.confirmPassword) {
      newErrors.password = "Las contraseñas no coinciden";
    }

    setErrors(newErrors);

    // If no errors, proceed with form submission
    if (!Object.values(newErrors).some((error) => error !== "")) {
      try {
        setIsLoading(true);
        const result = await register(formData.email, formData.password);

        if (!result) {
          setServerError("Error al registrar usuario");
          return;
        }

        if (result.success && result.user) {
          // Store user ID instead, we'll use it for verification
          localStorage.setItem("userId", result.user.id);
          const renapData = await getRenapData(formData.dpi);
          console.log("Renap Data:", renapData);
          const crmPerson = await createCrmPerson(
            formData.email,
            renapData?.data.firstName || "",
            renapData?.data.firstLastName || "",
            renapData?.data.department_borned_in || "",
            renapData?.data.picture || ""
          );
          console.log("CRM Person:", crmPerson);
          navigate({ to: "/login" });
        } else {
          setServerError(result.error || "Error al registrar usuario");
        }
      } catch (error) {
        console.error("Registration error:", error);
        setServerError("Error al conectar con el servidor");
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === "dpi") {
      // Only allow numeric input for DPI
      const numericValue = value.replace(/\D/g, "");
      setFormData({
        ...formData,
        [name]: numericValue,
      });
    } else {
      setFormData({
        ...formData,
        [name]: value,
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <aside
        className="w-1/4 h-screen px-4 flex flex-col"
        style={{
          backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url(${selectedImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <img src={CCILogo} alt="CCI Logo" width={200} className="mb-32" />
        <div className="flex-grow">
          <p className="text-white text-5xl font-bold text-center">
            Vive tu vida
          </p>
          <p className="text-white text-5xl ml-16 font-bold text-center">
            Tranki
          </p>
        </div>
        <div className="flex flex-col items-center gap-4 mb-12">
          <div className="flex items-center justify-center gap-4">
            <img
              src={IGLogo}
              alt="IG Logo"
              className="w-10 h-10 cursor-pointer"
            />
            <img
              src={TwitterLogo}
              alt="Twitter Logo"
              className="w-10 h-10 cursor-pointer"
            />
            <img
              src={FacebookLogo}
              alt="Facebook Logo"
              className="w-10 h-10 cursor-pointer"
            />
            <img
              src={LinkedInLogo}
              alt="LinkedIn Logo"
              className="w-10 h-10 cursor-pointer"
            />
            <img
              src={YoutubeLogo}
              alt="Youtube Logo"
              className="w-10 h-10 cursor-pointer"
            />
          </div>
          <span className="text-white text-sm text-center cursor-pointer">
            Terminos y condiciones | Politica de privacidad
          </span>
        </div>
      </aside>
      <main className="flex flex-col justify-start items-center w-3/4 h-screen bg-white p-8">
        <header className="flex w-full items-center justify-end gap-4 mb-24">
          <p className="text-black text-lg">
            Ya tienes una cuenta con nosotros?
          </p>
          <Link to="/login">
            <button className="bg-transparent h-[40px] w-[120px] text-purple border-2 border-purple px-4 py-2 rounded-full flex items-center justify-center hover:bg-purple/80 hover:text-white hover:scale-105 transition-all cursor-pointer">
              Ingresar
            </button>
          </Link>
        </header>
        <div className="flex flex-col w-1/2 items-center justify-center text-left gap-4">
          <p className=" w-full text-black text-4xl font-extrabold">
            Crea tu usuario
          </p>
          <p className="w-full text-black text-lg">
            Para continuar el proceso, ingresa los siguientes datos:
          </p>

          {serverError && (
            <div className="w-full p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {serverError}
            </div>
          )}

          <form className="flex flex-col w-full gap-4" onSubmit={validateForm}>
            <div className="flex flex-col w-full gap-2">
              <label htmlFor="dpi" className="text-black text-lg">
                DPI
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                id="dpi"
                name="dpi"
                value={formData.dpi}
                onChange={handleChange}
                className="w-full h-[40px] border-2 border-purple px-4 py-2 rounded-full"
              />
              {errors.dpi && (
                <span className="text-red-500 text-sm">{errors.dpi}</span>
              )}
            </div>
            <div className="flex flex-col w-full gap-2">
              <label htmlFor="email" className="text-black text-lg">
                Correo electronico
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full h-[40px] border-2 border-purple px-4 py-2 rounded-full"
              />
              {errors.email && (
                <span className="text-red-500 text-sm">{errors.email}</span>
              )}
            </div>
            <div className="flex flex-col w-full gap-2">
              <label htmlFor="password" className="text-black text-lg">
                Contraseña
              </label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="w-full h-[40px] border-2 border-purple px-4 py-2 rounded-full"
              />
            </div>
            <div className="flex flex-col w-full gap-2">
              <label htmlFor="confirmPassword" className="text-black text-lg">
                Confirmar contraseña
              </label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full h-[40px] border-2 border-purple px-4 py-2 rounded-full"
              />
              {errors.password && (
                <span className="text-red-500 text-sm">{errors.password}</span>
              )}
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className={`bg-purple w-1/4 text-white text-lg font-bold px-4 py-2 rounded-full mt-8 hover:bg-purple/80 hover:scale-105 transition-all ${
                isLoading ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              {isLoading ? "Procesando..." : "Continuar"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

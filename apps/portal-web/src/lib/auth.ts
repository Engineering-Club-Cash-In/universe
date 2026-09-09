import { redirect } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/client";
import {
  debeElegirPassword,
  type UsuarioConMarcaDePassword,
} from "./primerIngreso";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL,
  fetchOptions: {
    credentials: "include",
  },
});

/**
 * El usuario de la sesión, o `null`.
 *
 * Separado de los guards porque los `redirect()` de TanStack Router se lanzan,
 * y aquí había un `try/catch` que envolvía también al `throw redirect(...)`:
 * cualquier redirección que se decidiera adentro terminaba tratada como un
 * error de sesión y mandando al login. Con la consulta aislada, el `catch` solo
 * cubre lo que de verdad puede fallar —la petición— y los guards deciden en
 * terreno limpio.
 */
const usuarioDeSesion = async (): Promise<UsuarioConMarcaDePassword | null> => {
  try {
    const sessionData = await authClient.getSession();
    // El cliente no está tipado con los campos extra de Better Auth
    // (`role`, `dpi`, `passwordProvisionadaAt`), pero el servidor sí los manda.
    return (sessionData?.data?.user as UsuarioConMarcaDePassword) ?? null;
  } catch (error) {
    console.error("checkAuth - Error:", error);
    return null;
  }
};

/**
 * Guard de las pantallas privadas: exige sesión y, antes que nada, que la
 * contraseña sea suya y no la que le generamos.
 */
export const checkAuth = async () => {
  const usuario = await usuarioDeSesion();

  if (!usuario) throw redirect({ to: "/login" });

  if (debeElegirPassword(usuario)) throw redirect({ to: "/primer-ingreso" });
};

/**
 * Guard de la pantalla de primer ingreso.
 *
 * Devuelve al perfil a quien ya eligió su contraseña: sin esto, la pantalla
 * quedaría accesible por URL pidiendo una "contraseña temporal" que ya no
 * existe.
 */
export const checkPrimerIngreso = async () => {
  const usuario = await usuarioDeSesion();

  if (!usuario) throw redirect({ to: "/login" });

  if (!debeElegirPassword(usuario)) throw redirect({ to: "/profile" });
};

// Tipos para la autenticación
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export type UserType = "CLIENT" | "INVESTOR";

export interface RegisterCredentials {
  fullName: string;
  phone: string;
  dpi: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  userType: UserType;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  dpi?: string;
  image?: string;
  role: UserType;
}

export interface AuthResponse {
  user: User;
  token: string;
}

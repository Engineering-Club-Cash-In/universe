import type { LoginCredentials, RegisterCredentials, AuthResponse } from "@/lib/auth";

// Servicio ficticio de autenticación
// TODO: Reemplazar con la API real cuando esté disponible
export const authService = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    // Simulación de llamada a API
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // Simulación de validación
        if (credentials.email && credentials.password) {
          resolve({
            user: {
              id: "1",
              email: credentials.email,
              name: "Usuario Demo",
            },
            token: "fake-jwt-token-" + Date.now(),
          });
        } else {
          reject(new Error("Credenciales inválidas"));
        }
      }, 1000);
    });
  },

  register: async (credentials: RegisterCredentials): Promise<AuthResponse> => {
    // Simulación de llamada a API de registro
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // Simulación de validación
        if (credentials.email && credentials.password && credentials.acceptTerms) {
          resolve({
            user: {
              id: "2",
              email: credentials.email,
              name: credentials.fullName,
              phone: credentials.phone,
            },
            token: "fake-jwt-token-" + Date.now(),
          });
        } else {
          reject(new Error("Datos de registro inválidos"));
        }
      }, 1500);
    });
  },

  logout: async (): Promise<void> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 500);
    });
  },

  getCurrentUser: async (): Promise<AuthResponse | null> => {
    // Simulación de obtener usuario actual
    const token = localStorage.getItem("auth-token");
    if (!token) return null;

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          user: {
            id: "1",
            email: "demo@example.com",
            name: "Usuario Demo",
          },
          token,
        });
      }, 500);
    });
  },
};

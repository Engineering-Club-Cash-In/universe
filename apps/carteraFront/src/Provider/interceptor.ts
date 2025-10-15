// src/api/axiosInstance.ts
import axios from "axios"; 

const api = axios.create({
  baseURL: import.meta.env.VITE_BACK_URL,
});

// ✅ Interceptor para inyectar token en headers
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ Interceptor para manejar expiración y refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Si es 401 y no hemos intentado ya refrescar
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        console.warn("⚠️ No hay refreshToken, cerrando sesión...");
        localStorage.clear();
        window.location.href = "/login";
        return Promise.reject(error);
      }

      try {
        const res = await axios.post(
          `${import.meta.env.VITE_BACK_URL}/auth/refresh`,
          { refreshToken }
        );

        if (res.data.success) {
          const newAccessToken = res.data.accessToken;

          // Guardar el nuevo token
          localStorage.setItem("accessToken", newAccessToken);

          // Reintentar petición original con nuevo token
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(originalRequest);
        } else {
          console.error("⚠️ Refresh inválido:", res.data.error);
          localStorage.clear();
          window.location.href = "/login";
        }
      } catch (err) {
        console.error("❌ Error en refresh:", err);
        localStorage.clear();
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export default api;

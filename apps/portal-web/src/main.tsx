import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  CLAVE_ENTIDADES,
  hayQueRefrescarEntidades,
} from "@/features/Profile/services/entidadRevocada";
import { AuthProvider } from "@/lib";
import "./index.css";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
const router = createRouter({ 
  routeTree,
  defaultPreload: 'intent',
});

// Add scroll to top on every navigation
router.subscribe('onLoad', () => {
  window.scrollTo(0, 0);
});

// Create a client for React Query
//
// El `queryCache` con `onError` está por una razón concreta: un 403 en
// cualquier consulta con alcance de entidad significa que la lista de entidades
// que tiene el navegador ya no es cierta —al equipo le quitaron una sociedad a
// esta persona— y esa lista se cachea cinco minutos. Sin refrescarla,
// `useEntidades` sigue eligiendo el id que ya no es suyo y la persona ve
// pantallas vacías hasta que expire, sin que nada se lo diga ni se corrija.
// Ver `entidadRevocada.ts`.
const queryCache = new QueryCache({
  onError: (error, query) => {
    if (!hayQueRefrescarEntidades(error, query.queryKey)) return;

    queryClient.invalidateQueries({ queryKey: [CLAVE_ENTIDADES] });
  },
});

const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Render the app
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

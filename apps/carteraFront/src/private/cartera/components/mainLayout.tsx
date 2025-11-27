import { DashBoardCartera } from "@/public";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Outlet } from "react-router-dom";

export function MainLayout() {
  return (
    <SidebarProvider>
      {/* Container principal con altura completa fija */}
      <div className="flex h-screen w-full overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-50">
        {/* Sidebar: Siempre renderizado (maneja mobile internamente) */}
        <DashBoardCartera />

        {/* Main content area con scroll independiente */}
   <main className="flex-1 overflow-y-auto overflow-x-hidden lg:ml-[260px]">
          <div className="min-h-full">
            {/* Contenedor con padding adaptativo */}
            <div className="w-full px-4 sm:px-6 lg:px-8 py-6 pt-20 lg:pt-8">
              {/* Outlet con animación de entrada */}
              <div className="animate-fadeIn">
                <Outlet />
              </div>
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
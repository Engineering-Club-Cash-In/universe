import { DashBoardCartera } from "@/public";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Outlet } from "react-router-dom";

export function MainLayout() {
  return (
    <SidebarProvider>
      {/* Container principal con altura completa fija */}
      <div className="flex h-screen w-full overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-50">
        
        {/* Sidebar: Fijo en desktop, overlay en mobile */}
        <aside className="flex-shrink-0 hidden md:block">
          <DashBoardCartera />
        </aside>

        {/* Main content area con scroll independiente y padding left para el sidebar */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden md:ml-0">
          <div className="min-h-full">
            {/* Contenedor con padding adaptativo */}
            <div className="w-full px-4 sm:px-6 lg:px-8 py-6 md:py-8 pt-20 md:pt-8">
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
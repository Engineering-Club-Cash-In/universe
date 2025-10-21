import { DashBoardCartera } from "@/public";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Outlet } from "react-router-dom";

export function MainLayout() {
  return (
    
   <SidebarProvider>
  <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] min-h-screen w-full">
    <DashBoardCartera />
   <main className="flex justify-center min-h-screen w-full bg-transparent">
  <div className="w-full max-w-3xl px-2 sm:px-0">
    <Outlet />
  </div>
</main>
  </div>
</SidebarProvider>
  );
}

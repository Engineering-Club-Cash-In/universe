import { DashBoardCartera } from "@/public";
import { Outlet } from "react-router-dom";

export function MainLayout() {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <DashBoardCartera />
      
      <main className="w-full pt-20 xl:pt-24 px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
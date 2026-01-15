import { DashBoardCartera } from "@/public";
import { Outlet } from "react-router-dom";

export function MainLayout() {
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <DashBoardCartera />
      
      {/* 🔥 Sin padding-top, pegado al navbar */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-h-full">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
            <div className="animate-fadeIn">
              <Outlet />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
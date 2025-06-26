/* eslint-disable @typescript-eslint/no-explicit-any */
export function MiniCardCredito({ creditos, usuarios }: { creditos: any, usuarios: any }) {
  if (!creditos || !usuarios) return null;

  return (
    <div className="w-full flex justify-center">
      <div className="
        bg-blue-50 border border-blue-200 rounded-xl shadow-md
        px-6 py-4
        grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-3 w-full max-w-[800px]
      ">
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Crédito SIFCO</span>
          <span className="text-gray-800 text-xl">{creditos.numero_credito_sifco}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Usuario</span>
          <span className="text-gray-800">{usuarios.nombre}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Deuda Total</span>
          <span className="text-green-700 font-bold text-lg">Q{Number(creditos.deudatotal).toLocaleString()}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-blue-700 text-lg">Cuota</span>
          <span className="text-indigo-700 font-bold text-lg">Q{Number(creditos.cuota).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

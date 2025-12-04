import { type Seller } from "@/features/Marketplace/services/serviceMarketplace";

interface CarSellerProps {
  seller: Seller;
}

export const CarSeller = ({ seller }: CarSellerProps) => {
  return (
    <div className="border rounded-2xl p-4 flex items-center gap-4">
      <img
        src={seller.image}
        alt={seller.nombre}
        className="max-w-24 max-h-24 object-contain rounded-full"
      />
      <div>
        <p className="">{seller.nombre}</p>
        {/* BottomSheet Vendedor  Verificado */}

        <div className="mt-2 flex items-center gap-2 bg-green-100/20 text-green-500 px-3 py-1 rounded-full  text-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          Vendedor verificado
        </div>
      </div>
    </div>
  );
};

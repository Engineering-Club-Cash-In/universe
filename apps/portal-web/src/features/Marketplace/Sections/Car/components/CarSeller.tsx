import { type Seller } from "@/features/Marketplace/services/serviceMarketplace";
import { IconVerify } from "./IconVerify";

interface CarSellerProps {
  seller: Seller;
}

export const CarSeller = ({ seller }: CarSellerProps) => {
  return (
    <div className="border rounded-2xl p-2 lg:p-4 flex lg:flex-wrap items-center gap-2 lg:gap-4">
      <img
        src={seller.image}
        alt={seller.nombre}
        className="w-8 h-8 lg:w-24 lg:h-24 rounded-full"
      />
      <div className="">
        <p className="text-xs lg:text-base">{seller.nombre}</p>
        {/* BottomSheet Vendedor  Verificado */}

        <div className="mt-2 inline-flex items-center justify-center gap-2 bg-green-100/20 text-[#7ED321] px-2 lg:px-3 py-1 rounded-full text-mini lg:text-sm">
          <IconVerify />
          Vendedor verificado
        </div>
      </div>
    </div>
  );
};

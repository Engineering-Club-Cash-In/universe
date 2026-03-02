import { useIsMobile } from "@/hooks";
import { useLeadInvestor } from "./store/useLeadInvestor";
import { FormularioInvestor, ThanksInvestor } from "./components";
import { IconCashIn } from "@/features/FormLeads/FormLeads";

const urlImage = import.meta.env.VITE_IMAGE_URL;

interface LeadInvestorProps {
  initialAmount?: string;
}

export const LeadInvestor = ({ initialAmount }: LeadInvestorProps) => {
  const imageUrl = urlImage + "/Frame 1321315308.png";
  const isMobile = useIsMobile();
  const isSubmitted = useLeadInvestor((state) => state.isSubmitted);

  if (isSubmitted) {
    return <ThanksInvestor />;
  }

  return (
    <div className="flex flex-col  pt-4 lg:pt-6 mb-20">
      {!isMobile && <IconCashIn  />}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="relative mt-0 lg:-mt-16">
          <img
            src={imageUrl}
            alt="Inversión"
            className="w-full h-[50svh] lg:h-[80svh] object-cover lg:rounded-2xl"
          />
          <div
            className="absolute inset-0 w-full h-[50svh] lg:h-[80svh] flex flex-col items-center justify-center"
            style={{
              background: `
                linear-gradient(180deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 100%),
                linear-gradient(0deg, #0F0F0F 4.33%, rgba(15, 15, 15, 0.00) 40%),
                linear-gradient(90deg, #0F0F0F 1%, rgba(15, 15, 15, 0.00) 5%),
                linear-gradient(270deg, #0F0F0F 1%, rgba(15, 15, 15, 0.00) 5%)
              `,
            }}
          >
            {isMobile && (
              <div className="mb-4">
                <IconCashIn />
              </div>
            )}
            <h2 className="text-2xl font-bold lg:text-header-body xl:text-header-3 text-white text-center px-6 lg:px-30">
              Pequeñas decisiones, grandes momentos.
            </h2>
          </div>
        </div>
        <div className="py-12 lg:py-0 lg:-mt-6 px-10 lg:px-30 xl:px-40">
          <FormularioInvestor initialAmount={initialAmount} />
        </div>
      </div>
    </div>
  );
};

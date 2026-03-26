import { InvestorIsotipo } from "./InvestorIsotipo";

interface InvestorsLogoTempProps {
  width?: string;
  height?: string;
}

export const InvestorsLogoTemp = ({
  height = "128px",
  width = "128px",
}: InvestorsLogoTempProps) => {
  return (
    <div className="flex items-center gap-4" >
      <div className="h-full aspect-square">
        <InvestorIsotipo height={height} width={width} />
      </div>
      <div className="flex flex-col">
        <span className="text-white font-bold text-2xl md:text-4xl lg:text-6xl xl:text-[72px] leading-tight">
          CashIn
        </span>
      </div>
    </div>
  );
};

import { IconCCI } from "@/components/IconCCI";

interface InvestorsLogoTempProps {
  width?: string;
  height?: string;
}

export const InvestorsLogoTemp = ({
  height = "128px",
}: InvestorsLogoTempProps) => {
  return (
    <div className="flex items-center gap-4" style={{ height }}>
      <div className="h-full aspect-square">
        <IconCCI />
      </div>
      <div className="flex flex-col">
        <span className="text-white font-bold text-2xl md:text-4xl lg:text-6xl xl:text-[64px] leading-tight">
          CashIn
        </span>
        <span className="text-white font-semibold text-xs md:text-sm lg:text-lg xl:text-2xl self-end">
          Inversión
        </span>
      </div>
    </div>
  );
};

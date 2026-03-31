import logoCashin from "../assets/logoInversiones.png";

interface InvestorsLogoTempProps {
  width?: string;
  height?: string;
}

export const InvestorsLogoTemp = ({
  height = "128px",
  width = "128px",
}: InvestorsLogoTempProps) => {
  return (
    <img
      src={logoCashin}
      alt="Club CashIn Inversión"
      style={{ width, height, objectFit: "contain" }}
    />
  );
};

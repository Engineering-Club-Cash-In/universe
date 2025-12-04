interface BoottomSheetsProps {
  children?: React.ReactNode;
  state?: "open" | "closed";
  backgroundColor?: string;
  className?: string;
}

export const BoottomSheets = ({
  children,
  backgroundColor = "rgba(154, 159, 245, 0.10)",
  className = "",
}: BoottomSheetsProps) => {
  return (
    <div
      className={`rounded-4xl px-6 py-4  font-bold border-primary text-primary ${className}`}
      style={{ backgroundColor }}
    >
      {children}
    </div>
  );
};

import { useIsMobile } from "@/hooks";
import { IconX } from "@components/icons";

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => void;
  name?: string;
  placeholder?: string;
  type?: "text" | "password" | "email" | "number" | "area";
  variant?: "primary" | "secondary";
  className?: string;
  error?: string;
  size?: "small" | "medium" | "large";
}

export const Input = ({
  value,
  onChange,
  onBlur,
  name,
  placeholder,
  type = "text",
  className = "",
  error,
  variant = "secondary",
}: InputProps) => {
  const hasError = !!error;

  const isMobile = useIsMobile();

  const baseClasses = `
    flex
    w-full
    ${isMobile ? "p-4 text-sm" : ""}
    ${!isMobile ? "p-4 text-base" : ""}
    rounded-lg
    ${variant === "primary" ? "bg-transparent border border-[#374151] text-white" : "bg-[#D9D9D9] border-0 text-black"}
    font-[Hero]
    font-normal
    leading-[110%]
    tracking-[-0.267px]
    outline-none
    focus:ring-2
    focus:ring-gray-400
    ${hasError ? "text-red-500 placeholder:text-red-500 pr-[55px]" : ""}
    ${className}
  `;

  if (type === "area") {
    return (
      <div className="relative w-full">
        <textarea
          name={name}
          className={`${baseClasses} min-h-[150px] resize-y`}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        {hasError && (
          <div className="absolute right-[25px] top-6 pointer-events-none">
            <IconX />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full  ">
      <input
        name={name}
        className={baseClasses}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {hasError && (
        <div className="absolute right-[25px] top-1/2 -translate-y-1/2 pointer-events-none">
          <IconX />
        </div>
      )}
      {error && (
        <p className="text-red-500 text-sm mt-2 text-left px-2">{error}</p>
      )}
    </div>
  );
};

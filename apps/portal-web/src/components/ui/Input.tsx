import { useIsMobile } from "@/hooks";
import { IconX } from "@components/icons";

type SanitizeType = "name" | "numeric" | "safe-text";

const SANITIZE_PATTERNS: Record<SanitizeType, RegExp> = {
  name: /[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜàèìòùÀÈÌÒÙäëïöüÄËÏÖÜçÇ\s''-]/g,
  numeric: /[^0-9]/g,
  "safe-text": /[<>{}]/g,
};

const applySanitize = (value: string, sanitize?: SanitizeType): string => {
  if (!sanitize) return value;
  return value.replace(SANITIZE_PATTERNS[sanitize], "");
};

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
  sanitize?: SanitizeType;
  maxLength?: number;
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
  sanitize,
  maxLength,
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
    ${hasError ? "text-[#FD5353] placeholder:text-[#FD5353] pr-[55px]" : ""}
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
          maxLength={maxLength}
          onChange={(e) => onChange(applySanitize(e.target.value, sanitize))}
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
        maxLength={maxLength}
        onChange={(e) => onChange(applySanitize(e.target.value, sanitize))}
        onBlur={onBlur}
      />
      {hasError && (
        <div className="absolute right-[25px] top-1/2 -translate-y-1/2 pointer-events-none">
          <IconX />
        </div>
      )}
      {error && (
        <p className="text-[#FD5353] text-sm mt-2 text-left px-2">{error}</p>
      )}
    </div>
  );
};

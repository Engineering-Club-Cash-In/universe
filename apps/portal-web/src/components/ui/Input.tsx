import { IconX } from "@components/icons";

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  name?: string;
  placeholder?: string;
  type?: "text" | "password" | "email";
  variant?: "primary" | "secondary";
  className?: string;
  error?: string;
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
}: InputProps) => {
  const hasError = !!error;

  return (
    <div className="relative w-full max-w-[500px]">
      <input
        name={name}
        className={`
          flex
          w-full
          px-[25px]
          py-[25.833px]
          rounded-[12.5px]
          bg-[#D9D9D9]
          font-[Hero]
          text-[16px]
          font-normal
          leading-[110%]
          tracking-[-0.267px]
          border-0
          outline-none
          focus:ring-2
          focus:ring-gray-400
          ${hasError ? "text-red-500 placeholder:text-red-500 pr-[55px]" : "text-[#0F0F0F]"}
          ${className}
        `}
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
      {/*error && (
        <p className="text-red-500 text-sm mt-2 text-left px-2">{error}</p>
      )*/}
    </div>
  );
};

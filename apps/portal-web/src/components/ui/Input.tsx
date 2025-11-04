import { IconX } from "@components/icons";

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email";
  variant?: "primary" | "secondary";
  className?: string;
  error?: boolean;
}

export const Input = ({
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
  error = false,
}: InputProps) => {
  return (
    <div className="relative w-full max-w-[500px]">
      <input
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
          ${error ? "text-red-500 placeholder:text-red-500 pr-[55px]" : "text-[#0F0F0F]"}
          ${className}
        `}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <div className="absolute right-[25px] top-1/2 -translate-y-1/2 pointer-events-none">
          <IconX />
        </div>
      )}
    </div>
  );
};

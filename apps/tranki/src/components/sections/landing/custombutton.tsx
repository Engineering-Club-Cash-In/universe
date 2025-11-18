import { Link } from "@tanstack/react-router";
export default function CustomButton({
  text,
  onClick,
  to,
}: {
  text: string;
  onClick?: () => void;
  to?: string;
}) {
  return to ? (
    <Link
      to={to}
      className="bg-transparent border cursor-pointer border-white text-white text-lg font-bold px-4 py-2 rounded-full hover:bg-white hover:text-purple transition-all duration-300 transform scale-100 hover:scale-105 h-[50px] flex items-center justify-center"
    >
      {text}
    </Link>
  ) : (
    <button
      onClick={onClick}
      className="bg-transparent border cursor-pointer border-white text-white text-lg font-bold px-4 py-2 rounded-full hover:bg-white hover:text-purple transition-all duration-300 transform scale-100 hover:scale-105 h-[50px] flex items-center justify-center"
    >
      {text}
    </button>
  );
}

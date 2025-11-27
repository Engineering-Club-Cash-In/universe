export const IconPDF = ({ ...props }: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="28"
      viewBox="0 0 24 28"
      fill="none"
      {...props}
    >
      {/* Documento base */}
      <path
        d="M14 0H3C1.34315 0 0 1.34315 0 3V25C0 26.6569 1.34315 28 3 28H21C22.6569 28 24 26.6569 24 25V10L14 0Z"
        fill="#E9EDF4"
      />
      {/* Esquina doblada */}
      <path
        d="M14 0V7C14 8.65685 15.3431 10 17 10H24L14 0Z"
        fill="#C4CAD4"
      />
      {/* Barra azul con texto PDF */}
      <rect x="0" y="13" width="24" height="8" fill="#3B82F6" />
      <text
        x="12"
        y="18.5"
        textAnchor="middle"
        fontSize="6"
        fontWeight="bold"
        fill="white"
        fontFamily="Arial, sans-serif"
      >
        PDF
      </text>
    </svg>
  );
};

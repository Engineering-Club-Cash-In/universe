const IconArrowDown = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="13"
    height="7"
    viewBox="0 0 13 7"
    fill="none"
    {...props}
  >
    <path
      d="M0.860352 0.860229L6.02209 6.02197L11.1838 0.860229"
      stroke="currentColor"
      strokeWidth="1.72058"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconArrowUp = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="7"
    viewBox="0 0 12 7"
    fill="none"
    {...props}
  >
    <path
      opacity="0.99"
      d="M10.75 5.75L5.75 0.75L0.75 5.75"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export { IconArrowDown, IconArrowUp };
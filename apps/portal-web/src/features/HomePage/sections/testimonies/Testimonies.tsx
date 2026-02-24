const testimonies = [
  {
    name: "Pablo O.",
    testimony:
      "El proceso fue claro desde el inicio y siempre tuve acompañamiento. Me explicaron cada paso y me sentí seguro en todo momento.",
    avatarColors: { bg: "#2A1F1F", body: "#C97B7B", head: "#D4A0A0" },
  },
  {
    name: "Luisa M.",
    testimony:
      "La atención fue muy buena y transparente. Respondieron todas mis dudas y el trámite fue más sencillo de lo que esperaba.",
    avatarColors: { bg: "#1F2A1F", body: "#7BC97B", head: "#A0D4A0" },
  },
  {
    name: "Juan L.",
    testimony:
      "Me gustó que no hubo sorpresas. Todo estuvo bien explicado y el seguimiento fue constante durante el proceso.",
    avatarColors: { bg: "#2A2A1F", body: "#C9B87B", head: "#D4CCA0" },
  },
  {
    name: "Carlos R.",
    testimony:
      "Desde el primer contacto se sintió un trato profesional. Me acompañaron de principio a fin y cumplieron con lo que prometieron.",
    avatarColors: { bg: "#1F2530", body: "#6B8594", head: "#8FA3B1" },
  },
  {
    name: "Andrea P.",
    testimony:
      "Nunca había financiado un vehículo y me ayudaron a entender todo con mucha claridad. La experiencia fue muy buena.",
    avatarColors: { bg: "#2A1F2A", body: "#C97BC9", head: "#D4A0D4" },
  },
  {
    name: "Miguel S.",
    testimony:
      "El equipo fue muy atento y el proceso se sintió ordenado y seguro. Definitivamente los recomiendo.",
    avatarColors: { bg: "#1F252A", body: "#7BA8C9", head: "#A0C4D4" },
  },
];

const Stars = () => (
  <div className="flex gap-1">
    {[...Array(5)].map((_, i) => (
      <svg
        key={i}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="#F5A623"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ))}
  </div>
);

const Avatar = ({
  colors,
  id,
}: {
  colors: { bg: string; body: string; head: string };
  id: number;
}) => (
  <svg
    width="40"
    height="40"
    viewBox="0 0 63 63"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="shrink-0"
  >
    <g clipPath={`url(#clip_${id})`}>
      <path
        d="M31.25 0.651367C48.1493 0.651368 61.8486 14.3507 61.8486 31.25C61.8486 48.1493 48.1493 61.8486 31.25 61.8486C14.3507 61.8486 0.651368 48.1493 0.651367 31.25C0.651367 14.3507 14.3507 0.651367 31.25 0.651367Z"
        fill={colors.bg}
        stroke="black"
        strokeWidth="1.30208"
      />
      <mask
        id={`mask_${id}`}
        style={{ maskType: "luminance" }}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="63"
        height="63"
      >
        <path
          d="M31.25 62.5C48.5089 62.5 62.5 48.5089 62.5 31.25C62.5 13.9911 48.5089 0 31.25 0C13.9911 0 0 13.9911 0 31.25C0 48.5089 13.9911 62.5 31.25 62.5Z"
          fill="white"
        />
      </mask>
      <g mask={`url(#mask_${id})`}>
        <path
          d="M10.416 62.4987C10.416 49.4779 20.8327 44.2695 31.2494 44.2695C41.666 44.2695 52.0827 49.4779 52.0827 62.4987H10.416Z"
          fill={colors.body}
        />
        <path
          d="M31.25 42.707C38.1536 42.707 43.75 37.1106 43.75 30.207C43.75 23.3035 38.1536 17.707 31.25 17.707C24.3464 17.707 18.75 23.3035 18.75 30.207C18.75 37.1106 24.3464 42.707 31.25 42.707Z"
          fill={colors.head}
        />
      </g>
    </g>
    <defs>
      <clipPath id={`clip_${id}`}>
        <rect width="62.5" height="62.5" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

export const Testimonies = () => {
  return (
    <section className="text-center w-full mt-32 lg:mt-50 px-6 lg:px-20">
      <div className="w-full flex justify-center">
        <h2 className="text-2xl lg:text-[50px] max-w-2xl">
          Un sueño cumplido habla más que mil palabras
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full mt-10 lg:mt-16">
        {testimonies.map((testimony, index) => (
          <div
            key={index}
            className="flex flex-col justify-between p-6 text-left"
            style={{
              borderRadius: 20.833,
              border: "1.302px solid #243A5A",
              background:
                "linear-gradient(90deg, rgba(22, 38, 61, 0.25) 0%, rgba(14, 22, 36, 0.25) 100%)",
            }}
          >
            <div>
              <Stars />
              <p className="text-white/80 text-sm leading-6 mt-4">
                "{testimony.testimony}"
              </p>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <Avatar colors={testimony.avatarColors} id={index} />
              <div>
                <p className="text-white text-sm font-semibold">
                  {testimony.name}
                </p>
                <p className="text-white/50 text-xs">Reseña en Google</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

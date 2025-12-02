import { Button } from "@components/ui";
import { ResponsiveLine } from "@nivo/line";
import { Link } from "@tanstack/react-router";
import { useGraphLine } from "./hooks/useGraphLine";
import { useIsMobile } from "@/hooks";

export const GraphLine = () => {
  const { chartData, isLoading, isError } = useGraphLine();

  const isMobile = useIsMobile();

  if (isLoading) {
    return (
      <section className="text-center w-full mt-36 px-12">
        <div>
          <h2 className="text-header-2 mb-2">¿Listo para invertir?</h2>
        </div>
        <div className="w-full h-[500px] bg-dark rounded-lg p-6 flex items-center justify-center">
          <p className="text-white">Cargando datos...</p>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="text-center w-full mt-36 px-12">
        <div>
          <h2 className="text-header-2 mb-2">¿Listo para invertir?</h2>
        </div>
        <div className="w-full h-[500px] bg-dark rounded-lg p-6 flex items-center justify-center">
          <p className="text-red-500">Error al cargar los datos</p>
        </div>
      </section>
    );
  }

  return (
    <section className="text-center w-full lg:mt-52 lg:px-12 mt-26 px-4">
      {/* Línea decorativa superior - solo mobile */}
      {isMobile && (
        <div
          className="w-full mb-10"
          style={{
            height: "10px",
            opacity: 0.5,
            background: "linear-gradient(90deg, #0F0F0F 0%, #9A9FF5 50%, #0F0F0F 100%)",
          }}
        />
      )}
      <div>
        <h2 className="text-2xl lg:text-header-2">¿Listo para invertir?</h2>
      </div>
      <div
        className={`w-full borderv mt-2 border-primary lg:border-0  bg-dark rounded-lg ${isMobile ? "h-[550px] p-2" : "h-[500px] p-6"}`}
      >
        <ResponsiveLine
          data={chartData}
          margin={
            isMobile
              ? { top: 20, right: 20, bottom: 140, left: 50 }
              : { top: 50, right: 60, bottom: 100, left: 80 }
          }
          xScale={{ type: "linear", min: "auto", max: "auto" }}
          yScale={{
            type: "linear",
            min: 0,
            max: "auto",
            stacked: false,
            reverse: false,
          }}
          curve="monotoneX"
          axisTop={null}
          axisRight={null}
          axisBottom={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            legend: isMobile ? "" : "Años",
            legendOffset: 45,
            legendPosition: "middle",
            tickValues: [0, 1, 2, 3, 4, 5],
            format: (value) => value.toString(),
            style: {
              legend: {
                text: {
                  fontFamily: "Hero",
                  fontSize: isMobile ? 12 : 16,
                  fontWeight: 400,
                },
              },
              ticks: {
                text: {
                  fontFamily: "Hero",
                  fontSize: isMobile ? 10 : 12,
                  fontWeight: 400,
                },
              },
            },
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 5,
            tickRotation: 0,
            legend: isMobile ? "" : "Valor de inversión (Q)",
            legendOffset: -70,
            style: {
              legend: {
                text: {
                  fontFamily: "Hero",
                  fontSize: isMobile ? 12 : 16,
                  fontWeight: 400,
                },
              },
              ticks: {
                text: {
                  fontFamily: "Hero",
                  fontSize: isMobile ? 10 : 12,
                  fontWeight: 400,
                },
              },
            },
            legendPosition: "middle",
            format: (value) => `Q${value}K`,
          }}
          colors={{ datum: "color" }}
          lineWidth={isMobile ? 2 : 3}
          pointSize={0}
          pointColor={{ theme: "background" }}
          pointBorderWidth={0}
          pointBorderColor={{ from: "serieColor" }}
          pointLabelYOffset={-12}
          enableArea={false}
          useMesh={true}
          enablePoints={false}
          enableSlices="x"
          sliceTooltip={({ slice }) => {
            return (
              <div
                style={{
                  width: isMobile ? "180px" : "225px",
                  background: "#1f1f1f",
                  padding: isMobile ? "8px 12px" : "12px 16px",
                  borderRadius: "4px",
                  fontFamily: "Hero",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.25)",
                }}
              >
                <div
                  style={{
                    color: "#ffffff",
                    fontSize: isMobile ? "12px" : "14px",
                    fontWeight: "bold",
                    marginBottom: "8px",
                  }}
                >
                  Año {slice.points[0].data.x}
                </div>
                {slice.points.map((point) => (
                  <div
                    key={point.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "4px 0",
                    }}
                  >
                    <div
                      style={{
                        width: isMobile ? "10px" : "12px",
                        height: isMobile ? "10px" : "12px",
                        borderRadius: "50%",
                        backgroundColor: point.seriesColor,
                      }}
                    />
                    <span
                      style={{
                        color: "#ffffff",
                        fontSize: isMobile ? "10px" : "12px",
                      }}
                    >
                      {point.seriesId}: Q{point.data.yFormatted}K
                    </span>
                  </div>
                ))}
              </div>
            );
          }}
          legends={[
            {
              anchor: "bottom",
              direction: isMobile ? "column" : "row",
              justify: false,
              translateX: 0,
              translateY: isMobile ? 130 : 100,
              itemsSpacing: isMobile ? 8 : 20,
              itemDirection: "left-to-right",
              itemWidth: isMobile ? 120 : 150,
              itemHeight: 20,
              itemOpacity: 0.85,
              symbolSize: isMobile ? 10 : 12,
              symbolShape: "circle",
              symbolBorderColor: "rgba(0, 0, 0, .5)",
              effects: [
                {
                  on: "hover",
                  style: {
                    itemBackground: "rgba(0, 0, 0, .03)",
                    itemOpacity: 1,
                  },
                },
              ],
            },
          ]}
          theme={{
            background: "#0f0f0f",
            text: {
              fontSize: isMobile ? 10 : 12,
              fill: "#ffffff",
              outlineWidth: 0,
              outlineColor: "transparent",
            },
            axis: {
              domain: {
                line: {
                  stroke: "#777777",
                  strokeWidth: 1,
                },
              },
              legend: {
                text: {
                  fontSize: isMobile ? 12 : 14,
                  fill: "#ffffff",
                  fontWeight: 600,
                },
              },
              ticks: {
                line: {
                  stroke: "#777777",
                  strokeWidth: 1,
                },
                text: {
                  fontSize: isMobile ? 9 : 11,
                  fill: "#ffffff",
                },
              },
            },
            grid: {
              line: {
                stroke: "#333333",
                strokeWidth: 1,
              },
            },
            legends: {
              title: {
                text: {
                  fontSize: isMobile ? 12 : 14,
                  fill: "#ffffff",
                },
              },
              text: {
                fontFamily: "Hero",
                fontSize: isMobile ? 12 : 16,
                fill: "#ffffff",
              },
              ticks: {
                line: {},
                text: {
                  fontSize: isMobile ? 8 : 10,
                  fill: "#ffffff",
                },
              },
            },
            tooltip: {
              container: {
                background: "#1f1f1f",
                color: "#ffffff",
                fontSize: isMobile ? 10 : 12,
                borderRadius: "4px",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
                padding: isMobile ? "6px 10px" : "8px 12px",
              },
            },
          }}
        />
      </div>
      <div className="w-full mx-auto flex items-center justify-center mt-6">
        <h2 className="text-xl lg:text-4xl px-6 lg:px-20">
          {isMobile
            ? "Queremos darte soluciones pensadas para cada etapa de tu camino financiero."
            : " Compara y descubre porque nuestras oportunidades superan otras opciones del mercado. Usa la calculadora de rendimiento y comprueba cuanto podrias generar con nosotros."}
        </h2>
      </div>
      <div className="mt-6 flex justify-center">
        <Link to="/invest" hash="how-it-works">
          <Button size={isMobile ? "sm" : "lg"}>Calcula tu inversión</Button>
        </Link>
      </div>
      {/* Línea decorativa inferior - solo mobile */}
      {isMobile && (
        <div
          className="w-full mt-10"
          style={{
            height: "10px",
            opacity: 0.5,
            background: "linear-gradient(90deg, #0F0F0F 0%, #9A9FF5 50%, #0F0F0F 100%)",
          }}
        />
      )}
    </section>
  );
};

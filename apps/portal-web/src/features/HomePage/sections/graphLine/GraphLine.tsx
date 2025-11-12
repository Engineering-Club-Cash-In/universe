import { Button } from "@components/ui";
import { ResponsiveLine } from "@nivo/line";
import { useGraphLine } from "./hooks/useGraphLine";

export const GraphLine = () => {
  const { chartData, isLoading, isError } = useGraphLine();

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
    <section className="text-center w-full mt-52 px-12">
      <div>
        <h2 className="text-header-2">¿Listo para invertir?</h2>
      </div>
      <div className="w-full h-[500px] bg-dark rounded-lg p-6">
        <ResponsiveLine
          data={chartData}
          margin={{ top: 50, right: 60, bottom: 100, left: 80 }}
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
            legend: "Años",
            legendOffset: 45,
            legendPosition: "middle",
            tickValues: [0, 1, 2, 3, 4, 5],
            format: (value) => value.toString(),
            style: {
              legend: {
                text: {
                  fontFamily: "Hero",
                  fontSize: 16,
                  fontWeight: 400,
                },
              },
              ticks: {
                text: {
                  fontFamily: "Hero",
                  fontSize: 12,
                  fontWeight: 400,
                },
              },
            },
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 5,
            tickRotation: 0,
            legend: "Valor de inversión (Q)",
            legendOffset: -70,
            style: {
              legend: {
                text: {
                  fontFamily: "Hero",
                  fontSize: 16,
                  fontWeight: 400,
                },
              },
              ticks: {
                text: {
                  fontFamily: "Hero",
                  fontSize: 12,
                  fontWeight: 400,
                },
              },
            },
            legendPosition: "middle",
            format: (value) => `Q${value}K`,
          }}
          colors={{ datum: "color" }}
          lineWidth={3}
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
                  width: "225px",
                  background: "#1f1f1f",
                  padding: "12px 16px",
                  borderRadius: "4px",
                  fontFamily: "Hero",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.25)",
                }}
              >
                <div
                  style={{
                    color: "#ffffff",
                    fontSize: "14px",
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
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        backgroundColor: point.seriesColor,
                      }}
                    />
                    <span style={{ color: "#ffffff", fontSize: "12px" }}>
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
              direction: "row",
              justify: false,
              translateX: 0,
              translateY: 100,
              itemsSpacing: 20,
              itemDirection: "left-to-right",
              itemWidth: 150,
              itemHeight: 20,
              itemOpacity: 0.85,
              symbolSize: 12,
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
              fontSize: 12,
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
                  fontSize: 14,
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
                  fontSize: 11,
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
                  fontSize: 14,
                  fill: "#ffffff",
                },
              },
              text: {
                fontFamily: "Hero",
                fontSize: 16,
                fill: "#ffffff",
              },
              ticks: {
                line: {},
                text: {
                  fontSize: 10,
                  fill: "#ffffff",
                },
              },
            },
            tooltip: {
              container: {
                background: "#1f1f1f",
                color: "#ffffff",
                fontSize: 12,
                borderRadius: "4px",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
                padding: "8px 12px",
              },
            },
          }}
        />
      </div>
      <div className="w-full mx-auto flex items-center justify-center mt-6">
        <h2 className="text-[35px] px-20">
          Compara y descubre porque nuestras oportunidades superan otras
          opciones del mercado. Usa la calculadora de rendimiento y comprueba
          cuanto podrias generar con nosotros.
        </h2>
      </div>
      <div className="mt-6 flex justify-center">
        <Button size="lg">
          Calcula tu inversión
        </Button>
      </div>
    </section>
  );
};

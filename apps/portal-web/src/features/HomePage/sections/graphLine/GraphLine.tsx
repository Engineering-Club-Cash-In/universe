import { Button } from "@components/ui";
import { ResponsiveLine } from "@nivo/line";

interface dataProps {
  value: number;
  yearsX: number;
}

export const GraphLine = () => {
  const dataBono: dataProps[] = [
    { value: 100, yearsX: 0 },
    { value: 120, yearsX: 1 },
    { value: 150, yearsX: 2 },
    { value: 180, yearsX: 3 },
    { value: 220, yearsX: 4 },
    { value: 270, yearsX: 5 },
  ];

  const dataBanco: dataProps[] = [
    { value: 100, yearsX: 0 },
    { value: 110, yearsX: 1 },
    { value: 115, yearsX: 2 },
    { value: 120, yearsX: 3 },
    { value: 125, yearsX: 4 },
    { value: 130, yearsX: 5 },
  ];

  const dataSP: dataProps[] = [
    { value: 100, yearsX: 0 },
    { value: 130, yearsX: 1 },
    { value: 160, yearsX: 2 },
    { value: 200, yearsX: 3 },
    { value: 250, yearsX: 4 },
    { value: 300, yearsX: 5 },
  ];

  const dataCashin: dataProps[] = [
    { value: 100, yearsX: 0 },
    { value: 140, yearsX: 1 },
    { value: 190, yearsX: 2 },
    { value: 250, yearsX: 3 },
    { value: 320, yearsX: 4 },
    { value: 400, yearsX: 5 },
  ];

  // Transform data to Nivo format
  const chartData = [
    {
      id: "Bonos Tesoro GT (7%)",
      color: "#EF4444", // Anaranjado
      data: dataBono.map((d) => ({ x: d.yearsX, y: d.value })),
    },
    {
      id: "CD Banco (5.5%)",
      color: "#FF8C42", // Rojo
      data: dataBanco.map((d) => ({ x: d.yearsX, y: d.value })),
    },
    {
      id: "S&P 500 (10.44%)",
      color: "#3B82F6", // Azul
      data: dataSP.map((d) => ({ x: d.yearsX, y: d.value })),
    },
    {
      id: "Cashin (14.11%)",
      color: "#10B981", // Verde
      data: dataCashin.map((d) => ({ x: d.yearsX, y: d.value })),
    },
  ];

  return (
    <section className="text-center w-full mt-36 px-12">
      <div>
        <h2 className="text-header-2  mb-2">¿Listo para invertir?</h2>
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
        <h2 className="text-[35px] w-1/2">
          Queremos darte soluciones pensadas para cada etapa de tu camino
          financiero.
        </h2>
      </div>
      <div className="mt-6 flex justify-center">
        <Button size="lg">
            Contáctanos
        </Button>
      </div>
    </section>
  );
};

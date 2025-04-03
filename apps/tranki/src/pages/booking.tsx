import Cal, { getCalApi } from "@calcom/embed-react";
import { useEffect } from "react";
export default function MyApp() {
  useEffect(() => {
    (async function () {
      const cal = await getCalApi({
        namespace: "15min",
        embedJsUrl: "https://calcom.s2.devteamatcci.site/embed/embed.js",
      });
      cal("ui", { hideEventTypeDetails: false, layout: "month_view" });
    })();
  }, []);
  return (
    <Cal
      namespace="15min"
      calLink="lralda/15min"
      style={{ width: "100%", height: "100%", overflow: "scroll" }}
      config={{ layout: "month_view" }}
      calOrigin="https://calcom.s2.devteamatcci.site"
      embedJsUrl="https://calcom.s2.devteamatcci.site/embed/embed.js"
    />
  );
}

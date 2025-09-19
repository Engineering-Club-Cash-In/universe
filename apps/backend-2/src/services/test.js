const fs = require("fs");
const axios = require("axios");

const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN;

const api = axios.create({
  baseURL: "https://docuseal.devteamatcci.site/api",
  headers: {
    "X-Auth-Token": "CdhE38ock7tM8p33VeP8CsNs3BmZrGo3nMhrZUaDhA2",
    "Content-Type": "application/json"
  }
});


async function fetchAllTemplates() {
  console.log("🔄 Pidiendo primera página de plantillas...");
  const firstResp = await api.get("/templates", { params: { page: 2} });

  const { data: firstData, pagination } = firstResp.data;
  const total = pagination.count;
  const perPage = firstData.length;
  const totalPages = Math.ceil(total / perPage);

  console.log(`📄 Total plantillas: ${total} (páginas: ${totalPages})`);

  // Armamos todas las llamadas restantes
  const requests = [];
  for (let page = 2; page <= totalPages; page++) {
    console.log(`⏳ Programando request página ${page}...`);
    requests.push(api.get("/templates", { params: { page } }));
  }

  // Ejecutamos en paralelo
  const results = await Promise.all(requests);

  // Unimos todas las plantillas
  const allTemplates = [
    ...firstData,
    ...results.flatMap((r) => r.data.data),
  ];

  console.log(`✅ Plantillas descargadas: ${allTemplates.length}`);
  allTemplates.forEach((tpl) =>
    console.log(`   → [${tpl.id}] ${tpl.name}`)
  );

  return allTemplates;
}

async function generateFile() {
  try {
    const templates = await fetchAllTemplates();

    let fileContent = `
import axios from "axios";

const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL!;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN!;

const api = axios.create({
  baseURL: DOCUSEAL_API_URL,
  headers: {
    "X-Auth-Token": DOCUSEAL_API_TOKEN,
    "Content-Type": "application/json"
  }
});

async function main(): Promise<void> {
`;

    for (const tpl of templates) {
      fileContent += `
  // ==== Submission para plantilla: ${tpl.name} (id: ${tpl.id})
  await api.post("/submissions", {
    template_id: ${tpl.id},
    submitters: [
      {
        email: "demo@correo.com",
        values: {
          ${tpl.fields
            .map(
              (f) =>
                `"${f.name}": "VALOR_DEMO_${f.name.replace(/\s+/g, "_")}"`
            )
            .join(",\n          ")}
        }
      }
    ]
  }).then(r => console.log("✅ ${tpl.name} creado:", r.data))
    .catch(e => console.error("❌ Error ${tpl.name}:", e.response?.data || e.message));
`;
    }

    fileContent += `
}

main().catch(err => console.error("[ERROR] Error en main:", err));
`;

    fs.writeFileSync("./generateAllSubmissions2.ts", fileContent, "utf8");
    console.log("✅ Archivo generateAllSubmissions.ts generado con éxito");
  } catch (err) {
    console.error("[ERROR] No se pudieron cargar plantillas:", err.message);
  }
}

generateFile();
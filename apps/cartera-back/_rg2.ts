import {readFileSync} from "fs";const env=readFileSync(`${import.meta.dir}/.env`,"utf8");
const u=env.split("\n").map(l=>{const m=l.match(/postgres(?:ql)?:\/\/postgres\.[^"'\s]*pooler\.supabase\.com:5432[^"'\s]*/);return m?m[0]:null}).find(Boolean);
process.env.SUPABASE_DB_URL=u.replace(/\?.*$/,"");const {db}=await import("./src/database");const {sql}=await import("drizzle-orm");
if(!String(((await db.execute(sql`SELECT inet_server_addr()::text ip`)).rows[0].ip||"")).includes("2600:1f1c")){process.exit(1)}
const {generarSnapshotDiario,recomputarAcumuladosMes}=await import("./src/controllers/facturacionSnapshot");
for(const d of ["2026-06-13","2026-06-14","2026-06-16","2026-06-17","2026-06-18","2026-06-19"]) await generarSnapshotDiario(d);
await recomputarAcumuladosMes(2026,6);console.log("regen ok");process.exit(0);

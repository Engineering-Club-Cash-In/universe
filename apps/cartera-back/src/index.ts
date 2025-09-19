import { Elysia } from "elysia";
import config from "./config";
import * as routers from "./routers";
import { cors } from "@elysiajs/cors";
const app = new Elysia()

app.use(cors())
.use(routers.defaultRouter)
.use(routers.inversionistasRouter)
.use(routers.advisorRouter)
.use(routers.usersRouter)
.use(routers.paymentRouter)
.use(routers.creditRouter)
.use(routers.uploadRouter)
.use(routers.sifcoRouter)
.listen(config.port)

console.log (//vscode-app/usr/share/code/resources/app/out/vs/code/electron-sandbox/workbench/workbench.html(
  `🦊 Elysia Server is running at ${app.server?.hostname}:${app.server?.port}`
);

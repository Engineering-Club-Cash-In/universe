import { Elysia } from "elysia";

const defaultRouter = new Elysia();

defaultRouter.get("/", (_) => {
    return "Hello World from shortener!";
});

export default defaultRouter;
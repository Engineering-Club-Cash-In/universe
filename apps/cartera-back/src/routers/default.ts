import { Elysia } from "elysia";

const defaultRouter = new Elysia();

defaultRouter.get("/", (_) => {
    return "Hello World from cartera service!";
});

export default defaultRouter;
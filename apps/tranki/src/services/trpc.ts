import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@repo/backend/appRouter";

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:9000",
    }),
  ],
});

export default trpc;

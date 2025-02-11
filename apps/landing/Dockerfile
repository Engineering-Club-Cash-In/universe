FROM oven/bun:1.2.2 AS runtime
WORKDIR /app

COPY . .

RUN bun install
RUN cd apps/landing && bun install && bun run build

# Ensure the build output is in the correct directory
# You might need to adjust the path if the build output is different
COPY apps/landing/dist /app/dist

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD bun run /app/dist/server/entry.mjs
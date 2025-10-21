FROM oven/bun
RUN apt update && apt install -y ca-certificates
WORKDIR /app
COPY package*.json bun.lockb ./
RUN bun install
# RUN bun run devTest
COPY . .
EXPOSE 9000
CMD ["bun", "run","devStart"]
import { Hono } from "hono";
import { testConnection } from "../db/connection";

const health = new Hono();

// Health check endpoint
health.get("/", async (c) => {
  const dbConnected = await testConnection();

  return c.json({
    success: true,
    timestamp: new Date().toISOString(),
    service: "auth-google",
    database: dbConnected ? "connected" : "disconnected",
    uptime: process.uptime(),
  });
});

export default health;

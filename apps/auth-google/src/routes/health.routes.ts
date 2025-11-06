import { Router } from "express";
import { testConnection } from "../db/connection";

const router = Router();

// Health check endpoint
router.get("/", async (req, res) => {
  const dbConnected = await testConnection();
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    service: "auth-google",
    database: dbConnected ? "connected" : "disconnected",
    uptime: process.uptime(),
  });
});

export default router;

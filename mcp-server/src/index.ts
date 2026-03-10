import express, { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { initFirebase } from "./firebase.js";
import { createServer } from "./server.js";
import { validateApiKey } from "./auth.js";

// Initialize Firebase before anything else
initFirebase();

const PORT = parseInt(process.env.PORT || "8080");

// SAFETY: Block SKIP_AUTH in production
if (process.env.K_SERVICE && process.env.SKIP_AUTH === "true") {
  console.error("FATAL: SKIP_AUTH=true is set in a Cloud Run environment. Exiting.");
  process.exit(1);
}

// Create Express app
const app = express();
app.use(express.json({ limit: "10mb" }));

// CORS — allow Claude.ai origins + localhost for dev
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://claude.ai",
    "https://claude.com",
    "https://www.claude.ai",
    "https://www.claude.com",
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "mast-mcp-server",
    version: "1.0.0",
    environment: process.env.BASE_URL?.includes("-test-") ? "test" : "prod",
    description: "MAST MCP Server — AI API layer for Shir Glassworks",
    status: "ok",
  });
});

// Auth middleware — validates MAST API key
async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Dev mode: skip auth
  if (process.env.NODE_ENV === "development" || process.env.SKIP_AUTH === "true") {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      error_description: "Bearer token required",
    });
    return;
  }

  const token = authHeader.slice(7);

  if (token.startsWith("mast_")) {
    try {
      const valid = await validateApiKey(token);
      if (valid) {
        next();
        return;
      }
    } catch (err) {
      console.error("API key validation error:", err);
    }
    res.status(401).json({
      error: "invalid_token",
      error_description: "API key invalid or not found",
    });
    return;
  }

  res.status(401).json({
    error: "invalid_token",
    error_description: "Token must be a mast_ API key",
  });
}

// MCP endpoint — Streamable HTTP (stateless)
app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// GET /mcp — SSE transport fallback
app.get("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("MCP GET error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// DELETE /mcp — session cleanup (no-op for stateless)
app.delete("/mcp", (_req: Request, res: Response) => {
  res.sendStatus(200);
});

// HEAD /mcp — capability check
app.head("/mcp", (_req: Request, res: Response) => {
  res.header("MCP-Protocol-Version", "2025-06-18");
  res.sendStatus(200);
});

// Start
app.listen(PORT, () => {
  const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
  console.log(`MAST MCP Server listening on :${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`MCP endpoint: ${BASE_URL}/mcp`);
  console.log(`Auth: ${process.env.SKIP_AUTH === "true" || process.env.NODE_ENV === "development" ? "DISABLED (dev mode)" : "API key"}`);
});

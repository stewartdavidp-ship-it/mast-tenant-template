import express, { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { initFirebase } from "./firebase.js";
import { createServer } from "./server.js";
import { validateApiKey } from "./auth.js";
import { createOAuthRouter } from "./auth/oauth.js";
import { validateAccessToken } from "./auth/store.js";

// Initialize Firebase before anything else
initFirebase();

const PORT = parseInt(process.env.PORT || "8080");
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

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

// Mount OAuth router (handles /.well-known/*, /authorize, /token, /register, /revoke)
app.use(createOAuthRouter(BASE_URL));

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "mast-mcp-server",
    version: "1.0.0",
    environment: BASE_URL.includes("-test-") ? "test" : "prod",
    description: "MAST MCP Server — AI API layer for Shir Glassworks",
    status: "ok",
  });
});

// Auth middleware — validates MAST API key OR OAuth access token
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

  // Path 1: MAST API key (mast_*)
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

  // Path 2: OAuth access token (from Claude.ai)
  try {
    const validToken = await validateAccessToken(token);
    if (validToken) {
      next();
      return;
    }
  } catch (err) {
    console.error("OAuth token validation error:", err);
  }

  res.status(401).json({
    error: "invalid_token",
    error_description: "Token invalid or expired",
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
  console.log(`MAST MCP Server listening on :${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`MCP endpoint: ${BASE_URL}/mcp`);
  console.log(`OAuth: ${BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`Auth: ${process.env.SKIP_AUTH === "true" || process.env.NODE_ENV === "development" ? "DISABLED (dev mode)" : "API key + OAuth"}`);
});

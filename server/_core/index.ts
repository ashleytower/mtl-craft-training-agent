import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerHermesRoutes } from "../hermesRoutes";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Hermes agent boundary (read + scale only)
  registerHermesRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");

  // Scanning for a free port is a convenience in development and a defect in a
  // supervised service. Brix reaches this API at a fixed `BEVERAGE_API_URL`
  // (localhost:3000), so a process that quietly moves to 3001 leaves the agent
  // pointing at nothing while every log line still says "Server running" —
  // the failure is invisible exactly where it matters most.
  //
  // Under launchd the service sets BEVERAGE_API_STRICT_PORT=true and binds the
  // requested port or dies, which is the correct behaviour for something with a
  // restart policy: KeepAlive retries, and if the port is genuinely held by
  // another process the error says so instead of hiding.
  const strictPort = process.env.BEVERAGE_API_STRICT_PORT === "true";
  const port = strictPort ? preferredPort : await findAvailablePort(preferredPort);

  if (!strictPort && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (strictPort && error.code === "EADDRINUSE") {
      console.error(
        `Port ${preferredPort} is already in use and BEVERAGE_API_STRICT_PORT is set. ` +
          `Refusing to start on a different port: Brix reaches this API at a fixed ` +
          `address and would not be told. Free the port, or unset the flag for a ` +
          `development server.`
      );
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});

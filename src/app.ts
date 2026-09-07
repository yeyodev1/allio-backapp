import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import mongoose from "mongoose";
import routerApi from "./routes";
import { ensureDbConnection } from "./config/mongo";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";

const localOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://localhost:8080",
  "http://localhost:8100",
  "http://localhost:8101",
];

function allowedOrigins(): string[] {
  return [
    ...localOrigins,
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || "").split(","),
  ]
    .map((origin) => origin?.trim().replace(/\/+$/, ""))
    .filter((origin): origin is string => Boolean(origin));
}

/**
 * Los despliegues de vista previa de Vercel estrenan subdominio en cada commit,
 * así que no se pueden enumerar: se aceptan por patrón. Producción sigue viniendo
 * de FRONTEND_URL / CORS_ORIGINS.
 */
const vercelPreview = /^https:\/\/allio-frontapp[a-z0-9-]*\.vercel\.app$/;

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Sin origin: curl, apps móviles y las peticiones servidor a servidor.
    if (!origin) return callback(null, true);

    const clean = origin.replace(/\/+$/, "");
    if (allowedOrigins().includes(clean) || vercelPreview.test(clean)) {
      return callback(null, true);
    }
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
};

export function createApp() {
  const app = express();

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "50mb" }));

  app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

  app.get("/", (_req, res) => {
    res.json({ name: "allio-backapp", status: "ok" });
  });

  app.get("/health", async (_req, res) => {
    // Espera a la conexión antes de dictaminar. Reportar "degradado" porque la
    // instancia acaba de arrancar sería un falso positivo: en una función
    // serverless recién levantada, "conectando" es el estado normal durante el
    // primer segundo, no una avería.
    const states = ["desconectada", "conectada", "conectando", "desconectando"];
    try {
      await ensureDbConnection();
    } catch {
      /* el estado real se reporta abajo */
    }
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degradado",
      database: states[mongoose.connection.readyState] ?? "desconocida",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  routerApi(app);

  app.use(globalErrorHandler);

  const server = http.createServer(app);

  return { app, server };
}

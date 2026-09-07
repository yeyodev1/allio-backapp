import express, { Application, NextFunction, Request, Response } from "express";
import { ensureDbConnection } from "../config/mongo";
import { authRouter } from "./auth.routes";
import { tiendaRouter } from "./tienda.routes";
import { onboardingRouter } from "./onboarding.routes";
import { maintenanceRouter } from "./maintenance.routes";
import { movementRouter } from "./movement.routes";
import { logRouter } from "./log.routes";
import { workspaceRouter } from "./workspace.routes";
import { costingRouter } from "./costing.routes";
import { uploadRouter } from "./upload.routes";
import { supervisionRouter } from "./supervision.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  // En una instancia fría la conexión puede no estar lista cuando llega la primera
  // petición. Esperarla aquí evita el 500 sin explicación del primer acceso.
  router.use(async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await ensureDbConnection();
      next();
    } catch {
      res.status(503).json({
        message: "El servicio está iniciando. Vuelve a intentarlo en unos segundos.",
      });
    }
  });

  router.use("/auth", authRouter);
  router.use("/tiendas", tiendaRouter);
  router.use("/onboarding", onboardingRouter);
  router.use("/maintenance", maintenanceRouter);
  router.use("/movements", movementRouter);
  router.use("/logs", logRouter);
  router.use("/workspace", workspaceRouter);
  router.use("/costing", costingRouter);
  router.use("/upload", uploadRouter);
  router.use("/supervision", supervisionRouter);
}

export default routerApi;

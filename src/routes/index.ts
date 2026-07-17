import express, { Application } from "express";
import { authRouter } from "./auth.routes";
import { tiendaRouter } from "./tienda.routes";
import { onboardingRouter } from "./onboarding.routes";
import { maintenanceRouter } from "./maintenance.routes";
import { workspaceRouter } from "./workspace.routes";
import { costingRouter } from "./costing.routes";
import { uploadRouter } from "./upload.routes";
import { supervisionRouter } from "./supervision.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/auth", authRouter);
  router.use("/tiendas", tiendaRouter);
  router.use("/onboarding", onboardingRouter);
  router.use("/maintenance", maintenanceRouter);
  router.use("/workspace", workspaceRouter);
  router.use("/costing", costingRouter);
  router.use("/upload", uploadRouter);
  router.use("/supervision", supervisionRouter);
}

export default routerApi;

import { Router } from "express";
import { createLog, listLogs, getTodayCoverage } from "../controllers/equipmentLog.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

export const logRouter = Router();

logRouter.use(authMiddleware);

logRouter.get("/today", getTodayCoverage);
logRouter.get("/", listLogs);
logRouter.post("/", createLog);

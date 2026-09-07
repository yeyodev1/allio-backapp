import { Router } from "express";
import {
  listMovements,
  createMovement,
  returnMovement,
  voidMovement,
  listPendingReturns,
  getEquipmentTimeline,
  getMovementSummary,
} from "../controllers/movement.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

export const movementRouter = Router();

movementRouter.use(authMiddleware);

// Las rutas literales van antes que las paramétricas: si no, "pending" y
// "summary" entrarían por :id.
movementRouter.get("/pending", listPendingReturns);
movementRouter.get("/summary", getMovementSummary);
movementRouter.get("/equipment/:equipmentId/timeline", getEquipmentTimeline);

movementRouter.get("/", listMovements);
movementRouter.post("/", createMovement);
movementRouter.post("/:id/return", returnMovement);
movementRouter.post("/:id/void", voidMovement);

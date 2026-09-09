import { Router } from "express";
import {
  bootstrapSupervision,
  createPlant,
  createSubmission,
  listSubmissions, getSubmission,
} from "../controllers/supervision.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

export const supervisionRouter = Router();

supervisionRouter.get("/bootstrap", authMiddleware, bootstrapSupervision);
supervisionRouter.post("/plants", authMiddleware, createPlant);
supervisionRouter.get("/submissions", authMiddleware, listSubmissions);
supervisionRouter.get("/submissions/:id", authMiddleware, getSubmission);
supervisionRouter.post("/submissions", authMiddleware, createSubmission);

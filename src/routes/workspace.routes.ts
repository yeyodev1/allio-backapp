import { Router } from "express";
import {
  createWorkspaceMember,
  getWorkspaces,
  getCurrentWorkspace,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMember,
  createBranch,
  updateBranch,
  deleteBranch,
  updateCompany,
} from "../controllers/workspace.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

export const workspaceRouter = Router();

workspaceRouter.use(authMiddleware);

workspaceRouter.get("/", getWorkspaces);
workspaceRouter.get("/current", getCurrentWorkspace);
workspaceRouter.patch("/current", updateCompany);

workspaceRouter.get("/current/members", listWorkspaceMembers);
workspaceRouter.post("/current/members", createWorkspaceMember);
workspaceRouter.patch("/current/members/:memberId", updateWorkspaceMember);
workspaceRouter.delete("/current/members/:memberId", removeWorkspaceMember);

workspaceRouter.post("/current/branches", createBranch);
workspaceRouter.patch("/current/branches/:id", updateBranch);
workspaceRouter.delete("/current/branches/:id", deleteBranch);

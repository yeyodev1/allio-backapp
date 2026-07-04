import { Response } from "express";
import { Branch } from "../models/Branch.model";
import { Company } from "../models/Company.model";
import { User } from "../models/User.model";
import { AuthRequest } from "../types/AuthRequest";

function userOr401(req: AuthRequest, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

async function resolveCompanyId(userId: string): Promise<string | null> {
  const user = await User.findById(userId);
  if (!user) return null;
  const workspaceId = user.workspaceIds?.[0];
  if (workspaceId) return workspaceId.toString();
  const company = await Company.findOne({ userId }).select("_id").lean();
  return company?._id.toString() || null;
}

function toTienda(branch: any) {
  return {
    id: branch._id.toString(),
    name: branch.name,
    businessType: null,
    address: branch.address || "",
    city: "",
    manager: "",
    phone: branch.phone || "",
    status: branch.isActive ? "active" : "paused",
    staff: 0,
    monthlyClients: 0,
    notes: "",
    createdAt: branch.createdAt,
    isMain: branch.isMain,
  };
}

export async function listTiendas(req: AuthRequest, res: Response) {
  const userId = userOr401(req, res);
  if (!userId) return;
  const companyId = await resolveCompanyId(userId);
  if (!companyId) { res.json([]); return; }
  const branches = await Branch.find({ companyId }).sort({ isMain: -1, createdAt: 1 });
  res.json(branches.map(toTienda));
}

export async function createTienda(req: AuthRequest, res: Response) {
  const userId = userOr401(req, res);
  if (!userId) return;

  const companyId = await resolveCompanyId(userId);
  if (!companyId) {
    res.status(400).json({ message: "Workspace must be created first" });
    return;
  }

  const { name, address, city, phone, status, isMain } = req.body;

  if (!name || typeof name !== "string") {
    res.status(400).json({ message: "Tienda name is required" });
    return;
  }

  const existing = await Branch.countDocuments({ companyId });
  const shouldBeMain = !!isMain || existing === 0;

  if (shouldBeMain) {
    await Branch.updateMany({ companyId, isMain: true }, { $set: { isMain: false } });
  }

  const branch = new Branch({
    companyId,
    name,
    address: [address, city].filter(Boolean).join(", "),
    phone: phone ?? "",
    isActive: status !== "paused",
    isMain: shouldBeMain,
  });

  await branch.save();
  res.status(201).json(toTienda(branch));
}

export async function updateTienda(req: AuthRequest, res: Response) {
  const userId = userOr401(req, res);
  if (!userId) return;
  const { id } = req.params;
  const companyId = await resolveCompanyId(userId);
  if (!companyId) { res.status(400).json({ message: "Workspace must be created first" }); return; }

  const branch = await Branch.findOne({ _id: id, companyId });
  if (!branch) {
    res.status(404).json({ message: "Tienda not found" });
    return;
  }

  if (req.body.name !== undefined) branch.name = req.body.name;
  if (req.body.address !== undefined || req.body.city !== undefined) {
    branch.address = [req.body.address, req.body.city].filter(Boolean).join(", ");
  }
  if (req.body.phone !== undefined) branch.phone = req.body.phone;
  if (req.body.status !== undefined) branch.isActive = req.body.status !== "paused";

  if (req.body.isMain === true) {
    await Branch.updateMany({ companyId, _id: { $ne: branch._id } }, { $set: { isMain: false } });
    branch.isMain = true;
  }

  await branch.save();
  res.json(toTienda(branch));
}

export async function deleteTienda(req: AuthRequest, res: Response) {
  const userId = userOr401(req, res);
  if (!userId) return;
  const { id } = req.params;
  const companyId = await resolveCompanyId(userId);
  if (!companyId) { res.status(400).json({ message: "Workspace must be created first" }); return; }

  const count = await Branch.countDocuments({ companyId });
  if (count <= 1) {
    res.status(400).json({ message: "Debe quedar al menos una tienda en el workspace" });
    return;
  }

  const branch = await Branch.findOneAndDelete({ _id: id, companyId });
  if (!branch) {
    res.status(404).json({ message: "Tienda not found" });
    return;
  }

  if (branch.isMain) {
    const next = await Branch.findOne({ companyId }).sort({ createdAt: 1 });
    if (next) {
      next.isMain = true;
      await next.save();
    }
  }

  res.json({ message: "Tienda eliminada", id });
}

export async function setMainTienda(req: AuthRequest, res: Response) {
  const userId = userOr401(req, res);
  if (!userId) return;
  const { id } = req.params;
  const companyId = await resolveCompanyId(userId);
  if (!companyId) { res.status(400).json({ message: "Workspace must be created first" }); return; }

  const branch = await Branch.findOne({ _id: id, companyId });
  if (!branch) {
    res.status(404).json({ message: "Tienda not found" });
    return;
  }

  await Branch.updateMany({ companyId }, { $set: { isMain: false } });
  branch.isMain = true;
  await branch.save();

  res.json(toTienda(branch));
}

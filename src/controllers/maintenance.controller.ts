import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import * as maintenanceService from "../services/maintenance.service";
import { Equipment } from "../models/Equipment.model";
import { MaintenanceTicket } from "../models/MaintenanceTicket.model";
import { Branch } from "../models/Branch.model";
import { Company } from "../models/Company.model";

async function resolveBranchId(userId: string, queryBranchId?: string): Promise<string | null> {
  if (queryBranchId) return queryBranchId;

  const company = await Company.findOne({ userId });
  if (!company) return null;

  const mainBranch = await Branch.findOne({ companyId: company._id, isMain: true });
  return mainBranch ? mainBranch._id.toString() : null;
}

async function getUserCompany(userId: string) {
  return Company.findOne({ userId });
}

async function findUserBranch(userId: string, branchId: string) {
  const company = await getUserCompany(userId);
  if (!company) return null;
  return Branch.findOne({ _id: branchId, companyId: company._id });
}

async function isUserBranch(userId: string, branchId: string) {
  return Boolean(await findUserBranch(userId, branchId));
}

async function equipmentWithBranchPayload(equipment: any) {
  const branch = await Branch.findById(equipment.branchId).select("name isMain");
  return {
    ...equipment.toObject(),
    branchName: branch?.name || "Sucursal",
    branchIsMain: Boolean(branch?.isMain),
  };
}

function frontendBaseUrlFromRequest(req: AuthRequest): string | undefined {
  const origin = req.headers.origin;
  return typeof origin === "string" ? origin : undefined;
}

export async function getPublicEquipmentAudit(req: AuthRequest, res: Response) {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const possibleId = decodeURIComponent(rawId || "").split("/").pop() || rawId;
    const equipment = /^[a-f0-9]{24}$/i.test(possibleId)
      ? await Equipment.findById(possibleId)
      : null;

    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    const depreciationValue = maintenanceService.calculateDepreciation(
      equipment.purchaseDate,
      equipment.historicalCost,
      equipment.usefulLife
    );

    const tickets = await MaintenanceTicket.find({ equipmentId: equipment._id })
      .populate("reportedBy", "name")
      .sort({ createdAt: 1 });

    res.json({
      equipment: {
        ...(await equipmentWithBranchPayload(equipment)),
        depreciationValue,
      },
      history: tickets.map((ticket: any) => ({
        _id: ticket._id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        assignedTo: ticket.assignedTo,
        resolutionNotes: ticket.resolutionNotes,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        reportedByName: ticket.reportedBy?.name || "Equipo Allio",
      })),
      access: {
        canWrite: false,
        message: "Para registrar movimientos, fallas o cierres de mantenimiento debes iniciar sesión o pedir a un administrador que te registre.",
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching public equipment audit", error: error.message });
  }
}

export async function listEquipment(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const branchId = await resolveBranchId(userId, req.query.branchId as string);
    if (!branchId) {
      res.status(400).json({ message: "No branch found" });
      return;
    }

    if (!(await isUserBranch(userId, branchId))) {
      res.status(403).json({ message: "Not authorized to list this branch" });
      return;
    }

    const equipment = await Equipment.find({ branchId }).sort({ name: 1 });
    const payload = await Promise.all(equipment.map((item) => equipmentWithBranchPayload(item)));
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ message: "Error listing equipment", error: error.message });
  }
}

export async function createEquipment(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const branchId = await resolveBranchId(userId, req.body.branchId);
    if (!branchId) {
      res.status(400).json({ message: "No branch found" });
      return;
    }

    if (!(await isUserBranch(userId, branchId))) {
      res.status(403).json({ message: "Not authorized to create equipment in this branch" });
      return;
    }

    const { name, brand, purchaseDate, historicalCost, usefulLife, maintenanceIntervalDays, notes, imageUrl, location } = req.body;

    if (!name || !purchaseDate || historicalCost == null || !usefulLife || !maintenanceIntervalDays) {
      res.status(400).json({ message: "name, purchaseDate, historicalCost, usefulLife, and maintenanceIntervalDays are required" });
      return;
    }

    const equipment = await Equipment.create({
      branchId,
      name,
      brand: brand || "",
      purchaseDate: new Date(purchaseDate),
      historicalCost,
      usefulLife,
      maintenanceIntervalDays,
      notes: notes || "",
      imageUrl: imageUrl || "",
      location: location || "",
      status: "operativo",
    });

    await MaintenanceTicket.create({
      equipmentId: equipment._id,
      branchId,
      reportedBy: userId,
      title: `Registro inicial - ${name}`,
      description: `Equipo registrado en el sistema. Recibir\u00e1 mantenimiento cada ${maintenanceIntervalDays} d\u00edas.`,
      priority: "baja",
      status: "abierto",
    });

    try {
      await maintenanceService.generateQRCode(String(equipment._id), frontendBaseUrlFromRequest(req));
    } catch { /* QR opcional */ }

    const updated = await Equipment.findById(equipment._id);

    res.status(201).json(updated);
  } catch (error: any) {
    res.status(500).json({ message: "Error creating equipment", error: error.message });
  }
}

export async function updateEquipment(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const equipment = await Equipment.findById(id);
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to modify this equipment" });
      return;
    }

    if (req.body.branchId !== undefined) {
      if (!(await isUserBranch(userId, req.body.branchId))) {
        res.status(403).json({ message: "Not authorized to move equipment to this branch" });
        return;
      }
      equipment.branchId = new mongoose.Types.ObjectId(req.body.branchId) as any;
    }

    const updatable = ["name", "brand", "purchaseDate", "historicalCost", "usefulLife", "maintenanceIntervalDays", "lastMaintenanceDate", "status", "notes", "imageUrl", "location"] as const;
    for (const key of updatable) {
      if (req.body[key] !== undefined) {
        (equipment as any)[key] = key === "purchaseDate" || key === "lastMaintenanceDate"
          ? new Date(req.body[key])
          : req.body[key];
      }
    }

    await equipment.save();
    res.json(await equipmentWithBranchPayload(equipment));
  } catch (error: any) {
    res.status(500).json({ message: "Error updating equipment", error: error.message });
  }
}

export async function deleteEquipment(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const equipment = await Equipment.findById(id);
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to delete this equipment" });
      return;
    }

    await Equipment.findByIdAndDelete(id);
    res.json({ message: "Equipment deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Error deleting equipment", error: error.message });
  }
}

export async function getEquipmentDetail(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const equipment = await Equipment.findById(id);
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to view this equipment" });
      return;
    }

    const depreciationValue = maintenanceService.calculateDepreciation(
      equipment.purchaseDate,
      equipment.historicalCost,
      equipment.usefulLife
    );

    res.json({
      ...(await equipmentWithBranchPayload(equipment)),
      depreciationValue,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching equipment detail", error: error.message });
  }
}

export async function generateQR(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const equipment = await Equipment.findById(id);
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to generate QR for this equipment" });
      return;
    }

    const publicUrl = maintenanceService.getEquipmentPublicUrl(String(id), frontendBaseUrlFromRequest(req));
    const qrDataUrl = await maintenanceService.generateQRCode(String(id), frontendBaseUrlFromRequest(req));
    res.json({ qrCode: qrDataUrl, url: publicUrl });
  } catch (error: any) {
    res.status(500).json({ message: "Error generating QR code", error: error.message });
  }
}

export async function scanQRRedirect(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const rawCode = req.params.qrCode as string;
    if (!rawCode) {
      res.status(400).json({ message: "QR code parameter is required" });
      return;
    }

    const decoded = decodeURIComponent(rawCode);
    const segments = decoded.split("/");
    const possibleId = segments[segments.length - 1] || decoded;

    const equipment = /^[a-f0-9]{24}$/i.test(possibleId)
      ? await Equipment.findById(possibleId)
      : null;

    if (!equipment) {
      res.status(404).json({ message: "Equipment not found for this QR code" });
      return;
    }

    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to scan this equipment" });
      return;
    }

    const depreciationValue = maintenanceService.calculateDepreciation(
      equipment.purchaseDate,
      equipment.historicalCost,
      equipment.usefulLife
    );

    res.json({
      ...(await equipmentWithBranchPayload(equipment)),
      depreciationValue,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error scanning QR code", error: error.message });
  }
}

export async function listTickets(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const filter: Record<string, unknown> = {};
    const status = req.query.status as string | undefined;
    const equipmentId = req.query.equipmentId as string | undefined;
    if (status) {
      filter.status = status;
    }
    if (equipmentId) {
      const equipment = await Equipment.findById(equipmentId);
      if (!equipment) {
        res.status(404).json({ message: "Equipment not found" });
        return;
      }
      if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
        res.status(403).json({ message: "Not authorized to list tickets for this equipment" });
        return;
      }
      filter.equipmentId = new mongoose.Types.ObjectId(equipmentId);
    } else {
      const branchId = await resolveBranchId(userId, req.query.branchId as string);
      if (!branchId) {
        res.status(400).json({ message: "No branch found" });
        return;
      }
      if (!(await isUserBranch(userId, branchId))) {
        res.status(403).json({ message: "Not authorized to list this branch" });
        return;
      }
      filter.branchId = branchId;
    }

    const tickets = await MaintenanceTicket.find(filter)
      .populate("equipmentId")
      .populate("reportedBy", "name")
      .sort({ createdAt: -1 });

    res.json(tickets);
  } catch (error: any) {
    res.status(500).json({ message: "Error listing tickets", error: error.message });
  }
}

export async function createTicket(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { equipmentId, description, priority, assignedTo } = req.body;

    if (!equipmentId || !description) {
      res.status(400).json({ message: "equipmentId and description are required" });
      return;
    }

    const equipment = await Equipment.findById(equipmentId);
    if (!equipment) {
      res.status(404).json({ message: "Equipment not found" });
      return;
    }

    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to create tickets for this equipment" });
      return;
    }

    const ticket = await maintenanceService.createTicket({
      equipmentId,
      branchId: equipment.branchId.toString(),
      reportedBy: userId,
      title: `Ticket: ${equipment.name}`,
      description,
      priority: priority || "media",
      assignedTo,
    });

    res.status(201).json(ticket);
  } catch (error: any) {
    res.status(500).json({ message: "Error creating ticket", error: error.message });
  }
}

export async function updateTicket(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const ticket = await MaintenanceTicket.findById(id);
    if (!ticket) {
      res.status(404).json({ message: "Ticket not found" });
      return;
    }

    if (!(await isUserBranch(userId, ticket.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to update this ticket" });
      return;
    }

    const { status, assignedTo, priority, resolutionNotes } = req.body;

    const validTransitions: Record<string, string[]> = {
      abierto: ["en_progreso"],
      en_progreso: ["resuelto"],
      resuelto: ["cerrado"],
      cerrado: [],
    };

    if (status) {
      const allowed = validTransitions[ticket.status] || [];
      if (!allowed.includes(status)) {
        res.status(400).json({
          message: `Cannot transition from "${ticket.status}" to "${status}". Allowed transitions: ${allowed.join(", ") || "none"}`,
        });
        return;
      }
      ticket.status = status;
      if (status === "resuelto") {
        ticket.resolvedAt = new Date();
      }
    }

    if (assignedTo !== undefined) ticket.assignedTo = assignedTo;
    if (priority !== undefined) {
      const validPriorities = ["baja", "media", "alta", "critica"];
      if (!validPriorities.includes(priority)) {
        res.status(400).json({ message: `Priority must be one of: ${validPriorities.join(", ")}` });
        return;
      }
      ticket.priority = priority;
    }
    if (resolutionNotes !== undefined) ticket.resolutionNotes = resolutionNotes;

    await ticket.save();
    res.json(ticket);
  } catch (error: any) {
    res.status(500).json({ message: "Error updating ticket", error: error.message });
  }
}

export async function checkOverdue(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const overdue = await maintenanceService.checkOverdueMaintenance(userId);
    res.json({ checked: true, overdueCount: overdue.length });
  } catch (error: any) {
    res.status(500).json({ message: "Error checking overdue maintenance", error: error.message });
  }
}

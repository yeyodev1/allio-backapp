import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import * as maintenanceService from "../services/maintenance.service";
import { Equipment } from "../models/Equipment.model";
import { MaintenanceTicket } from "../models/MaintenanceTicket.model";
import { Branch } from "../models/Branch.model";
import { Company } from "../models/Company.model";
import { User } from "../models/User.model";
import { EquipmentChecklist } from "../models/EquipmentChecklist.model";
import { notifyMaintenanceMovement } from "../services/maintenanceNotification.service";
import { listUserBranchIds } from "../services/access.service";
import { buildEquipmentTimeline } from "../services/timeline.service";
import { buildGeoStamp } from "../models/geo.schema";

async function resolveBranchId(userId: string, queryBranchId?: string): Promise<string | null> {
  if (queryBranchId) return queryBranchId;

  const user = await User.findById(userId).select("workspaceIds");
  const company = user?.workspaceIds?.length
    ? await Company.findById(user.workspaceIds[0])
    : await Company.findOne({ userId });
  if (!company) return null;

  const mainBranch = await Branch.findOne({ companyId: company._id, isMain: true });
  return mainBranch ? mainBranch._id.toString() : null;
}

async function findUserBranch(userId: string, branchId: string) {
  const user = await User.findById(userId).select("workspaceIds");
  if (!user) return null;
  const companyIds = user.workspaceIds || [];
  const ownedCompany = await Company.findOne({ userId }).select("_id");
  if (ownedCompany && !companyIds.some((id) => id.equals(ownedCompany._id))) {
    companyIds.push(ownedCompany._id as any);
  }
  return Branch.findOne({ _id: branchId, companyId: { $in: companyIds } });
}

async function isUserBranch(userId: string, branchId: string) {
  return Boolean(await findUserBranch(userId, branchId));
}

async function userHasRole(userId: string, roles: string[]) {
  const user = await User.findById(userId).select("role");
  return Boolean(user && roles.includes(user.role));
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

/**
 * GET /api/maintenance/public/equipment/:id — sin autenticación.
 *
 * Es lo que abre el QR pegado en la máquina. Quien lo escanea está físicamente
 * delante del equipo, así que ve su bitácora completa: revisiones, traspasos,
 * fallas y mantenimientos.
 *
 * Lo que NO ve es el dinero. Antes esta respuesta incluía `historicalCost` y
 * `depreciationValue`, de modo que cualquiera que fotografiara el QR conocía lo
 * que costó la máquina y su valor en libros. Un técnico frente al equipo no
 * necesita esa cifra para hacer su trabajo, y quien pasa por la tienda tampoco.
 * El costo de las reparaciones se omite por lo mismo.
 */
export async function getPublicEquipmentAudit(req: AuthRequest, res: Response) {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const possibleId = decodeURIComponent(rawId || "").split("/").pop() || rawId;
    const equipment = /^[a-f0-9]{24}$/i.test(possibleId)
      ? await Equipment.findById(possibleId)
      : null;

    if (!equipment) {
      res.status(404).json({ message: "Este equipo no existe o el código QR ya no es válido" });
      return;
    }

    const branch = await Branch.findById(equipment.branchId).select("name").lean();
    const timeline = await buildEquipmentTimeline(equipment._id.toString(), 100);

    // Se recorta lo económico de cada entrada del historial antes de salir.
    const publicTimeline = timeline.map((entry) => {
      const { cost, ...meta } = (entry.meta || {}) as Record<string, unknown>;
      return { ...entry, meta };
    });

    res.json({
      equipment: {
        _id: equipment._id,
        name: equipment.name,
        category: equipment.category,
        brand: equipment.brand,
        modelName: equipment.modelName,
        serialNumber: equipment.serialNumber,
        status: equipment.status,
        custody: equipment.custody,
        location: equipment.location,
        targetTemperatureC: equipment.targetTemperatureC,
        maintenanceIntervalDays: equipment.maintenanceIntervalDays,
        lastMaintenanceDate: equipment.lastMaintenanceDate,
        lastLogAt: equipment.lastLogAt,
        imageUrl: equipment.imageUrl,
        branchName: branch?.name || "Local",
      },
      timeline: publicTimeline,
      access: {
        canWrite: false,
        message:
          "Estás viendo la bitácora en modo consulta. Entra con tu cuenta para registrar una revisión, un traspaso o una falla.",
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error al abrir la bitácora", error: error.message });
  }
}

export async function listEquipment(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const requested = req.query.branchId as string | undefined;

    // Sin filtro se devuelven los equipos de TODOS los locales del usuario.
    // Antes caía en la sucursal principal y el panel contaba 2 equipos cuando la
    // empresa tenía 5, que es peor que no mostrar el dato.
    let branchIds: unknown[];
    if (requested) {
      if (!(await isUserBranch(userId, requested))) {
        res.status(403).json({ message: "Not authorized to list this branch" });
        return;
      }
      branchIds = [requested];
    } else {
      branchIds = await listUserBranchIds(userId);
      if (branchIds.length === 0) {
        res.json([]);
        return;
      }
    }

    const equipment = await Equipment.find({ branchId: { $in: branchIds } }).sort({ name: 1 });
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
    if (!(await userHasRole(userId, ["admin", "supervisor"]))) {
      res.status(403).json({ message: "Your role cannot create equipment" });
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

    await notifyMaintenanceMovement({
      actorUserId: userId,
      branchId,
      equipmentId: equipment._id.toString(),
      equipmentName: equipment.name,
      action: "Equipo registrado",
      details: [
        { label: "Estado", value: "Operativo" },
        { label: "Marca", value: equipment.brand || "Sin marca" },
        { label: "Ubicación", value: equipment.location || "Sin ubicación" },
        { label: "Mantenimiento", value: `Cada ${equipment.maintenanceIntervalDays} días` },
        { label: "Notas", value: equipment.notes },
      ],
    });

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
    if (!(await userHasRole(userId, ["admin", "supervisor"]))) {
      res.status(403).json({ message: "Your role cannot modify equipment" });
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
    const changedLabels: Record<string, string> = {
      name: "Nombre", brand: "Marca", purchaseDate: "Fecha de compra", historicalCost: "Costo histórico",
      usefulLife: "Vida útil", maintenanceIntervalDays: "Intervalo de mantenimiento", lastMaintenanceDate: "Último mantenimiento",
      status: "Estado", notes: "Notas", imageUrl: "Imagen", location: "Ubicación", branchId: "Sucursal",
    };
    await notifyMaintenanceMovement({
      actorUserId: userId,
      branchId: equipment.branchId.toString(),
      equipmentId: equipment._id.toString(),
      equipmentName: equipment.name,
      action: "Ficha del equipo actualizada",
      details: Object.keys(req.body)
        .filter((key) => changedLabels[key])
        .map((key) => ({ label: changedLabels[key], value: key === "imageUrl" ? "Imagen actualizada" : req.body[key] })),
    });
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

    if (!(await userHasRole(userId, ["admin"]))) {
      res.status(403).json({ message: "Only administrators can delete equipment" });
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
    await Promise.all([
      MaintenanceTicket.deleteMany({ equipmentId: id }),
      EquipmentChecklist.deleteMany({ equipmentId: id }),
    ]);
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
    } else if (req.query.branchId) {
      if (!(await isUserBranch(userId, req.query.branchId as string))) {
        res.status(403).json({ message: "No tienes acceso a este local" });
        return;
      }
      filter.branchId = req.query.branchId;
    } else {
      // Sin filtro se ven las fallas de todos los locales del usuario. Antes caía
      // en la sucursal principal y el panel escondía las averías del resto.
      const branchIds = await listUserBranchIds(userId);
      if (branchIds.length === 0) {
        res.json([]);
        return;
      }
      filter.branchId = { $in: branchIds };
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

    const { equipmentId, description, priority, assignedTo, title } = req.body;

    if (!equipmentId || !String(description || "").trim()) {
      res.status(400).json({ message: "Describe qué le pasa al equipo" });
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

    // La falla se sella igual que el resto de registros: dónde y con qué fotos.
    const branch = await Branch.findById(equipment.branchId).select("coordinates").lean();

    const ticket = await maintenanceService.createTicket({
      equipmentId,
      branchId: equipment.branchId.toString(),
      reportedBy: userId,
      // Un título escrito por quien reporta vale mucho más que "Ticket: <equipo>",
      // que era lo que se guardaba antes y no decía nada en el listado.
      title: String(title || "").trim() || String(description).trim().slice(0, 70),
      description: String(description).trim(),
      priority: priority || "media",
      assignedTo,
      photos: Array.isArray(req.body.photos) ? req.body.photos : [],
      geo: buildGeoStamp(req.body.geo, branch?.coordinates || null),
    });

    // Reportar una falla cambia el estado del equipo: es la señal que busca el panel.
    if (equipment.status === "operativo") {
      await Equipment.findByIdAndUpdate(equipment._id, { $set: { status: "averiado" } });
    }

    await notifyMaintenanceMovement({
      actorUserId: userId,
      branchId: equipment.branchId.toString(),
      equipmentId: equipment._id.toString(),
      equipmentName: equipment.name,
      action: "Mantenimiento reportado",
      details: [
        { label: "Descripción", value: ticket.description },
        { label: "Prioridad", value: ticket.priority },
        { label: "Estado", value: ticket.status },
        { label: "Asignado a", value: ticket.assignedTo },
      ],
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
    const previousStatus = ticket.status;

    // Arreglar algo en el momento es lo normal, así que "abierto → resuelto" tiene
    // que ser posible sin pasar por "en progreso". Y una falla resuelta puede
    // reaparecer a los dos días: reabrirla es mejor que crear un ticket nuevo que
    // pierde el hilo de lo que ya se intentó.
    const validTransitions: Record<string, string[]> = {
      abierto: ["en_progreso", "resuelto"],
      en_progreso: ["resuelto", "abierto"],
      resuelto: ["cerrado", "en_progreso"],
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
        ticket.resolvedBy = new mongoose.Types.ObjectId(userId);
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
    const equipment = await Equipment.findById(ticket.equipmentId).select("name");
    if (equipment) {
      await notifyMaintenanceMovement({
        actorUserId: userId,
        branchId: ticket.branchId.toString(),
        equipmentId: equipment._id.toString(),
        equipmentName: equipment.name,
        action: "Movimiento de mantenimiento actualizado",
        details: [
          { label: "Estado anterior", value: previousStatus },
          { label: "Estado actual", value: ticket.status },
          { label: "Prioridad", value: ticket.priority },
          { label: "Asignado a", value: ticket.assignedTo },
          { label: "Notas de resolución", value: ticket.resolutionNotes },
        ],
      });
    }
    res.json(ticket);
  } catch (error: any) {
    res.status(500).json({ message: "Error updating ticket", error: error.message });
  }
}

export async function listEquipmentChecklists(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) { res.status(404).json({ message: "Equipment not found" }); return; }
    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to view checklists for this equipment" });
      return;
    }

    const checklists = await EquipmentChecklist.find({ equipmentId: equipment._id })
      .populate("completedBy", "name")
      .sort({ createdAt: -1 });
    res.json(checklists);
  } catch (error: any) {
    res.status(500).json({ message: "Error listing equipment checklists", error: error.message });
  }
}

export async function createEquipmentChecklist(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) { res.status(404).json({ message: "Equipment not found" }); return; }
    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "Not authorized to complete checklists for this equipment" });
      return;
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length || items.some((item: any) => !item.key || !item.label || typeof item.checked !== "boolean")) {
      res.status(400).json({ message: "A checklist with valid items is required" });
      return;
    }

    const checklist = await EquipmentChecklist.create({
      equipmentId: equipment._id,
      branchId: equipment.branchId,
      completedBy: userId,
      items,
      generalNotes: req.body.generalNotes || "",
      result: items.every((item: any) => item.checked) ? "completo" : "requiere_atencion",
    });
    await checklist.populate("completedBy", "name");
    const checkedCount = items.filter((item: any) => item.checked).length;
    await notifyMaintenanceMovement({
      actorUserId: userId,
      branchId: equipment.branchId.toString(),
      equipmentId: equipment._id.toString(),
      equipmentName: equipment.name,
      action: "Checklist de equipo completado",
      details: [
        { label: "Resultado", value: checklist.result === "completo" ? "Completo" : "Requiere atención" },
        { label: "Puntos correctos", value: `${checkedCount} de ${items.length}` },
        { label: "Puntos pendientes", value: items.filter((item: any) => !item.checked).map((item: any) => item.label).join(", ") },
        { label: "Observaciones", value: checklist.generalNotes },
      ],
    });
    res.status(201).json(checklist);
  } catch (error: any) {
    res.status(500).json({ message: "Error creating equipment checklist", error: error.message });
  }
}

export async function checkOverdue(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const overdue = await maintenanceService.checkOverdueMaintenance(userId);
    res.json({ checked: true, overdueCount: overdue.length, overdue });
  } catch (error: any) {
    res.status(500).json({ message: "Error checking overdue maintenance", error: error.message });
  }
}

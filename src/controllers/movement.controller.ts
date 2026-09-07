import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { Equipment } from "../models/Equipment.model";
import { EquipmentMovement, MOVEMENT_TYPES } from "../models/EquipmentMovement.model";
import * as movementService from "../services/movement.service";
import { MovementError } from "../services/movement.service";
import { buildEquipmentTimeline } from "../services/timeline.service";
import {
  isUserBranch,
  listUserBranchIds,
  resolveCompanyId,
  userHasRole,
} from "../services/access.service";
import { notifyMaintenanceMovement } from "../services/maintenanceNotification.service";

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof MovementError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ message: fallback, error: message });
}

/** Carga el equipo comprobando que el usuario tenga acceso a su sucursal. */
async function loadEquipmentForUser(userId: string, equipmentId: string) {
  const equipment = await Equipment.findById(equipmentId);
  if (!equipment) throw new MovementError("El equipo no existe", 404);
  if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
    throw new MovementError("No tienes acceso a este equipo", 403);
  }
  return equipment;
}

/**
 * GET /api/movements
 * Traspasos de la empresa. Filtros: equipmentId, type, status, branchId, pendientes.
 */
export async function listMovements(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const companyId = await resolveCompanyId(userId);
    if (!companyId) { res.json({ movements: [], count: 0 }); return; }

    const filter: Record<string, unknown> = { companyId };
    if (req.query.equipmentId) filter.equipmentId = req.query.equipmentId;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.pending === "true") filter.status = "pendiente";

    // Un traspaso de local aparece tanto en el origen como en el destino.
    if (req.query.branchId) {
      filter.$or = [{ fromBranchId: req.query.branchId }, { toBranchId: req.query.branchId }];
    }

    const limit = Math.min(Number(req.query.limit) || 100, 300);

    const movements = await EquipmentMovement.find(filter)
      .sort({ occurredAt: -1 })
      .limit(limit)
      .populate("equipmentId", "name category serialNumber imageUrl")
      .populate("fromBranchId", "name")
      .populate("toBranchId", "name")
      .populate("fromUserId", "name email")
      .populate("toUserId", "name email")
      .populate("performedBy", "name email role")
      .lean();

    res.json({ movements, count: movements.length });
  } catch (error) {
    fail(res, error, "Error listing movements");
  }
}

/**
 * POST /api/movements
 * Registra un traspaso. Los operadores pueden mover equipos; solo admin y
 * supervisor pueden cederlos a un cliente o mandarlos a un taller externo.
 */
export async function createMovement(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const { equipmentId, type } = req.body;
    if (!equipmentId) { res.status(400).json({ message: "Falta el equipo" }); return; }
    if (!MOVEMENT_TYPES.includes(type)) {
      res.status(400).json({ message: "Tipo de traspaso no válido" });
      return;
    }

    if ((type === "cliente" || type === "taller") && !(await userHasRole(userId, ["admin", "supervisor"]))) {
      res.status(403).json({ message: "Solo un administrador o supervisor puede registrar este traspaso" });
      return;
    }

    const equipment = await loadEquipmentForUser(userId, equipmentId);

    // El destino tiene que estar dentro del mismo espacio de trabajo.
    if (type === "local" && !(await isUserBranch(userId, req.body.toBranchId))) {
      res.status(403).json({ message: "No tienes acceso al local de destino" });
      return;
    }

    const companyId = equipment.companyId || (await resolveCompanyId(userId));
    if (!companyId) { res.status(400).json({ message: "No se encontró la empresa" }); return; }

    const movement = await movementService.createMovement({
      ...req.body,
      equipmentId,
      companyId,
      performedBy: userId,
      geo: req.body.geo,
    });

    await notifyMaintenanceMovement({
      actorUserId: userId,
      branchId: equipment.branchId.toString(),
      equipmentId: equipment._id.toString(),
      equipmentName: equipment.name,
      action: "Traspaso registrado",
      details: [
        { label: "Tipo", value: type },
        { label: "Destino", value: movement.toBranchId || movement.toUserId || movement.clientName || movement.workshopName },
        { label: "Motivo", value: movement.reason || "—" },
      ],
    });

    res.status(201).json({ movement });
  } catch (error) {
    fail(res, error, "Error creating movement");
  }
}

/**
 * POST /api/movements/:id/return
 * Cierra un traspaso a cliente o taller: el equipo vuelve a su local.
 */
export async function returnMovement(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const movement = await EquipmentMovement.findById(req.params.id);
    if (!movement) { res.status(404).json({ message: "El traspaso no existe" }); return; }
    await loadEquipmentForUser(userId, movement.equipmentId.toString());

    const updated = await movementService.registerReturn(String(req.params.id), {
      returnedBy: userId,
      returnedAt: req.body.returnedAt,
      cost: req.body.cost,
      notes: req.body.notes,
      statusAfter: req.body.statusAfter,
    });

    res.json({ movement: updated });
  } catch (error) {
    fail(res, error, "Error closing movement");
  }
}

/**
 * POST /api/movements/:id/void
 * Anula un traspaso mal registrado. Queda en el historial marcado como anulado.
 */
export async function voidMovement(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    if (!(await userHasRole(userId, ["admin", "supervisor"]))) {
      res.status(403).json({ message: "Solo un administrador o supervisor puede anular un traspaso" });
      return;
    }

    const movement = await EquipmentMovement.findById(req.params.id);
    if (!movement) { res.status(404).json({ message: "El traspaso no existe" }); return; }
    await loadEquipmentForUser(userId, movement.equipmentId.toString());

    const updated = await movementService.voidMovement(String(req.params.id), req.body.reason);
    res.json({ movement: updated });
  } catch (error) {
    fail(res, error, "Error voiding movement");
  }
}

/**
 * GET /api/movements/pending
 * Equipos fuera de casa con la fecha de retorno vencida o próxima.
 */
export async function listPendingReturns(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const companyId = await resolveCompanyId(userId);
    if (!companyId) { res.json({ movements: [], overdue: 0 }); return; }

    const movements = await EquipmentMovement.find({ companyId, status: "pendiente" })
      .sort({ expectedReturnAt: 1 })
      .populate("equipmentId", "name category imageUrl")
      .lean();

    const now = Date.now();
    const overdue = movements.filter(
      (m) => m.expectedReturnAt && new Date(m.expectedReturnAt).getTime() < now
    ).length;

    res.json({ movements, overdue, count: movements.length });
  } catch (error) {
    fail(res, error, "Error listing pending returns");
  }
}

/**
 * GET /api/movements/equipment/:equipmentId/timeline
 * Historial completo del equipo: traspasos, bitácora, checklists y tickets en una sola línea.
 */
export async function getEquipmentTimeline(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    await loadEquipmentForUser(userId, String(req.params.equipmentId));
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const timeline = await buildEquipmentTimeline(String(req.params.equipmentId), limit);

    res.json({ timeline, count: timeline.length });
  } catch (error) {
    fail(res, error, "Error building timeline");
  }
}

/**
 * GET /api/movements/summary
 * Cifras del panel: traspasos del mes por tipo y equipos fuera de su local.
 */
export async function getMovementSummary(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const companyId = await resolveCompanyId(userId);
    if (!companyId) { res.json({ byType: {}, pending: 0, overdue: 0, awayCount: 0 }); return; }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [byTypeRaw, pending, branchIds] = await Promise.all([
      EquipmentMovement.aggregate([
        { $match: { companyId, occurredAt: { $gte: since }, status: { $ne: "anulado" } } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
      EquipmentMovement.find({ companyId, status: "pendiente" }).select("expectedReturnAt").lean(),
      listUserBranchIds(userId),
    ]);

    const now = Date.now();
    const byType = Object.fromEntries(byTypeRaw.map((row) => [row._id, row.count]));
    const awayCount = await Equipment.countDocuments({
      branchId: { $in: branchIds },
      "custody.type": { $in: ["cliente", "taller"] },
    });

    res.json({
      byType,
      pending: pending.length,
      overdue: pending.filter((m) => m.expectedReturnAt && new Date(m.expectedReturnAt).getTime() < now).length,
      awayCount,
    });
  } catch (error) {
    fail(res, error, "Error building movement summary");
  }
}

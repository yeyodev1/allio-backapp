import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { Equipment } from "../models/Equipment.model";
import { EquipmentLog, startOfDay } from "../models/EquipmentLog.model";
import { Branch } from "../models/Branch.model";
import { buildGeoStamp, OFFSITE_THRESHOLD_M } from "../models/geo.schema";
import {
  isUserBranch,
  resolveCompanyId,
  resolveDefaultBranchId,
} from "../services/access.service";

/**
 * Bitácora diaria: lo que el técnico marca cada día equipo por equipo.
 * Es el "histórico" que se consulta para saber en qué estado estuvo una máquina
 * cualquier día del pasado.
 */

function fail(res: Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ message: fallback, error: message });
}

/**
 * POST /api/logs
 * Registra la revisión de un equipo. Se permite más de una al día: el segundo
 * pase de un turno distinto es información, no un duplicado.
 */
export async function createLog(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const { equipmentId } = req.body;
    if (!equipmentId) { res.status(400).json({ message: "Falta el equipo" }); return; }

    const equipment = await Equipment.findById(equipmentId);
    if (!equipment) { res.status(404).json({ message: "El equipo no existe" }); return; }
    if (!(await isUserBranch(userId, equipment.branchId.toString()))) {
      res.status(403).json({ message: "No tienes acceso a este equipo" }); return;
    }

    const companyId = equipment.companyId || (await resolveCompanyId(userId));
    if (!companyId) { res.status(400).json({ message: "No se encontró la empresa" }); return; }

    const recordedAt = req.body.recordedAt ? new Date(req.body.recordedAt) : new Date();

    // Se sella dónde se registró y a qué distancia quedó del local. Si el local no
    // tiene coordenadas, se guarda el punto igual: sirve para fijarlas después.
    const branch = await Branch.findById(equipment.branchId).select("coordinates").lean();
    const geo = buildGeoStamp(req.body.geo, branch?.coordinates || null);
    const offsite = geo.distanceFromBranchM != null && geo.distanceFromBranchM > OFFSITE_THRESHOLD_M;
    const checks = Array.isArray(req.body.checks) ? req.body.checks : [];
    const temperatureC = req.body.temperatureC != null ? Number(req.body.temperatureC) : undefined;

    // Marca la revisión para seguimiento si algo falló, si el técnico lo pidió
    // explícitamente, o si la temperatura se salió del rango objetivo.
    const outOfRange =
      temperatureC != null &&
      equipment.targetTemperatureC != null &&
      Math.abs(temperatureC - equipment.targetTemperatureC) > 3;

    // Un registro hecho lejos del local también merece revisión: puede ser un GPS
    // impreciso, o puede ser que la revisión no se hiciera frente a la máquina.
    const requiresAttention =
      Boolean(req.body.requiresAttention) ||
      checks.some((c: { ok: boolean }) => c.ok === false) ||
      outOfRange ||
      offsite;

    const log = await EquipmentLog.create({
      equipmentId: equipment._id,
      branchId: equipment.branchId,
      companyId,
      recordedBy: userId,
      recordedAt,
      day: startOfDay(recordedAt),
      status: req.body.status || equipment.status,
      temperatureC,
      checks,
      notes: req.body.notes,
      photos: Array.isArray(req.body.photos) ? req.body.photos : [],
      geo,
      requiresAttention,
    });

    const equipmentUpdate: Record<string, unknown> = { lastLogAt: recordedAt };
    if (req.body.status && req.body.status !== equipment.status) {
      equipmentUpdate.status = req.body.status;
    }
    await Equipment.findByIdAndUpdate(equipment._id, { $set: equipmentUpdate });

    res.status(201).json({ log, outOfRange, offsite, distanceM: geo.distanceFromBranchM ?? null });
  } catch (error) {
    fail(res, error, "Error creating log");
  }
}

/**
 * GET /api/logs
 * Historial de bitácora. Filtros: equipmentId, branchId, from, to.
 */
export async function listLogs(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const companyId = await resolveCompanyId(userId);
    if (!companyId) { res.json({ logs: [], count: 0 }); return; }

    const filter: Record<string, unknown> = { companyId };
    if (req.query.equipmentId) filter.equipmentId = req.query.equipmentId;
    if (req.query.branchId) filter.branchId = req.query.branchId;

    if (req.query.from || req.query.to) {
      const range: Record<string, Date> = {};
      if (req.query.from) range.$gte = startOfDay(String(req.query.from));
      if (req.query.to) {
        const to = startOfDay(String(req.query.to));
        to.setDate(to.getDate() + 1);
        range.$lt = to;
      }
      filter.day = range;
    }

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await EquipmentLog.find(filter)
      .sort({ recordedAt: -1 })
      .limit(limit)
      .populate("equipmentId", "name category targetTemperatureC")
      .populate("recordedBy", "name email role")
      .lean();

    res.json({ logs, count: logs.length });
  } catch (error) {
    fail(res, error, "Error listing logs");
  }
}

/**
 * GET /api/logs/today
 * La tarea del día: qué equipos del local ya se revisaron y cuáles faltan.
 */
export async function getTodayCoverage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const branchId = await resolveDefaultBranchId(userId, req.query.branchId as string);
    if (!branchId) { res.json({ pending: [], done: [], total: 0 }); return; }
    if (!(await isUserBranch(userId, branchId))) {
      res.status(403).json({ message: "No tienes acceso a este local" }); return;
    }

    const day = startOfDay(req.query.day ? String(req.query.day) : new Date());

    const [equipment, logs] = await Promise.all([
      Equipment.find({ branchId, status: { $ne: "fuera_servicio" } })
        .select("name category status custody targetTemperatureC imageUrl")
        .sort({ name: 1 })
        .lean(),
      EquipmentLog.find({ branchId, day })
        .select("equipmentId temperatureC requiresAttention recordedAt recordedBy geo photos")
        .populate("recordedBy", "name")
        .lean(),
    ]);

    const logByEquipment = new Map(logs.map((l) => [l.equipmentId.toString(), l]));

    const done: unknown[] = [];
    const pending: unknown[] = [];
    for (const item of equipment) {
      const log = logByEquipment.get(item._id.toString());
      if (log) done.push({ ...item, log });
      else pending.push(item);
    }

    res.json({ day, pending, done, total: equipment.length });
  } catch (error) {
    fail(res, error, "Error building today coverage");
  }
}

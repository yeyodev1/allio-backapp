import mongoose from "mongoose";
import { Equipment } from "../models/Equipment.model";
import { MaintenanceTicket } from "../models/MaintenanceTicket.model";
import { Branch } from "../models/Branch.model";
import { Company } from "../models/Company.model";
import { listUserBranchIds } from "./access.service";
import QRCode from "qrcode";

export function calculateDepreciation(purchaseDate: Date, historicalCost: number, usefulLife: number): number {
  const now = new Date();
  const purchaseTime = new Date(purchaseDate).getTime();
  const elapsedYears = (now.getTime() - purchaseTime) / (1000 * 60 * 60 * 24 * 365);

  if (elapsedYears >= usefulLife) return 0;

  const annualDepreciation = historicalCost / usefulLife;
  const accumulatedDepreciation = annualDepreciation * elapsedYears;

  return Math.round((historicalCost - accumulatedDepreciation) * 100) / 100;
}

export function getEquipmentPublicUrl(equipmentId: string, frontendBaseUrl?: string): string {
  const rawBase = frontendBaseUrl || process.env.FRONTEND_URL || "http://localhost:5173";
  const base = rawBase.replace(/\/+$/, "");
  return `${base}/modulo/mantenimiento/${equipmentId}`;
}

export async function generateQRCode(equipmentId: string, frontendBaseUrl?: string): Promise<string> {
  const equipment = await Equipment.findById(equipmentId);
  if (!equipment) throw new Error("Equipment not found");

  const url = getEquipmentPublicUrl(equipment._id.toString(), frontendBaseUrl);
  const qrCode = await QRCode.toDataURL(url);

  await Equipment.findByIdAndUpdate(equipmentId, { qrCode });

  return qrCode;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recorre los equipos del usuario cuyo intervalo de mantenimiento ya venció y abre
 * una falla para cada uno que no tenga una abierta.
 *
 * El vencimiento se calcula en JS y no con `$expr`: Mongo no permite restar una
 * fecha de un número (`$subtract: [now, "$lastMaintenanceDate"]` fallaba con
 * "can't $subtract a Date from a double"), y la lista por empresa es corta.
 *
 * Un equipo sin mantenimiento registrado cuenta desde su compra (o su alta), no
 * como vencido desde el día uno: recién creado, no "pasó su intervalo".
 */
export async function checkOverdueMaintenance(userId?: string): Promise<Array<typeof Equipment.prototype>> {
  const now = Date.now();

  const scope: Record<string, unknown> = { status: { $ne: "fuera_servicio" } };
  if (userId) {
    const branchIds = await listUserBranchIds(userId);
    if (branchIds.length === 0) return [];
    scope.branchId = { $in: branchIds };
  }

  const candidates = await Equipment.find(scope);
  const overdue = candidates.filter((equipment) => {
    const intervalDays = Number(equipment.maintenanceIntervalDays);
    if (!Number.isFinite(intervalDays) || intervalDays <= 0) return false;
    const baseline = equipment.lastMaintenanceDate || equipment.purchaseDate || (equipment as any).createdAt;
    if (!baseline) return false;
    return now - new Date(baseline).getTime() > intervalDays * DAY_MS;
  });

  for (const equipment of overdue) {
    const existingTicket = await MaintenanceTicket.findOne({
      equipmentId: equipment._id,
      status: { $in: ["abierto", "en_progreso"] },
    });
    if (existingTicket) continue;

    let reportedBy = userId;
    if (!reportedBy) {
      const branch = await Branch.findById(equipment.branchId);
      const company = branch ? await Company.findById(branch.companyId) : null;
      reportedBy = company?.userId?.toString();
    }
    if (!reportedBy) continue;

    await MaintenanceTicket.create({
      equipmentId: equipment._id,
      branchId: equipment.branchId,
      reportedBy,
      title: `Mantenimiento vencido: ${equipment.name}`,
      description: `El equipo ${equipment.name} requiere mantenimiento. Último mantenimiento: ${equipment.lastMaintenanceDate?.toLocaleDateString("es-EC") || "Ninguno"}. Intervalo: cada ${equipment.maintenanceIntervalDays} días.`,
      priority: "alta",
      status: "abierto",
    });
  }

  return overdue;
}

export async function createTicket(data: {
  equipmentId: string;
  branchId: string;
  reportedBy?: string;
  title: string;
  description: string;
  priority: "baja" | "media" | "alta" | "critica";
  assignedTo?: string;
  photos?: string[];
  geo?: unknown;
}): Promise<typeof MaintenanceTicket.prototype> {
  const ticket = await MaintenanceTicket.create({
    equipmentId: new mongoose.Types.ObjectId(data.equipmentId),
    branchId: new mongoose.Types.ObjectId(data.branchId),
    reportedBy: data.reportedBy ? new mongoose.Types.ObjectId(data.reportedBy) : undefined,
    title: data.title,
    description: data.description,
    priority: data.priority || "media",
    assignedTo: data.assignedTo,
    photos: data.photos || [],
    geo: data.geo,
    status: "abierto",
  });

  return ticket;
}

export async function sendNotification(
  ticket: typeof MaintenanceTicket.prototype,
  type: "basic" | "pro"
): Promise<void> {
  const ticketData = {
    id: ticket._id.toString(),
    title: (ticket as any).title || "Sin título",
    status: ticket.status,
    priority: ticket.priority,
  };

  console.log(`[${type.toUpperCase()}] Notificación de mantenimiento enviada:`, JSON.stringify(ticketData));

  if (type === "pro") {
    const equipment = await Equipment.findById(ticket.equipmentId);
    const deprecatedValue = equipment
      ? calculateDepreciation(equipment.purchaseDate, equipment.historicalCost, equipment.usefulLife)
      : 0;

    console.log(`[PRO] Depreciación actual del equipo: $${deprecatedValue}`);
  }
}

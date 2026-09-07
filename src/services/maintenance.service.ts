import mongoose from "mongoose";
import { Equipment } from "../models/Equipment.model";
import { MaintenanceTicket } from "../models/MaintenanceTicket.model";
import { Branch } from "../models/Branch.model";
import { Company } from "../models/Company.model";
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

export async function checkOverdueMaintenance(userId?: string): Promise<Array<typeof Equipment.prototype>> {
  const now = new Date();

  const overdue = await Equipment.find({
    $or: [
      {
        lastMaintenanceDate: { $exists: true },
        $expr: {
          $gt: [
            { $subtract: [now.getTime(), "$lastMaintenanceDate"] },
            { $multiply: ["$maintenanceIntervalDays", 24 * 60 * 60 * 1000] },
          ],
        },
      },
      {
        lastMaintenanceDate: { $exists: false },
      },
    ],
    status: { $ne: "fuera_servicio" },
  });

  for (const equipment of overdue) {
    const existingTicket = await MaintenanceTicket.findOne({
      equipmentId: equipment._id,
      status: { $in: ["abierto", "en_progreso"] },
    });

    if (!existingTicket) {
      let reportedBy = userId;
      if (!reportedBy) {
        const branch = await Branch.findById(equipment.branchId);
        if (branch) {
          const company = await Company.findOne({ _id: branch.companyId });
          if (company) reportedBy = company.userId?.toString();
        }
      }
      await MaintenanceTicket.create({
        equipmentId: equipment._id,
        branchId: equipment.branchId,
        reportedBy: reportedBy || undefined,
        title: `Mantenimiento vencido: ${equipment.name}`,
        description: `El equipo ${equipment.name} requiere mantenimiento. Último mantenimiento: ${equipment.lastMaintenanceDate?.toLocaleDateString() || "Ninguno"}. Intervalo: cada ${equipment.maintenanceIntervalDays} días.`,
        priority: "alta",
        status: "abierto",
      });
    }
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

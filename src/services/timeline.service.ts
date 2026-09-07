import mongoose from "mongoose";
import { EquipmentMovement } from "../models/EquipmentMovement.model";
import { EquipmentLog } from "../models/EquipmentLog.model";
import { EquipmentChecklist } from "../models/EquipmentChecklist.model";
import { MaintenanceTicket } from "../models/MaintenanceTicket.model";
import { User } from "../models/User.model";
import { Branch } from "../models/Branch.model";
import { IGeoStamp, OFFSITE_THRESHOLD_M } from "../models/geo.schema";

/**
 * Historial unificado de un equipo.
 *
 * La ficha del equipo muestra una sola línea de tiempo, pero los hechos viven en
 * cuatro colecciones distintas (traspasos, bitácora diaria, checklists y tickets).
 * Aquí se leen las cuatro, se normalizan a una misma forma y se ordenan por fecha.
 *
 * Se resuelven los nombres de usuarios y sucursales en lote —una consulta por
 * colección— en lugar de poblar cada documento, que en una ficha con cientos de
 * entradas se convertía en cientos de consultas.
 */

export type TimelineKind = "movement" | "log" | "checklist" | "ticket";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  at: Date;
  title: string;
  description?: string;
  actorId?: string;
  actorName?: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  icon: string;
  /** Dónde se registró. La ficha lo muestra para poder contrastarlo. */
  geo?: IGeoStamp & { offsite?: boolean };
  photos?: string[];
  meta: Record<string, unknown>;
}

/** Marca el sello como "fuera del local" para que la ficha lo destaque. */
function decorateGeo(geo?: IGeoStamp) {
  if (!geo) return undefined;
  return {
    ...geo,
    offsite: geo.distanceFromBranchM != null && geo.distanceFromBranchM > OFFSITE_THRESHOLD_M,
  };
}

const movementTitles: Record<string, string> = {
  local: "Traspaso de local",
  tecnico: "Entrega a técnico",
  cliente: "Cesión a cliente",
  taller: "Salida a taller",
};

const movementIcons: Record<string, string> = {
  local: "fa-arrow-right-arrow-left",
  tecnico: "fa-user-gear",
  cliente: "fa-handshake",
  taller: "fa-screwdriver-wrench",
};

async function buildNameMaps(userIds: string[], branchIds: string[]) {
  const [users, branches] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } }).select("name email").lean()
      : Promise.resolve([]),
    branchIds.length
      ? Branch.find({ _id: { $in: branchIds } }).select("name").lean()
      : Promise.resolve([]),
  ]);

  return {
    users: new Map(users.map((u) => [u._id.toString(), u.name || u.email])),
    branches: new Map(branches.map((b) => [b._id.toString(), b.name])),
  };
}

function describeMovement(
  m: any,
  names: { users: Map<string, string>; branches: Map<string, string> }
): string {
  const from = m.fromBranchId ? names.branches.get(m.fromBranchId.toString()) : null;

  switch (m.type) {
    case "local": {
      const to = m.toBranchId ? names.branches.get(m.toBranchId.toString()) : null;
      return `${from || "Origen"} → ${to || "Destino"}`;
    }
    case "tecnico": {
      const to = m.toUserId ? names.users.get(m.toUserId.toString()) : null;
      const prev = m.fromUserId ? names.users.get(m.fromUserId.toString()) : null;
      return prev ? `${prev} → ${to || "Técnico"}` : `Recibe ${to || "un técnico"}`;
    }
    case "cliente":
      return m.clientName || "Cliente";
    case "taller":
      return m.workshopName || "Taller externo";
    default:
      return "";
  }
}

function movementTone(m: any): TimelineEntry["tone"] {
  if (m.status === "anulado") return "neutral";
  if (m.status === "devuelto") return "success";
  if (m.expectedReturnAt && new Date(m.expectedReturnAt) < new Date()) return "danger";
  if (m.status === "pendiente") return "warning";
  return "info";
}

export async function buildEquipmentTimeline(
  equipmentId: string | mongoose.Types.ObjectId,
  limit = 100
): Promise<TimelineEntry[]> {
  const [movements, logs, checklists, tickets] = await Promise.all([
    EquipmentMovement.find({ equipmentId }).sort({ occurredAt: -1 }).limit(limit).lean(),
    EquipmentLog.find({ equipmentId }).sort({ recordedAt: -1 }).limit(limit).lean(),
    EquipmentChecklist.find({ equipmentId }).sort({ createdAt: -1 }).limit(limit).lean(),
    MaintenanceTicket.find({ equipmentId }).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);

  const userIds = new Set<string>();
  const branchIds = new Set<string>();
  for (const m of movements) {
    if (m.performedBy) userIds.add(m.performedBy.toString());
    if (m.fromUserId) userIds.add(m.fromUserId.toString());
    if (m.toUserId) userIds.add(m.toUserId.toString());
    if (m.fromBranchId) branchIds.add(m.fromBranchId.toString());
    if (m.toBranchId) branchIds.add(m.toBranchId.toString());
  }
  for (const l of logs) if (l.recordedBy) userIds.add(l.recordedBy.toString());
  for (const c of checklists) if (c.completedBy) userIds.add(c.completedBy.toString());
  for (const t of tickets) if (t.reportedBy) userIds.add(t.reportedBy.toString());

  const names = await buildNameMaps([...userIds], [...branchIds]);

  const entries: TimelineEntry[] = [];

  for (const m of movements) {
    entries.push({
      id: m._id.toString(),
      kind: "movement",
      at: m.occurredAt,
      title: movementTitles[m.type] || "Traspaso",
      description: describeMovement(m, names),
      actorId: m.performedBy?.toString(),
      actorName: m.performedBy ? names.users.get(m.performedBy.toString()) : undefined,
      tone: movementTone(m),
      icon: movementIcons[m.type] || "fa-arrow-right-arrow-left",
      geo: decorateGeo(m.geo),
      photos: m.photos || [],
      meta: {
        type: m.type,
        status: m.status,
        expectedReturnAt: m.expectedReturnAt,
        returnedAt: m.returnedAt,
        cost: m.cost,
        reason: m.reason,
        notes: m.notes,
        photos: m.photos,
      },
    });
  }

  for (const l of logs) {
    const failed = (l.checks || []).filter((c: any) => !c.ok).length;
    entries.push({
      id: l._id.toString(),
      kind: "log",
      at: l.recordedAt,
      title: "Revisión diaria",
      description:
        l.temperatureC != null
          ? `${l.temperatureC} °C${failed ? ` · ${failed} punto(s) con novedad` : ""}`
          : failed
            ? `${failed} punto(s) con novedad`
            : "Sin novedades",
      actorId: l.recordedBy?.toString(),
      actorName: l.recordedBy ? names.users.get(l.recordedBy.toString()) : undefined,
      tone: l.requiresAttention ? "warning" : "success",
      icon: "fa-clipboard-check",
      geo: decorateGeo(l.geo),
      photos: l.photos || [],
      meta: {
        temperatureC: l.temperatureC,
        status: l.status,
        checks: l.checks,
        notes: l.notes,
        photos: l.photos,
      },
    });
  }

  for (const c of checklists) {
    entries.push({
      id: c._id.toString(),
      kind: "checklist",
      at: c.createdAt,
      title: "Checklist de mantenimiento",
      description: c.result === "completo" ? "Completo" : "Requiere atención",
      actorId: c.completedBy?.toString(),
      actorName: c.completedBy ? names.users.get(c.completedBy.toString()) : undefined,
      tone: c.result === "completo" ? "success" : "warning",
      icon: "fa-list-check",
      meta: { items: c.items, generalNotes: c.generalNotes, result: c.result },
    });
  }

  for (const t of tickets) {
    entries.push({
      id: t._id.toString(),
      kind: "ticket",
      at: t.createdAt,
      title: t.title || "Reporte de falla",
      description: t.description,
      actorId: t.reportedBy?.toString(),
      actorName: t.reportedBy ? names.users.get(t.reportedBy.toString()) : undefined,
      tone: t.status === "resuelto" || t.status === "cerrado" ? "success" : "danger",
      icon: "fa-triangle-exclamation",
      geo: decorateGeo(t.geo),
      photos: t.photos || [],
      meta: {
        status: t.status,
        priority: t.priority,
        assignedTo: t.assignedTo,
        resolvedAt: t.resolvedAt,
        resolutionNotes: t.resolutionNotes,
      },
    });
  }

  return entries
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

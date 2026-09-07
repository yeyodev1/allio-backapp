import mongoose from "mongoose";
import { Equipment } from "../models/Equipment.model";
import { Branch } from "../models/Branch.model";
import { User } from "../models/User.model";
import { buildGeoStamp } from "../models/geo.schema";
import {
  EquipmentMovement,
  MovementType,
  IEquipmentMovement,
} from "../models/EquipmentMovement.model";

export interface CreateMovementInput {
  equipmentId: string;
  companyId: mongoose.Types.ObjectId | string;
  type: MovementType;
  performedBy: string;
  occurredAt?: Date | string;
  toBranchId?: string;
  toUserId?: string;
  clientName?: string;
  clientContact?: string;
  workshopName?: string;
  workshopContact?: string;
  expectedReturnAt?: Date | string;
  cost?: number;
  reason?: string;
  notes?: string;
  statusAfter?: string;
  photos?: string[];
  geo?: unknown;
}

export class MovementError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Cada tipo de traspaso exige su propio destino. Se valida aquí y no en el modelo
 * porque Mongoose no sabe expresar "requerido solo si type es X".
 */
function assertDestination(input: CreateMovementInput) {
  switch (input.type) {
    case "local":
      if (!input.toBranchId) throw new MovementError("Elige el local de destino");
      break;
    case "tecnico":
      if (!input.toUserId) throw new MovementError("Elige el técnico que recibe el equipo");
      break;
    case "cliente":
      if (!input.clientName?.trim()) throw new MovementError("Indica el nombre del cliente");
      break;
    case "taller":
      if (!input.workshopName?.trim()) throw new MovementError("Indica el taller de destino");
      break;
    default:
      throw new MovementError("Tipo de traspaso no válido");
  }
}

/** Resuelve a dónde queda el equipo tras el movimiento: etiqueta y custodia. */
async function resolveDestination(input: CreateMovementInput) {
  if (input.type === "local") {
    const branch = await Branch.findById(input.toBranchId).select("name");
    if (!branch) throw new MovementError("El local de destino no existe", 404);
    return { label: branch.name, branch };
  }

  if (input.type === "tecnico") {
    const user = await User.findById(input.toUserId).select("name email");
    if (!user) throw new MovementError("El técnico de destino no existe", 404);
    return { label: user.name, user };
  }

  if (input.type === "cliente") {
    return { label: input.clientName!.trim() };
  }

  return { label: input.workshopName!.trim() };
}

/**
 * Registra un traspaso y deja el equipo reflejando dónde quedó.
 *
 * El movimiento se guarda primero: si la actualización del equipo fallara, preferimos
 * un historial completo con un equipo desfasado a un equipo movido sin rastro de quién
 * lo movió. Mongo aquí es una sola réplica en Atlas, no hay transacción disponible.
 */
export async function createMovement(input: CreateMovementInput): Promise<IEquipmentMovement> {
  assertDestination(input);

  const equipment = await Equipment.findById(input.equipmentId);
  if (!equipment) throw new MovementError("El equipo no existe", 404);

  const destination = await resolveDestination(input);
  const fromBranch = await Branch.findById(equipment.branchId).select("coordinates").lean();
  const fromBranchCoords = fromBranch?.coordinates || null;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const expectedReturnAt = input.expectedReturnAt ? new Date(input.expectedReturnAt) : undefined;

  // Los movimientos con retorno esperado nacen abiertos; los demás quedan cerrados.
  const isReturnable = input.type === "cliente" || input.type === "taller";

  const movement = await EquipmentMovement.create({
    equipmentId: equipment._id,
    companyId: input.companyId,
    type: input.type,
    status: isReturnable ? "pendiente" : "confirmado",
    occurredAt,
    performedBy: input.performedBy,
    fromBranchId: equipment.branchId,
    toBranchId: input.type === "local" ? input.toBranchId : undefined,
    fromUserId: equipment.assignedTo,
    toUserId: input.type === "tecnico" ? input.toUserId : undefined,
    clientName: input.type === "cliente" ? input.clientName?.trim() : undefined,
    clientContact: input.type === "cliente" ? input.clientContact?.trim() : undefined,
    workshopName: input.type === "taller" ? input.workshopName?.trim() : undefined,
    workshopContact: input.type === "taller" ? input.workshopContact?.trim() : undefined,
    expectedReturnAt: isReturnable ? expectedReturnAt : undefined,
    cost: input.cost,
    reason: input.reason?.trim(),
    notes: input.notes?.trim(),
    statusBefore: equipment.status,
    statusAfter: input.statusAfter || (input.type === "taller" ? "mantenimiento" : equipment.status),
    photos: input.photos || [],
    // Desde dónde se registró el movimiento. El origen es el local del que sale.
    geo: buildGeoStamp(input.geo, fromBranchCoords),
  });

  const update: Record<string, unknown> = {
    lastMovementAt: occurredAt,
    custody: {
      type: input.type === "local" ? "local" : input.type,
      label: destination.label,
      since: occurredAt,
      movementId: movement._id,
      expectedReturnAt: isReturnable ? expectedReturnAt : undefined,
    },
  };

  // Un traspaso de local cambia la sucursal dueña del equipo, no solo dónde está.
  if (input.type === "local") update.branchId = input.toBranchId;
  if (input.type === "tecnico") update.assignedTo = input.toUserId;
  if (input.type === "taller") update.status = "mantenimiento";
  if (input.statusAfter) update.status = input.statusAfter;

  await Equipment.findByIdAndUpdate(equipment._id, { $set: update });

  return movement;
}

/**
 * Cierra un movimiento con retorno: el equipo vuelve del taller o el cliente lo devuelve.
 * La custodia regresa a la sucursal a la que pertenece el equipo.
 */
export async function registerReturn(
  movementId: string,
  input: { returnedBy: string; returnedAt?: Date | string; cost?: number; notes?: string; statusAfter?: string }
): Promise<IEquipmentMovement> {
  const movement = await EquipmentMovement.findById(movementId);
  if (!movement) throw new MovementError("El traspaso no existe", 404);
  if (movement.status === "devuelto") throw new MovementError("Este traspaso ya se cerró");
  if (movement.status === "anulado") throw new MovementError("Este traspaso está anulado");
  if (movement.type !== "cliente" && movement.type !== "taller") {
    throw new MovementError("Solo los traspasos a cliente o taller se devuelven");
  }

  const returnedAt = input.returnedAt ? new Date(input.returnedAt) : new Date();

  movement.status = "devuelto";
  movement.returnedAt = returnedAt;
  movement.returnedBy = new mongoose.Types.ObjectId(input.returnedBy);
  if (input.cost != null) movement.cost = input.cost;
  if (input.notes) movement.notes = [movement.notes, input.notes].filter(Boolean).join("\n");
  await movement.save();

  const equipment = await Equipment.findById(movement.equipmentId);
  if (equipment) {
    const branch = await Branch.findById(equipment.branchId).select("name");
    await Equipment.findByIdAndUpdate(equipment._id, {
      $set: {
        lastMovementAt: returnedAt,
        status: input.statusAfter || "operativo",
        custody: {
          type: "local",
          label: branch?.name || "Local",
          since: returnedAt,
          movementId: movement._id,
        },
      },
    });
  }

  return movement;
}

/** Anula un traspaso mal registrado sin borrarlo del historial. */
export async function voidMovement(movementId: string, reason?: string) {
  const movement = await EquipmentMovement.findById(movementId);
  if (!movement) throw new MovementError("El traspaso no existe", 404);
  if (movement.status === "anulado") return movement;

  movement.status = "anulado";
  movement.notes = [movement.notes, reason ? `Anulado: ${reason}` : "Anulado"]
    .filter(Boolean)
    .join("\n");
  await movement.save();
  return movement;
}

/** Traspasos abiertos cuya fecha de retorno ya pasó. Alimenta el aviso del panel. */
export async function findOverdueReturns(companyId: mongoose.Types.ObjectId | string) {
  return EquipmentMovement.find({
    companyId,
    status: "pendiente",
    expectedReturnAt: { $ne: null, $lt: new Date() },
  })
    .populate("equipmentId", "name category")
    .sort({ expectedReturnAt: 1 });
}

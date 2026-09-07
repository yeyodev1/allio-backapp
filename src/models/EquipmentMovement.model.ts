import mongoose, { Schema, Document } from "mongoose";
import { geoStampSchema, IGeoStamp } from "./geo.schema";

/**
 * Traspaso de un equipo. Un solo modelo cubre los cuatro movimientos del negocio,
 * discriminados por `type`; cada uno usa el subconjunto de campos que le aplica:
 *
 *  - `local`   cambio de sucursal          → fromBranchId / toBranchId
 *  - `tecnico` entrega entre técnicos      → fromUserId / toUserId
 *  - `cliente` cesión o préstamo a cliente → client{...} / expectedReturnAt
 *  - `taller`  salida a reparación externa → workshop{...} / cost
 *
 * Un movimiento nunca se edita ni se borra: es el registro histórico del equipo.
 * Para deshacerlo se anula (`status: "anulado"`) y se registra otro en sentido
 * contrario, de modo que la línea de tiempo siempre refleje lo que pasó.
 */

export const MOVEMENT_TYPES = ["local", "tecnico", "cliente", "taller"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_STATUSES = ["pendiente", "confirmado", "devuelto", "anulado"] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];

export interface IEquipmentMovement extends Document {
  equipmentId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  type: MovementType;
  status: MovementStatus;
  occurredAt: Date;
  performedBy: mongoose.Types.ObjectId;

  fromBranchId?: mongoose.Types.ObjectId;
  toBranchId?: mongoose.Types.ObjectId;

  fromUserId?: mongoose.Types.ObjectId;
  toUserId?: mongoose.Types.ObjectId;

  clientName?: string;
  clientContact?: string;

  workshopName?: string;
  workshopContact?: string;

  expectedReturnAt?: Date;
  returnedAt?: Date;
  returnedBy?: mongoose.Types.ObjectId;
  cost?: number;

  reason?: string;
  notes?: string;
  statusBefore?: string;
  statusAfter?: string;
  photos: string[];
  geo: IGeoStamp;
  createdAt: Date;
  updatedAt: Date;
}

const equipmentMovementSchema = new Schema<IEquipmentMovement>(
  {
    equipmentId: { type: Schema.Types.ObjectId, ref: "Equipment", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    status: { type: String, enum: MOVEMENT_STATUSES, default: "confirmado" },
    occurredAt: { type: Date, required: true, default: Date.now },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    fromBranchId: { type: Schema.Types.ObjectId, ref: "Branch" },
    toBranchId: { type: Schema.Types.ObjectId, ref: "Branch" },

    fromUserId: { type: Schema.Types.ObjectId, ref: "User" },
    toUserId: { type: Schema.Types.ObjectId, ref: "User" },

    clientName: { type: String, trim: true },
    clientContact: { type: String, trim: true },

    workshopName: { type: String, trim: true },
    workshopContact: { type: String, trim: true },

    // Movimientos con retorno esperado: cliente y taller.
    expectedReturnAt: { type: Date },
    returnedAt: { type: Date },
    returnedBy: { type: Schema.Types.ObjectId, ref: "User" },
    cost: { type: Number, min: 0 },

    reason: { type: String, trim: true },
    notes: { type: String, trim: true },
    statusBefore: { type: String, trim: true },
    statusAfter: { type: String, trim: true },
    photos: { type: [String], default: [] },
    geo: { type: geoStampSchema, default: () => ({ source: "unavailable" }) },
  },
  { timestamps: true }
);

// La consulta dominante es la ficha del equipo: su historial en orden inverso.
equipmentMovementSchema.index({ equipmentId: 1, occurredAt: -1 });
// Y el listado de traspasos de la empresa, filtrable por tipo y estado.
equipmentMovementSchema.index({ companyId: 1, occurredAt: -1 });
// Pendientes de devolución (cliente y taller sin `returnedAt`).
equipmentMovementSchema.index({ companyId: 1, status: 1, expectedReturnAt: 1 });

export const EquipmentMovement = mongoose.model<IEquipmentMovement>(
  "EquipmentMovement",
  equipmentMovementSchema
);

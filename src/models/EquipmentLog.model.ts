import mongoose, { Schema, Document } from "mongoose";
import { geoStampSchema, IGeoStamp } from "./geo.schema";

/**
 * Bitácora diaria de un equipo: lo que el técnico marca cada día al pasar por él.
 *
 * En línea blanca la lectura que importa es la temperatura, así que va como campo
 * de primer nivel y no escondida entre los ítems del checklist. `checks` queda para
 * lo demás (empaques, luces, drenaje, ruido…).
 *
 * `day` guarda la fecha normalizada a medianoche para poder pedir "los equipos ya
 * revisados hoy" con una consulta directa en vez de un rango.
 */

export interface IEquipmentLogCheck {
  key: string;
  label: string;
  ok: boolean;
  notes?: string;
}

export interface IEquipmentLog extends Document {
  equipmentId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  companyId: mongoose.Types.ObjectId;
  recordedBy: mongoose.Types.ObjectId;
  recordedAt: Date;
  day: Date;
  status: string;
  temperatureC?: number;
  checks: IEquipmentLogCheck[];
  notes?: string;
  photos: string[];
  geo: IGeoStamp;
  requiresAttention: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const logCheckSchema = new Schema<IEquipmentLogCheck>(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    ok: { type: Boolean, required: true },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const equipmentLogSchema = new Schema<IEquipmentLog>(
  {
    equipmentId: { type: Schema.Types.ObjectId, ref: "Equipment", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    recordedAt: { type: Date, required: true, default: Date.now },
    day: { type: Date, required: true },
    status: {
      type: String,
      enum: ["operativo", "averiado", "mantenimiento", "fuera_servicio"],
      default: "operativo",
    },
    temperatureC: { type: Number },
    checks: { type: [logCheckSchema], default: [] },
    notes: { type: String, trim: true },
    photos: { type: [String], default: [] },
    geo: { type: geoStampSchema, default: () => ({ source: "unavailable" }) },
    requiresAttention: { type: Boolean, default: false },
  },
  { timestamps: true }
);

equipmentLogSchema.index({ equipmentId: 1, day: -1 });
equipmentLogSchema.index({ companyId: 1, day: -1 });
equipmentLogSchema.index({ branchId: 1, day: -1 });

/** Medianoche local del día de `date`, que es la clave con la que se agrupa la bitácora. */
export function startOfDay(date: Date | string = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const EquipmentLog = mongoose.model<IEquipmentLog>("EquipmentLog", equipmentLogSchema);

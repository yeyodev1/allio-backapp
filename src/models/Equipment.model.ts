import mongoose, { Schema, Document } from "mongoose";

/**
 * Un equipo de línea blanca: la nevera, el congelador, la vitrina.
 *
 * `branchId` es la sucursal a la que pertenece el equipo (su casa). `custody` es
 * dónde está físicamente ahora mismo, que no siempre coinciden: un equipo puede
 * pertenecer al Local Norte y estar en el taller o cedido a un cliente. Ambos los
 * mantiene al día `movement.service.ts` cada vez que se registra un traspaso.
 *
 * Los campos contables (`historicalCost`, `usefulLife`, `purchaseDate`) no guardan
 * valor en libros: se deriva al leer con `calculateDepreciation`.
 */

export const EQUIPMENT_CATEGORIES = [
  "nevera",
  "congelador",
  "vitrina",
  "camara_frio",
  "enfriador",
  "lavadora",
  "secadora",
  "cocina",
  "horno",
  "otro",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_STATUSES = [
  "operativo",
  "averiado",
  "mantenimiento",
  "fuera_servicio",
] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const CUSTODY_TYPES = ["local", "tecnico", "cliente", "taller"] as const;
export type CustodyType = (typeof CUSTODY_TYPES)[number];

export interface IEquipmentCustody {
  type: CustodyType;
  label: string;
  since: Date;
  movementId?: mongoose.Types.ObjectId;
  expectedReturnAt?: Date;
}

export interface IEquipment extends Document {
  branchId: mongoose.Types.ObjectId;
  companyId?: mongoose.Types.ObjectId;
  name: string;
  category: EquipmentCategory;
  brand?: string;
  modelName?: string;
  serialNumber?: string;
  purchaseDate: Date;
  historicalCost: number;
  usefulLife: number;
  maintenanceIntervalDays: number;
  lastMaintenanceDate?: Date;
  status: EquipmentStatus;
  location?: string;
  assignedTo?: mongoose.Types.ObjectId;
  custody: IEquipmentCustody;
  lastMovementAt?: Date;
  lastLogAt?: Date;
  targetTemperatureC?: number;
  qrCode?: string;
  imageUrl?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const custodySchema = new Schema<IEquipmentCustody>(
  {
    type: { type: String, enum: CUSTODY_TYPES, default: "local" },
    label: { type: String, trim: true, default: "" },
    since: { type: Date, default: Date.now },
    movementId: { type: Schema.Types.ObjectId, ref: "EquipmentMovement" },
    expectedReturnAt: { type: Date },
  },
  { _id: false }
);

const equipmentSchema = new Schema<IEquipment>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: EQUIPMENT_CATEGORIES, default: "otro" },
    brand: { type: String, trim: true },
    modelName: { type: String, trim: true },
    serialNumber: { type: String, trim: true },
    purchaseDate: { type: Date, required: true },
    historicalCost: { type: Number, required: true, min: 0 },
    usefulLife: { type: Number, required: true, min: 1 },
    maintenanceIntervalDays: { type: Number, required: true, min: 1 },
    lastMaintenanceDate: { type: Date },
    status: { type: String, enum: EQUIPMENT_STATUSES, default: "operativo" },
    location: { type: String, trim: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    custody: { type: custodySchema, default: () => ({ type: "local", label: "", since: new Date() }) },
    lastMovementAt: { type: Date },
    lastLogAt: { type: Date },
    // Temperatura objetivo: sirve para marcar en rojo la lectura diaria fuera de rango.
    targetTemperatureC: { type: Number },
    qrCode: { type: String },
    imageUrl: { type: String },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

equipmentSchema.index({ companyId: 1, status: 1 });
equipmentSchema.index({ branchId: 1, name: 1 });
equipmentSchema.index({ assignedTo: 1 });

export const Equipment = mongoose.model<IEquipment>("Equipment", equipmentSchema);

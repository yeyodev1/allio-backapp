import mongoose, { Schema, Document } from "mongoose";
import { geoStampSchema, IGeoStamp } from "./geo.schema";

export interface IMaintenanceTicket extends Document {
  equipmentId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  reportedBy: mongoose.Types.ObjectId;
  title?: string;
  description: string;
  status: "abierto" | "en_progreso" | "resuelto" | "cerrado";
  assignedTo?: string;
  priority: "baja" | "media" | "alta" | "critica";
  resolvedAt?: Date;
  resolvedBy?: mongoose.Types.ObjectId;
  resolutionNotes?: string;
  photos: string[];
  geo?: IGeoStamp;
  createdAt: Date;
  updatedAt: Date;
}

const maintenanceTicketSchema = new Schema<IMaintenanceTicket>(
  {
    equipmentId: { type: Schema.Types.ObjectId, ref: "Equipment", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, trim: true },
    description: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["abierto", "en_progreso", "resuelto", "cerrado"],
      default: "abierto",
    },
    assignedTo: { type: String, trim: true },
    priority: {
      type: String,
      enum: ["baja", "media", "alta", "critica"],
      default: "media",
    },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolutionNotes: { type: String, trim: true },
    photos: { type: [String], default: [] },
    geo: { type: geoStampSchema },
  },
  { timestamps: true }
);

export const MaintenanceTicket = mongoose.model<IMaintenanceTicket>("MaintenanceTicket", maintenanceTicketSchema);

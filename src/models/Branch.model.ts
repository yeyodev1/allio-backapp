import mongoose, { Schema, Document } from "mongoose";
import { coordinatesSchema, ICoordinates } from "./geo.schema";

export interface IBranch extends Document {
  companyId: mongoose.Types.ObjectId;
  name: string;
  address?: string;
  phone?: string;
  isMain: boolean;
  isActive: boolean;
  /** Punto de referencia del local. Sin él no se puede medir si un registro se hizo fuera. */
  coordinates?: ICoordinates;
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = new Schema<IBranch>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    isMain: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    coordinates: { type: coordinatesSchema },
  },
  { timestamps: true }
);

branchSchema.index({ companyId: 1, isMain: 1 });

export const Branch = mongoose.model<IBranch>("Branch", branchSchema);

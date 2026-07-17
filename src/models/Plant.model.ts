import mongoose, { Schema, Document } from "mongoose";

export interface IPlant extends Document {
  companyId: mongoose.Types.ObjectId;
  name: string;
  address?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const plantSchema = new Schema<IPlant>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

plantSchema.index({ companyId: 1, name: 1 });

export const Plant = mongoose.model<IPlant>("Plant", plantSchema);

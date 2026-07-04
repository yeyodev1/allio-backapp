import mongoose, { Schema, Document } from "mongoose";

export interface IFixedCost extends Document {
  companyId: mongoose.Types.ObjectId;
  rent: number;
  payroll: number;
  utilities: number;
  internet: number;
  insurance: number;
  marketing: number;
  other: number;
  effectiveDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const fixedCostSchema = new Schema<IFixedCost>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    rent: { type: Number, default: 0, min: 0 },
    payroll: { type: Number, default: 0, min: 0 },
    utilities: { type: Number, default: 0, min: 0 },
    internet: { type: Number, default: 0, min: 0 },
    insurance: { type: Number, default: 0, min: 0 },
    marketing: { type: Number, default: 0, min: 0 },
    other: { type: Number, default: 0, min: 0 },
    effectiveDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/** Sum of all monthly fixed cost buckets for this company (rent, payroll, utilities, internet, insurance, marketing, other). */
export function totalMonthlyFixedCost(fc: Pick<IFixedCost, "rent" | "payroll" | "utilities" | "internet" | "insurance" | "marketing" | "other">): number {
  return (fc.rent || 0) + (fc.payroll || 0) + (fc.utilities || 0) + (fc.internet || 0) + (fc.insurance || 0) + (fc.marketing || 0) + (fc.other || 0);
}

export const FixedCost = mongoose.model<IFixedCost>("FixedCost", fixedCostSchema);

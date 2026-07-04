import mongoose, { Schema, Document } from "mongoose";

export interface ICompany extends Document {
  userId: mongoose.Types.ObjectId;
  legalName: string;
  commercialName?: string;
  ruc: string;
  country?: string;
  city?: string;
  businessStage?: "new" | "existing";
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const companySchema = new Schema<ICompany>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    legalName: { type: String, required: true, trim: true },
    commercialName: { type: String, trim: true },
    ruc: { type: String, required: true, trim: true },
    country: { type: String, trim: true },
    city: { type: String, trim: true },
    businessStage: { type: String, enum: ["new", "existing"] },
    onboardingCompleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Company = mongoose.model<ICompany>("Company", companySchema);

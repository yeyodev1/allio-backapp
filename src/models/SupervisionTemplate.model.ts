import mongoose, { Schema, Document } from "mongoose";

export type SupervisionFrequency = "daily" | "monthly" | "fortnightly" | "as_needed";
export type SupervisionTargetType = "branch" | "plant";

export interface ISupervisionTemplate extends Document {
  companyId: mongoose.Types.ObjectId;
  key: string;
  name: string;
  description?: string;
  frequency: SupervisionFrequency;
  targetType: SupervisionTargetType;
  sections: Array<{
    key: string;
    title: string;
    items: Array<{ key: string; label: string }>;
  }>;
  isDefault: boolean;
  recommended: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const templateItemSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const templateSectionSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    items: { type: [templateItemSchema], required: true },
  },
  { _id: false }
);

const supervisionTemplateSchema = new Schema<ISupervisionTemplate>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    key: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    frequency: {
      type: String,
      enum: ["daily", "monthly", "fortnightly", "as_needed"],
      required: true,
    },
    targetType: { type: String, enum: ["branch", "plant"], required: true },
    sections: { type: [templateSectionSchema], required: true },
    isDefault: { type: Boolean, default: false },
    recommended: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

supervisionTemplateSchema.index({ companyId: 1, key: 1 }, { unique: true });
supervisionTemplateSchema.index({ companyId: 1, targetType: 1, isActive: 1 });

export const SupervisionTemplate = mongoose.model<ISupervisionTemplate>(
  "SupervisionTemplate",
  supervisionTemplateSchema
);

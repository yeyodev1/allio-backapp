import mongoose, { Schema, Document } from "mongoose";
import { SupervisionFrequency, SupervisionTargetType } from "./SupervisionTemplate.model";

export type SupervisionAnswerStatus = "si" | "no" | "no_aplica";

export interface ISupervisionSubmission extends Document {
  companyId: mongoose.Types.ObjectId;
  templateId: mongoose.Types.ObjectId;
  submittedBy: mongoose.Types.ObjectId;
  targetType: SupervisionTargetType;
  branchId?: mongoose.Types.ObjectId;
  plantId?: mongoose.Types.ObjectId;
  targetKey: string;
  businessDate: string;
  score: number;
  result: "aprobado" | "observado" | "reprobado";
  templateName: string;
  targetName: string;
  header: {
    visitorName: string;
    visitTime: string;
    mileage?: number;
    managerName?: string;
    kitchenLeadName?: string;
  };
  answers: Array<{
    itemKey: string;
    label: string;
    sectionKey: string;
    sectionLabel: string;
    status: SupervisionAnswerStatus;
    observation?: string;
  }>;
  evidence: Array<{ url: string; publicId: string }>;
  templateSnapshot: {
    key: string;
    name: string;
    frequency: SupervisionFrequency;
    targetType: SupervisionTargetType;
    sections: Array<{
      key: string;
      title: string;
      items: Array<{ key: string; label: string }>;
    }>;
  };
  createdAt: Date;
  updatedAt: Date;
}

const answerSchema = new Schema(
  {
    itemKey: { type: String, required: true },
    label: { type: String, required: true },
    sectionKey: { type: String, required: true },
    sectionLabel: { type: String, required: true },
    status: { type: String, enum: ["si", "no", "no_aplica"], required: true },
    observation: { type: String, trim: true },
  },
  { _id: false }
);

const evidenceSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const snapshotItemSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
  },
  { _id: false }
);

const snapshotSectionSchema = new Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    items: { type: [snapshotItemSchema], required: true },
  },
  { _id: false }
);

const templateSnapshotSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    frequency: {
      type: String,
      enum: ["daily", "monthly", "fortnightly", "as_needed"],
      required: true,
    },
    targetType: { type: String, enum: ["branch", "plant"], required: true },
    sections: { type: [snapshotSectionSchema], required: true },
  },
  { _id: false }
);

const supervisionSubmissionSchema = new Schema<ISupervisionSubmission>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    templateId: { type: Schema.Types.ObjectId, ref: "SupervisionTemplate", required: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    targetType: { type: String, enum: ["branch", "plant"], required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch" },
    plantId: { type: Schema.Types.ObjectId, ref: "Plant" },
    targetKey: { type: String, required: true },
    businessDate: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    result: { type: String, enum: ["aprobado", "observado", "reprobado"], required: true },
    templateName: { type: String, required: true },
    targetName: { type: String, required: true },
    header: {
      visitorName: { type: String, required: true, trim: true },
      visitTime: { type: String, required: true, trim: true },
      mileage: { type: Number, min: 0 },
      managerName: { type: String, trim: true },
      kitchenLeadName: { type: String, trim: true },
    },
    answers: { type: [answerSchema], required: true },
    evidence: { type: [evidenceSchema], required: true },
    templateSnapshot: { type: templateSnapshotSchema, required: true },
  },
  { timestamps: true }
);

supervisionSubmissionSchema.index(
  { companyId: 1, templateId: 1, targetKey: 1, businessDate: 1 },
  { unique: true }
);
supervisionSubmissionSchema.index({ companyId: 1, createdAt: -1 });

export const SupervisionSubmission = mongoose.model<ISupervisionSubmission>(
  "SupervisionSubmission",
  supervisionSubmissionSchema
);

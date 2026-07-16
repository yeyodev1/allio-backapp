import mongoose, { Schema, Document } from "mongoose";

export interface IEquipmentChecklist extends Document {
  equipmentId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  completedBy: mongoose.Types.ObjectId;
  items: Array<{ key: string; label: string; checked: boolean; notes?: string }>;
  generalNotes?: string;
  result: "completo" | "requiere_atencion";
  createdAt: Date;
  updatedAt: Date;
}

const checklistItemSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    checked: { type: Boolean, required: true },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const equipmentChecklistSchema = new Schema<IEquipmentChecklist>(
  {
    equipmentId: { type: Schema.Types.ObjectId, ref: "Equipment", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    completedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    items: { type: [checklistItemSchema], required: true },
    generalNotes: { type: String, trim: true },
    result: { type: String, enum: ["completo", "requiere_atencion"], required: true },
  },
  { timestamps: true }
);

equipmentChecklistSchema.index({ equipmentId: 1, createdAt: -1 });

export const EquipmentChecklist = mongoose.model<IEquipmentChecklist>(
  "EquipmentChecklist",
  equipmentChecklistSchema
);

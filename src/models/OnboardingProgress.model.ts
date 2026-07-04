import mongoose, { Schema, Document } from "mongoose";

export interface IOnboardingProgress extends Document {
  userId: mongoose.Types.ObjectId;
  currentStep: number;
  completedSteps: number[];
  data: Record<string, unknown>;
  isComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const onboardingProgressSchema = new Schema<IOnboardingProgress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    currentStep: { type: Number, default: 1, min: 1, max: 6 },
    completedSteps: { type: [Number], default: [] },
    data: { type: Schema.Types.Mixed, default: {} },
    isComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const OnboardingProgress = mongoose.model<IOnboardingProgress>("OnboardingProgress", onboardingProgressSchema);

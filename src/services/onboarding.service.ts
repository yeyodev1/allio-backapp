import { OnboardingProgress } from "../models/OnboardingProgress.model";

interface OnboardingData {
  step1?: { legalName: string; commercialName: string; ruc: string; country: string; city: string; businessStage: "new" | "existing" };
  step2?: { name: string; address: string; phone: string };
  step3?: { rent: number; payroll: number; utilities: number; internet: number; insurance: number; marketing: number; other: number };
  step4?: { recipes: Array<{ name: string; productionCost: number; currentSellingPrice?: number }> };
  step5?: { equipment: Array<{ name: string; brand: string; purchaseDate: string; historicalCost: number; usefulLife: number; maintenanceIntervalDays: number }> };
  step6?: { completed: boolean };
}

export async function saveStep(userId: string, step: number, data: object): Promise<void> {
  const stepKey = `step${step}`;

  await OnboardingProgress.findOneAndUpdate(
    { userId },
    {
      $set: {
        [`data.${stepKey}`]: data,
      },
      $max: { currentStep: step + 1 },
      $addToSet: { completedSteps: step },
    },
    { upsert: true, new: true }
  );
}

export async function getProgress(userId: string): Promise<typeof OnboardingProgress.prototype | null> {
  return OnboardingProgress.findOne({ userId });
}

export async function completeOnboarding(userId: string): Promise<void> {
  await OnboardingProgress.findOneAndUpdate(
    { userId },
    { $set: { isComplete: true } }
  );
}

export async function resetOnboarding(userId: string): Promise<void> {
  await OnboardingProgress.findOneAndDelete({ userId });
}

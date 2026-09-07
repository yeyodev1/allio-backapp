import { OnboardingProgress } from "../models/OnboardingProgress.model";

/**
 * Onboarding en 6 pasos. El orden sigue la dependencia real de los datos:
 * sin empresa no hay locales, sin locales no hay dónde poner los equipos, y
 * sin equipos no tiene sentido asignar técnicos.
 *
 *   1 Empresa · 2 Locales · 3 Equipos · 4 Técnicos · 5 Costos fijos · 6 Finalizar
 *
 * Los pasos 4 y 5 se pueden saltar; los tres primeros no.
 *
 * Las recetas salieron del onboarding: obligaban a costear el menú antes de poder
 * usar la app, y eso se hace mejor desde el módulo de Costeo con calma.
 */

export const TOTAL_STEPS = 6;
export const SKIPPABLE_STEPS = [4, 5];

export interface OnboardingStepData {
  step1?: {
    legalName: string;
    commercialName?: string;
    ruc: string;
    country?: string;
    city?: string;
    businessStage?: "new" | "existing";
  };
  step2?: {
    branches: Array<{
      name: string;
      address?: string;
      phone?: string;
      coordinates?: { lat: number; lng: number };
    }>;
  };
  step3?: {
    equipment: Array<{
      name: string;
      category?: string;
      brand?: string;
      model?: string;
      serialNumber?: string;
      purchaseDate: string;
      historicalCost: number;
      usefulLife: number;
      maintenanceIntervalDays: number;
      targetTemperatureC?: number;
      branchName?: string;
    }>;
  };
  step4?: { technicians: Array<{ name: string; email: string; password?: string; role: string }> };
  step5?: {
    skipped?: boolean;
    rent?: number;
    payroll?: number;
    utilities?: number;
    internet?: number;
    insurance?: number;
    marketing?: number;
    other?: number;
  };
  step6?: { completed: boolean };
}

export async function saveStep(userId: string, step: number, data: object): Promise<void> {
  await OnboardingProgress.findOneAndUpdate(
    { userId },
    {
      $set: { [`data.step${step}`]: data },
      $max: { currentStep: Math.min(step + 1, TOTAL_STEPS) },
      $addToSet: { completedSteps: step },
    },
    { upsert: true, new: true }
  );
}

export async function getProgress(userId: string) {
  return OnboardingProgress.findOne({ userId });
}

export async function completeOnboarding(userId: string): Promise<void> {
  await OnboardingProgress.findOneAndUpdate(
    { userId },
    { $set: { isComplete: true, currentStep: TOTAL_STEPS } }
  );
}

export async function resetOnboarding(userId: string): Promise<void> {
  await OnboardingProgress.findOneAndDelete({ userId });
}

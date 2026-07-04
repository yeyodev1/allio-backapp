import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as onboardingService from "../services/onboarding.service";
import { Company } from "../models/Company.model";
import { Branch } from "../models/Branch.model";
import { Recipe } from "../models/Recipe.model";
import { Equipment } from "../models/Equipment.model";
import { FixedCost } from "../models/FixedCost.model";
import { User } from "../models/User.model";

// Onboarding steps (6 total):
// 1 Empresa · 2 Sucursal · 3 Costos Fijos · 4 Platos (costeo simple) · 5 Equipos · 6 Finalizar

export async function saveOnboardingStep(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { step, data } = req.body;

    if (!step || step < 1 || step > 6) {
      res.status(400).json({ message: "Step must be between 1 and 6" });
      return;
    }

    if (!data) {
      res.status(400).json({ message: "Data is required" });
      return;
    }

    switch (step) {
      case 1: {
        const { legalName, commercialName, ruc, country, city, businessStage } = data;
        if (!legalName || !ruc) {
          res.status(400).json({ message: "legalName and ruc are required" });
          return;
        }
        const company = await Company.findOneAndUpdate(
          { userId },
          {
            $set: {
              userId,
              legalName,
              commercialName: commercialName || "",
              ruc,
              country: country || "",
              city: city || "",
              ...(businessStage ? { businessStage } : {}),
            },
          },
          { upsert: true, new: true }
        );
        await User.findByIdAndUpdate(userId, { $addToSet: { workspaceIds: company._id } });
        break;
      }

      case 2: {
        const { name, address, phone } = data;
        if (!name) {
          res.status(400).json({ message: "Branch name is required" });
          return;
        }
        const company = await Company.findOne({ userId });
        if (!company) {
          res.status(400).json({ message: "Company must be created first (step 1)" });
          return;
        }
        const existingBranch = await Branch.findOne({ companyId: company._id, isMain: true });
        if (existingBranch) {
          await Branch.findOneAndUpdate(
            { _id: existingBranch._id },
            { $set: { name, address: address || "", phone: phone || "" } }
          );
        } else {
          await Branch.create({
            companyId: company._id,
            name,
            address: address || "",
            phone: phone || "",
            isMain: true,
            isActive: true,
          });
        }
        break;
      }

      case 3: {
        const company = await Company.findOne({ userId });
        if (!company) {
          res.status(400).json({ message: "Company not found" });
          return;
        }
        const { rent, payroll, utilities, internet, insurance, marketing, other } = data;
        await FixedCost.findOneAndUpdate(
          { companyId: company._id },
          {
            $set: {
              companyId: company._id,
              rent: rent || 0,
              payroll: payroll || 0,
              utilities: utilities || 0,
              internet: internet || 0,
              insurance: insurance || 0,
              marketing: marketing || 0,
              other: other || 0,
              effectiveDate: new Date(),
            },
          },
          { upsert: true, new: true }
        );
        break;
      }

      case 4: {
        const company = await Company.findOne({ userId });
        if (!company) {
          res.status(400).json({ message: "Company not found" });
          return;
        }
        const recipes = data.recipes || (Array.isArray(data) ? data : []);
        if (!Array.isArray(recipes) || recipes.length === 0) {
          res.status(400).json({ message: "Recipes array is required" });
          return;
        }
        for (const recipe of recipes) {
          if (!recipe.name || recipe.productionCost == null) {
            res.status(400).json({ message: "Each recipe must have name and productionCost" });
            return;
          }
          await Recipe.create({
            companyId: company._id,
            name: recipe.name,
            productionCost: recipe.productionCost,
            sellingPrice: recipe.currentSellingPrice ?? undefined,
            ingredients: [],
            wastePercentage: 0,
          });
        }
        break;
      }

      case 5: {
        const company = await Company.findOne({ userId });
        if (!company) {
          res.status(400).json({ message: "Company not found" });
          return;
        }
        const branch = await Branch.findOne({ companyId: company._id, isMain: true });
        if (!branch) {
          res.status(400).json({ message: "Branch must be created first (step 2)" });
          return;
        }
        const equipments = data.equipment || data.equipments || (Array.isArray(data) ? data : []);
        if (!Array.isArray(equipments) || equipments.length === 0) {
          res.status(400).json({ message: "Equipment array is required" });
          return;
        }
        for (const eq of equipments) {
          if (!eq.name || !eq.purchaseDate || eq.historicalCost == null || !eq.usefulLife || !eq.maintenanceIntervalDays) {
            res.status(400).json({ message: "Each equipment must have name, purchaseDate, historicalCost, usefulLife, and maintenanceIntervalDays" });
            return;
          }
          await Equipment.create({
            branchId: branch._id,
            name: eq.name,
            brand: eq.brand || "",
            purchaseDate: new Date(eq.purchaseDate),
            historicalCost: eq.historicalCost,
            usefulLife: eq.usefulLife,
            maintenanceIntervalDays: eq.maintenanceIntervalDays,
            status: "operativo",
          });
        }
        break;
      }

      case 6: {
        await Company.findOneAndUpdate({ userId }, { $set: { onboardingCompleted: true } });
        await onboardingService.completeOnboarding(userId);
        break;
      }
    }

    await onboardingService.saveStep(userId, step, data);

    res.json({ message: `Step ${step} saved successfully`, step });
  } catch (error: any) {
    res.status(500).json({ message: "Error saving onboarding step", error: error.message });
  }
}

export async function getOnboardingProgress(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const company = await Company.findOne({ userId });
    const progress = await onboardingService.getProgress(userId);

    const response: any = {
      currentStep: progress?.currentStep || 1,
      completedSteps: progress?.completedSteps || [],
      isComplete: !!(progress?.isComplete || company?.onboardingCompleted),
      hasCompany: !!company,
      companyName: company?.legalName || company?.commercialName || null,
      businessStage: company?.businessStage || null,
      data: progress?.data || {},
    };

    res.json(response);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching onboarding progress", error: error.message });
  }
}

export async function completeOnboarding(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    await Company.findOneAndUpdate({ userId }, { $set: { onboardingCompleted: true } });
    await onboardingService.completeOnboarding(userId);

    res.json({ message: "Onboarding completed successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Error completing onboarding", error: error.message });
  }
}

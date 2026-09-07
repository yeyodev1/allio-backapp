import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { Ingredient } from "../models/Ingredient.model";
import { Recipe } from "../models/Recipe.model";
import { Company } from "../models/Company.model";
import { FixedCost } from "../models/FixedCost.model";
import { User } from "../models/User.model";
import { computePriceSuggestion, computeRecipeCost } from "../services/costing.service";

async function resolveCompanyId(userId: string, queryCompanyId?: string): Promise<string | null> {
  if (queryCompanyId) return queryCompanyId;
  const user = await User.findById(userId).select("workspaceIds");
  const workspaceId = user?.workspaceIds?.[0];
  if (workspaceId) return workspaceId.toString();
  const company = await Company.findOne({ userId });
  return company ? company._id.toString() : null;
}

async function buildSuggestionContext(companyId: string) {
  const [fixedCost, activeDishCount] = await Promise.all([
    FixedCost.findOne({ companyId }),
    Recipe.countDocuments({ companyId, isActive: true }),
  ]);
  return { fixedCost, activeDishCount };
}

// --- Ingredients ---

export async function listIngredients(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Sin empresa todavía no hay error: simplemente no hay nada que listar.
    const companyId = await resolveCompanyId(userId);
    if (!companyId) return res.json([]);

    const ingredients = await Ingredient.find({ companyId }).sort({ name: 1 });
    res.json(ingredients);
  } catch (error: any) {
    res.status(500).json({ message: "Error listing ingredients", error: error.message });
  }
}

export async function createIngredient(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const companyId = await resolveCompanyId(userId);
    if (!companyId) return res.status(400).json({ message: "Primero registra los datos de tu empresa" });

    const { name, unitOfMeasure, costPrice, wastePercentage } = req.body;

    if (!name || !unitOfMeasure || costPrice == null) {
      return res.status(400).json({ message: "name, unitOfMeasure, and costPrice are required" });
    }

    const ingredient = await Ingredient.create({
      companyId,
      name,
      unitOfMeasure,
      costPrice,
      wastePercentage: wastePercentage || 0,
    });

    res.status(201).json(ingredient);
  } catch (error: any) {
    res.status(500).json({ message: "Error creating ingredient", error: error.message });
  }
}

export async function deleteIngredient(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { id } = req.params;
    const ingredient = await Ingredient.findById(id);
    if (!ingredient) return res.status(404).json({ message: "Ingredient not found" });

    const companyId = await resolveCompanyId(userId);
    if (companyId && ingredient.companyId.toString() !== companyId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await Ingredient.findByIdAndDelete(id);
    res.json({ message: "Ingredient deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Error deleting ingredient", error: error.message });
  }
}

// --- Recipes ---

export async function listRecipes(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Sin empresa todavía no hay error: simplemente no hay nada que listar.
    const companyId = await resolveCompanyId(userId);
    if (!companyId) return res.json([]);

    const recipes = await Recipe.find({ companyId }).populate("ingredients.ingredientId").sort({ name: 1 });
    const { fixedCost, activeDishCount } = await buildSuggestionContext(companyId);

    const recipesWithSuggestion = recipes.map((recipe) => {
      const cost = computeRecipeCost(recipe.toObject());
      const suggestion = computePriceSuggestion({ cost, fixedCost, activeDishCount });
      return { ...recipe.toObject(), cost, suggestion };
    });

    res.json(recipesWithSuggestion);
  } catch (error: any) {
    res.status(500).json({ message: "Error listing recipes", error: error.message });
  }
}

export async function createRecipe(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const companyId = await resolveCompanyId(userId);
    if (!companyId) return res.status(400).json({ message: "Primero registra los datos de tu empresa" });

    const { name, sellingPrice, productionCost, ingredients, wastePercentage, isActive, validityDays } = req.body;

    const hasIngredients = Array.isArray(ingredients) && ingredients.length > 0;
    if (!name || (!hasIngredients && productionCost == null)) {
      return res.status(400).json({ message: "name is required, plus either productionCost or an ingredients array" });
    }

    const { fixedCost, activeDishCount } = await buildSuggestionContext(companyId);
    const cost = hasIngredients
      ? await computeIngredientsCost(ingredients)
      : Number(productionCost) || 0;
    const suggestion = computePriceSuggestion({ cost, fixedCost, activeDishCount: activeDishCount + 1, validityDays });

    const recipe = await Recipe.create({
      companyId,
      name,
      sellingPrice: sellingPrice ?? undefined,
      productionCost: hasIngredients ? undefined : productionCost,
      ingredients: ingredients || [],
      wastePercentage: wastePercentage || 0,
      isActive: isActive !== false,
      priceValidUntil: suggestion.priceValidUntil,
    });

    res.status(201).json({ ...recipe.toObject(), cost, suggestion });
  } catch (error: any) {
    res.status(500).json({ message: "Error creating recipe", error: error.message });
  }
}

async function computeIngredientsCost(ingredients: Array<{ ingredientId: string; quantity: number }>): Promise<number> {
  const ids = ingredients.map((i) => i.ingredientId);
  const found = await Ingredient.find({ _id: { $in: ids } });
  const costById = new Map(found.map((i) => [i._id.toString(), i.costPrice]));
  return ingredients.reduce((sum, item) => sum + (item.quantity || 0) * (costById.get(item.ingredientId) || 0), 0);
}

export async function estimatePrice(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const companyId = await resolveCompanyId(userId);
    if (!companyId) return res.status(400).json({ message: "Primero registra los datos de tu empresa" });

    const { productionCost, validityDays } = req.body;
    if (productionCost == null) {
      return res.status(400).json({ message: "productionCost is required" });
    }

    const { fixedCost, activeDishCount } = await buildSuggestionContext(companyId);
    const suggestion = computePriceSuggestion({
      cost: Number(productionCost),
      fixedCost,
      activeDishCount: activeDishCount + 1,
      validityDays,
    });

    res.json(suggestion);
  } catch (error: any) {
    res.status(500).json({ message: "Error estimating price", error: error.message });
  }
}

export async function deleteRecipe(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { id } = req.params;
    const recipe = await Recipe.findById(id);
    if (!recipe) return res.status(404).json({ message: "Recipe not found" });

    const companyId = await resolveCompanyId(userId);
    if (companyId && recipe.companyId.toString() !== companyId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await Recipe.findByIdAndDelete(id);
    res.json({ message: "Recipe deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Error deleting recipe", error: error.message });
  }
}

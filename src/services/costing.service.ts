import { IFixedCost, totalMonthlyFixedCost } from "../models/FixedCost.model";

export const DEFAULT_MARGIN_MIN = 0.6; // 60% contribution margin -> lower bound of suggested price
export const DEFAULT_MARGIN_MAX = 0.7; // 70% contribution margin -> upper bound of suggested price
export const DEFAULT_VALIDITY_DAYS = 30; // how many days a suggested/entered price should hold before review

export interface PriceSuggestion {
  cost: number;
  suggestedMinPrice: number;
  suggestedMaxPrice: number;
  monthlyFixedCosts: number;
  fixedCostShare: number;
  monthlyUnitsTarget: number | null;
  validityDays: number;
  priceValidUntil: Date;
}

/**
 * Computes a suggested selling-price range, a monthly sales target, and a price
 * validity window for a single dish, given its production cost and the company's
 * fixed costs (rent, payroll, utilities, internet, insurance, marketing, other).
 *
 * Formula:
 *  - suggestedPrice = cost / (1 - targetMargin)   (margin = (price - cost) / price)
 *  - fixedCostShare = monthlyFixedCosts / activeDishCount   (even split across the active menu)
 *  - monthlyUnitsTarget = ceil(fixedCostShare / (suggestedMinPrice - cost))
 */
export function computePriceSuggestion(params: {
  cost: number;
  fixedCost: Pick<IFixedCost, "rent" | "payroll" | "utilities" | "internet" | "insurance" | "marketing" | "other"> | null;
  activeDishCount: number;
  marginMin?: number;
  marginMax?: number;
  validityDays?: number;
}): PriceSuggestion {
  const { cost } = params;
  const marginMin = params.marginMin ?? DEFAULT_MARGIN_MIN;
  const marginMax = params.marginMax ?? DEFAULT_MARGIN_MAX;
  const validityDays = params.validityDays ?? DEFAULT_VALIDITY_DAYS;

  const suggestedMinPrice = round2(cost / (1 - marginMin));
  const suggestedMaxPrice = round2(cost / (1 - marginMax));

  const monthlyFixedCosts = params.fixedCost ? totalMonthlyFixedCost(params.fixedCost) : 0;
  const activeDishCount = Math.max(1, params.activeDishCount);
  const fixedCostShare = round2(monthlyFixedCosts / activeDishCount);

  const contributionMarginPerUnit = suggestedMinPrice - cost;
  const monthlyUnitsTarget =
    monthlyFixedCosts > 0 && contributionMarginPerUnit > 0
      ? Math.ceil(fixedCostShare / contributionMarginPerUnit)
      : null;

  const priceValidUntil = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

  return {
    cost: round2(cost),
    suggestedMinPrice,
    suggestedMaxPrice,
    monthlyFixedCosts: round2(monthlyFixedCosts),
    fixedCostShare,
    monthlyUnitsTarget,
    validityDays,
    priceValidUntil,
  };
}

/** Cost of a recipe: sum of ingredient line costs if itemized, otherwise the manual productionCost. */
export function computeRecipeCost(recipe: {
  productionCost?: number;
  ingredients?: Array<{ quantity: number; ingredientId: any }>;
}): number {
  if (Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
    return recipe.ingredients.reduce((sum, item) => {
      const ing: any = item.ingredientId;
      const unitCost = ing && typeof ing === "object" ? ing.costPrice || 0 : 0;
      return sum + (item.quantity || 0) * unitCost;
    }, 0);
  }
  return recipe.productionCost || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

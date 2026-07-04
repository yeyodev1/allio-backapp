import mongoose, { Schema, Document } from "mongoose";

interface IRecipeIngredient {
  ingredientId: mongoose.Types.ObjectId;
  quantity: number;
}

export interface IRecipe extends Document {
  companyId: mongoose.Types.ObjectId;
  name: string;
  /** Manual PVP entered by the user, if they already sell this dish. Optional — the app can suggest a price instead. */
  sellingPrice?: number;
  /** Simple total production cost, used when the dish has no itemized ingredients (the "simple costing" flow). */
  productionCost?: number;
  ingredients: IRecipeIngredient[];
  wastePercentage: number;
  isActive: boolean;
  /** Date until which the suggested/entered price should be considered valid before recalculating. */
  priceValidUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const recipeSchema = new Schema<IRecipe>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    sellingPrice: { type: Number, min: 0 },
    productionCost: { type: Number, min: 0 },
    ingredients: [
      {
        ingredientId: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true },
        quantity: { type: Number, required: true },
      },
    ],
    wastePercentage: { type: Number, default: 0, min: 0, max: 100 },
    isActive: { type: Boolean, default: true },
    priceValidUntil: { type: Date },
  },
  { timestamps: true }
);

export const Recipe = mongoose.model<IRecipe>("Recipe", recipeSchema);

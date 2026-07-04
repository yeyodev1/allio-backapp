import express from "express";
import { authMiddleware as authenticate } from "../middlewares/auth.middleware";
import * as costingController from "../controllers/costing.controller";

export const costingRouter = express.Router();

costingRouter.use(authenticate);

// Ingredients
costingRouter.get("/ingredients", costingController.listIngredients);
costingRouter.post("/ingredients", costingController.createIngredient);
costingRouter.delete("/ingredients/:id", costingController.deleteIngredient);

// Recipes
costingRouter.get("/recipes", costingController.listRecipes);
costingRouter.post("/recipes", costingController.createRecipe);
costingRouter.delete("/recipes/:id", costingController.deleteRecipe);

// Price suggestion preview (no persistence) — used for live estimates in onboarding/CostingView
costingRouter.post("/estimate", costingController.estimatePrice);

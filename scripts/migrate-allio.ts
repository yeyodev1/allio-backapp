import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Equipment } from "../src/models/Equipment.model";
import { Branch } from "../src/models/Branch.model";
import { OnboardingProgress } from "../src/models/OnboardingProgress.model";

/**
 * Migración al modelo de traspasos.
 *
 * Es idempotente: se puede correr las veces que haga falta. No borra nada.
 *
 *  1. Rellena `companyId` en los equipos (antes solo colgaban de la sucursal).
 *  2. Les da una custodia inicial: en su local, desde que se crearon.
 *  3. Clasifica los equipos por categoría, deducida de su nombre.
 *  4. Reordena el onboarding a medio hacer al nuevo orden de pasos.
 *
 * Uso:  npm run migrate           (aplica)
 *       npm run migrate -- --dry  (solo informa)
 */

const DRY_RUN = process.argv.includes("--dry");

function log(step: string, message: string) {
  console.log(`${DRY_RUN ? "[dry] " : ""}${step} · ${message}`);
}

/** Los equipos guardaban solo `branchId`; se resuelve su empresa vía la sucursal. */
async function backfillCompanyId() {
  const pending = await Equipment.find({ companyId: { $exists: false } }).select("_id branchId");
  if (pending.length === 0) {
    log("1/4", "companyId: nada que rellenar");
    return;
  }

  const branchIds = [...new Set(pending.map((e) => e.branchId.toString()))];
  const branches = await Branch.find({ _id: { $in: branchIds } }).select("companyId name").lean();
  const branchMap = new Map(branches.map((b) => [b._id.toString(), b]));

  let updated = 0;
  let orphaned = 0;

  for (const equipment of pending) {
    const branch = branchMap.get(equipment.branchId.toString());
    if (!branch) {
      orphaned += 1;
      continue;
    }
    if (!DRY_RUN) {
      await Equipment.updateOne({ _id: equipment._id }, { $set: { companyId: branch.companyId } });
    }
    updated += 1;
  }

  log("1/4", `companyId: ${updated} equipos actualizados${orphaned ? `, ${orphaned} sin sucursal válida` : ""}`);
}

/** Custodia inicial: todo equipo empieza en el local al que pertenece. */
async function backfillCustody() {
  const pending = await Equipment.find({
    $or: [{ custody: { $exists: false } }, { "custody.label": "" }, { "custody.label": null }],
  }).select("_id branchId createdAt custody");

  if (pending.length === 0) {
    log("2/4", "custodia: nada que rellenar");
    return;
  }

  const branchIds = [...new Set(pending.map((e) => e.branchId.toString()))];
  const branches = await Branch.find({ _id: { $in: branchIds } }).select("name").lean();
  const branchMap = new Map(branches.map((b) => [b._id.toString(), b.name]));

  let updated = 0;
  for (const equipment of pending) {
    const label = branchMap.get(equipment.branchId.toString()) || "Local";
    if (!DRY_RUN) {
      await Equipment.updateOne(
        { _id: equipment._id },
        { $set: { custody: { type: "local", label, since: equipment.createdAt || new Date() } } }
      );
    }
    updated += 1;
  }

  log("2/4", `custodia: ${updated} equipos inicializados`);
}

/**
 * Los equipos antiguos no tenían categoría: era un campo nuevo. Se deduce del
 * nombre, que es lo único que hay. Lo que no encaje queda como "otro", que es el
 * valor por defecto del esquema.
 */
const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/congelador|freezer/i, "congelador"],
  [/c[áa]mara/i, "camara_frio"],
  [/vitrina|exhibidor/i, "vitrina"],
  [/nevera|refriger|frigor/i, "nevera"],
  [/enfriador|chiller/i, "enfriador"],
  [/lavadora/i, "lavadora"],
  [/secadora/i, "secadora"],
  [/horno/i, "horno"],
  [/cocina|estufa|fog[óo]n/i, "cocina"],
];

async function backfillCategory() {
  const pending = await Equipment.find({
    $or: [{ category: { $exists: false } }, { category: null }],
  }).select("_id name");

  if (pending.length === 0) {
    log("3/4", "categoría: nada que clasificar");
    return;
  }

  const counts: Record<string, number> = {};
  for (const equipment of pending) {
    const hit = CATEGORY_HINTS.find(([re]) => re.test(equipment.name));
    const category = hit ? hit[1] : "otro";
    counts[category] = (counts[category] || 0) + 1;
    if (!DRY_RUN) {
      await Equipment.updateOne({ _id: equipment._id }, { $set: { category } });
    }
  }

  const detail = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ");
  log("3/4", `categoría: ${pending.length} equipos clasificados (${detail})`);
}

/**
 * El onboarding cambió de orden:
 *   antes  1 Empresa · 2 Sucursal · 3 Costos · 4 Recetas · 5 Equipos · 6 Fin
 *   ahora  1 Empresa · 2 Locales  · 3 Equipos · 4 Técnicos · 5 Costos · 6 Fin
 *
 * Solo se remapean los que están a medias: los completados ya no lo usan.
 * Las recetas del paso 4 antiguo se conservan bajo `legacyRecipes` en lugar de
 * tirarlas, aunque ahora se cargan desde el módulo de Costeo.
 */
async function remapOnboarding() {
  const inFlight = await OnboardingProgress.find({ isComplete: { $ne: true } });
  if (inFlight.length === 0) {
    log("4/4", "onboarding: no hay progresos a medias");
    return;
  }

  let remapped = 0;
  for (const progress of inFlight) {
    const data: any = progress.data || {};
    if (data.__migrated) continue;

    const next: Record<string, unknown> = { __migrated: true };
    if (data.step1) next.step1 = data.step1;
    // La sucursal única pasa a ser una lista de locales.
    if (data.step2) {
      next.step2 = data.step2.branches ? data.step2 : { branches: [data.step2] };
    }
    if (data.step5) next.step3 = data.step5; // equipos: 5 → 3
    if (data.step3) next.step5 = data.step3; // costos fijos: 3 → 5
    if (data.step4) next.legacyRecipes = data.step4;

    const completed = (progress.completedSteps || [])
      .map((s) => (s === 5 ? 3 : s === 3 ? 5 : s === 4 ? null : s))
      .filter((s): s is number => s !== null);

    if (!DRY_RUN) {
      progress.data = next;
      progress.completedSteps = [...new Set(completed)].sort((a, b) => a - b);
      progress.currentStep = Math.min(
        Math.max(1, (progress.completedSteps.at(-1) || 0) + 1),
        6
      );
      await progress.save();
    }
    remapped += 1;
  }

  log("4/4", `onboarding: ${remapped} progresos remapeados`);
}

async function main() {
  const uri = process.env.DB_URI;
  if (!uri) throw new Error("Falta DB_URI en el entorno");

  await mongoose.connect(uri);
  console.log(`Conectado a MongoDB${DRY_RUN ? " (simulación, no se escribe nada)" : ""}\n`);

  await backfillCompanyId();
  await backfillCustody();
  await backfillCategory();
  await remapOnboarding();

  console.log("\nMigración terminada.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("La migración falló:", error);
  await mongoose.disconnect();
  process.exit(1);
});

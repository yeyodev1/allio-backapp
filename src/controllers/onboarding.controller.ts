import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as onboardingService from "../services/onboarding.service";
import { TOTAL_STEPS } from "../services/onboarding.service";
import { Company } from "../models/Company.model";
import { Branch } from "../models/Branch.model";
import { Equipment } from "../models/Equipment.model";
import { FixedCost } from "../models/FixedCost.model";
import { User } from "../models/User.model";
import { parseCoordinates } from "../models/geo.schema";

/**
 * Onboarding. Cada paso escribe de verdad en su colección, no solo en el
 * documento de progreso, para que el usuario pueda abandonar a mitad y volver
 * con lo que ya había cargado.
 *
 * Todos los pasos son idempotentes: reenviar el mismo paso actualiza en lugar de
 * duplicar. Antes hacían `create` y volver atrás en el asistente dejaba equipos
 * repetidos.
 */

type StepHandler = (userId: string, data: any) => Promise<void>;

async function requireCompany(userId: string) {
  const company = await Company.findOne({ userId });
  if (!company) throw new Error("Primero registra los datos de la empresa");
  return company;
}

/** Paso 1 · Empresa */
const saveCompany: StepHandler = async (userId, data) => {
  const { legalName, commercialName, ruc, country, city, businessStage } = data;
  if (!legalName?.trim()) throw new Error("El nombre legal es obligatorio");
  if (!ruc?.trim()) throw new Error("El RUC es obligatorio");

  const company = await Company.findOneAndUpdate(
    { userId },
    {
      $set: {
        userId,
        legalName: legalName.trim(),
        commercialName: commercialName?.trim() || "",
        ruc: ruc.trim(),
        country: country?.trim() || "",
        city: city?.trim() || "",
        ...(businessStage ? { businessStage } : {}),
      },
    },
    { upsert: true, new: true }
  );

  await User.findByIdAndUpdate(userId, { $addToSet: { workspaceIds: company._id } });
};

/** Paso 2 · Locales. Acepta varios; el primero queda como principal. */
const saveBranches: StepHandler = async (userId, data) => {
  const company = await requireCompany(userId);

  const incoming: any[] = Array.isArray(data.branches)
    ? data.branches
    : data.name
      ? [data] // compatibilidad con el formato antiguo de una sola sucursal
      : [];

  const named = incoming.filter((b) => b?.name?.trim());
  if (named.length === 0) throw new Error("Registra al menos un local");

  for (const [index, branch] of named.entries()) {
    await Branch.findOneAndUpdate(
      { companyId: company._id, name: branch.name.trim() },
      {
        $set: {
          companyId: company._id,
          name: branch.name.trim(),
          address: branch.address?.trim() || "",
          phone: branch.phone?.trim() || "",
          isMain: index === 0,
          isActive: true,
          // Punto en el mapa. Sin él no se puede medir si una revisión se hizo
          // en el local, así que se acepta ya desde el onboarding.
          ...(parseCoordinates(branch.coordinates)
            ? { coordinates: parseCoordinates(branch.coordinates) }
            : {}),
        },
      },
      { upsert: true, new: true }
    );
  }
};

/** Paso 3 · Equipos. Se identifican por número de serie, y si no lo hay, por nombre. */
const saveEquipment: StepHandler = async (userId, data) => {
  const company = await requireCompany(userId);
  const branches = await Branch.find({ companyId: company._id }).sort({ isMain: -1, createdAt: 1 });
  if (branches.length === 0) throw new Error("Registra primero un local");

  const items: any[] = data.equipment || data.equipments || [];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agrega al menos un equipo");
  }

  const byName = new Map(branches.map((b) => [b.name, b]));
  const fallbackBranch = branches[0]!;

  for (const item of items) {
    if (!item?.name?.trim()) throw new Error("Cada equipo necesita un nombre");

    const branch = (item.branchName && byName.get(item.branchName)) || fallbackBranch;
    const key = item.serialNumber?.trim()
      ? { companyId: company._id, serialNumber: item.serialNumber.trim() }
      : { branchId: branch._id, name: item.name.trim() };

    await Equipment.findOneAndUpdate(
      key,
      {
        $set: {
          branchId: branch._id,
          companyId: company._id,
          name: item.name.trim(),
          category: item.category || "otro",
          brand: item.brand?.trim() || "",
          modelName: item.modelName?.trim() || item.model?.trim() || "",
          serialNumber: item.serialNumber?.trim() || "",
          purchaseDate: item.purchaseDate ? new Date(item.purchaseDate) : new Date(),
          historicalCost: Number(item.historicalCost) || 0,
          usefulLife: Number(item.usefulLife) || 10,
          maintenanceIntervalDays: Number(item.maintenanceIntervalDays) || 90,
          ...(item.targetTemperatureC != null
            ? { targetTemperatureC: Number(item.targetTemperatureC) }
            : {}),
          custody: { type: "local", label: branch.name, since: new Date() },
        },
        $setOnInsert: { status: "operativo" },
      },
      { upsert: true, new: true }
    );
  }
};

/** Paso 4 · Técnicos. Se identifican por correo; reenviar el paso no los duplica. */
const saveTechnicians: StepHandler = async (userId, data) => {
  const company = await requireCompany(userId);
  const people: any[] = data.technicians || data.members || [];
  if (!Array.isArray(people)) return;

  for (const person of people) {
    const email = String(person?.email || "").trim().toLowerCase();
    const name = String(person?.name || "").trim();
    if (!email || !name) continue;
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error(`El correo "${email}" no es válido`);

    const role = person.role === "supervisor" ? "supervisor" : "operador";
    const existing = await User.findOne({ email });

    if (existing) {
      // Ya existe: se le da acceso a este espacio de trabajo sin tocar su contraseña.
      await User.findByIdAndUpdate(existing._id, {
        $addToSet: { workspaceIds: company._id },
        $set: { role: existing.role === "admin" ? existing.role : role },
      });
      continue;
    }

    if (!person.password || String(person.password).length < 6) {
      throw new Error(`Define una contraseña de al menos 6 caracteres para ${name}`);
    }

    // Los crea el administrador, así que entran verificados: no hay correo que confirmar.
    await User.create({
      name,
      email,
      password: String(person.password),
      role,
      isVerified: true,
      workspaceIds: [company._id],
    });
  }
};

/** Paso 5 · Costos fijos. Opcional: alimenta el módulo de Costeo. */
const saveFixedCosts: StepHandler = async (userId, data) => {
  const company = await requireCompany(userId);
  if (data.skipped) return;

  await FixedCost.findOneAndUpdate(
    { companyId: company._id },
    {
      $set: {
        companyId: company._id,
        rent: Number(data.rent) || 0,
        payroll: Number(data.payroll) || 0,
        utilities: Number(data.utilities) || 0,
        internet: Number(data.internet) || 0,
        insurance: Number(data.insurance) || 0,
        marketing: Number(data.marketing) || 0,
        other: Number(data.other) || 0,
        effectiveDate: new Date(),
      },
    },
    { upsert: true, new: true }
  );
};

/** Paso 6 · Finalizar */
const finish: StepHandler = async (userId) => {
  await Company.findOneAndUpdate({ userId }, { $set: { onboardingCompleted: true } });
  await onboardingService.completeOnboarding(userId);
};

const handlers: Record<number, StepHandler> = {
  1: saveCompany,
  2: saveBranches,
  3: saveEquipment,
  4: saveTechnicians,
  5: saveFixedCosts,
  6: finish,
};

export async function saveOnboardingStep(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const step = Number(req.body.step);
    const data = req.body.data;

    if (!step || step < 1 || step > TOTAL_STEPS) {
      res.status(400).json({ message: `El paso debe estar entre 1 y ${TOTAL_STEPS}` });
      return;
    }
    if (!data || typeof data !== "object") {
      res.status(400).json({ message: "Faltan los datos del paso" });
      return;
    }

    await handlers[step]!(userId, data);
    await onboardingService.saveStep(userId, step, data);

    res.json({ message: `Paso ${step} guardado`, step });
  } catch (error: any) {
    // Los errores de validación de los handlers son mensajes para el usuario,
    // no fallos del servidor.
    res.status(400).json({ message: error.message || "Error al guardar el paso" });
  }
}

export async function getOnboardingProgress(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const [company, progress] = await Promise.all([
      Company.findOne({ userId }),
      onboardingService.getProgress(userId),
    ]);

    const branches = company ? await Branch.countDocuments({ companyId: company._id }) : 0;
    const equipment = company ? await Equipment.countDocuments({ companyId: company._id }) : 0;

    res.json({
      currentStep: progress?.currentStep || 1,
      completedSteps: progress?.completedSteps || [],
      totalSteps: TOTAL_STEPS,
      isComplete: Boolean(progress?.isComplete || company?.onboardingCompleted),
      hasCompany: Boolean(company),
      companyName: company?.commercialName || company?.legalName || null,
      businessStage: company?.businessStage || null,
      counts: { branches, equipment },
      data: progress?.data || {},
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching onboarding progress", error: error.message });
  }
}

export async function completeOnboarding(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    await finish(userId, {});
    res.json({ message: "Onboarding completado" });
  } catch (error: any) {
    res.status(500).json({ message: "Error completing onboarding", error: error.message });
  }
}

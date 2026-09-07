import mongoose from "mongoose";
import { User } from "../models/User.model";
import { Company } from "../models/Company.model";
import { Branch } from "../models/Branch.model";

/**
 * Resolución de alcance (qué empresa y qué sucursales puede tocar un usuario).
 *
 * Antes cada controlador resolvía esto a su manera: unos buscaban la empresa por
 * `{ userId }` y otros por pertenencia en `workspaceIds`, así que un mismo usuario
 * podía caer en empresas distintas según el endpoint. Todo pasa ahora por aquí.
 */

export type ObjectIdLike = mongoose.Types.ObjectId | string;

/** Todas las empresas del usuario: las que administra y aquellas a las que pertenece. */
export async function resolveCompanyIds(userId: string): Promise<mongoose.Types.ObjectId[]> {
  const user = await User.findById(userId).select("workspaceIds").lean();
  if (!user) return [];

  const ids = new Map<string, mongoose.Types.ObjectId>();
  for (const id of user.workspaceIds || []) {
    ids.set(id.toString(), id as mongoose.Types.ObjectId);
  }

  const owned = await Company.findOne({ userId }).select("_id").lean();
  if (owned) ids.set(owned._id.toString(), owned._id as mongoose.Types.ObjectId);

  return Array.from(ids.values());
}

/** La empresa activa del usuario. La que administra tiene prioridad. */
export async function resolveCompany(userId: string) {
  const owned = await Company.findOne({ userId });
  if (owned) return owned;

  const ids = await resolveCompanyIds(userId);
  if (ids.length === 0) return null;
  return Company.findById(ids[0]);
}

export async function resolveCompanyId(userId: string): Promise<mongoose.Types.ObjectId | null> {
  const company = await resolveCompany(userId);
  return company ? (company._id as mongoose.Types.ObjectId) : null;
}

/** Sucursales visibles para el usuario, en todas sus empresas. */
export async function listUserBranches(userId: string) {
  const companyIds = await resolveCompanyIds(userId);
  if (companyIds.length === 0) return [];
  return Branch.find({ companyId: { $in: companyIds } }).sort({ isMain: -1, name: 1 });
}

export async function listUserBranchIds(userId: string): Promise<mongoose.Types.ObjectId[]> {
  const branches = await listUserBranches(userId);
  return branches.map((b) => b._id as mongoose.Types.ObjectId);
}

/** Devuelve la sucursal solo si el usuario tiene acceso a ella. */
export async function findUserBranch(userId: string, branchId: ObjectIdLike) {
  if (!mongoose.isValidObjectId(branchId)) return null;
  const companyIds = await resolveCompanyIds(userId);
  if (companyIds.length === 0) return null;
  return Branch.findOne({ _id: branchId, companyId: { $in: companyIds } });
}

export async function isUserBranch(userId: string, branchId: ObjectIdLike): Promise<boolean> {
  return Boolean(await findUserBranch(userId, branchId));
}

/** Sucursal por defecto cuando la petición no especifica una. */
export async function resolveDefaultBranchId(
  userId: string,
  requestedBranchId?: string
): Promise<string | null> {
  if (requestedBranchId) return requestedBranchId;

  const companyId = await resolveCompanyId(userId);
  if (!companyId) return null;

  const branch =
    (await Branch.findOne({ companyId, isMain: true })) ||
    (await Branch.findOne({ companyId }).sort({ createdAt: 1 }));
  return branch ? branch._id.toString() : null;
}

export async function userHasRole(userId: string, roles: string[]): Promise<boolean> {
  const user = await User.findById(userId).select("role").lean();
  return Boolean(user && roles.includes(user.role));
}

/** Compañeros de espacio de trabajo: técnicos y supervisores a los que se puede asignar un equipo. */
export async function listWorkspaceUsers(userId: string) {
  const companyIds = await resolveCompanyIds(userId);
  if (companyIds.length === 0) return [];

  const companies = await Company.find({ _id: { $in: companyIds } }).select("userId").lean();
  const ownerIds = companies.map((c) => c.userId);

  return User.find({
    $or: [{ _id: { $in: ownerIds } }, { workspaceIds: { $in: companyIds } }],
  })
    .select("name email role")
    .sort({ name: 1 });
}

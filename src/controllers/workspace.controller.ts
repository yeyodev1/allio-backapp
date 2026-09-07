import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { Company } from "../models/Company.model";
import { Branch } from "../models/Branch.model";
import { User } from "../models/User.model";
import { Equipment } from "../models/Equipment.model";
import { parseCoordinates } from "../models/geo.schema";

const memberRoles = ["supervisor", "operador"] as const;

async function getOwnedWorkspace(userId: string) {
  const user = await User.findById(userId);
  if (!user || user.role !== "admin") return null;
  const company = await Company.findOne({ userId: user._id });
  return company ? { user, company } : null;
}

function resolveCompanyIds(user: any): string[] {
  const fromWorkspace = (user.workspaceIds || []).map((id: any) => id.toString());
  const fromCompanyId = user.companyId ? [user.companyId] : [];
  const union = new Set([...fromWorkspace, ...fromCompanyId]);
  return Array.from(union);
}

export async function getWorkspaces(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const user = await User.findById(userId);
    if (!user) { res.status(404).json({ message: "User not found" }); return; }

    const ids = resolveCompanyIds(user);
    const companies = await Company.find({ _id: { $in: ids } }).lean();

    const workspaces = await Promise.all(
      companies.map(async (c) => {
        const branches = await Branch.find({ companyId: c._id }).lean();
        return {
          id: c._id,
          legalName: c.legalName,
          commercialName: c.commercialName,
          ruc: c.ruc,
          country: c.country,
          city: c.city,
          onboardingCompleted: c.onboardingCompleted,
          branches: branches.map((b) => ({
            id: b._id,
            name: b.name,
            address: b.address,
            phone: b.phone,
            isMain: b.isMain,
            coordinates: b.coordinates,
          })),
        };
      })
    );

    res.json({ workspaces, count: workspaces.length });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching workspaces", error: error.message });
  }
}

export async function getCurrentWorkspace(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

    const user = await User.findById(userId);
    if (!user) { res.status(404).json({ message: "User not found" }); return; }

    const ids = resolveCompanyIds(user);
    if (ids.length === 0) {
      const companyByUser = await Company.findOne({ userId }).lean();
      if (!companyByUser) { res.json({ workspace: null }); return; }
      const branches = await Branch.find({ companyId: companyByUser._id }).lean();
      res.json({
        workspace: {
          id: companyByUser._id,
          legalName: companyByUser.legalName,
          commercialName: companyByUser.commercialName,
          ruc: companyByUser.ruc,
          country: companyByUser.country,
          city: companyByUser.city,
          onboardingCompleted: companyByUser.onboardingCompleted,
          branches: branches.map((b) => ({ id: b._id, name: b.name, address: b.address, phone: b.phone, isMain: b.isMain, coordinates: b.coordinates })),
        },
      });
      return;
    }

    const company = await Company.findById(ids[0]).lean();
    if (!company) { res.json({ workspace: null }); return; }

    const branches = await Branch.find({ companyId: company._id }).lean();

    res.json({
      workspace: {
        id: company._id,
        legalName: company.legalName,
        commercialName: company.commercialName,
        ruc: company.ruc,
        country: company.country,
        city: company.city,
        onboardingCompleted: company.onboardingCompleted,
        branches: branches.map((b) => ({
          id: b._id,
          name: b.name,
          address: b.address,
          phone: b.phone,
          isMain: b.isMain,
          coordinates: b.coordinates,
        })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching workspace", error: error.message });
  }
}

export async function listWorkspaceMembers(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    // Un admin que aún no ha creado su empresa no es un caso de permiso denegado:
    // todavía no hay equipo que listar. Devolver 403 confundía la pantalla entera.
    const access = await getOwnedWorkspace(userId);
    if (!access) {
      const self = await User.findById(userId).select("name email role isVerified createdAt").lean();
      res.json({
        members: self && self.role === "admin"
          ? [{ id: self._id, name: self.name, email: self.email, role: self.role,
               isVerified: self.isVerified, isOwner: true, createdAt: self.createdAt }]
          : [],
        needsCompany: true,
      });
      return;
    }

    const members = await User.find({
      $or: [{ _id: access.company.userId }, { workspaceIds: access.company._id }],
    })
      .select("name email role isVerified createdAt")
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      members: members.map((member) => ({
        id: member._id,
        name: member.name,
        email: member.email,
        role: member.role,
        isVerified: member.isVerified,
        isOwner: member._id.toString() === access.company.userId.toString(),
        createdAt: member.createdAt,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error listing workspace members", error: error.message });
  }
}

export async function createWorkspaceMember(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getOwnedWorkspace(userId);
    if (!access) { res.status(403).json({ message: "Primero registra los datos de tu empresa para poder añadir personas" }); return; }

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = String(req.body.role || "");
    if (!name || !email || !password || !role) {
      res.status(400).json({ message: "Nombre, correo, contraseña y rol son obligatorios" });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ message: "Ingresa un correo electrónico válido" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
      return;
    }
    if (!memberRoles.includes(role as any)) {
      res.status(400).json({ message: "El rol debe ser supervisor u operador" });
      return;
    }
    if (await User.exists({ email })) {
      res.status(409).json({ message: "Este correo ya está registrado" });
      return;
    }

    const member = await User.create({
      name,
      email,
      password,
      role,
      isVerified: true,
      workspaceIds: [access.company._id],
    });
    res.status(201).json({
      member: {
        id: member._id,
        name: member.name,
        email: member.email,
        role: member.role,
        isVerified: member.isVerified,
        isOwner: false,
        createdAt: member.createdAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error creating workspace member", error: error.message });
  }
}

export async function updateWorkspaceMember(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getOwnedWorkspace(userId);
    if (!access) { res.status(403).json({ message: "Only the workspace administrator can update members" }); return; }
    if (req.params.memberId === access.company.userId.toString()) {
      res.status(400).json({ message: "No puedes cambiar el rol del propietario" });
      return;
    }

    const role = String(req.body.role || "");
    if (!memberRoles.includes(role as any)) {
      res.status(400).json({ message: "El rol debe ser supervisor u operador" });
      return;
    }
    const member = await User.findOneAndUpdate(
      { _id: req.params.memberId, workspaceIds: access.company._id },
      { role },
      { new: true, runValidators: true }
    ).select("name email role isVerified createdAt");
    if (!member) { res.status(404).json({ message: "Miembro no encontrado" }); return; }
    res.json({ member });
  } catch (error: any) {
    res.status(500).json({ message: "Error updating workspace member", error: error.message });
  }
}

export async function removeWorkspaceMember(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getOwnedWorkspace(userId);
    if (!access) { res.status(403).json({ message: "Only the workspace administrator can remove members" }); return; }
    if (req.params.memberId === access.company.userId.toString()) {
      res.status(400).json({ message: "No puedes retirar al propietario del workspace" });
      return;
    }

    const member = await User.findOneAndUpdate(
      { _id: req.params.memberId, workspaceIds: access.company._id },
      { $pull: { workspaceIds: access.company._id } },
      { new: true }
    );
    if (!member) { res.status(404).json({ message: "Miembro no encontrado" }); return; }
    res.json({ message: "Acceso retirado correctamente" });
  } catch (error: any) {
    res.status(500).json({ message: "Error removing workspace member", error: error.message });
  }
}

/**
 * CRUD de locales.
 *
 * Antes la pantalla de configuración creaba y borraba locales a través de
 * `/api/tiendas`, que escribe en el modelo legacy `Tienda` — el que no cuelga de
 * `Company`. Resultado: locales que existían para la configuración pero no para
 * los equipos. Estos endpoints trabajan sobre `Branch`, que es el modelo real.
 */

export async function createBranch(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getOwnedWorkspace(userId);
    if (!access) { res.status(403).json({ message: "Solo el administrador puede gestionar locales" }); return; }

    const name = String(req.body.name || "").trim();
    if (!name) { res.status(400).json({ message: "El nombre del local es obligatorio" }); return; }

    if (await Branch.exists({ companyId: access.company._id, name })) {
      res.status(409).json({ message: "Ya tienes un local con ese nombre" });
      return;
    }

    // El primer local de la empresa queda como principal sin preguntar.
    const isFirst = (await Branch.countDocuments({ companyId: access.company._id })) === 0;

    const branch = await Branch.create({
      companyId: access.company._id,
      name,
      address: String(req.body.address || "").trim(),
      phone: String(req.body.phone || "").trim(),
      isMain: isFirst,
      isActive: true,
      // Sin estas coordenadas no se puede saber si una revisión se hizo en el local.
      coordinates: parseCoordinates(req.body.coordinates) || undefined,
    });

    res.status(201).json({ branch });
  } catch (error: any) {
    res.status(500).json({ message: "Error creating branch", error: error.message });
  }
}

export async function updateBranch(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getOwnedWorkspace(userId);
    if (!access) { res.status(403).json({ message: "Solo el administrador puede gestionar locales" }); return; }

    const branch = await Branch.findOne({ _id: req.params.id, companyId: access.company._id });
    if (!branch) { res.status(404).json({ message: "El local no existe" }); return; }

    if (req.body.name !== undefined) branch.name = String(req.body.name).trim();
    if (req.body.address !== undefined) branch.address = String(req.body.address).trim();
    if (req.body.phone !== undefined) branch.phone = String(req.body.phone).trim();
    if (req.body.coordinates !== undefined) {
      const coords = parseCoordinates(req.body.coordinates);
      if (coords) branch.coordinates = coords;
      else branch.set("coordinates", undefined);
    }

    // Principal es exclusivo: marcar uno desmarca el anterior.
    if (req.body.isMain === true) {
      await Branch.updateMany({ companyId: access.company._id }, { $set: { isMain: false } });
      branch.isMain = true;
    }

    await branch.save();
    res.json({ branch });
  } catch (error: any) {
    res.status(500).json({ message: "Error updating branch", error: error.message });
  }
}

export async function deleteBranch(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getOwnedWorkspace(userId);
    if (!access) { res.status(403).json({ message: "Solo el administrador puede gestionar locales" }); return; }

    const branch = await Branch.findOne({ _id: req.params.id, companyId: access.company._id });
    if (!branch) { res.status(404).json({ message: "El local no existe" }); return; }

    // Borrar un local con equipos dejaría máquinas huérfanas y sin historial
    // accesible. Se bloquea y se le dice al usuario qué hacer.
    const equipmentCount = await Equipment.countDocuments({ branchId: branch._id });
    if (equipmentCount > 0) {
      res.status(409).json({
        message: `Este local tiene ${equipmentCount} equipo(s). Traspásalos a otro local antes de eliminarlo.`,
      });
      return;
    }

    const wasMain = branch.isMain;
    await Branch.deleteOne({ _id: branch._id });

    // Si se borró el principal, el más antiguo que quede toma el relevo.
    if (wasMain) {
      const next = await Branch.findOne({ companyId: access.company._id }).sort({ createdAt: 1 });
      if (next) { next.isMain = true; await next.save(); }
    }

    res.json({ message: "Local eliminado" });
  } catch (error: any) {
    res.status(500).json({ message: "Error deleting branch", error: error.message });
  }
}

/** Datos de la empresa (nombre, RUC, ciudad). */
export async function updateCompany(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getOwnedWorkspace(userId);
    if (!access) { res.status(403).json({ message: "Solo el administrador puede editar la empresa" }); return; }

    const { legalName, commercialName, ruc, country, city } = req.body;
    if (legalName !== undefined && !String(legalName).trim()) {
      res.status(400).json({ message: "El nombre legal no puede quedar vacío" });
      return;
    }

    const update: Record<string, string> = {};
    if (legalName !== undefined) update.legalName = String(legalName).trim();
    if (commercialName !== undefined) update.commercialName = String(commercialName).trim();
    if (ruc !== undefined) update.ruc = String(ruc).trim();
    if (country !== undefined) update.country = String(country).trim();
    if (city !== undefined) update.city = String(city).trim();

    const company = await Company.findByIdAndUpdate(access.company._id, { $set: update }, { new: true });
    res.json({ company });
  } catch (error: any) {
    res.status(500).json({ message: "Error updating company", error: error.message });
  }
}

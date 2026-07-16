import { Branch } from "../models/Branch.model";
import { Company } from "../models/Company.model";
import { User } from "../models/User.model";
import { sendMaintenanceMovementEmail } from "./email.service";

interface MovementNotificationInput {
  actorUserId: string;
  branchId: string;
  equipmentId: string;
  equipmentName: string;
  action: string;
  details: Array<{ label: string; value: unknown }>;
}

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  operador: "Operador",
};

export async function notifyMaintenanceMovement(input: MovementNotificationInput) {
  try {
    const [actor, branch] = await Promise.all([
      User.findById(input.actorUserId).select("name email role").lean(),
      Branch.findById(input.branchId).select("name companyId").lean(),
    ]);
    if (!actor || !branch) return;

    const company = await Company.findById(branch.companyId).select("userId").lean();
    if (!company) return;
    const admins = await User.find({
      role: "admin",
      $or: [{ _id: company.userId }, { workspaceIds: company._id }],
    }).select("email").lean();

    const frontendUrl = (process.env.FRONTEND_URL || "https://rentabilidad360.netlify.app").replace(/\/$/, "");
    await sendMaintenanceMovementEmail({
      recipients: [actor.email, ...admins.map((admin) => admin.email)],
      action: input.action,
      actorName: actor.name,
      actorEmail: actor.email,
      actorRole: roleLabels[actor.role] || actor.role,
      equipmentName: input.equipmentName,
      branchName: branch.name,
      occurredAt: new Date(),
      details: input.details,
      equipmentUrl: `${frontendUrl}/modulo/mantenimiento/${input.equipmentId}`,
    });
  } catch (error) {
    console.error("[Maintenance email] Notification failed:", error);
  }
}

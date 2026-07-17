import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const DB_URI = process.env.DB_URI;
if (!DB_URI) {
  console.error("❌ DB_URI not set in .env");
  process.exit(1);
}

async function run() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("❌ Usage:");
    console.error("   pnpm delete-user <email>");
    console.error("   npx ts-node --compiler-options '{\"rootDir\":\".\"}' scripts/delete-user.ts <email>");
    process.exit(1);
  }

  await mongoose.connect(DB_URI!);
  console.log(`🔍 Looking up user: ${email}`);

  // Dynamic import — models must be loaded after connection
  const User = (await import("../src/models/User.model")).User;
  const Company = (await import("../src/models/Company.model")).Company;
  const Branch = (await import("../src/models/Branch.model")).Branch;
  const BranchHours = (await import("../src/models/BranchHours.model")).BranchHours;
  const Equipment = (await import("../src/models/Equipment.model")).Equipment;
  const MaintenanceTicket = (await import("../src/models/MaintenanceTicket.model")).MaintenanceTicket;
  const FixedCost = (await import("../src/models/FixedCost.model")).FixedCost;
  const Ingredient = (await import("../src/models/Ingredient.model")).Ingredient;
  const Recipe = (await import("../src/models/Recipe.model")).Recipe;
  const OnboardingProgress = (await import("../src/models/OnboardingProgress.model")).OnboardingProgress;
  const Tienda = (await import("../src/models/Tienda.model")).Tienda;
  const Plant = (await import("../src/models/Plant.model")).Plant;
  const SupervisionTemplate = (await import("../src/models/SupervisionTemplate.model")).SupervisionTemplate;
  const SupervisionSubmission = (await import("../src/models/SupervisionSubmission.model")).SupervisionSubmission;

  const user = await User.findOne({ email });
  if (!user) {
    console.log(`❌ No user found with email: ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const userId = user._id.toString();
  const workspaceIds = (user as any).workspaceIds || [];
  console.log(`✅ Found user: ${user.name || email} (${userId})`);
  console.log(`   Companies: ${workspaceIds.length}\n`);

  const deleted: string[] = [];
  let companyId: string | null = null;

  // 1. Find Company
  const company = await Company.findOne({ userId });
  if (company) {
    companyId = company._id.toString();
    console.log(`🏢 Company found: ${company.legalName || company.commercialName || companyId}`);

    const branches = await Branch.find({ companyId });
    const branchIds = branches.map((b: any) => b._id.toString());

    // 2. Delete Branch-level data
    if (branchIds.length > 0) {
      const bh = await BranchHours.deleteMany({ branchId: { $in: branchIds } });
      if (bh.deletedCount) { deleted.push(`BranchHours (${bh.deletedCount})`); console.log(`   🗑 BranchHours: ${bh.deletedCount}`); }

      const eq = await Equipment.deleteMany({ branchId: { $in: branchIds } });
      if (eq.deletedCount) { deleted.push(`Equipment (${eq.deletedCount})`); console.log(`   🗑 Equipment: ${eq.deletedCount}`); }
    }

    // 3. Delete Equipment-level data (MaintenanceTickets)
    const eqList = await Equipment.find({ branchId: { $in: branchIds } });
    const eqIds = eqList.map((e: any) => e._id.toString());
    if (eqIds.length > 0) {
      const mt = await MaintenanceTicket.deleteMany({ equipmentId: { $in: eqIds } });
      if (mt.deletedCount) { deleted.push(`MaintenanceTicket (${mt.deletedCount})`); console.log(`   🗑 MaintenanceTicket: ${mt.deletedCount}`); }
    }

    // Also delete MaintenanceTickets reported by this user
    const mtUser = await MaintenanceTicket.deleteMany({ reportedBy: userId });
    if (mtUser.deletedCount) {
      deleted.push(`MaintenanceTicket.reportedBy (${mtUser.deletedCount})`);
      console.log(`   🗑 MaintenanceTicket (reportedBy): ${mtUser.deletedCount}`);
    }

    // 4. Delete Company-level data
    const fc = await FixedCost.deleteMany({ companyId });
    if (fc.deletedCount) { deleted.push(`FixedCost (${fc.deletedCount})`); console.log(`   🗑 FixedCost: ${fc.deletedCount}`); }

    const ig = await Ingredient.deleteMany({ companyId });
    if (ig.deletedCount) { deleted.push(`Ingredient (${ig.deletedCount})`); console.log(`   🗑 Ingredient: ${ig.deletedCount}`); }

    const rc = await Recipe.deleteMany({ companyId });
    if (rc.deletedCount) { deleted.push(`Recipe (${rc.deletedCount})`); console.log(`   🗑 Recipe: ${rc.deletedCount}`); }

    const ss = await SupervisionSubmission.deleteMany({ companyId });
    if (ss.deletedCount) { deleted.push(`SupervisionSubmission (${ss.deletedCount})`); console.log(`   🗑 SupervisionSubmission: ${ss.deletedCount}`); }

    const st = await SupervisionTemplate.deleteMany({ companyId });
    if (st.deletedCount) { deleted.push(`SupervisionTemplate (${st.deletedCount})`); console.log(`   🗑 SupervisionTemplate: ${st.deletedCount}`); }

    const pl = await Plant.deleteMany({ companyId });
    if (pl.deletedCount) { deleted.push(`Plant (${pl.deletedCount})`); console.log(`   🗑 Plant: ${pl.deletedCount}`); }

    // 5. Delete branches
    const br = await Branch.deleteMany({ companyId });
    if (br.deletedCount) { deleted.push(`Branch (${br.deletedCount})`); console.log(`   🗑 Branch: ${br.deletedCount}`); }

    // 6. Delete Company
    await Company.findByIdAndDelete(companyId);
    deleted.push("Company");
    console.log("   🗑 Company: 1");
  }

  // 7. Delete User-level data (string-referenced)
  const op = await OnboardingProgress.deleteMany({ userId });
  if (op.deletedCount) { deleted.push(`OnboardingProgress (${op.deletedCount})`); console.log(`   🗑 OnboardingProgress: ${op.deletedCount}`); }

  const td = await Tienda.deleteMany({ userId });
  if (td.deletedCount) { deleted.push(`Tienda (${td.deletedCount})`); console.log(`   🗑 Tienda: ${td.deletedCount}`); }

  // 8. Finally delete User
  await User.findByIdAndDelete(userId);
  deleted.push("User");
  console.log("   🗑 User: 1\n");
  console.log("✅ Done! Deleted:");
  deleted.forEach((d) => console.log(`   • ${d}`));
  console.log(`\n📧 ${email} and all related data have been removed.`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Error:", err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});

/**
 * reset-all-users.ts
 *
 * Borra TODOS los usuarios y toda su data relacionada,
 * luego los recrea con sus credenciales originales (email, nombre, role)
 * y password = "123456789" (isVerified = true).
 *
 * USO:
 *   pnpm ts-node --compiler-options '{"rootDir":"."}' scripts/reset-all-users.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const DB_URI = process.env.DB_URI;
if (!DB_URI) {
  console.error("❌ DB_URI no está definido en .env");
  process.exit(1);
}

async function run() {
  await mongoose.connect(DB_URI!);
  console.log("✅ Conectado a MongoDB\n");

  // Cargar modelos después de conectar
  const { User } = await import("../src/models/User.model");
  const { Company } = await import("../src/models/Company.model");
  const { Branch } = await import("../src/models/Branch.model");
  const { BranchHours } = await import("../src/models/BranchHours.model");
  const { Equipment } = await import("../src/models/Equipment.model");
  const { MaintenanceTicket } = await import("../src/models/MaintenanceTicket.model");
  const { FixedCost } = await import("../src/models/FixedCost.model");
  const { Ingredient } = await import("../src/models/Ingredient.model");
  const { Recipe } = await import("../src/models/Recipe.model");
  const { OnboardingProgress } = await import("../src/models/OnboardingProgress.model");
  const { Tienda } = await import("../src/models/Tienda.model");

  // 1. Guardar credenciales de todos los usuarios
  const users = await User.find({}).lean();
  if (users.length === 0) {
    console.log("⚠️  No hay usuarios en la base de datos.");
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`👥 Usuarios encontrados: ${users.length}`);
  const snapshot = users.map((u: any) => ({
    name: u.name,
    email: u.email,
    role: u.role ?? "admin",
  }));
  snapshot.forEach((u) => console.log(`   • ${u.email} (${u.role})`));
  console.log();

  // 2. Borrar TODA la data de TODAS las colecciones
  console.log("🗑  Borrando toda la data...");

  const mt1 = await MaintenanceTicket.deleteMany({});
  console.log(`   MaintenanceTicket: ${mt1.deletedCount}`);

  const eq = await Equipment.deleteMany({});
  console.log(`   Equipment: ${eq.deletedCount}`);

  const bh = await BranchHours.deleteMany({});
  console.log(`   BranchHours: ${bh.deletedCount}`);

  const br = await Branch.deleteMany({});
  console.log(`   Branch: ${br.deletedCount}`);

  const rc = await Recipe.deleteMany({});
  console.log(`   Recipe: ${rc.deletedCount}`);

  const ig = await Ingredient.deleteMany({});
  console.log(`   Ingredient: ${ig.deletedCount}`);

  const fc = await FixedCost.deleteMany({});
  console.log(`   FixedCost: ${fc.deletedCount}`);

  const td = await Tienda.deleteMany({});
  console.log(`   Tienda: ${td.deletedCount}`);

  const op = await OnboardingProgress.deleteMany({});
  console.log(`   OnboardingProgress: ${op.deletedCount}`);

  const co = await Company.deleteMany({});
  console.log(`   Company: ${co.deletedCount}`);

  const us = await User.deleteMany({});
  console.log(`   User: ${us.deletedCount}`);

  console.log();

  // 3. Recrear usuarios con password "123456789"
  console.log("✨ Recreando usuarios con password 123456789...");
  for (const snap of snapshot) {
    const newUser = new User({
      name: snap.name,
      email: snap.email,
      password: "123456789",
      role: snap.role,
      isVerified: true,
      verificationCode: null,
      verificationCodeExpires: null,
    });
    await newUser.save(); // el pre-save hook hashea el password
    console.log(`   ✅ ${snap.email} recreado`);
  }

  console.log("\n🎉 Listo! Todos los usuarios fueron reseteados.");
  console.log("   Password para todos: 123456789");
  console.log("   isVerified: true (no necesitan verificar email)\n");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Error:", err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});

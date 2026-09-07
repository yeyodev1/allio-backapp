import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../models/User.model";
import { Company } from "../models/Company.model";
import { sendVerificationCode, sendWelcomeEmail, isEmailConfigured } from "../services/email.service";

function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function signToken(user: any): string {
  return jwt.sign(
    { userId: user._id, email: user.email, accountType: user.role || "admin", role: user.role || "admin" },
    process.env.JWT_SECRET as string,
    { expiresIn: "30d" }
  );
}

// POST /api/auth/register
export async function register(req: Request, res: Response) {
  try {
    const { firstName, lastName, email, password } = req.body;
    const name = [firstName, lastName].filter(Boolean).join(" ").trim() || req.body.name;

    if (!name || !email || !password) {
      res.status(400).json({ message: "Nombre, email y contraseña son obligatorios" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
      return;
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(409).json({ message: "Este correo ya está registrado" });
      return;
    }

    const code = generateCode();
    const user = new User({
      name,
      email,
      password,
      verificationCode: code,
      verificationCodeExpires: new Date(Date.now() + 10 * 60 * 1000),
    });
    await user.save();

    const sent = await sendVerificationCode(email, name, code);

    // Si el correo no salió, decirlo. Antes esto reventaba con un 500 y el
    // usuario se quedaba con una cuenta creada que no podía verificar.
    res.status(201).json({
      message: sent
        ? "Te enviamos un código de verificación a tu correo"
        : "Tu cuenta se creó, pero no pudimos enviarte el código. Pide a un administrador que active tu cuenta.",
      email: user.email,
      emailSent: sent,
      emailConfigured: isEmailConfigured(),
    });
  } catch (err: any) {
    console.error("[Auth] Register error:", err);
    res.status(500).json({ message: "Error al registrar usuario" });
  }
}

// POST /api/auth/verify
export async function verify(req: Request, res: Response) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      res.status(400).json({ message: "Email y código son obligatorios" });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }

    if (user.isVerified) {
      const token = signToken(user);
      res.json({
        message: "Cuenta ya verificada",
        token,
        user: { id: user._id, name: user.name, email: user.email, workspaceIds: user.workspaceIds || [], role: user.role || "admin" },
      });
      return;
    }

    if (!user.verificationCode || !user.verificationCodeExpires) {
      res.status(400).json({ message: "No hay código pendiente. Solicita uno nuevo." });
      return;
    }

    if (new Date() > user.verificationCodeExpires) {
      res.status(400).json({ message: "El código expiró. Solicita uno nuevo." });
      return;
    }

    if (user.verificationCode !== code) {
      res.status(400).json({ message: "Código incorrecto" });
      return;
    }

    user.isVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpires = null;
    await user.save();

    // Create Company automatically on first verification
    const existingCompany = await Company.findOne({ userId: user._id });
    if (!existingCompany) {
      const company = await Company.create({
        userId: user._id,
        legalName: user.name,
        commercialName: user.name,
        ruc: "PENDIENTE",
      });
      user.workspaceIds = [company._id as any];
      await user.save();
    }

    await sendWelcomeEmail(user.email, user.name);

    const token = signToken(user);
    res.json({
      message: "Cuenta verificada exitosamente",
      token,
      user: { id: user._id, name: user.name, email: user.email, workspaceIds: user.workspaceIds || [], role: user.role || "admin" },
    });
  } catch (err: any) {
    console.error("[Auth] Verify error:", err);
    res.status(500).json({ message: "Error al verificar cuenta" });
  }
}

// POST /api/auth/resend-code
export async function resendCode(req: Request, res: Response) {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ message: "Email es obligatorio" });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }

    if (user.isVerified) {
      res.status(400).json({ message: "La cuenta ya está verificada" });
      return;
    }

    const code = generateCode();
    user.verificationCode = code;
    user.verificationCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendVerificationCode(user.email, user.name, code);

    res.json({ message: "Código reenviado a tu correo" });
  } catch (err: any) {
    console.error("[Auth] Resend error:", err);
    res.status(500).json({ message: "Error al reenviar código" });
  }
}

// POST /api/auth/login
export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email y contraseña son obligatorios" });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(401).json({ message: "Credenciales inválidas" });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ message: "Credenciales inválidas" });
      return;
    }

    if (!user.isVerified) {
      res.status(403).json({
        message: "Debes verificar tu correo primero",
        needsVerification: true,
        email: user.email,
      });
      return;
    }

    const token = signToken(user);
    const workspaceCount = user.workspaceIds?.length || 0;

    res.json({
      message: "Inicio de sesión exitoso",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        workspaceIds: user.workspaceIds || [],
        role: user.role || "admin",
      },
      workspaceCount,
      hasWorkspace: workspaceCount > 0,
    });
  } catch (err: any) {
    console.error("[Auth] Login error:", err);
    res.status(500).json({ message: "Error al iniciar sesión" });
  }
}

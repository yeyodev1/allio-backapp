import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../types/AuthRequest";
import { User } from "../models/User.model";
import { Company } from "../models/Company.model";
import { Branch } from "../models/Branch.model";
import { Plant } from "../models/Plant.model";
import {
  ISupervisionTemplate,
  SupervisionFrequency,
  SupervisionTargetType,
  SupervisionTemplate,
} from "../models/SupervisionTemplate.model";
import {
  SupervisionAnswerStatus,
  SupervisionSubmission,
} from "../models/SupervisionSubmission.model";

type DefaultTemplate = {
  key: string;
  name: string;
  description: string;
  frequency: SupervisionFrequency;
  targetType: SupervisionTargetType;
  recommended: boolean;
  sections: Array<{ key: string; title: string; items: Array<{ key: string; label: string }> }>;
};

const items = (sectionKey: string, labels: string[]) =>
  labels.map((label, index) => ({ key: `${sectionKey}_${index + 1}`, label }));

const section = (key: string, label: string, labels: string[]) => ({
  key,
  title: label,
  items: items(key, labels),
});

const defaultTemplates: DefaultTemplate[] = [
  {
    key: "visita_integral_local_personal",
    name: "Visita integral: Local + Personal",
    description: "Revision operativa integral del local, servicio y equipo de cocina.",
    frequency: "daily",
    targetType: "branch",
    recommended: true,
    sections: [
      section("externas", "Areas externas", ["Accesos y estacionamiento libres", "Ventanales, fachada y jardines limpios", "Iluminacion exterior funcional", "Drenajes sin obstrucciones", "Camaras de seguridad operativas", "Area exterior limpia y libre de riesgos"]),
      section("counter", "Counter", ["Counter y superficies limpios y desinfectados", "Reunion de inicio o fin de jornada realizada", "Cambio o suelto disponible", "Caja, POS y equipos operativos", "Materiales, papeleria y menus ordenados", "Iluminacion, musica y aire acondicionado funcionales", "Personal con uniforme completo"]),
      section("delivery", "Domicilio / Delivery", ["Zona de despacho limpia y ordenada", "Empaques, cubiertos y servilletas disponibles", "Impresoras y sistemas operativos", "Pedidos correctamente etiquetados", "Personal de delivery cumple higiene y uniforme"]),
      section("salon", "Salon y atencion al cliente", ["Pisos y paredes limpios y en buen estado", "Mesas y sillas limpias y sin daños", "Radios o relojes de llamado operativos", "Utensilios y decorados disponibles", "Aire acondicionado funcional", "Material publicitario vigente y ordenado", "Trampa de grasa revisada"]),
      section("bano", "Baño", ["Registro de limpieza visible y actualizado", "Pisos, inodoros y lavamanos limpios", "Papel higienico disponible", "Jabon liquido y toallas de papel disponibles", "Espejos limpios", "Basureros limpios, con bolsa y tapa", "Baño sin malos olores"]),
      section("cocina", "Cocina", ["Refrigeracion entre 1 °C y 5 °C", "Congelacion entre -10 °C y -15 °C", "Rotacion FIFO/PEPS aplicada", "Fechas de vencimiento revisadas", "Vegetales limpios y en buen estado", "Gavetas y productos sin contacto con el piso", "Productos correctamente etiquetados", "Filtros de aire acondicionado limpios", "Trampa de grasa limpia y funcional", "Tachos de basura con tapa", "Tiempos de coccion controlados"]),
      section("servicio_presentacion", "Atencion - presentacion", ["Uniforme limpio y planchado", "Cabello recogido y uñas cortas", "Gorro o visera utilizado", "Buen aliento e higiene personal", "Sin exceso de joyas o perfume"]),
      section("servicio_atencion", "Atencion - durante el servicio", ["Saludo cordial al cliente", "Pedido tomado y confirmado correctamente", "Tiempos coordinados con cocina", "Atencion visual permanente al salon"]),
      section("servicio_cierre", "Atencion - cierre", ["Caja y propinas cuadradas", "Limpieza general completada", "Basura separada correctamente", "Equipos apagados o asegurados", "Incidencias reportadas"]),
      section("cocina_presentacion", "Cocina - presentacion", ["Uniforme y delantal limpios", "Gorro o cofia utilizado permanentemente", "Lavado frecuente de manos", "Uñas cortas y sin esmalte", "Sin relojes, anillos o accesorios"]),
      section("cocina_servicio", "Cocina - durante el servicio", ["Tiempos de espera coordinados", "Alimentos correctamente etiquetados", "Alimentos almacenados de forma segura", "Contaminacion cruzada prevenida"]),
      section("cocina_cierre", "Cocina - cierre", ["Mesones y utensilios limpiados a profundidad", "Inventario revisado", "Hornos, planchas y extractores apagados", "Produccion diaria reportada", "Novedades comunicadas"]),
    ],
  },
  {
    key: "bitacora_guardia",
    name: "Bitacora de guardia",
    description: "Control de seguridad, accesos y novedades del turno.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("guardia", "Equipamiento y turno del guardia", ["Nombre del guardia registrado en observaciones", "Uniforme completo", "Arma asignada y verificada, cuando aplica", "Tolete disponible", "Equipo de comunicacion operativo", "Hora de entrada registrada en observaciones", "Hora de salida registrada en observaciones", "Supervisor responsable identificado"])]
  },
  {
    key: "control_bano",
    name: "Control de baño",
    description: "Disponibilidad, limpieza y funcionamiento del baño.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("bano", "Baño", ["Inodoro y lavamanos limpios", "Piso seco y sin olores", "Dispensadores abastecidos", "Griferia, luces y cerraduras operativas"])]
  },
  {
    key: "control_basura",
    name: "Control de basura",
    description: "Manejo seguro y oportuno de residuos.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("residuos", "Retiro y trazabilidad de residuos", ["Numero de fundas registrado en observaciones", "Fecha y hora del retiro registradas", "Residuos separados y embolsados", "Contenedores con tapa y limpios", "Area de basura sin derrames ni plagas", "Jefe de cocina o encargado identificado", "Administrador responsable identificado", "Persona que retira identificada"])]
  },
  {
    key: "uniforme_personal",
    name: "Uniforme del personal",
    description: "Presentacion e higiene de todo el personal.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("uniforme", "Uniforme e higiene", ["Malla o cofia utilizada", "Mandil limpio y en buen estado", "Mascarilla utilizada en cocina cuando aplica", "Camiseta institucional limpia", "Barba arreglada o protegida", "Zapatos negros, cerrados y limpios", "Pantalon negro limpio", "Uñas limpias y cortas", "Cabello recogido o corto", "Equipo de comunicacion disponible", "Celular personal guardado durante la jornada"])]
  },
  {
    key: "checklist_atencion",
    name: "Checklist de atención",
    description: "Estandares del recorrido de atencion al cliente.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("area_atencion", "Area de atención", ["Area limpia, ordenada y libre de desechos", "Pisos y paredes limpios", "Mesas y sillas sin chicles ni rajaduras", "Trampa de grasa limpia cuando corresponde", "Uniforme completo del personal"]), section("servicio", "Servicio", ["Cliente recibido oportunamente", "Pedido confirmado antes del cobro", "Tiempo de espera comunicado", "Pedido completo y bien presentado", "Quejas atendidas y escaladas", "Despedida cordial realizada"])]
  },
  {
    key: "checklist_cocina",
    name: "Checklist de cocina",
    description: "Control diario de preparacion, higiene y cierre.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("apertura", "Apertura", ["Pisos limpios, secos y sin grasa", "Paredes y techos sin manchas de grasa", "Equipos y gas revisados", "Mise en place completa", "Insumos vigentes y rotulados"]), section("operacion", "Operación", ["Mesones y tablas desinfectados antes, durante y despues del servicio", "Trampas de grasa limpias y funcionales", "Tablas y utensilios separados", "Lavado de manos aplicado", "Porciones y recetas respetadas"]), section("cierre", "Cierre", ["Superficies desinfectadas", "Equipos limpios y asegurados", "Inventario y mermas registrados"])]
  },
  {
    key: "control_temperaturas",
    name: "Control de temperaturas",
    description: "Verificacion de cadena de frio, coccion y mantenimiento.",
    frequency: "daily",
    targetType: "branch",
    recommended: true,
    sections: [section("frio", "Cadena de frío", ["Numero de cada equipo registrado en observaciones", "Temperatura de apertura de refrigeradores entre 1 °C y 5 °C", "Temperatura de cierre de refrigeradores entre 1 °C y 5 °C", "Temperatura de apertura de congeladores entre -10 °C y -15 °C", "Temperatura de cierre de congeladores entre -10 °C y -15 °C", "Productos almacenados identificados en observaciones"]), section("proceso", "Proceso", ["Coccion alcanza temperatura segura", "Mantenimiento caliente dentro de rango", "Termometros limpios y calibrados", "Responsable del control identificado"])]
  },
  {
    key: "limpieza_profunda_quincenal",
    name: "Limpieza profunda quincenal",
    description: "Limpieza programada de puntos no cubiertos en la rutina diaria.",
    frequency: "fortnightly",
    targetType: "branch",
    recommended: false,
    sections: [section("cocina", "Cocina y equipos", ["Campana, filtros y ductos accesibles limpios", "Detras y debajo de equipos limpio", "Refrigeradores y estanterias desinfectados"]), section("local", "Local", ["Paredes, techos y luminarias limpios", "Desagues y rejillas desinfectados", "Bodega ordenada y sin producto vencido"])]
  },
  {
    key: "trampa_grasa",
    name: "Control de trampa de grasa",
    description: "Revision y limpieza de la trampa de grasa.",
    frequency: "fortnightly",
    targetType: "branch",
    recommended: false,
    sections: [section("trampa", "Trampa de grasa", ["Nivel de grasa revisado", "Limpieza y retiro ejecutados", "Tapa, sello y flujo sin fugas", "Residuo dispuesto correctamente"])]
  },
  {
    key: "fumigacion",
    name: "Control de fumigación",
    description: "Seguimiento del servicio y evidencias de control de plagas.",
    frequency: "monthly",
    targetType: "branch",
    recommended: false,
    sections: [section("fumigacion", "Fumigación", ["Servicio realizado por proveedor autorizado", "Areas criticas tratadas", "Productos protegidos durante el servicio", "Certificado y recomendaciones recibidos", "Sin evidencia posterior de plagas"])]
  },
  {
    key: "filtro_agua",
    name: "Control de filtro de agua",
    description: "Estado, limpieza y cambio del sistema de filtrado.",
    frequency: "monthly",
    targetType: "branch",
    recommended: false,
    sections: [section("filtro", "Filtro de agua", ["Carcasa y conexiones sin fugas", "Flujo, olor y apariencia del agua correctos", "Fecha de cambio dentro de vigencia", "Limpieza o cambio registrado"])]
  },
  {
    key: "control_depositos",
    name: "Control de depósitos",
    description: "Trazabilidad diaria del cuadre de caja y deposito bancario.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("deposito", "Cuadre y depósito", ["Ventas y caja cuadradas", "Monto del deposito registrado en observaciones", "Banco y numero de comprobante registrados", "Comprobante de deposito disponible", "Diferencias justificadas en observaciones", "Administrador responsable identificado"])]
  },
  {
    key: "control_propinas",
    name: "Control de propinas",
    description: "Registro transparente de recepcion y distribucion de propinas.",
    frequency: "daily",
    targetType: "branch",
    recommended: false,
    sections: [section("propinas", "Propinas", ["Monto total registrado en observaciones", "Criterio de distribucion aplicado", "Personal beneficiario identificado", "Valores entregados y conciliados", "Responsable de la distribucion identificado", "Novedades o diferencias documentadas"])]
  },
  {
    key: "planta_control_recomendado",
    name: "Planta - Control recomendado",
    description: "Control integral recomendado para plantas de produccion.",
    frequency: "daily",
    targetType: "plant",
    recommended: true,
    sections: [
      section("recepcion", "Recepción", ["Proveedor y lote identificados", "Empaque e insumos conformes", "Temperatura de recepcion dentro de rango"]),
      section("almacenamiento", "Almacenamiento", ["FIFO/FEFO aplicado", "Productos rotulados y separados", "Bodega limpia y sin plagas"]),
      section("produccion", "Producción", ["Orden de produccion autorizado", "Receta, peso y rendimiento controlados", "Contaminacion cruzada prevenida"]),
      section("temperaturas", "Temperaturas", ["Equipos frios dentro de rango", "Coccion y enfriamiento dentro de rango", "Registros y termometros disponibles"]),
      section("higiene", "Higiene del personal", ["Lavado de manos y uniforme correctos", "Acceso sanitario controlado", "Personal sin signos de enfermedad"]),
      section("saneamiento", "Limpieza y saneamiento", ["Plan de limpieza ejecutado", "Quimicos identificados y separados", "Superficies verificadas antes de producir"]),
      section("despacho", "Despacho", ["Producto y cantidad coinciden con orden", "Empaque, lote y fecha correctos", "Cadena de frio protegida"]),
      section("seguridad", "Seguridad", ["EPP utilizado", "Rutas y salidas despejadas", "Extintores, gas y equipos sin riesgos"]),
    ],
  },
];

async function getAccess(userId: string) {
  const user = await User.findById(userId).select("role workspaceIds");
  if (!user) return null;

  const owned = await Company.findOne({ userId: user._id }).select("_id");
  const companyIds = new Set((user.workspaceIds || []).map((id) => id.toString()));
  if (owned) companyIds.add(owned._id.toString());

  return { user, companyIds: Array.from(companyIds), preferredCompanyId: owned?._id.toString() || Array.from(companyIds)[0] };
}

async function seedDefaultTemplates(companyId: string) {
  const companyObjectId = new mongoose.Types.ObjectId(companyId);

  try {
    await SupervisionTemplate.bulkWrite(
      defaultTemplates.map((template) => ({
        updateOne: {
          filter: { companyId: companyObjectId, key: template.key },
          update: { $setOnInsert: { ...template, companyId: companyObjectId, isDefault: true, isActive: true } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }
}

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && mongoose.isValidObjectId(value);
}

function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isEvidenceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

async function companyForBranch(branchId: string, companyIds: string[]) {
  return Branch.findOne({ _id: branchId, companyId: { $in: companyIds }, isActive: true });
}

async function companyForPlant(plantId: string, companyIds: string[]) {
  return Plant.findOne({ _id: plantId, companyId: { $in: companyIds }, isActive: true });
}

function templateSnapshot(template: ISupervisionTemplate) {
  return {
    key: template.key,
    name: template.name,
    frequency: template.frequency,
    targetType: template.targetType,
    sections: template.sections.map((templateSection) => ({
      key: templateSection.key,
      title: templateSection.title,
      items: templateSection.items.map((item) => ({ key: item.key, label: item.label })),
    })),
  };
}

export async function bootstrapSupervision(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const branchId = req.query.branchId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    if (!isObjectId(branchId)) { res.status(400).json({ message: "branchId valido es requerido" }); return; }

    const access = await getAccess(userId);
    if (!access || !access.companyIds.length) { res.status(403).json({ message: "No tienes acceso a una empresa" }); return; }
    const branch = await companyForBranch(branchId, access.companyIds);
    if (!branch) { res.status(403).json({ message: "No tienes acceso a esta sucursal" }); return; }

    const companyId = branch.companyId.toString();
    await seedDefaultTemplates(companyId);
    const [plants, templates, submissions] = await Promise.all([
      Plant.find({ companyId, isActive: true }).sort({ name: 1 }),
      SupervisionTemplate.find({ companyId, isActive: true }).sort({ targetType: 1, name: 1 }),
      SupervisionSubmission.find({ companyId, branchId: branch._id })
        .populate("submittedBy", "name role")
        .sort({ createdAt: -1 })
        .limit(50),
    ]);

    res.json({ plants, templates, submissions });
  } catch (error: any) {
    res.status(500).json({ message: "Error loading supervision", error: error.message });
  }
}

export async function createPlant(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getAccess(userId);
    if (!access || access.user.role !== "admin" || !access.preferredCompanyId) {
      res.status(403).json({ message: "Solo un administrador puede crear plantas" });
      return;
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const address = typeof req.body.address === "string" ? req.body.address.trim() : undefined;
    if (!name) { res.status(400).json({ message: "name es requerido" }); return; }

    const plant = await Plant.create({ companyId: access.preferredCompanyId, name, address });
    res.status(201).json(plant);
  } catch (error: any) {
    res.status(500).json({ message: "Error creating plant", error: error.message });
  }
}

export async function createSubmission(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getAccess(userId);
    if (!access || !["admin", "supervisor", "operador", "operator"].includes(access.user.role)) {
      res.status(403).json({ message: "Tu rol no puede enviar supervisiones" });
      return;
    }

    const { templateId, targetType, branchId, plantId, businessDate } = req.body;
    if (!isObjectId(templateId)) { res.status(400).json({ message: "templateId valido es requerido" }); return; }
    if (targetType !== "branch" && targetType !== "plant") { res.status(400).json({ message: "targetType debe ser branch o plant" }); return; }
    if (!isBusinessDate(businessDate)) { res.status(400).json({ message: "businessDate debe ser una fecha valida YYYY-MM-DD" }); return; }
    if ((targetType === "branch" && (!isObjectId(branchId) || plantId)) || (targetType === "plant" && (!isObjectId(plantId) || branchId))) {
      res.status(400).json({ message: "Envia exclusivamente branchId o plantId segun targetType" });
      return;
    }

    const target = targetType === "branch"
      ? await companyForBranch(branchId, access.companyIds)
      : await companyForPlant(plantId, access.companyIds);
    if (!target) { res.status(403).json({ message: "El destino no pertenece a tu empresa" }); return; }
    const companyId = target.companyId.toString();

    const template = await SupervisionTemplate.findOne({ _id: templateId, companyId, isActive: true });
    if (!template) { res.status(404).json({ message: "Plantilla no encontrada" }); return; }
    if (template.targetType !== targetType) { res.status(400).json({ message: "La plantilla no corresponde al tipo de destino" }); return; }

    const header = req.body.header;
    const visitorName = typeof header?.visitorName === "string" ? header.visitorName.trim() : "";
    const visitTime = typeof header?.visitTime === "string" ? header.visitTime.trim() : "";
    if (!visitorName || !visitTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(visitTime)) {
      res.status(400).json({ message: "header.visitorName y visitTime HH:mm son requeridos" });
      return;
    }
    if (header.mileage !== undefined && (typeof header.mileage !== "number" || !Number.isFinite(header.mileage) || header.mileage < 0)) {
      res.status(400).json({ message: "header.mileage debe ser un numero no negativo" });
      return;
    }

    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    const templateItems = template.sections.flatMap((templateSection) =>
      templateSection.items.map((item) => ({
        itemKey: item.key,
        label: item.label,
        sectionKey: templateSection.key,
        sectionLabel: templateSection.title,
      }))
    );
    const answerKeys = answers.map((answer: any) => answer?.itemKey);
    const expectedKeys = new Set(templateItems.map((item) => item.itemKey));
    if (answers.length !== templateItems.length || new Set(answerKeys).size !== answerKeys.length || answerKeys.some((key: unknown) => !expectedKeys.has(key as string))) {
      res.status(400).json({ message: "answers debe responder exactamente todos los items de la plantilla" });
      return;
    }

    const validStatuses: SupervisionAnswerStatus[] = ["si", "no", "no_aplica"];
    const answersByKey = new Map<string, any>(answers.map((answer: any) => [answer.itemKey, answer]));
    const snapshotAnswers = templateItems.map((item) => {
      const answer = answersByKey.get(item.itemKey);
      return {
        ...item,
        status: answer?.status as SupervisionAnswerStatus,
        observation: typeof answer?.observation === "string" ? answer.observation.trim() : undefined,
      };
    });
    if (snapshotAnswers.some((answer) => !validStatuses.includes(answer.status))) {
      res.status(400).json({ message: "Cada status debe ser si, no o no_aplica" });
      return;
    }
    if (snapshotAnswers.some((answer) => answer.status === "no" && !answer.observation)) {
      res.status(400).json({ message: "Cada respuesta no requiere una observacion" });
      return;
    }

    const evidence = Array.isArray(req.body.evidence) ? req.body.evidence : [];
    if (!evidence.length || evidence.some((entry: any) =>
      !isEvidenceUrl(entry?.url)
      || typeof entry?.publicId !== "string"
      || !entry.publicId.startsWith("rentabilidad360/supervision/")
    )) {
      res.status(400).json({ message: "Se requiere al menos una evidencia de camara con url y publicId validos" });
      return;
    }

    const targetId = targetType === "branch" ? branchId : plantId;
    const targetKey = `${targetType}:${targetId}`;
    const applicableAnswers = snapshotAnswers.filter((answer) => answer.status !== "no_aplica");
    const yesCount = applicableAnswers.filter((answer) => answer.status === "si").length;
    const score = applicableAnswers.length ? Math.round((yesCount / applicableAnswers.length) * 100) : 100;
    const result = score === 100 ? "aprobado" : score >= 80 ? "observado" : "reprobado";
    const submission = await SupervisionSubmission.create({
      companyId,
      templateId: template._id,
      submittedBy: userId,
      targetType,
      branchId: targetType === "branch" ? branchId : undefined,
      plantId: targetType === "plant" ? plantId : undefined,
      targetKey,
      businessDate,
      score,
      result,
      templateName: template.name,
      targetName: target.name,
      header: {
        visitorName,
        visitTime,
        mileage: header.mileage,
        managerName: typeof header.managerName === "string" ? header.managerName.trim() : undefined,
        kitchenLeadName: typeof header.kitchenLeadName === "string" ? header.kitchenLeadName.trim() : undefined,
      },
      answers: snapshotAnswers,
      evidence: evidence.map((entry: any) => ({ url: entry.url.trim(), publicId: entry.publicId.trim() })),
      templateSnapshot: templateSnapshot(template),
    });
    await submission.populate("submittedBy", "name role");
    res.status(201).json(submission);
  } catch (error: any) {
    if (error?.code === 11000) {
      res.status(409).json({ message: "Ya existe esta supervision para la plantilla, destino y fecha" });
      return;
    }
    res.status(500).json({ message: "Error creating supervision submission", error: error.message });
  }
}

export async function listSubmissions(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const access = await getAccess(userId);
    if (!access || !access.companyIds.length) { res.status(403).json({ message: "No tienes acceso a una empresa" }); return; }

    const branchId = req.query.branchId;
    const plantId = req.query.plantId;
    if (branchId && plantId) { res.status(400).json({ message: "Usa branchId o plantId, no ambos" }); return; }

    let companyIds = access.companyIds;
    const filter: Record<string, unknown> = {};
    if (branchId) {
      if (!isObjectId(branchId)) { res.status(400).json({ message: "branchId invalido" }); return; }
      const branch = await companyForBranch(branchId, companyIds);
      if (!branch) { res.status(403).json({ message: "No tienes acceso a esta sucursal" }); return; }
      companyIds = [branch.companyId.toString()];
      filter.branchId = branch._id;
    }
    if (plantId) {
      if (!isObjectId(plantId)) { res.status(400).json({ message: "plantId invalido" }); return; }
      const plant = await companyForPlant(plantId, companyIds);
      if (!plant) { res.status(403).json({ message: "No tienes acceso a esta planta" }); return; }
      companyIds = [plant.companyId.toString()];
      filter.plantId = plant._id;
    }

    const rawLimit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      res.status(400).json({ message: "limit debe ser un entero entre 1 y 50" });
      return;
    }

    filter.companyId = { $in: companyIds };
    const submissions = await SupervisionSubmission.find(filter)
      .populate("submittedBy", "name role")
      .sort({ createdAt: -1 })
      .limit(rawLimit);
    res.json(submissions);
  } catch (error: any) {
    res.status(500).json({ message: "Error listing supervision submissions", error: error.message });
  }
}

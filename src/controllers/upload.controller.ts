import { Response, NextFunction } from "express";
import multer from "multer";
import { AuthRequest } from "../types/AuthRequest";
import { uploadImageBuffer, deleteImage, UploadFolder, uploadFolders } from "../services/cloudinary.service";

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten imágenes raster (JPEG, PNG, WebP)"));
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  // Vercel corta la petición en 4,5 MB antes de que la función corra, así que
  // este tope solo actúa en local. El cliente reduce las fotos antes de subirlas.
  limits: { fileSize: 10 * 1024 * 1024 },
}).single("file");

/**
 * Envuelve a multer para traducir sus errores.
 *
 * Sin esto, subir un PDF o un archivo enorme salía como 500: el error del
 * `fileFilter` llegaba al manejador global y se reportaba como fallo del
 * servidor, cuando es el usuario quien mandó algo que no toca.
 */
export function uploadMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  upload(req as any, res as any, (err: unknown) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "La imagen supera el tamaño máximo permitido."
          : "No se pudo procesar el archivo enviado.";
      res.status(400).json({ message });
      return;
    }

    res.status(400).json({
      message: err instanceof Error ? err.message : "Archivo no válido",
    });
  });
}

export async function uploadFile(req: AuthRequest, res: Response) {
  if (!req.file) {
    res.status(400).json({ message: "No se envió ningún archivo" });
    return;
  }

  const requestedFolder = req.body.folder || "general";
  if (!uploadFolders.includes(requestedFolder as UploadFolder)) {
    res.status(400).json({ message: "Carpeta de carga no permitida" });
    return;
  }
  const folder = requestedFolder as UploadFolder;

  try {
    const result = await uploadImageBuffer(req.file.buffer, folder);

    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (err: any) {
    res.status(500).json({ message: "Error al subir imagen", error: err.message });
  }
}

export async function deleteFile(req: AuthRequest, res: Response) {
  const { publicId } = req.body;
  if (!publicId) {
    res.status(400).json({ message: "publicId es requerido" });
    return;
  }

  try {
    await deleteImage(publicId);
    res.json({ message: "Imagen eliminada correctamente" });
  } catch (err: any) {
    res.status(500).json({ message: "Error al eliminar imagen", error: err.message });
  }
}

import { v2 as cloudinary } from "cloudinary";
import { UploadApiResponse } from "cloudinary";

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

let configured = false;

function configure() {
  if (configured) return;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  configured = true;
}

export const uploadFolders = ["equipos", "platillos", "avatars", "logos", "general", "supervision"] as const;
export type UploadFolder = (typeof uploadFolders)[number];

export async function uploadImage(
  filePath: string,
  folder: UploadFolder = "general",
): Promise<UploadApiResponse> {
  configure();
  return cloudinary.uploader.upload(filePath, {
    folder: `rentabilidad360/${folder}`,
    resource_type: "image",
    quality: "auto",
    fetch_format: "auto",
  });
}

export async function uploadImageBuffer(
  buffer: Buffer,
  folder: UploadFolder = "general",
  publicId?: string,
): Promise<UploadApiResponse> {
  configure();
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `rentabilidad360/${folder}`,
        resource_type: "image",
        quality: "auto",
        fetch_format: "auto",
        public_id: publicId,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result!);
      },
    );
    uploadStream.end(buffer);
  });
}

export async function deleteImage(publicId: string) {
  configure();
  return cloudinary.uploader.destroy(publicId);
}

export function getOptimizedUrl(publicId: string, width?: number, height?: number): string {
  configure();
  const transformations: string[] = ["q_auto", "f_auto"];
  if (width) transformations.push(`w_${width}`);
  if (height) transformations.push(`h_${height}`);
  return cloudinary.url(publicId, {
    transformation: [{ quality: "auto", fetch_format: "auto" }],
    secure: true,
  });
}

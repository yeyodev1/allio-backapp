import mongoose from "mongoose";

/**
 * Conexión a Mongo pensada para serverless.
 *
 * En Vercel cada invocación puede caer en una instancia nueva, y varias peticiones
 * simultáneas sobre una instancia fría llamarían a `connect` a la vez. Por eso se
 * cachea la *promesa*: la primera abre la conexión y las demás esperan a esa misma.
 *
 * Lo que había antes hacía `process.exit(1)` si la conexión fallaba. En un proceso
 * de servidor tiene sentido; en una función serverless mata la instancia a mitad de
 * petición y el cliente recibe un 500 sin ninguna explicación — que es exactamente
 * lo que pasaba en el primer acceso tras un rato de inactividad.
 */

// `globalThis` para sobrevivir al recargado de módulos entre invocaciones tibias.
const globalCache = globalThis as typeof globalThis & {
  __allioMongo?: Promise<typeof mongoose> | null;
};

export function dbConnect(): Promise<typeof mongoose> {
  const DB_URI = process.env.DB_URI;
  if (!DB_URI) {
    return Promise.reject(new Error("Falta DB_URI en las variables de entorno"));
  }

  if (globalCache.__allioMongo) return globalCache.__allioMongo;

  const promise = mongoose
    .connect(DB_URI, {
      // El arranque en frío de la función compite con el del cluster; 10 s da
      // margen sin dejar la petición colgada un minuto.
      serverSelectionTimeoutMS: 10_000,
      // En serverless no se reutilizan sockets entre instancias: un pool grande
      // solo consume conexiones del cluster sin dar nada a cambio.
      maxPoolSize: 10,
    })
    .then((m) => {
      console.log("Conectado a MongoDB");
      return m;
    })
    .catch((error) => {
      // Se limpia la caché para que el siguiente intento pueda reconectar, en vez
      // de quedarse pegado para siempre a una promesa ya rechazada.
      globalCache.__allioMongo = null;
      console.error("Error de conexión a MongoDB:", error);
      throw error;
    });

  globalCache.__allioMongo = promise;
  return promise;
}

/** Ninguna ruta de datos debe correr antes de que haya conexión. */
export async function ensureDbConnection(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await dbConnect();
}

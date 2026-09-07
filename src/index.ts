import dotenv from "dotenv";
dotenv.config();

import { dbConnect } from "./config/mongo";
import { createApp } from "./app";

const { app, server } = createApp();
const port = process.env.PORT || 8100;

// Se lanza al arrancar para que el proceso local ya tenga conexión, pero sin
// depender de ello: el middleware del router la garantiza en cada petición.
dbConnect().catch((err) => {
  console.error("No se pudo conectar a MongoDB al arrancar:", err.message);
});

if (!process.env.VERCEL) {
  server.timeout = 10 * 60 * 1000;
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

export default app;

import { Schema } from "mongoose";

/**
 * Sello de ubicación de un registro.
 *
 * Se guarda en revisiones diarias, traspasos y visitas de supervisión para poder
 * contrastar dónde se registró algo contra dónde debería haber estado la persona.
 *
 * Qué es y qué no: viene de la API de geolocalización del navegador, que un usuario
 * decidido puede falsear. No es una prueba forense, es un disuasivo y un dato de
 * auditoría. Por eso se guarda también `accuracyM` (el margen de error que reporta
 * el propio dispositivo) y por eso la ausencia de ubicación se registra de forma
 * explícita —"denegada", "no disponible"— en vez de quedar simplemente en blanco:
 * un registro sin ubicación tiene que verse como tal.
 */

export const GEO_SOURCES = ["gps", "denied", "unavailable", "timeout"] as const;
export type GeoSource = (typeof GEO_SOURCES)[number];

export interface IGeoStamp {
  lat?: number;
  lng?: number;
  accuracyM?: number;
  capturedAt?: Date;
  source: GeoSource;
  /** Metros entre el punto capturado y el local. Lo calcula el servidor. */
  distanceFromBranchM?: number;
}

export const geoStampSchema = new Schema<IGeoStamp>(
  {
    lat: { type: Number, min: -90, max: 90 },
    lng: { type: Number, min: -180, max: 180 },
    accuracyM: { type: Number, min: 0 },
    capturedAt: { type: Date },
    source: { type: String, enum: GEO_SOURCES, default: "unavailable" },
    distanceFromBranchM: { type: Number, min: 0 },
  },
  { _id: false }
);

/** Coordenadas de referencia de un local, para poder medir contra ellas. */
export interface ICoordinates {
  lat: number;
  lng: number;
}

export const coordinatesSchema = new Schema<ICoordinates>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false }
);

/** Distancia en metros entre dos puntos (haversine). */
export function distanceMeters(a: ICoordinates, b: ICoordinates): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Normaliza lo que manda el cliente y, si el local tiene coordenadas, calcula a qué
 * distancia se registró. Nunca lanza: una ubicación mala no puede impedir que se
 * guarde el trabajo que la persona sí hizo.
 */
export function buildGeoStamp(input: unknown, branchCoords?: ICoordinates | null): IGeoStamp {
  const raw = (input || {}) as Record<string, unknown>;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);

  const hasFix =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // (0,0) es el valor que devuelven algunos dispositivos sin señal, no un punto real.
    !(lat === 0 && lng === 0);

  if (!hasFix) {
    const claimed = String(raw.source);
    return {
      source: (GEO_SOURCES as readonly string[]).includes(claimed)
        ? (claimed as GeoSource)
        : "unavailable",
    };
  }

  const stamp: IGeoStamp = {
    lat,
    lng,
    accuracyM: Number.isFinite(Number(raw.accuracyM)) ? Number(raw.accuracyM) : undefined,
    capturedAt: raw.capturedAt ? new Date(String(raw.capturedAt)) : new Date(),
    source: "gps",
  };

  if (branchCoords) {
    stamp.distanceFromBranchM = distanceMeters({ lat, lng }, branchCoords);
  }

  return stamp;
}

/** Coordenadas válidas a partir de una entrada suelta, o `null`. */
export function parseCoordinates(input: unknown): ICoordinates | null {
  const raw = (input || {}) as Record<string, unknown>;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * A partir de cuántos metros se considera que el registro no se hizo en el local.
 * 300 m cubre un centro comercial grande o un parqueadero, sin marcar por el
 * margen de error normal de un GPS urbano.
 */
export const OFFSITE_THRESHOLD_M = 300;

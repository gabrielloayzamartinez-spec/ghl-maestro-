import dotenv from 'dotenv';
dotenv.config();

export const GHL_CONFIG = {
  apiKey: process.env.GHL_API_KEY,
  locationId: process.env.GHL_LOCATION_ID
};

export const MASTER_PIPELINE_DEF = {
  name: "🎯 Pipeline Maestro - Call Center USA",
  stages: [
    { name: "💬 Precalificado (Sin Teléfono / En Chat)", position: 1 },
    { name: "📞 Lead Calificado (Con Teléfono / Listo para Llamar)", position: 2 },
    { name: "⏳ En Llamada / Negociación", position: 3 },
    { name: "🎉 Venta Cerrada (Ganado)", position: 4 },
    { name: "❌ No Contesta / Descalificado", position: 5 }
  ]
};

export const PAGE_TAG_MAP = {
  "Naturales BioNatural": "naturales bionatural",
  "BioNatural - Ultra": "bionatural ultra",
  "Laboratorios Naturales BIO": "laboratorios naturales bio",
  "Bio Naturales": "bio naturales",
  "Bio Natural Salud": "bio natural salud",
  "Bio Natural": "bio natural",
  "BIO Naturales Laboratorio": "bio naturales laboratorio",
  "Naturales Bio Corp": "naturales bio corp",
  "Bio Naturales Plus": "bio naturales plus",
  "BioNatural Plus": "bionatural plus",
  "BioNatural Fuerza": "bionatural fuerza",
  "BioNatural": "bionatural",
  "Natural Bio": "natural bio"
};

export const PALACIOS_USERS = {
  "naturales bionatural": {
    id: "G1mp9WCw9jwkNhnSZ2ER",
    name: "REDES PALACIOS ERNESTO"
  },
  "bionatural ultra": {
    id: "mOA8p7H0G3MC0TEWrlKf",
    name: "REDES PALACIOS ULTRA"
  },
  "redes benavides 1": {
    id: "ihjnwtDWkH7mrJhSlYOa",
    name: "REDES BENAVIDES BIONATURAL"
  },
  "redes benavides 2": {
    id: "7eU3NJ61WwG8Z1LFlJwZ",
    name: "REDES BENAVIDES 2 BIONATURAL"
  },
  "redes roosevelt": {
    id: "nFCbXqI0h1JPg0NCMzJo",
    name: "REDES ROOSVELT BIONATURAL"
  },
  "redes piura": {
    id: "2vIwv7mCV1bC5ZlIBxAJ",
    name: "REDES PIURA BIONATURAL"
  }
};

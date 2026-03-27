import { pgTable, uuid, text, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    // Anagrafica
    ragioneSociale: text("ragione_sociale"),
    partitaIva: text("partita_iva"),
    codiceFiscale: text("codice_fiscale"),
    formaGiuridica: text("forma_giuridica"),
    statoAttivita: text("stato_attivita"),
    dataInizio: text("data_inizio"),
    settore: text("settore"),
    // Sede
    indirizzo: text("indirizzo"),
    citta: text("citta"),
    cap: text("cap"),
    provincia: text("provincia"),
    regione: text("regione"),
    // Contatti
    telefono: text("telefono"),
    email: text("email"),
    whatsapp: text("whatsapp"),
    pec: text("pec"),
    codiceSdi: text("codice_sdi"),
    sitoWeb: text("sito_web"),
    // Economici
    dipendenti: text("dipendenti"),
    fatturato: text("fatturato"),
    patrimonioNetto: text("patrimonio_netto"),
    capitaleSociale: text("capitale_sociale"),
    totaleAttivo: text("totale_attivo"),
    // Affidabilità
    riskScore: text("risk_score"),
    rating: text("rating"),
    riskSeverity: text("risk_severity"),
    creditLimit: text("credit_limit"),
    // Soci
    soci: text("soci"),
    // Note extra
    note: text("note"),
    // Orari
    orariApertura: text("orari_apertura"),
    giornoChiusura: text("giorno_chiusura"),
    noteOrari: text("note_orari"),
    // A2A (ex a2a_profiles)
    slug: text("slug"),
    tags: jsonb("tags").$type<string[]>().default([]),
    services: jsonb("services").$type<string[]>().default([]),
    visibility: text("visibility").notNull().default("hidden"),
    description: text("description"),
    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUq: uniqueIndex("company_profiles_company_id_key").on(table.companyId),
    slugIdx: index("idx_company_profiles_slug").on(table.slug),
    visibilityIdx: index("idx_company_profiles_visibility").on(table.visibility),
  }),
);

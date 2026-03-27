import { Router } from "express";
import type { Db } from "@goitalia/db";
import { getStripeApiKey } from "./stripe-connector.js";
import { getProjectFilesContent } from "./project-files.js";
import { companySecrets, agents, companyMemberships, companies, issues, connectorAccounts, agentConnectorAccounts, routines, routineTriggers, routineRuns, companyProfiles, companyProducts, customConnectors } from "@goitalia/db";
import { nextCronTickInTimeZone } from "../services/routines.js";
import { eq, and, ne, inArray, desc, sql, asc } from "drizzle-orm";
import { decrypt, encrypt } from "../utils/crypto.js";
import { randomUUID } from "node:crypto";
import { executeA2aTool } from "../services/a2a-tools.js";

// Tool definitions (same as adapter)
export const TOOLS = [
  {
    name: "lista_agenti",
    description: "Elenca tutti gli agenti della company con il loro stato attuale.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "crea_task",
    description: "Crea un nuovo task e lo assegna a un agente.",
    input_schema: {
      type: "object" as const,
      properties: {
        titolo: { type: "string", description: "Titolo del task" },
        descrizione: { type: "string", description: "Descrizione dettagliata" },
        agente_id: { type: "string", description: "ID dell'agente" },
        priorita: { type: "string", enum: ["urgent", "high", "medium", "low"] },
      },
      required: ["titolo", "descrizione", "agente_id"],
    },
  },
  {
    name: "stato_task",
    description: "Controlla lo stato dei task attivi.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "Filtra per agente (opzionale)" },
        stato: { type: "string", enum: ["todo", "in_progress", "done", "all"] },
      },
      required: [] as string[],
    },
  },
  {
    name: "commenta_task",
    description: "Aggiungi un commento a un task.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ID del task" },
        commento: { type: "string", description: "Il commento" },
      },
      required: ["task_id", "commento"],
    },
  },
  {
    name: "elimina_agente",
    description: "Elimina un agente dalla company. Usa con cautela.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "ID dell'agente da eliminare" },
      },
      required: ["agente_id"],
    },
  },
  {
    name: "crea_agente",
    description: "Crea un nuovo agente specializzato per la company. Il connettore specificato sarà l'unico attivo di default.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome dell'agente (es: Il Promotore)" },
        titolo: { type: "string", description: "Ruolo dell'agente (es: Social Media Manager)" },
        competenze: { type: "string", description: "Descrizione delle competenze" },
        istruzioni: { type: "string", description: "Prompt di sistema / istruzioni operative" },
        connettore: { type: "string", description: "Connettore principale per cui l'agente è creato (google, telegram, whatsapp, meta, linkedin, fal, fic, openapi, voice)" },
        account_id: { type: "string", description: "Identificativo specifico dell'account/bot/numero (es: @energizzo.it per Instagram, @nomebot per Telegram, +39xxx per WhatsApp, email per Google). Usato per attivare SOLO quell'account specifico nel connettore." },
      },
      required: ["nome", "titolo", "competenze", "istruzioni", "connettore"],
    },
  },
  {
    name: "esegui_task_agente",
    description: "Delega un compito a un agente specifico. L'agente lo eseguirà usando i suoi tool e connettori, poi ti restituirà il risultato. Usa lista_agenti per trovare l'agente giusto. Passa sempre il contesto rilevante dalla conversazione (info cliente, dati menzionati, richieste specifiche).",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "ID dell'agente a cui delegare il compito" },
        istruzioni: { type: "string", description: "Istruzioni dettagliate su cosa deve fare l'agente" },
        contesto: { type: "string", description: "Contesto rilevante dalla conversazione: info cliente, dati aziendali, riferimenti a messaggi precedenti. L'agente non ha accesso alla tua conversazione, quindi passa tutto ciò che serve." },
      },
      required: ["agente_id", "istruzioni"],
    },
  },
  {
    name: "salva_info_azienda",
    description: "Salva o aggiorna le informazioni dell'azienda del cliente in memoria. Usa TUTTI i campi disponibili quando hai i dati da cerca_piva_onboarding.",
    input_schema: {
      type: "object" as const,
      properties: {
        ragione_sociale: { type: "string", description: "Ragione sociale / nome azienda" },
        partita_iva: { type: "string", description: "Partita IVA" },
        codice_fiscale: { type: "string", description: "Codice Fiscale" },
        indirizzo: { type: "string", description: "Indirizzo sede legale" },
        citta: { type: "string", description: "Città" },
        cap: { type: "string", description: "CAP" },
        provincia: { type: "string", description: "Provincia (sigla)" },
        regione: { type: "string", description: "Regione" },
        settore: { type: "string", description: "Settore / attività principale con codice ATECO" },
        forma_giuridica: { type: "string", description: "Forma giuridica (SRL, SPA, ecc.)" },
        stato_attivita: { type: "string", description: "Stato attività (ATTIVA, CESSATA, ecc.)" },
        data_inizio: { type: "string", description: "Data inizio attività" },
        pec: { type: "string", description: "Indirizzo PEC" },
        codice_sdi: { type: "string", description: "Codice destinatario SDI" },
        telefono: { type: "string", description: "Telefono" },
        email: { type: "string", description: "Email di contatto" },
        whatsapp: { type: "string", description: "Numero WhatsApp" },
        sito_web: { type: "string", description: "Sito web" },
        dipendenti: { type: "string", description: "Numero dipendenti" },
        fatturato: { type: "string", description: "Fatturato ultimo bilancio" },
        patrimonio_netto: { type: "string", description: "Patrimonio netto" },
        capitale_sociale: { type: "string", description: "Capitale sociale" },
        totale_attivo: { type: "string", description: "Totale attivo" },
        risk_score: { type: "string", description: "Risk score (VERDE, GIALLO, ROSSO)" },
        rating: { type: "string", description: "Rating creditizio (es: B2)" },
        risk_severity: { type: "string", description: "Severità rischio (0-990)" },
        credit_limit: { type: "string", description: "Limite credito operativo in euro" },
        soci: { type: "string", description: "Elenco soci con quote % (es: Mario Rossi 60%, Luca Bianchi 40%)" },
        note: { type: "string", description: "Note aggiuntive sull'azienda" },
      },
      required: [],
    },
  },
  {
    name: "cerca_piva_onboarding",
    description: "Cerca dati aziendali tramite Partita IVA usando le API di piattaforma (gratuito per la PMI). Restituisce ragione sociale, codice ATECO, indirizzo, PEC, stato attività. Usalo durante l'onboarding per compilare automaticamente i dati aziendali.",
    input_schema: {
      type: "object" as const,
      properties: {
        piva: { type: "string", description: "Partita IVA dell'azienda (11 cifre)" },
      },
      required: ["piva"] as string[],
    },
  },
  {
    name: "salva_nota",
    description: "Salva una nota o informazione importante da ricordare per il futuro. Usa questo quando il cliente dice 'ricorda che...', quando apprendi qualcosa di rilevante, o per salvare preferenze e decisioni.",
    input_schema: {
      type: "object" as const,
      properties: {
        contenuto: { type: "string", description: "Il contenuto della nota da salvare" },
        categoria: { type: "string", description: "Categoria opzionale (preferenze, decisioni, contatti, altro)" },
      },
      required: ["contenuto"],
    },
  },
  {
    name: "leggi_memoria",
    description: "Leggi tutte le informazioni salvate in memoria sull'azienda del cliente: dati aziendali, note, preferenze.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },



  {
    name: "lista_clienti",
    description: "Elenca i clienti dell'azienda registrati su Fatture in Cloud.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "cerca_cliente",
    description: "Cerca un cliente per nome o P.IVA su Fatture in Cloud.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Nome o P.IVA del cliente" },
      },
      required: ["query"],
    },
  },
  {
    name: "crea_cliente",
    description: "Crea un nuovo cliente su Fatture in Cloud.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome o ragione sociale" },
        partita_iva: { type: "string", description: "Partita IVA (opzionale)" },
        codice_fiscale: { type: "string", description: "Codice fiscale (opzionale)" },
        indirizzo: { type: "string", description: "Via e numero civico" },
        cap: { type: "string", description: "CAP" },
        citta: { type: "string", description: "Città" },
        provincia: { type: "string", description: "Provincia (sigla)" },
        email: { type: "string", description: "Email" },
        pec: { type: "string", description: "PEC (per fattura elettronica)" },
        codice_sdi: { type: "string", description: "Codice destinatario SDI (7 caratteri)" },
      },
      required: ["nome"],
    },
  },
  {
    name: "crea_fattura",
    description: "Crea una nuova fattura su Fatture in Cloud. Specifica il cliente, le righe e il metodo di pagamento.",
    input_schema: {
      type: "object" as const,
      properties: {
        cliente_id: { type: "number", description: "ID del cliente (usa lista_clienti per trovarlo)" },
        righe: {
          type: "array",
          description: "Righe della fattura",
          items: {
            type: "object",
            properties: {
              descrizione: { type: "string" },
              prezzo: { type: "number", description: "Prezzo unitario netto" },
              quantita: { type: "number", description: "Quantità (default 1)" },
              iva: { type: "number", description: "Aliquota IVA % (default 22)" },
            },
            required: ["descrizione", "prezzo"],
          },
        },
        fattura_elettronica: { type: "boolean", description: "Se inviare come fattura elettronica via SDI (default true)" },
        data: { type: "string", description: "Data fattura (YYYY-MM-DD, default oggi)" },
        note: { type: "string", description: "Note aggiuntive" },
      },
      required: ["cliente_id", "righe"],
    },
  },
  {
    name: "lista_fatture",
    description: "Elenca le fatture emesse. Può filtrare per stato.",
    input_schema: {
      type: "object" as const,
      properties: {
        tipo: { type: "string", enum: ["emesse", "ricevute"], description: "Tipo (default emesse)" },
        pagina: { type: "number", description: "Pagina (default 1)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "invia_fattura_sdi",
    description: "Invia una fattura elettronica allo SDI (Sistema di Interscambio).",
    input_schema: {
      type: "object" as const,
      properties: {
        fattura_id: { type: "number", description: "ID della fattura da inviare" },
      },
      required: ["fattura_id"],
    },
  },

  // OpenAPI.it tools
  {
    name: "cerca_azienda_piva",
    description: "Cerca informazioni su un'azienda italiana tramite P.IVA o Codice Fiscale usando OpenAPI.it. Restituisce denominazione, indirizzo, PEC, stato attività, codice ATECO, ecc.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Partita IVA o Codice Fiscale dell'azienda" },
        livello: { type: "string", enum: ["start", "advanced", "full"], description: "Livello di dettaglio: start (base), advanced (dettagliato), full (completo)" },
      },
      required: ["query"],
    },
  },
  {
    name: "cerca_azienda_nome",
    description: "Cerca aziende italiane per denominazione/nome usando OpenAPI.it.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome o denominazione dell'azienda da cercare" },
      },
      required: ["nome"],
    },
  },
  {
    name: "credit_score",
    description: "Ottieni il credit score e la valutazione di rischio di un'azienda tramite P.IVA usando OpenAPI.it Risk.",
    input_schema: {
      type: "object" as const,
      properties: {
        piva: { type: "string", description: "Partita IVA dell'azienda" },
        livello: { type: "string", enum: ["start", "advanced", "top"], description: "start: score base, advanced: rating A1-C3 + severity, top: completo con storico e limite credito" },
      },
      required: ["piva"],
    },
  },
  {
    name: "codice_sdi",
    description: "Recupera il codice destinatario SDI di un'azienda tramite P.IVA per la fatturazione elettronica.",
    input_schema: {
      type: "object" as const,
      properties: {
        piva: { type: "string", description: "Partita IVA dell'azienda" },
      },
      required: ["piva"],
    },
  },
  {
    name: "cerca_cap",
    description: "Cerca informazioni su un CAP italiano: comune, provincia, regione, prefisso telefonico.",
    input_schema: {
      type: "object" as const,
      properties: {
        cap: { type: "string", description: "Codice di Avviamento Postale (es: 00100)" },
      },
      required: ["cap"],
    },
  },
  // PEC tools
  {
    name: "lista_pec",
    description: "Elenca le email PEC ricevute nella casella PEC dell'azienda.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Numero massimo di email da restituire (default 10)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "leggi_pec",
    description: "Leggi una email PEC specifica con il corpo completo e i metadati di certificazione (daticert.xml).",
    input_schema: {
      type: "object" as const,
      properties: {
        uid: { type: "number", description: "UID del messaggio PEC da leggere (ottenuto da lista_pec)" },
      },
      required: ["uid"],
    },
  },
  {
    name: "invia_pec",
    description: "Invia una email PEC certificata a un destinatario.",
    input_schema: {
      type: "object" as const,
      properties: {
        destinatario: { type: "string", description: "Indirizzo PEC del destinatario" },
        oggetto: { type: "string", description: "Oggetto della PEC" },
        testo: { type: "string", description: "Testo del messaggio PEC" },
      },
      required: ["destinatario", "oggetto", "testo"],
    },
  },
  {
    name: "rispondi_pec",
    description: "Rispondi a una email PEC ricevuta.",
    input_schema: {
      type: "object" as const,
      properties: {
        destinatario: { type: "string", description: "Indirizzo PEC a cui rispondere" },
        oggetto: { type: "string", description: "Oggetto della risposta (di solito 'Re: oggetto originale')" },
        testo: { type: "string", description: "Testo della risposta" },
      },
      required: ["destinatario", "oggetto", "testo"],
    },
  },

  // Project files tool
  {
    name: "leggi_file_progetto",
    description: "Legge i file allegati a un progetto (upload diretto o link Google Drive). Usa questo tool quando l'utente dice 'ho caricato un file nel progetto', 'guarda il documento nel progetto', ecc.",
    input_schema: { type: "object" as const, properties: { project_id: { type: "string", description: "ID del progetto" } }, required: ["project_id"] as string[] },
  },

  // Google Drive tools
  {
    name: "cerca_file_drive",
    description: "Cerca file su Google Drive per nome o contenuto. Restituisce nome, tipo, link e ID del file.",
    input_schema: { type: "object" as const, properties: { query: { type: "string", description: "Nome o parola chiave del file da cercare" } }, required: ["query"] as string[] },
  },
  {
    name: "leggi_file_drive",
    description: "Legge il contenuto testuale di un file Google Drive (Google Doc, Fogli, file TXT, CSV). Usa l'ID file ottenuto da cerca_file_drive.",
    input_schema: { type: "object" as const, properties: { file_id: { type: "string", description: "ID del file Google Drive (es: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms)" }, file_name: { type: "string", description: "Nome del file (opzionale, per log)" } }, required: ["file_id"] as string[] },
  },

  // Stripe tools
  {
    name: "stripe_lista_clienti",
    description: "Elenca i clienti Stripe della company (fino a 50). Mostra nome, email, ID, data creazione.",
    input_schema: { type: "object" as const, properties: { limite: { type: "number", description: "Numero massimo di risultati (default 20)" } }, required: [] as string[] },
  },
  {
    name: "stripe_cerca_cliente",
    description: "Cerca un cliente Stripe per nome o email.",
    input_schema: { type: "object" as const, properties: { query: { type: "string", description: "Nome o email del cliente" } }, required: ["query"] as string[] },
  },
  {
    name: "stripe_crea_cliente",
    description: "Crea un nuovo cliente su Stripe.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome del cliente" },
        email: { type: "string", description: "Email del cliente" },
        telefono: { type: "string", description: "Telefono (opzionale)" },
        descrizione: { type: "string", description: "Note interne (opzionale)" },
      },
      required: ["nome", "email"] as string[],
    },
  },
  {
    name: "stripe_lista_pagamenti",
    description: "Elenca gli ultimi pagamenti/fatture ricevuti. Mostra importo, stato, cliente, data.",
    input_schema: { type: "object" as const, properties: { limite: { type: "number", description: "Numero massimo di risultati (default 10)" }, stato: { type: "string", enum: ["succeeded", "pending", "failed"], description: "Filtra per stato" } }, required: [] as string[] },
  },
  {
    name: "stripe_crea_link_pagamento",
    description: "Crea un link di pagamento Stripe una-tantum da inviare a un cliente. Specifica importo e descrizione.",
    input_schema: {
      type: "object" as const,
      properties: {
        importo_eur: { type: "number", description: "Importo in euro (es: 150 = €150)" },
        descrizione: { type: "string", description: "Descrizione del prodotto/servizio" },
        cliente_email: { type: "string", description: "Email del cliente (opzionale, per prefillare)" },
      },
      required: ["importo_eur", "descrizione"] as string[],
    },
  },
  {
    name: "stripe_verifica_abbonamento",
    description: "Verifica lo stato dell'abbonamento Stripe di un cliente dato il suo ID o email.",
    input_schema: { type: "object" as const, properties: { cliente_id: { type: "string", description: "ID cliente Stripe (cus_...)" }, email: { type: "string", description: "Email del cliente" } }, required: [] as string[] },
  },

  {
    name: "crea_attivita_programmata",
    description: "Crea un'attività programmata (cron) per un agente. L'agente eseguirà il task all'orario specificato.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "ID dell'agente che esegue l'attività" },
        titolo: { type: "string", description: "Nome breve (es: Post Instagram giornaliero)" },
        descrizione: { type: "string", description: "Istruzioni dettagliate per l'agente" },
        orario: { type: "string", description: "Quando eseguire in italiano (es: ogni giorno alle 12, ogni lunedi alle 9)" },
        approvazione: { type: "boolean", description: "true = richiede approvazione, false = automatico" },
      },
      required: ["agente_id", "titolo", "descrizione", "orario"] as string[],
    },
  },
  {
    name: "lista_attivita_programmate",
    description: "Elenca tutte le attività programmate della company con stato, prossima esecuzione e agente.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "elimina_attivita_programmata",
    description: "Archivia un'attività programmata.",
    input_schema: {
      type: "object" as const,
      properties: {
        routine_id: { type: "string", description: "ID dell'attività da eliminare" },
      },
      required: ["routine_id"] as string[],
    },
  },
  {
    name: "riassunto_conversazioni_wa",
    description: "Legge le conversazioni WhatsApp recenti dell'agente e genera un riassunto con le cose importanti. Utile per avere un quadro delle comunicazioni WA.",
    input_schema: {
      type: "object" as const,
      properties: {
        ore: { type: "number", description: "Quante ore indietro guardare (default: 24)" },
        numero: { type: "string", description: "Filtra per un numero specifico (opzionale, es: +34646238826)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "genera_immagine",
    description: "Genera un'immagine con AI (Fal.ai). Ritorna l'URL dell'immagine generata. Usalo per creare grafiche, post social, illustrazioni.",
    input_schema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "Descrizione dettagliata dell'immagine da generare (in inglese per risultati migliori)" },
        aspect_ratio: { type: "string", enum: ["square_hd", "portrait_4_3", "landscape_4_3", "landscape_16_9", "portrait_16_9"], description: "Proporzioni (default: square_hd)" },
      },
      required: ["prompt"] as string[],
    },
  },
  {
    name: "pubblica_social",
    description: "Pubblica un post su Instagram, Facebook e/o LinkedIn. Può includere un'immagine (URL da genera_immagine o URL esterno). Per Instagram serve sempre un'immagine.",
    input_schema: {
      type: "object" as const,
      properties: {
        testo: { type: "string", description: "Caption/testo del post" },
        image_url: { type: "string", description: "URL dell'immagine da allegare (da genera_immagine o URL pubblico)" },
        piattaforme: {
          type: "array" as const,
          items: { type: "string" },
          description: "Array di piattaforme target. Formato: 'ig_USERNAME' per Instagram, 'fb_PAGEID' per Facebook, 'li' per LinkedIn. Es: ['ig_energizzo.it']",
        },
      },
      required: ["testo", "piattaforme"] as string[],
    },
  },
  // Catalogo prodotti/servizi
  {
    name: "lista_prodotti",
    description: "Mostra il catalogo prodotti e servizi dell'azienda con prezzi B2B e B2C, categorie e disponibilità.",
    input_schema: {
      type: "object" as const,
      properties: {
        categoria: { type: "string", description: "Filtra per categoria (opzionale)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "aggiungi_prodotto",
    description: "Aggiungi un prodotto o servizio al catalogo aziendale.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome del prodotto/servizio" },
        tipo: { type: "string", enum: ["product", "service"], description: "Tipo: product o service" },
        categoria: { type: "string", description: "Categoria (es: Farmaci, Vini rossi, Consulenza)" },
        unita: { type: "string", description: "Unità di misura (es: pz, kg, ora, confezione)" },
        prezzo_b2b: { type: "string", description: "Prezzo B2B per aziende" },
        prezzo_b2c: { type: "string", description: "Prezzo B2C al pubblico" },
        descrizione: { type: "string", description: "Descrizione del prodotto" },
        sku: { type: "string", description: "Codice articolo SKU (opzionale)" },
        quantita_magazzino: { type: "string", description: "Quantità disponibile in magazzino" },
        iva: { type: "string", description: "Aliquota IVA % (es: 22, 10, 4)" },
      },
      required: ["nome"] as string[],
    },
  },
  {
    name: "modifica_prodotto",
    description: "Modifica un prodotto/servizio esistente nel catalogo. Usa lista_prodotti per ottenere l'ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        prodotto_id: { type: "string", description: "ID del prodotto da modificare" },
        nome: { type: "string", description: "Nuovo nome" },
        prezzo_b2b: { type: "string", description: "Nuovo prezzo B2B" },
        prezzo_b2c: { type: "string", description: "Nuovo prezzo B2C" },
        disponibile: { type: "boolean", description: "true = disponibile, false = non disponibile" },
        descrizione: { type: "string", description: "Nuova descrizione" },
        categoria: { type: "string", description: "Nuova categoria" },
        unita: { type: "string", description: "Nuova unità" },
        sku: { type: "string", description: "Nuovo SKU" },
        quantita_magazzino: { type: "string", description: "Nuova quantità magazzino" },
        iva: { type: "string", description: "Nuova aliquota IVA %" },
      },
      required: ["prodotto_id"] as string[],
    },
  },
  {
    name: "elimina_prodotto",
    description: "Elimina un prodotto/servizio dal catalogo.",
    input_schema: {
      type: "object" as const,
      properties: {
        prodotto_id: { type: "string", description: "ID del prodotto da eliminare" },
      },
      required: ["prodotto_id"] as string[],
    },
  },
  // A2A — Rete B2B
  {
    name: "cerca_azienda_a2a",
    description: "Cerca aziende nella directory della Rete B2B per nome, settore, tag o zona geografica.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Testo di ricerca (nome azienda, settore, prodotto, servizio)" },
        zona: { type: "string", description: "Zona geografica (regione, provincia, città)" },
      },
      required: [] as string[],
    },
  },
  {
    name: "lista_partner_a2a",
    description: "Mostra la rubrica dei partner B2B collegati (connessioni attive) con il ruolo di ciascun partner (Fornitore, Cliente, ecc.).",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "invia_task_a2a",
    description: "Crea e invia un task (ordine, preventivo, messaggio, richiesta servizio) a un'azienda partner collegata.",
    input_schema: {
      type: "object" as const,
      properties: {
        azienda_id: { type: "string", description: "ID dell'azienda destinataria (da lista_partner_a2a o cerca_azienda_a2a)" },
        tipo: { type: "string", enum: ["message", "quote", "order", "service"], description: "Tipo: message (messaggio), quote (preventivo), order (ordine), service (richiesta servizio)" },
        titolo: { type: "string", description: "Titolo breve del task" },
        descrizione: { type: "string", description: "Descrizione dettagliata della richiesta" },
      },
      required: ["azienda_id", "titolo"] as string[],
    },
  },
  {
    name: "rispondi_task_a2a",
    description: "Rispondi a un task ricevuto da un'altra azienda e aggiorna lo stato.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ID del task a cui rispondere" },
        risposta: { type: "string", description: "Testo della risposta" },
        stato: { type: "string", enum: ["accepted", "rejected", "completed"], description: "Nuovo stato del task" },
      },
      required: ["task_id", "risposta"] as string[],
    },
  },
  {
    name: "lista_task_a2a",
    description: "Mostra i task B2B in entrata e uscita con filtri per direzione e stato.",
    input_schema: {
      type: "object" as const,
      properties: {
        direzione: { type: "string", enum: ["entrata", "uscita", "all"], description: "Filtra per direzione" },
        stato: { type: "string", enum: ["created", "accepted", "in_progress", "completed", "rejected", "cancelled"], description: "Filtra per stato" },
      },
      required: [] as string[],
    },
  },
  {
    name: "aggiorna_stato_task_a2a",
    description: "Cambia lo stato di un task B2B (accetta, rifiuta, completa, cancella).",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ID del task" },
        stato: { type: "string", enum: ["accepted", "rejected", "in_progress", "completed", "cancelled"], description: "Nuovo stato" },
      },
      required: ["task_id", "stato"] as string[],
    },
  },
  {
    name: "messaggio_a2a",
    description: "Invia un messaggio in un task B2B esistente.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "ID del task" },
        messaggio: { type: "string", description: "Testo del messaggio" },
      },
      required: ["task_id", "messaggio"] as string[],
    },
  },
  // Custom API Connectors
  {
    name: "crea_connettore_custom",
    description: "Crea un connettore per collegare un servizio esterno con API REST (CRM, gestionale, ecc.). Chiedi al cliente: nome servizio, URL API, API key.",
    input_schema: {
      type: "object" as const,
      properties: {
        nome: { type: "string", description: "Nome del servizio (es: Il Mio CRM)" },
        base_url: { type: "string", description: "URL base delle API (es: https://api.miocrm.com)" },
        api_key: { type: "string", description: "API key o token di accesso" },
        descrizione: { type: "string", description: "Breve descrizione di cosa fa il servizio" },
        auth_type: { type: "string", enum: ["bearer", "header", "none"], description: "Tipo autenticazione (default: bearer)" },
      },
      required: ["nome", "base_url", "api_key"],
    },
  },
  {
    name: "aggiungi_azione_custom",
    description: "Aggiunge un'azione a un connettore custom. Ogni azione diventa un tool disponibile per l'agente.",
    input_schema: {
      type: "object" as const,
      properties: {
        connector_id: { type: "string", description: "ID del connettore custom" },
        nome: { type: "string", description: "Nome azione snake_case (es: lista_clienti)" },
        label: { type: "string", description: "Nome leggibile (es: Lista Clienti)" },
        descrizione: { type: "string", description: "Cosa fa l'azione" },
        metodo: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Metodo HTTP" },
        path: { type: "string", description: "Path relativo (es: /api/clients)" },
        parametri: { type: "array", description: "Parametri accettati dall'azione" },
      },
      required: ["connector_id", "nome", "metodo", "path"],
    },
  },
  {
    name: "lista_connettori_custom",
    description: "Mostra i connettori API custom collegati dall'azienda con le loro azioni disponibili.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "rimuovi_connettore_custom",
    description: "Rimuove un connettore API custom e tutte le sue azioni.",
    input_schema: {
      type: "object" as const,
      properties: { connector_id: { type: "string", description: "ID del connettore da rimuovere" } },
      required: ["connector_id"],
    },
  },
  {
    name: "testa_connettore_custom",
    description: "Testa la connettività di un connettore custom verificando che l'URL base risponda.",
    input_schema: {
      type: "object" as const,
      properties: { connector_id: { type: "string", description: "ID del connettore da testare" } },
      required: ["connector_id"],
    },
  },
];

// Map each tool to the connector key it requires. null = always available.
export const TOOL_CONNECTOR: Record<string, string | null> = {
  lista_agenti: null,
  crea_task: null,
  stato_task: null,
  commenta_task: null,
  elimina_agente: null,
  crea_agente: null,
  esegui_task_agente: null,
  salva_info_azienda: null,
  cerca_piva_onboarding: null,
  salva_nota: null,
  leggi_memoria: null,
  // Project files
  leggi_file_progetto: null,
  // Google Drive
  cerca_file_drive: "drive",
  leggi_file_drive: "drive",
  // Fatture in Cloud
  lista_clienti: "fic",
  cerca_cliente: "fic",
  crea_cliente: "fic",
  crea_fattura: "fic",
  lista_fatture: "fic",
  invia_fattura_sdi: "fic",
  // OpenAPI.it
  cerca_azienda_piva: "oai_company",
  cerca_azienda_nome: "oai_company",
  codice_sdi: "oai_company",
  credit_score: "oai_risk",
  cerca_cap: "oai_cap",
  crea_attivita_programmata: null,
  lista_attivita_programmate: null,
  elimina_attivita_programmata: null,
  // PEC
  lista_pec: "pec",
  leggi_pec: "pec",
  invia_pec: "pec",
  rispondi_pec: "pec",
  // Stripe
  stripe_lista_clienti: "stripe",
  stripe_cerca_cliente: "stripe",
  stripe_crea_cliente: "stripe",
  stripe_lista_pagamenti: "stripe",
  stripe_crea_link_pagamento: "stripe",
  stripe_verifica_abbonamento: "stripe",
  riassunto_conversazioni_wa: "whatsapp",
  genera_immagine: "fal",
  pubblica_social: "meta", // delegato all'agente con connettore Meta attivo
  // Catalogo prodotti
  lista_prodotti: null,
  aggiungi_prodotto: null,
  modifica_prodotto: null,
  elimina_prodotto: null,
  // A2A — Rete B2B (always available, profile check is in the tool implementation)
  cerca_azienda_a2a: null,
  lista_partner_a2a: null,
  invia_task_a2a: null,
  rispondi_task_a2a: null,
  lista_task_a2a: null,
  aggiorna_stato_task_a2a: null,
  messaggio_a2a: null,
  // Custom API Connectors (CEO orchestration tools)
  crea_connettore_custom: null,
  aggiungi_azione_custom: null,
  lista_connettori_custom: null,
  rimuovi_connettore_custom: null,
  testa_connettore_custom: null,
};


// --- CEO SYSTEM PROMPT v3 ---
// Built dynamically from buildCeoPrompt() — the constant below is the base.
// Connector guides and tool lists are appended at runtime so adding a new
// connector/tool automatically updates every CEO.

const CEO_PROMPT_BASE = `Sei il CEO AI dell'azienda del cliente sulla piattaforma GoItalIA.
Non sei un assistente. Non sei un chatbot. Sei il direttore operativo digitale che gestisce l'intera infrastruttura aziendale AI del cliente.

Lingua: Italiano (sempre, senza eccezioni).
Tono: Professionale ma diretto. Come un AD competente che parla al proprio socio.

## PRINCIPI OPERATIVI

### 1. Fai, non descrivere
NON dire "Potrei creare una fattura per te". Crea la fattura e poi dì "Fatto. Fattura #247 emessa a Rossi Srl per €3.200 + IVA. Vuoi che la invii via PEC?"

### 2. Decidi, poi informa
Agisci e comunica. Chiedi conferma solo per:
- Operazioni finanziarie sopra soglia
- Comunicazioni esterne ufficiali
- Cancellazioni o modifiche irreversibili

### 3. Un interlocutore, zero complessità
Il cliente parla solo con te. Non deve sapere quale agente esegue cosa. Tu sei il front-end di tutta l'infrastruttura.

### 4. Proattività
Se noti problemi o opportunità, segnalali con azione concreta proposta.

## ONBOARDING NUOVO CLIENTE
Quando un nuovo cliente arriva (nessuna info aziendale in memoria):
1. Presentati: "Ciao! Sono il CEO della tua azienda AI su GoItalIA."
2. Chiedi SOLO la Partita IVA: "Per iniziare, dimmi la Partita IVA della tua azienda."
3. Usa il tool cerca_piva_onboarding con la PIVA fornita
4. Se trovata: mostra TUTTI i dati trovati al titolare senza omettere nulla — ragione sociale, PIVA, CF, forma giuridica, stato attività, data inizio, indirizzo completo (via, CAP, città, provincia, regione), ATECO, PEC, codice SDI, fatturato, patrimonio netto, capitale sociale, totale attivo, dipendenti, costo personale, soci con quote %, risk score, rating, severità rischio, limite credito operativo. Poi chiedi conferma: "Confermi che è la tua azienda?"
5. Se confermato: salva TUTTO in UNA SOLA chiamata a salva_info_azienda con TUTTI i campi disponibili: ragione_sociale, partita_iva, codice_fiscale, indirizzo, citta, cap, provincia, regione, settore (descrizione ATECO + codice), forma_giuridica, stato_attivita, data_inizio, pec, codice_sdi, dipendenti, fatturato, patrimonio_netto, capitale_sociale, totale_attivo, risk_score, rating, risk_severity, credit_limit, soci. NON usare salva_nota per questi dati — metti TUTTO in salva_info_azienda
6. Chiedi: "Perfetto! C'è qualcos'altro che vuoi dirmi sulla tua azienda? Servizi particolari, specialità, obiettivi?"
7. Salva eventuali info aggiuntive con salva_nota
8. DOPO IL RIEPILOGO: scrivi ESATTAMENTE: "Perfetto! Premi il bottone qui sotto per andare ai Connettori e collegare i tuoi servizi (Google, WhatsApp, Telegram, ecc.). Dopo aver collegato i connettori potrai creare i tuoi agenti AI specializzati."
9. NON proporre agenti da creare. NON elencare agenti possibili. Il cliente deve PRIMA collegare i connettori.

Se cerca_piva_onboarding fallisce (PIVA non trovata o errore):
- Chiedi i dati manualmente: ragione sociale, indirizzo sede, settore/attività, PEC, telefono, email
- Salva con salva_info_azienda

## CREAZIONE AGENTI — IL FLUSSO GUIDATO

Gli agenti NON esistono a priori e NON si creano automaticamente.
Il flusso è sempre:
1. Il cliente attiva un connettore dalla dashboard
2. Il cliente preme "Crea Agente"
3. Il cliente viene riportato nella chat con te
4. TU e IL CLIENTE insieme definite l'agente
5. Tu crei l'agente con crea_agente usando la configurazione concordata

Tu sei il configuratore. Guidi il cliente con domande intelligenti e costruisci il prompt dell'agente dalla conversazione.

### Come ti comporti quando arriva "Crea agente"

**Fase 1 — Benvenuto:** "Vedo che hai attivato [connettore]. Ottimo, creiamo insieme il tuo agente. Ti faccio qualche domanda per configurarlo al meglio."

**Fase 2 — Domande chiave (adatta al connettore):**
1. Obiettivo principale — "Cosa vuoi che faccia principalmente? Per esempio..." (3-4 esempi concreti)
2. Autonomia — "Quanto vuoi che sia autonomo? Deve chiederti conferma prima di [azione critica] o può andare in automatico?"
3. Tono e stile (se comunicazione esterna) — "Che tono deve usare? Formale, informale, via di mezzo?"
4. Limiti — "C'è qualcosa che NON deve assolutamente fare?"
5. Contesto aziendale — pesca dalla memoria per suggerire configurazioni smart

**Nomi agenti — REGOLE OBBLIGATORIE:**
Il formato nome è SEMPRE: AG. + identificativo specifico dell'account/bot/numero collegato. Esempi:
- Google Workspace (email mario@azienda.it) → "AG. mario@azienda.it"
- Telegram bot @miobot → "AG. @miobot"
- WhatsApp +39333xxx → "AG. +39333xxx"
- Instagram account @energizzo.it → "AG. @energizzo.it"
- LinkedIn profilo Mario Rossi → "AG. Mario Rossi LinkedIn"
- Fal.ai → "AG. Fal"
- Fatture in Cloud → "AG. Fatture"
- OpenAPI.it → "AG. OpenAPI"
- Vocali AI → "AG. Vocali"
Usa SEMPRE l'identificativo specifico (username, email, numero) quando disponibile nel messaggio del cliente.
NON inventare nomi creativi. NON usare nomi come Postino, Segretario, Concierge, Scout, ecc. SOLO il formato AG. + identificativo.

**Fase 3 — Riepilogo e conferma:**
"Ricapitolo l'agente: Nome: [nome] | Connettore: [connettore] | Scope: [cosa fa] | Limiti: [cosa non fa] | Autonomia: [livello] | Tono: [se applicabile]. Creo l'agente così o vuoi modificare qualcosa?"

**Fase 4 — Creazione:**
1. Chiama crea_agente con prompt costruito dalla conversazione, il campo connettore (es: "whatsapp", "google", "telegram", "meta", "fic", ecc.) E il campo account_id con l'identificativo specifico dell'account (es: "@energizzo.it" per Instagram, "@nomebot" per Telegram, "+39xxx" per WhatsApp, "email@example.com" per Google)
2. L'agente verrà creato con SOLO quell'account specifico attivo — non tutti gli account del connettore
3. Conferma: "Agente creato! [nome] è pronto e ha accesso a [connettore]."

**Fase 5 — Suggerimento flussi multi-connettore (IMPORTANTE):**
Se il cliente ha PIÙ connettori attivi, DOPO aver creato l'agente suggerisci:
"Tip: [nome agente] ora ha accesso solo a [connettore]. Se vuoi creare flussi avanzati (per esempio generare una fattura e inviarla via WhatsApp, o creare un post social con un'immagine generata da Fal.ai), puoi andare nella pagina dell'agente → tab Connettori e abilitare altri servizi."
Proponi 1-2 esempi concreti di flussi basati sui connettori che il cliente ha effettivamente attivi.

## ORCHESTRAZIONE — Delegazione Obbligatoria

Tu NON hai tool per i connettori (Gmail, Drive, Fatture, PEC, Stripe, WhatsApp, social, generazione immagini, OpenAPI).
Per QUALSIASI operazione che richiede un connettore, DEVI delegare a un agente specializzato.

### Flusso di delegazione
1. Quando l'utente chiede qualcosa che richiede un connettore (es: "manda una mail", "fai una fattura", "pubblica su Instagram"):
2. Usa lista_agenti per vedere quali agenti ci sono e quali connettori hanno
3. Trova l'agente giusto per il compito
4. Usa esegui_task_agente con istruzioni DETTAGLIATE e CONTESTO completo (info cliente, dati dalla conversazione, riferimenti)
5. L'agente esegue con i suoi tool
6. Tu riporti il risultato all'utente

### Se non c'è un agente per il compito
Se l'utente chiede qualcosa che richiede un connettore attivo ma nessun agente lo ha:
1. Crea l'agente automaticamente con crea_agente — nome formato "AG. [identificativo]", connettore giusto, istruzioni di base
2. Poi delega subito il compito con esegui_task_agente
3. Dì all'utente: "Ho creato l'agente [nome] per gestire [connettore]. [risultato dell'operazione]"

### Se il connettore non è attivo
Se il compito richiede un connettore che l'azienda non ha collegato:
- Dì: "Per fare questo serve collegare [connettore]. Vai su Connettori nella sidebar per attivarlo."

### Multi-agente
Per operazioni che coinvolgono più connettori, coordina più agenti in sequenza:
- Esempio: "Fai fattura a Rossi e mandagliela via PEC" → delega a AG. Fatture per creare la fattura, poi a AG. PEC per inviarla
- Passa il risultato del primo agente come contesto al secondo

### Contesto nella delegazione
SEMPRE passa contesto rilevante quando deleghi:
- Info sul cliente/destinatario dalla conversazione
- Dati aziendali pertinenti
- Risultati di operazioni precedenti
- Preferenze espresse dall'utente

### Regola d'oro
NON dire "Non posso farlo direttamente". Tu per l'utente fai tutto — delega dietro le quinte. L'utente non deve sapere che stai delegando. Agisci e comunica il risultato.

## CONNETTORI CUSTOM — API Esterne
Se il cliente dice di avere un CRM, gestionale, magazzino, o qualsiasi servizio con API:
1. Chiedi: "Come si chiama il servizio?"
2. Chiedi: "Qual è l'URL delle API?" (es: https://api.miocrm.com)
3. Chiedi: "Hai una API key o token di accesso?"
4. Usa crea_connettore_custom per registrarlo
5. Chiedi: "Cosa vuoi poterci fare?" (es: cercare clienti, creare ordini, vedere fatture)
6. Per ogni operazione usa aggiungi_azione_custom con metodo HTTP e path appropriati
7. Testa con testa_connettore_custom
8. Crea un agente dedicato con crea_agente e connettore custom
Non serve che il cliente conosca i dettagli tecnici — chiedigli cosa vuole fare e deduci metodo/path.

## ATTIVITÀ PROGRAMMATE
Puoi creare attività che vengono eseguite automaticamente a orari predefiniti:
- Usa crea_attivita_programmata per schedulare azioni ricorrenti
- Esempi: "pubblica post su IG ogni giorno alle 12", "manda report vendite ogni lunedì alle 9"
- Modalità con approvazione (default): l'agente prepara il contenuto, il cliente approva prima dell'esecuzione
- Modalità automatica: l'agente esegue senza conferma
- Usa lista_attivita_programmate per vedere le attività attive
- Usa elimina_attivita_programmata per rimuoverne una

## MODIFICA AGENTI
Il cliente può tornare e dire:
- "Modifica l'agente [nome]" → apri sessione di riconfigurazione
- "L'agente [nome] fa [cosa sbagliata]" → correggi il prompt
- "Elimina l'agente [nome]" → conferma e rimuovi
- "Che agenti ho attivi?" → lista_agenti con stato e riepilogo

## MEMORIA
Hai accesso alla memoria dell'azienda. Usala SEMPRE:
- Prima di rispondere, controlla se hai già le info con leggi_memoria
- Quando il cliente ti dà info importanti, salvale subito
- Se dice "ricorda che...", usa salva_nota immediatamente
- Info aziendali → salva_info_azienda (strutturate)
- Tutto il resto → salva_nota (note libere)
- MAI memorizzare password, credenziali, token

## SICUREZZA E PRIVACY
- I dati in memoria sono dell'azienda del CLIENTE. Puoi usarli — sono i SUOI dati.
- Quando crei un agente per un connettore, usa i dati specifici che arrivano nel messaggio (email, username, numero). NON usare la mail di contatto dell'azienda come email del connettore — sono cose diverse.

## COMPLIANCE
- No consulenza fiscale/legale specifica — indirizzi al professionista
- No operazioni bancarie dirette
- No decisioni irreversibili senza conferma
- Su temi fiscali chiudi con: "Per validazione fiscale/legale, conferma col tuo commercialista."

## TONO
- Diretto — vai al punto
- Competente — parla con cognizione
- Proattivo — anticipa
- Italiano vero — "Ti mando la fattura" non "Provvederò all'emissione"
- Usa "noi" quando parli dell'azienda del cliente
- Se deleghi dì "Ho chiesto a [nome agente] di..."`;

// --- Connector guides for agent creation ---
// Each entry describes what to ask the client when creating an agent for that connector.
// Adding a new connector here automatically makes it available in the CEO prompt.

interface ConnectorGuide {
  key: string;          // matches secret name check
  label: string;
  capabilities: string;
  questions: string[];
  suggestions: string[];
}

const CONNECTOR_GUIDES: ConnectorGuide[] = [
  {
    key: "google",
    label: "Google Workspace",
    capabilities: "Gmail, Calendar, Drive, Sheets, Docs",
    questions: [
      "Vuoi che gestisca le email? Deve rispondere in autonomia o solo segnalarti quelle importanti?",
      "Calendario: deve poter creare eventi e invitare persone, o solo consultare la tua agenda?",
      "Sheets: hai fogli specifici che usa regolarmente? (es. pipeline clienti, tracking ore)",
      "Drive: deve poter creare e condividere documenti o solo cercare file esistenti?",
    ],
    suggestions: [
      "Abilita la lettura email con filtro priorità — segnala solo quelle importanti senza rumore",
      "Se hai un foglio pipeline clienti, possiamo collegarlo per report automatici",
    ],
  },
  {
    key: "telegram",
    label: "Telegram",
    capabilities: "Bot multi-account, messaggi, auto-reply, vision AI",
    questions: [
      "Telegram lo usi per notifiche interne (alert a te/team) o anche verso clienti?",
      "Vuoi un canale/gruppo dove l'agente posta aggiornamenti?",
      "Che tipo di notifiche vuoi ricevere? (scadenze, email importanti, pagamenti, tutto)",
      "Deve rispondere in autonomia ai messaggi o solo notificarti?",
    ],
    suggestions: [
      "Puoi usare Telegram come canale di alert per eventi importanti dagli altri connettori",
    ],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    capabilities: "Messaggi, vocali (con trascrizione AI), auto-reply via WaSender",
    questions: [
      "WhatsApp lo usi per comunicare con i clienti, con il team interno, o entrambi?",
      "Deve poter rispondere in autonomia ai messaggi o solo notificarti?",
      "Hai messaggi tipo che mandi spesso? (conferme appuntamento, promemoria pagamento, ecc.)",
      "Ci sono orari fuori dai quali NON deve mai scrivere ai clienti?",
    ],
    suggestions: [
      "Possiamo creare template per le comunicazioni ricorrenti — conferme, promemoria, auguri",
      "Se attivi Vocali AI, l'agente trascriverà automaticamente i vocali ricevuti",
    ],
  },
  {
    key: "meta",
    label: "Instagram + Facebook",
    capabilities: "Post, stories, commenti, DM, analytics via Meta",
    questions: [
      "Che tipo di contenuti pubblicate? Prodotti, servizi, behind the scenes, educational?",
      "Quante volte a settimana vuoi pubblicare?",
      "Deve rispondere ai commenti e DM? Con che tono?",
      "Ci sono argomenti o toni da evitare assolutamente?",
    ],
    suggestions: [
      "Se attivi anche Fal.ai possiamo generare le grafiche direttamente — zero lavoro manuale",
      "Ti consiglio un report engagement settimanale per capire cosa funziona",
    ],
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    capabilities: "Post, articoli, commenti, analytics pagina",
    questions: [
      "LinkedIn lo usi per brand awareness, recruiting, o entrambi?",
      "Preferisci un tono istituzionale o più personale/thought leadership?",
      "Pubblicate dal profilo aziendale, personale, o entrambi?",
    ],
    suggestions: [
      "Post LinkedIn con contenuto educativo/thought leadership generano più engagement",
    ],
  },
  {
    key: "fal",
    label: "Fal.ai",
    capabilities: "Generazione immagini (Nano Banana 2) e video (Veo 3.1, Kling v3, Seedance 1.5)",
    questions: [
      "Lo userai principalmente per i social, per materiale marketing, o altro?",
      "Hai uno stile visivo / brand guideline da rispettare? (colori, mood, stile)",
      "Preferisci immagini fotorealistiche, illustrate, minimal?",
    ],
    suggestions: [
      "Se mi dai le brand guidelines le salvo in memoria — ogni immagine generata sarà coerente col tuo brand",
    ],
  },
  {
    key: "fic",
    label: "Fatture in Cloud",
    capabilities: "Fatture, preventivi, anagrafica clienti/fornitori, SDI, fatturazione elettronica",
    questions: [
      "Vuoi che emetta fatture in autonomia o solo che le prepari per la tua approvazione?",
      "C'è una soglia d'importo sotto la quale può andare da solo? (es. sotto €500)",
      "Vuoi alert sulle fatture scadute? Dopo quanti giorni?",
      "Il tuo commercialista ha bisogno di export periodici?",
    ],
    suggestions: [
      "Alert automatico: fatture scadute > 7 giorni → notifica immediata",
      "Possiamo collegarlo a Google Sheets per un cruscotto fatturato aggiornato",
    ],
  },
  {
    key: "openapi",
    label: "OpenAPI.it",
    capabilities: "Dati aziendali, visure camerali, risk score, codice SDI, CAP, PEC",
    questions: [
      "Fai spesso visure su nuovi clienti o fornitori? Possiamo automatizzare il check",
      "Vuoi che verifichi automaticamente la P.IVA per ogni nuovo cliente?",
      "Ti serve il credit score per valutare nuovi clienti?",
    ],
    suggestions: [
      "Check automatico P.IVA per ogni nuovo cliente — prima di fare fattura verifica che sia attiva",
    ],
  },
  {
    key: "voice",
    label: "Vocali AI",
    capabilities: "Trascrizione automatica vocali WhatsApp e Telegram in testo via OpenAI Whisper",
    questions: [
      "Vuoi che trascriva tutti i vocali o solo quelli sopra una certa durata?",
      "La trascrizione deve essere visibile solo a te o anche al mittente?",
    ],
    suggestions: [
      "Funziona automaticamente su WhatsApp e Telegram — ogni vocale viene trascritto in testo",
    ],
  },
  {
    key: "stripe",
    label: "Stripe",
    capabilities: "Clienti, pagamenti, link di pagamento, abbonamenti, fatture Stripe",
    questions: [
      "Hai clienti ricorrenti o fai pagamenti one-shot?",
      "Vuoi che l'agente crei link di pagamento da mandare via WhatsApp o email?",
      "Vuoi ricevere alert quando arriva un pagamento o quando uno fallisce?",
      "Gestisci abbonamenti? Vuoi un alert se un cliente non rinnova?",
    ],
    suggestions: [
      "Posso creare link di pagamento direttamente da WhatsApp — il cliente riceve il link e paga in pochi secondi",
      "Alert automatico: pagamento ricevuto → notifica Telegram/WhatsApp con dettagli",
      "Posso collegarlo a Fatture in Cloud — pagamento Stripe → fattura automatica",
    ],
  },
  {
    key: "pec",
    label: "PEC (Posta Certificata)",
    capabilities: "Invio e ricezione PEC, ricevute di accettazione e consegna, valore legale",
    questions: [
      "Quale provider PEC usi? (Aruba, Poste Italiane, Legalmail, altro)",
      "Per cosa usi principalmente la PEC? Fatture, contratti, comunicazioni PA?",
      "Vuoi che l'agente risponda automaticamente alle PEC o preferisci approvare prima dell'invio?",
    ],
    suggestions: [
      "Posso monitorare le PEC in arrivo e avvisarti delle più importanti",
      "Posso preparare risposte PEC e farle approvare prima dell'invio — valore legale preservato",
      "Posso collegare PEC + Fatture in Cloud per inviare fatture via PEC certificata",
    ],
  },
  {
    key: "custom",
    label: "API Custom",
    capabilities: "Collegamento a qualsiasi servizio esterno con API REST (CRM, gestionale, magazzino, e-commerce)",
    questions: [
      "Che servizio vuoi collegare? (CRM, gestionale, magazzino, ecc.)",
      "Hai l'URL delle API e una API key o token di accesso?",
      "Che operazioni vuoi fare con questo servizio? (cercare clienti, creare ordini, vedere fatture...)",
    ],
    suggestions: [
      "Posso collegare qualsiasi servizio con API REST — basta l'URL e una API key",
      "Dopo aver collegato il servizio, creiamo le azioni specifiche che ti servono",
    ],
  },
];

// Build connector guide section for CEO prompt
function buildConnectorGuides(): string {
  let s = "\n\n## GUIDA CONNETTORI — Cosa suggerire durante la creazione agente\n\n";
  for (const c of CONNECTOR_GUIDES) {
    s += `### ${c.label}\nCapacità: ${c.capabilities}\nDomande da fare:\n`;
    for (const q of c.questions) s += `- "${q}"\n`;
    s += "Suggerimenti proattivi:\n";
    for (const sg of c.suggestions) s += `- "${sg}"\n`;
    s += "\n";
  }
  return s;
}

// Build tool list section dynamically — CEO sees only orchestration tools
function buildToolList(): string {
  let s = "\n\n## I TUOI TOOL\n\nQuesti sono i tool che puoi usare direttamente:\n";
  for (const tool of TOOLS) {
    if (CEO_TOOLS.has(tool.name)) {
      s += `- ${tool.name}: ${tool.description}\n`;
    }
  }
  s += "\n### Tool disponibili tramite agenti (usa esegui_task_agente)\n";
  s += "Gli agenti specializzati hanno accesso ai tool dei connettori collegati (Gmail, Calendar, Drive, Fatture in Cloud, PEC, Stripe, WhatsApp, social, generazione immagini, OpenAPI). Delega a loro.\n";
  return s;
}

// A2A guide appended to CEO prompt
const A2A_PROMPT_GUIDE = `

## RETE A2A — Comunicazione tra CEO AI
Sei collegato alla Rete A2A di GoItalIA. Puoi comunicare con QUALSIASI CEO AI di altre aziende sulla piattaforma che hanno attivato A2A. Non serve essere "collegati" per comunicare.

### Come funziona
- **Directory**: cerca aziende per nome, settore, zona, tag con cerca_azienda_a2a
- **Partner (rubrica)**: vedi i partner abituali (fornitori, clienti) con lista_partner_a2a — è la tua rubrica dei contatti frequenti
- **Task**: invia ordini, preventivi, messaggi a QUALSIASI azienda con A2A attivo usando invia_task_a2a
- **Risposte**: rispondi ai task ricevuti con rispondi_task_a2a

### Comunicazione aperta vs Partner
- Puoi inviare task a qualsiasi azienda con A2A attivo, NON serve essere partner collegati
- I **Partner** sono la tua rubrica di contatti abituali (fornitori, clienti con cui lavori regolarmente)
- Quando il titolare dice "ordina dal mio fornitore di vini", usa PRIMA lista_partner_a2a per trovare il partner tramite il relationship_label — il partner ha già l'ID, non devi cercare
- Quando il titolare nomina un'azienda che NON è tra i partner, cerca nella directory con cerca_azienda_a2a e comunica direttamente

### Regole di comportamento A2A
- Per task tipo "order" (ordini) chiedi SEMPRE conferma al titolare prima di accettare o completare — "Confermo l'ordine di [dettagli]?"
- Per richieste info, listini, prezzi, preventivi: puoi rispondere automaticamente se hai le informazioni in memoria
- Per conferma ordini, pagamenti, impegni economici: CHIEDI SEMPRE approvazione al titolare prima di procedere
- Se la Rete A2A non è attiva, suggerisci al titolare di attivarla dalla pagina A2A nella sidebar
`;

// Assemble the full CEO prompt (called at request time, so new connectors/tools are picked up)
function buildCeoPrompt(): string {
  return CEO_PROMPT_BASE + buildConnectorGuides() + A2A_PROMPT_GUIDE + buildToolList();
}

// Tools the CEO can use directly (orchestration only, no connector tools)
const CEO_TOOLS = new Set([
  // Orchestrazione agenti
  "lista_agenti",
  "crea_agente",
  "elimina_agente",
  "esegui_task_agente",
  // Task management
  "crea_task",
  "stato_task",
  "commenta_task",
  // Memoria e info aziendali
  "salva_info_azienda",
  "cerca_piva_onboarding",
  "salva_nota",
  "leggi_memoria",
  // File progetto
  "leggi_file_progetto",
  // Attività programmate
  "crea_attivita_programmata",
  "lista_attivita_programmate",
  "elimina_attivita_programmata",
  // Catalogo prodotti
  "lista_prodotti",
  "aggiungi_prodotto",
  "modifica_prodotto",
  "elimina_prodotto",
  // A2A Rete B2B
  "cerca_azienda_a2a",
  "lista_partner_a2a",
  "invia_task_a2a",
  "rispondi_task_a2a",
  "lista_task_a2a",
  "aggiorna_stato_task_a2a",
  "messaggio_a2a",
  // Custom API Connectors
  "crea_connettore_custom",
  "aggiungi_azione_custom",
  "lista_connettori_custom",
  "rimuovi_connettore_custom",
  "testa_connettore_custom",
]);

// Tools that ONLY the CEO can use (agents must never have these)
const CEO_ONLY_TOOLS = new Set([
  "lista_agenti",
  "crea_agente",
  "elimina_agente",
  "esegui_task_agente",
  "crea_task",
  "stato_task",
  "commenta_task",
  "cerca_piva_onboarding",
  "crea_attivita_programmata",
  "lista_attivita_programmate",
  "elimina_attivita_programmata",
  // A2A — only CEO orchestrates B2B
  "cerca_azienda_a2a",
  "lista_partner_a2a",
  "invia_task_a2a",
  "rispondi_task_a2a",
  "lista_task_a2a",
  "aggiorna_stato_task_a2a",
  "messaggio_a2a",
  // Custom connector CEO tools
  "crea_connettore_custom",
  "aggiungi_azione_custom",
  "lista_connettori_custom",
  "rimuovi_connettore_custom",
  "testa_connettore_custom",
]);

export function filterToolsForAgent(agentRole: string, connectors: Record<string, boolean>): typeof TOOLS {
  if (agentRole === "ceo") {
    // CEO gets only orchestration tools, not connector tools
    return TOOLS.filter((tool) => CEO_TOOLS.has(tool.name));
  }

  return TOOLS.filter((tool) => {
    // Agents never get CEO-only tools
    if (CEO_ONLY_TOOLS.has(tool.name)) return false;
    const required = TOOL_CONNECTOR[tool.name];
    // Tool with no connector requirement = always available (memoria, catalogo, file)
    if (required === null || required === undefined) return true;
    // Check if connector is explicitly enabled
    return connectors[required] === true;
  });
}

// Generate dynamic tool definitions from custom connectors
async function getCustomToolsForCompany(db: Db, companyId: string): Promise<typeof TOOLS> {
  const connectors = await db.select().from(customConnectors)
    .where(eq(customConnectors.companyId, companyId));
  const tools: typeof TOOLS = [];
  for (const connector of connectors) {
    for (const action of (connector.actions as any[]) || []) {
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const param of (action.params || [])) {
        properties[param.name] = { type: param.type || "string", description: param.description || param.name };
        if (param.required) required.push(param.name);
      }
      tools.push({
        name: `custom_${connector.slug}_${action.name}`,
        description: `[${connector.name}] ${action.description || action.label || action.name}`,
        input_schema: { type: "object" as const, properties, required },
      });
    }
  }
  return tools;
}

/**
 * Build the connectors Record<string, boolean> from agent_connector_accounts.
 * Falls back to adapterConfig.connectors if no rows found (backward compat during migration).
 */
export async function getAgentConnectorsFromDb(
  db: Db,
  agentId: string,
  fallbackConnectors?: Record<string, boolean>,
): Promise<Record<string, boolean>> {
  const rows = await db.select({
    connectorType: connectorAccounts.connectorType,
    accountId: connectorAccounts.accountId,
  })
    .from(agentConnectorAccounts)
    .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
    .where(eq(agentConnectorAccounts.agentId, agentId));

  // Fallback to legacy adapterConfig.connectors if no relational data yet
  if (rows.length === 0 && fallbackConnectors && Object.keys(fallbackConnectors).length > 0) {
    return fallbackConnectors;
  }

  const connectors: Record<string, boolean> = {};
  for (const row of rows) {
    const t = row.connectorType;
    const acct = row.accountId;
    if (t === "google") {
      connectors.gmail = true; connectors.calendar = true; connectors.drive = true;
      connectors.sheets = true; connectors.docs = true;
    } else if (t === "telegram") {
      connectors["tg_" + acct] = true;
    } else if (t === "whatsapp") {
      connectors.whatsapp = true;
    } else if (t === "meta_ig") {
      connectors["ig_" + acct] = true;
      connectors.meta = true;
    } else if (t === "meta_fb") {
      connectors["fb_" + acct] = true;
      connectors.meta = true;
    } else if (t === "linkedin") {
      connectors.linkedin = true;
    } else if (t === "fal") {
      connectors.fal = true;
    } else if (t === "fic") {
      connectors.fic = true;
    } else if (t === "openapi") {
      connectors.oai_company = true; connectors.oai_risk = true;
      connectors.oai_cap = true; connectors.oai_sdi = true;
    } else if (t === "voice") {
      connectors.voice = true;
    }
  }
  return connectors;
}

async function getOaiToken(db: Db, companyId: string, service: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "openapi_it_creds")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const creds = JSON.parse(decrypt(secret.description));
    return creds.tokens?.[service] || null;
  } catch { return null; }
}
// Lock to prevent parallel token refreshes for the same company
const googleRefreshLocks = new Map<string, Promise<string | null>>();

async function getGoogleTokenForChat(db: Db, companyId: string): Promise<string | null> {
  // If a refresh is already in progress for this company, wait for it
  const existing = googleRefreshLocks.get(companyId);
  if (existing) return existing;

  const promise = _getGoogleTokenForChatImpl(db, companyId);
  googleRefreshLocks.set(companyId, promise);
  try { return await promise; } finally { googleRefreshLocks.delete(companyId); }
}

async function _getGoogleTokenForChatImpl(db: Db, companyId: string): Promise<string | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "google_oauth_tokens")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const decrypted = JSON.parse(decrypt(secret.description));
    const accounts = Array.isArray(decrypted) ? decrypted : [decrypted];
    const tokenData = accounts[0];
    if (!tokenData) return null;
    if (tokenData.expires_at && tokenData.expires_at < Date.now() && tokenData.refresh_token) {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "", refresh_token: tokenData.refresh_token, grant_type: "refresh_token" }),
      });
      if (res.ok) {
        const t = await res.json() as { access_token: string; expires_in: number };
        tokenData.access_token = t.access_token;
        tokenData.expires_at = Date.now() + t.expires_in * 1000;
        accounts[0] = tokenData;
        await db.update(companySecrets).set({ description: encrypt(JSON.stringify(accounts)), updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
      }
    }
    return tokenData.access_token || null;
  } catch { return null; }
}

async function getFicTokenForChat(db: Db, companyId: string): Promise<{ access_token: string; fic_company_id: number } | null> {
  const secret = await db.select().from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fattureincloud_tokens")))
    .then((r) => r[0]);
  if (!secret?.description) return null;
  try {
    const data = JSON.parse(decrypt(secret.description));
    // Refresh if expired
    if (data.expiresAt && data.expiresAt < Date.now() && data.refresh_token) {
      try {
        const r = await fetch("https://api-v2.fattureincloud.it/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: process.env.FIC_CLIENT_ID || "",
            client_secret: process.env.FIC_CLIENT_SECRET || "",
            refresh_token: data.refresh_token,
          }),
        });
        if (r.ok) {
          const tokens = await r.json() as any;
          data.access_token = tokens.access_token;
          data.refresh_token = tokens.refresh_token;
          data.expiresAt = Date.now() + (tokens.expires_in || 86400) * 1000;
          const enc = encrypt(JSON.stringify(data));
          await db.update(companySecrets).set({ description: enc, updatedAt: new Date() }).where(eq(companySecrets.id, secret.id));
        }
      } catch (e) { console.error("[chat] FIC refresh error:", e); }
    }
    return data;
  } catch (e) { console.error("[chat] FIC decrypt error:", e); return null; }
}

type ToolInput = Record<string, unknown>;


// Human-friendly labels for agent tool progress messages
const TOOL_PROGRESS_LABELS: Record<string, string> = {
  genera_immagine: "Generando immagine...",
  pubblica_social: "Pubblicando sui social...",
  invia_mail: "Inviando email...",
  leggi_mail: "Leggendo email...",
  cerca_file_drive: "Cercando file su Drive...",
  leggi_file_drive: "Leggendo file da Drive...",
  crea_fattura: "Creando fattura...",
  lista_fatture: "Recuperando fatture...",
  lista_clienti: "Recuperando lista clienti...",
  cerca_cliente: "Cercando cliente...",
  crea_cliente: "Creando cliente...",
  invia_fattura_sdi: "Inviando fattura via SDI...",
  lista_pec: "Leggendo PEC...",
  leggi_pec: "Leggendo messaggio PEC...",
  invia_pec: "Inviando PEC...",
  rispondi_pec: "Rispondendo via PEC...",
  stripe_lista_clienti: "Recuperando clienti Stripe...",
  stripe_cerca_cliente: "Cercando cliente Stripe...",
  stripe_crea_cliente: "Creando cliente Stripe...",
  stripe_lista_pagamenti: "Recuperando pagamenti...",
  stripe_crea_link_pagamento: "Creando link di pagamento...",
  stripe_verifica_abbonamento: "Verificando abbonamento...",
  riassunto_conversazioni_wa: "Riassumendo conversazioni WhatsApp...",
  cerca_azienda_piva: "Cercando azienda per PIVA...",
  cerca_azienda_nome: "Cercando azienda per nome...",
  credit_score: "Verificando credit score...",
  codice_sdi: "Recuperando codice SDI...",
  cerca_cap: "Cercando CAP...",
};

async function executeAgentTask(
  db: Db,
  companyId: string,
  targetAgentId: string,
  istruzioni: string,
  apiKey: string,
  contesto?: string,
  onProgress?: (message: string, toolName?: string) => void,
): Promise<string> {
  // 1. Load the target agent
  const agent = await db.select().from(agents)
    .where(eq(agents.id, targetAgentId))
    .then((rows) => rows[0]);
  
  if (!agent) return "Errore: agente non trovato con ID " + targetAgentId;

  const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
  const agentModel = (typeof adapterConfig?.model === "string" && adapterConfig.model) || "claude-haiku-4-5-20251001";
  const legacyConnectors = (adapterConfig?.connectors as Record<string, boolean>) || {};
  const connectors = await getAgentConnectorsFromDb(db, targetAgentId, legacyConnectors);
  const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
  const capabilities = agent.capabilities ?? "";

  // 2. Build agent system prompt
  const basePrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\nCompetenze: ${capabilities}\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo conciso e operativo.`;
  const customInstructions = typeof adapterConfig?.customInstructions === "string" ? adapterConfig.customInstructions : "";
  const systemPrompt = customInstructions.trim() ? basePrompt + "\n\n## ISTRUZIONI AGGIUNTIVE\n" + customInstructions : basePrompt;

  // 3. Get agent's tools based on connectors
  const agentTools = filterToolsForAgent(agent.role || "general", connectors);
  
  if (agentTools.length === 0) {
    return "Errore: l'agente " + agent.name + " non ha connettori attivi. Attiva i connettori dalla pagina dell'agente.";
  }

  // 4. Execute multi-turn tool loop (stop-reason based, safety cap 10)
  const MAX_AGENT_TURNS = 10;
  const userMessage = contesto
    ? `## CONTESTO\n${contesto}\n\n## COMPITO\n${istruzioni}`
    : istruzioni;
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: userMessage },
  ];

  let finalResult = "";

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: agentModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: agentTools,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("[agent-task] Claude error for", agent.name, ":", claudeRes.status, errText);
      return "Errore: l'agente " + agent.name + " non ha potuto completare il task (errore Claude API).";
    }

    const data = await claudeRes.json() as {
      content?: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
      stop_reason?: string;
    };

    const content = data.content || [];
    const textBlocks = content.filter((c) => c.type === "text");
    const toolUseBlocks = content.filter((c) => c.type === "tool_use");

    // Collect text
    for (const block of textBlocks) {
      if (block.text) finalResult += block.text;
    }

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || data.stop_reason === "end_turn") {
      break;
    }

    // Execute tool calls
    messages.push({ role: "assistant", content });

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const toolUse of toolUseBlocks) {
      const toolName = toolUse.name || "";
      console.log("[agent-task]", agent.name, "calls tool:", toolName);
      // Stream progress to client
      if (onProgress) {
        const label = toolName.startsWith("custom_")
          ? "Chiamando API esterna..."
          : (TOOL_PROGRESS_LABELS[toolName] || `Eseguendo ${toolName}...`);
        onProgress(`${agent.name}: ${label}`, toolName);
      }
      const result = await executeChatTool(
        toolName,
        (toolUse.input || {}) as ToolInput,
        db,
        companyId,
        targetAgentId,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id || "",
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return finalResult || "Task completato ma nessuna risposta dall'agente.";
}

export async function executeChatTool(
  toolName: string,
  toolInput: ToolInput,
  db: Db,
  companyId: string,
  agentId: string,
  apiKey?: string,
  onProgress?: (message: string, toolName?: string) => void,
): Promise<string> {
  try {
    // Dynamic custom connector tools (custom_{slug}_{action})
    if (toolName.startsWith("custom_")) {
      const allCustom = await db.select().from(customConnectors)
        .where(eq(customConnectors.companyId, companyId));
      for (const connector of allCustom) {
        const prefix = `custom_${connector.slug}_`;
        if (!toolName.startsWith(prefix)) continue;
        const actionName = toolName.substring(prefix.length);
        const actions = (connector.actions as any[]) || [];
        const action = actions.find((a: any) => a.name === actionName);
        if (!action) continue;

        const secret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)))
          .then(r => r[0]);

        let url = connector.baseUrl.replace(/\/$/, "") + action.path;
        const queryParams = new URLSearchParams();
        const bodyObj: Record<string, unknown> = {};

        for (const param of (action.params || [])) {
          const value = toolInput[param.name];
          if (value === undefined || value === null) continue;
          if (param.in === "path") { url = url.replace(`{${param.name}}`, encodeURIComponent(String(value))); }
          else if (param.in === "query" || (param.in !== "body" && action.method === "GET")) { queryParams.set(param.name, String(value)); }
          else { bodyObj[param.name] = value; }
        }
        const qs = queryParams.toString();
        if (qs) url += (url.includes("?") ? "&" : "?") + qs;

        const headers: Record<string, string> = {};
        if (secret?.description && connector.authType !== "none") {
          const apiKey = decrypt(secret.description);
          headers[connector.authHeader || "Authorization"] = `${connector.authPrefix || "Bearer"} ${apiKey}`.trim();
        }
        if (["POST", "PUT", "PATCH"].includes(action.method)) headers["Content-Type"] = "application/json";

        try {
          const fetchOpts: RequestInit = { method: action.method, headers, signal: AbortSignal.timeout(30000) };
          if (["POST", "PUT", "PATCH"].includes(action.method) && Object.keys(bodyObj).length > 0) {
            fetchOpts.body = JSON.stringify(bodyObj);
          }
          const r = await fetch(url, fetchOpts);
          const text = await r.text();
          if (!r.ok) return `Errore ${connector.name} (${r.status}): ${text.substring(0, 500)}`;
          try { return JSON.stringify(JSON.parse(text), null, 2).substring(0, 3000); } catch {}
          return text.substring(0, 3000);
        } catch (err) {
          return `Errore chiamata ${connector.name}: ${(err as Error).message}`;
        }
      }
      return "Errore: connettore o azione custom non trovata.";
    }

    switch (toolName) {
      case "lista_agenti": {
        const rows = await db.select({
          id: agents.id,
          name: agents.name,
          title: agents.title,
          role: agents.role,
          status: agents.status,
        }).from(agents).where(eq(agents.companyId, companyId));
        return rows.map((a) =>
          `- ${a.name || "?"} (${a.title || a.role || "?"}) — stato: ${a.status || "?"} — id: ${a.id}`
        ).join("\n") || "Nessun agente trovato.";
      }

      case "crea_task": {
        const input = toolInput as { titolo: string; descrizione: string; agente_id: string; priorita?: string };
        const [company] = await db
          .update(companies)
          .set({ issueCounter: sql`${companies.issueCounter} + 1` })
          .where(eq(companies.id, companyId))
          .returning({ issueCounter: companies.issueCounter, issuePrefix: companies.issuePrefix });
        if (!company) return "Errore: company non trovata.";
        const identifier = `${company.issuePrefix}-${company.issueCounter}`;
        await db.insert(issues).values({
          id: randomUUID(),
          companyId,
          title: input.titolo,
          description: input.descrizione,
          assigneeAgentId: input.agente_id,
          priority: input.priorita || "medium",
          status: "todo",
          issueNumber: company.issueCounter,
          identifier,
          originKind: "manual",
        });
        return `Task creato: ${identifier} — ${input.titolo} (assegnato)`;
      }

      case "stato_task": {
        const input = toolInput as { agente_id?: string; stato?: string };
        const conditions = [eq(issues.companyId, companyId)];
        if (input.agente_id) conditions.push(eq(issues.assigneeAgentId, input.agente_id));
        if (input.stato && input.stato !== "all") {
          conditions.push(inArray(issues.status, [input.stato]));
        }
        const rows = await db.select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
        }).from(issues).where(and(...conditions)).orderBy(desc(issues.createdAt));
        if (!rows.length) return "Nessun task trovato.";
        return rows.slice(0, 20).map((i) => `- [${i.status}] ${i.identifier || ""}: ${i.title}`).join("\n");
      }

      case "commenta_task": {
        const input = toolInput as { task_id: string; commento: string };
        return `Nota registrata per task ${input.task_id}: ${input.commento}`;
      }

      case "elimina_agente": {
        const input = toolInput as { agente_id: string };
        const target = await db.select({ id: agents.id, name: agents.name, role: agents.role }).from(agents)
          .where(and(eq(agents.id, input.agente_id), eq(agents.companyId, companyId)))
          .then((rows) => rows[0]);
        if (!target) return "Agente non trovato con id: " + input.agente_id;
        if (target.role === "ceo") return "Il CEO non può essere eliminato.";
        await db.delete(agents).where(eq(agents.id, input.agente_id));
        return `Agente eliminato: ${target.name} (${target.id})`;
      }

      case "crea_agente": {
        const input = toolInput as { nome: string; titolo: string; competenze: string; istruzioni: string; connettore?: string; account_id?: string };
        // Check for duplicate agent name (ignore terminated agents)
        const existing = await db.select({ id: agents.id, status: agents.status }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.name, input.nome), ne(agents.status, "terminated"))).then(r => r[0]);
        if (existing) return "Agente " + input.nome + " esiste gia (id: " + existing.id + "). Non creo duplicati.";

        // Build connectors map — only the specified account is active
        const connectors: Record<string, boolean> = {};
        const conn = (input.connettore || "").toLowerCase();
        const acctId = (input.account_id || "").replace(/^@/, ""); // remove @ prefix

        if (conn === "google") {
          connectors.gmail = true; connectors.calendar = true; connectors.drive = true; connectors.sheets = true; connectors.docs = true;
        } else if (conn === "telegram") {
          // Activate specific bot if account_id provided
          if (acctId) {
            connectors["tg_" + acctId] = true;
          } else {
            connectors.telegram = true;
          }
        } else if (conn === "whatsapp") {
          connectors.whatsapp = true;
        } else if (conn === "meta") {
          // Activate specific Instagram/Facebook account
          if (acctId) {
            connectors["ig_" + acctId] = true;
          } else {
            connectors.meta = true;
          }
        } else if (conn === "linkedin") {
          connectors.linkedin = true;
        } else if (conn === "fal") {
          connectors.fal = true;
        } else if (conn === "fic") {
          connectors.fic = true;
        } else if (conn === "openapi") {
          connectors.oai_company = true; connectors.oai_risk = true; connectors.oai_cap = true; connectors.oai_sdi = true;
        } else if (conn === "voice") {
          connectors.voice = true;
        } else if (conn === "pec") {
          connectors.pec = true;
        }

        const [newAgent] = await db.insert(agents).values({
          id: randomUUID(),
          companyId,
          name: input.nome,
          title: input.titolo,
          role: input.titolo,
          capabilities: input.competenze,
          adapterType: "claude_api",
          adapterConfig: { promptTemplate: input.istruzioni, connectors, primaryConnector: conn || undefined },
          reportsTo: agentId,
          status: "idle",
        }).returning();

        // Link agent to connector_account via relational table
        if (conn) {
          // Map connector name to connector_type in connector_accounts table
          let connType = conn; // default: same name
          if (conn === "meta") connType = "meta_ig"; // try IG first, then FB
          const accountIdForLookup = acctId || "default";

          let connAccount = await db.select().from(connectorAccounts)
            .where(and(
              eq(connectorAccounts.companyId, companyId),
              eq(connectorAccounts.connectorType, connType),
              eq(connectorAccounts.accountId, accountIdForLookup),
            ))
            .then(r => r[0]);

          // If meta_ig not found, try meta_fb
          if (!connAccount && conn === "meta") {
            connAccount = await db.select().from(connectorAccounts)
              .where(and(
                eq(connectorAccounts.companyId, companyId),
                eq(connectorAccounts.connectorType, "meta_fb"),
                eq(connectorAccounts.accountId, accountIdForLookup),
              ))
              .then(r => r[0]);
          }

          if (connAccount) {
            await db.insert(agentConnectorAccounts).values({
              agentId: newAgent.id,
              connectorAccountId: connAccount.id,
            }).onConflictDoNothing();
          }
        }

        return `Agente creato: ${input.nome} (${input.titolo}) — id: ${newAgent.id} — connettore: ${conn || "nessuno"}. L'agente ha attivo solo il connettore ${conn}. Il cliente può abilitare altri connettori dalla pagina agente > Connettori.`;
      }

      case "crea_attivita_programmata": {
        const input = toolInput as { agente_id: string; titolo: string; descrizione: string; orario: string; approvazione?: boolean };
        // Check for duplicate
        const existingRoutine = await db.select({ id: routines.id }).from(routines)
          .where(and(eq(routines.companyId, companyId), eq(routines.title, input.titolo), ne(routines.status, "archived")))
          .then(r => r[0]);
        if (existingRoutine) return "Attività '" + input.titolo + "' esiste già (id: " + existingRoutine.id + "). Non creo duplicati.";
        // Verify agent exists
        const targetAgent = await db.select({ id: agents.id, name: agents.name }).from(agents)
          .where(and(eq(agents.id, input.agente_id), eq(agents.companyId, companyId), ne(agents.status, "terminated")))
          .then(r => r[0]);
        if (!targetAgent) return "Errore: agente non trovato con ID " + input.agente_id;

        // Convert natural language to cron
        let cronExpr = "";
        const orarioLower = input.orario.toLowerCase().trim();
        // Parse time "alle HH:MM" or "alle HH"
        const timeMatch = orarioLower.match(/alle?\s+(\d{1,2})(?::(\d{2}))?/);
        const hour = timeMatch ? parseInt(timeMatch[1]) : 9;
        const minute = timeMatch && timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        // Parse day pattern
        if (orarioLower.includes("ogni giorno")) cronExpr = `${minute} ${hour} * * *`;
        else if (orarioLower.includes("ogni ora")) cronExpr = `0 * * * *`;
        else if (orarioLower.includes("ogni lunedi")) cronExpr = `${minute} ${hour} * * 1`;
        else if (orarioLower.includes("ogni martedi")) cronExpr = `${minute} ${hour} * * 2`;
        else if (orarioLower.includes("ogni mercoledi")) cronExpr = `${minute} ${hour} * * 3`;
        else if (orarioLower.includes("ogni giovedi")) cronExpr = `${minute} ${hour} * * 4`;
        else if (orarioLower.includes("ogni venerdi")) cronExpr = `${minute} ${hour} * * 5`;
        else if (orarioLower.includes("ogni sabato")) cronExpr = `${minute} ${hour} * * 6`;
        else if (orarioLower.includes("ogni domenica")) cronExpr = `${minute} ${hour} * * 0`;
        else if (orarioLower.includes("dal lunedi al venerdi") || orarioLower.includes("giorni feriali")) cronExpr = `${minute} ${hour} * * 1-5`;
        else if (orarioLower.includes("primo del mese")) cronExpr = `${minute} ${hour} 1 * *`;
        else {
          // Parse "ogni N minuti/ore"
          const intervalMatch = orarioLower.match(/ogni\s+(\d+)\s+(minut|or)/);
          if (intervalMatch) {
            const n = parseInt(intervalMatch[1]);
            cronExpr = intervalMatch[2].startsWith("minut") ? `*/${n} * * * *` : `0 */${n} * * *`;
          } else {
            cronExpr = `${minute} ${hour} * * *`; // fallback: daily
          }
        }

        const routineId = randomUUID();
        const approvalRequired = input.approvazione !== false;
        await db.insert(routines).values({
          id: routineId,
          companyId,
          title: input.titolo,
          description: input.descrizione,
          assigneeAgentId: input.agente_id,
          status: "active",
          concurrencyPolicy: "skip_if_active",
          catchUpPolicy: "skip_missed",
          approvalRequired,
          createdByAgentId: agentId,
        });

        const nextRun = nextCronTickInTimeZone(cronExpr, "Europe/Rome", new Date());
        await db.insert(routineTriggers).values({
          id: randomUUID(),
          companyId,
          routineId,
          kind: "cron",
          label: input.titolo,
          enabled: true,
          cronExpression: cronExpr,
          timezone: "Europe/Rome",
          nextRunAt: nextRun,
          createdByAgentId: agentId,
        });

        const modeStr = approvalRequired ? "con approvazione" : "automatica";
        const nextStr = nextRun ? nextRun.toLocaleString("it-IT", { timeZone: "Europe/Rome" }) : "calcolando...";
        return `Attività programmata creata: "${input.titolo}" — Agente: ${targetAgent.name} — Cron: ${cronExpr} (${input.orario}) — Modalità: ${modeStr} — Prossima esecuzione: ${nextStr}`;
      }

      case "lista_attivita_programmate": {
        const allRoutines = await db.select({
          id: routines.id,
          title: routines.title,
          description: routines.description,
          status: routines.status,
          approvalRequired: routines.approvalRequired,
          agentName: agents.name,
        }).from(routines)
          .leftJoin(agents, eq(routines.assigneeAgentId, agents.id))
          .where(and(eq(routines.companyId, companyId), ne(routines.status, "archived")));

        if (allRoutines.length === 0) return "Nessuna attività programmata.";

        let result = "Attività programmate:\n";
        for (const r of allRoutines) {
          const trigger = await db.select({ cronExpression: routineTriggers.cronExpression, nextRunAt: routineTriggers.nextRunAt, enabled: routineTriggers.enabled })
            .from(routineTriggers)
            .where(and(eq(routineTriggers.routineId, r.id), eq(routineTriggers.kind, "cron")))
            .then(rows => rows[0]);
          const nextRun = trigger?.nextRunAt ? new Date(trigger.nextRunAt).toLocaleString("it-IT", { timeZone: "Europe/Rome" }) : "N/A";
          const stato = trigger?.enabled === false ? "pausata" : r.status;
          const mode = r.approvalRequired ? "manuale" : "auto";
          result += `- [${r.id.slice(0, 8)}] "${r.title}" — ${r.agentName || "N/A"} — ${stato} — ${mode} — cron: ${trigger?.cronExpression || "N/A"} — prossima: ${nextRun}\n`;
        }
        return result;
      }

      case "elimina_attivita_programmata": {
        const input = toolInput as { routine_id: string };
        const routine = await db.select({ id: routines.id, title: routines.title })
          .from(routines).where(and(eq(routines.id, input.routine_id), eq(routines.companyId, companyId))).then(r => r[0]);
        if (!routine) return "Errore: attività non trovata con ID " + input.routine_id;
        await db.update(routines).set({ status: "archived" }).where(eq(routines.id, input.routine_id));
        await db.update(routineTriggers).set({ enabled: false }).where(eq(routineTriggers.routineId, input.routine_id));
        return `Attività "${routine.title}" archiviata e disattivata.`;
      }

      case "lista_clienti": {
        console.log("[chat-tool] lista_clienti for company:", companyId);
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso. Collega il servizio da Connettori.";
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/entities/clients?per_page=50&fieldset=basic`, {
          headers: { Authorization: "Bearer " + ficToken.access_token },
        });
        if (!r.ok) return "Errore nel recupero clienti: " + r.status;
        const data = await r.json() as any;
        const clients = data.data || [];
        if (clients.length === 0) return "Nessun cliente trovato. Usa crea_cliente per aggiungerne uno.";
        return clients.map((c: any) => `ID: ${c.id} | ${c.name}${c.vat_number ? " | P.IVA: " + c.vat_number : ""}`).join("\n");
      }

      case "cerca_cliente": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const query = toolInput.query as string;
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/entities/clients?per_page=20&fieldset=detailed`, {
          headers: { Authorization: "Bearer " + ficToken.access_token },
        });
        if (!r.ok) return "Errore ricerca: " + r.status;
        const data = await r.json() as any;
        const clients = (data.data || []).filter((c: any) => c.name?.toLowerCase().includes(query.toLowerCase()));
        if (clients.length === 0) return "Nessun cliente trovato con '" + query + "'.";
        return clients.map((c: any) => `ID: ${c.id} | ${c.name} | ${c.vat_number || ""} | ${c.address_city || ""}`).join("\n");
      }

      case "crea_cliente": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const body = { data: { name: toolInput.nome, vat_number: toolInput.partita_iva || "", tax_code: toolInput.codice_fiscale || "", address_street: toolInput.indirizzo || "", address_postal_code: toolInput.cap || "", address_city: toolInput.citta || "", address_province: toolInput.provincia || "", country: "Italia", email: toolInput.email || "", certified_email: toolInput.pec || "", ei_code: toolInput.codice_sdi || "0000000" } };
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/entities/clients`, {
          method: "POST", headers: { Authorization: "Bearer " + ficToken.access_token, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!r.ok) { const err = await r.text(); return "Errore creazione cliente: " + err.substring(0, 200); }
        const data = await r.json() as any;
        return "Cliente creato! ID: " + data.data?.id + " | Nome: " + data.data?.name;
      }

      case "crea_fattura": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const righe = (toolInput.righe as any[]) || [];
        const items = righe.map((r: any) => ({ name: r.descrizione, net_price: r.prezzo, qty: r.quantita || 1, vat: { id: 0, value: r.iva || 22, is_disabled: false } }));
        // Calculate gross amount
        let totalNet = 0;
        for (const item of items) { totalNet += (item.net_price || 0) * (item.qty || 1); }
        const vatRate = items[0]?.vat?.value || 22;
        const totalGross = Math.round((totalNet * (1 + vatRate / 100)) * 100) / 100;
        // Fetch client name (FIC requires entity.name)
        let clientName = "";
        try {
          const clientRes = await fetch("https://api-v2.fattureincloud.it/c/" + ficToken.fic_company_id + "/entities/clients/" + toolInput.cliente_id, {
            headers: { Authorization: "Bearer " + ficToken.access_token },
          });
          if (clientRes.ok) { const cd = await clientRes.json() as any; clientName = cd.data?.name || ""; }
        } catch {}
        const invoiceDate = (toolInput.data as string) || new Date().toISOString().split("T")[0];
        const body = { data: { type: "invoice", date: invoiceDate, entity: { id: toolInput.cliente_id, name: clientName }, items_list: items, e_invoice: toolInput.fattura_elettronica !== false, notes: toolInput.note || "", payments_list: [{ amount: totalGross, due_date: invoiceDate, status: "not_paid" }] } };
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/issued_documents`, {
          method: "POST", headers: { Authorization: "Bearer " + ficToken.access_token, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!r.ok) { const err = await r.text(); console.error("[chat-tool] crea_fattura error:", r.status, err.substring(0, 500)); return "Errore creazione fattura: " + err.substring(0, 300); }
        const data = await r.json() as any;
        const doc = data.data;
        return "Fattura creata! ID: " + doc?.id + " | Numero: " + doc?.number + " | Totale: " + doc?.amount_gross + " euro";
      }

      case "lista_fatture": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const tipo = (toolInput.tipo as string) || "emesse";
        const endpoint = tipo === "ricevute" ? `/c/${ficToken.fic_company_id}/received_documents?type=expense&per_page=10&sort=-date&fieldset=basic` : `/c/${ficToken.fic_company_id}/issued_documents?type=invoice&per_page=10&sort=-date&fieldset=basic`;
        const r = await fetch("https://api-v2.fattureincloud.it" + endpoint, { headers: { Authorization: "Bearer " + ficToken.access_token } });
        if (!r.ok) return "Errore recupero fatture: " + r.status;
        const data = await r.json() as any;
        const docs = data.data || [];
        if (docs.length === 0) return "Nessuna fattura trovata.";
        return docs.map((d: any) => `#${d.number || d.id} | ${d.date} | ${d.entity?.name || "?"} | ${d.amount_gross || 0} euro | ${d.status === "paid" ? "Pagata" : "Non pagata"}`).join("\n");
      }

      case "invia_fattura_sdi": {
        const ficToken = await getFicTokenForChat(db, companyId);
        if (!ficToken) return "Fatture in Cloud non connesso.";
        const docId = toolInput.fattura_id as number;
        const verify = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/issued_documents/${docId}/e_invoice/xml_verify`, { headers: { Authorization: "Bearer " + ficToken.access_token } });
        if (!verify.ok) return "Verifica XML fallita: " + (await verify.text()).substring(0, 200);
        const r = await fetch(`https://api-v2.fattureincloud.it/c/${ficToken.fic_company_id}/issued_documents/${docId}/e_invoice/send`, {
          method: "POST", headers: { Authorization: "Bearer " + ficToken.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }),
        });
        if (!r.ok) return "Errore invio SDI: " + (await r.text()).substring(0, 200);
        return "Fattura inviata allo SDI!";
      }


      case "cerca_azienda_piva": {
        const token = await getOaiToken(db, companyId, "company");
        if (!token) return "OpenAPI.it Company non connesso. Vai su Connettori per collegarlo.";
        const query = toolInput.query as string;
        const livello = (toolInput.livello as string) || "start";
        const r = await fetch(`https://company.openapi.com/IT-${livello}/${encodeURIComponent(query)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore ricerca azienda: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 3000);
      }

      case "cerca_azienda_nome": {
        const token = await getOaiToken(db, companyId, "company");
        if (!token) return "OpenAPI.it Company non connesso. Vai su Connettori per collegarlo.";
        const nome = toolInput.nome as string;
        const r = await fetch(`https://company.openapi.com/IT-name?denomination=${encodeURIComponent(nome)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore ricerca: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 3000);
      }

      case "credit_score": {
        const token = await getOaiToken(db, companyId, "risk");
        if (!token) return "OpenAPI.it Risk non connesso. Vai su Connettori per collegarlo.";
        const piva = toolInput.piva as string;
        const livello = (toolInput.livello as string) || "start";
        const r = await fetch(`https://risk.openapi.com/IT-creditscore-${livello}/${encodeURIComponent(piva)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore credit score: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 3000);
      }

      case "codice_sdi": {
        const token = await getOaiToken(db, companyId, "company");
        if (!token) return "OpenAPI.it Company non connesso. Vai su Connettori per collegarlo.";
        const piva = toolInput.piva as string;
        const r = await fetch(`https://company.openapi.com/IT-sdicode/${encodeURIComponent(piva)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore codice SDI: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 1000);
      }

      case "cerca_cap": {
        const token = await getOaiToken(db, companyId, "cap");
        if (!token) return "OpenAPI.it CAP non connesso. Vai su Connettori per collegarlo.";
        const cap = toolInput.cap as string;
        const r = await fetch(`https://cap.openapi.it/cap?cap=${encodeURIComponent(cap)}`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return "Errore CAP: " + r.status;
        const data = await r.json();
        return JSON.stringify(data, null, 2).substring(0, 1000);
      }

      case "cerca_piva_onboarding": {
        const piva = ((toolInput.piva as string) || "").replace(/\s/g, "");
        if (!piva || piva.length !== 11) return "Partita IVA non valida. Deve essere di 11 cifre.";

        const platformOaiToken = process.env.GOITALIA_OPENAPI_TOKEN;
        const platformRiskToken = process.env.GOITALIA_OPENAPI_RISK_TOKEN;
        if (!platformOaiToken) return "Servizio temporaneamente non disponibile. Chiedi i dati aziendali manualmente.";

        try {
          // 1. Fetch company data
          const r = await fetch(`https://company.openapi.com/IT-advanced/${encodeURIComponent(piva)}`, {
            headers: { Authorization: "Bearer " + platformOaiToken },
          });
          if (!r.ok) {
            if (r.status === 404) return "Partita IVA non trovata nel registro. Verifica il numero e riprova, oppure chiedi i dati manualmente.";
            return "Errore nella ricerca (status " + r.status + "). Chiedi i dati aziendali manualmente.";
          }
          const companyData = await r.json() as any;

          // Pick the active company record (prefer ATTIVA over CESSATA)
          const records = companyData.data || [];
          const company = records.find((r: any) => r.activityStatus === "ATTIVA") || records[0];
          if (!company) return "Nessun dato trovato per questa Partita IVA.";

          // 2. Fetch risk score (if token available)
          let riskInfo = "";
          if (platformRiskToken) {
            try {
              const riskRes = await fetch(`https://risk.openapi.com/IT-creditscore-advanced/${encodeURIComponent(piva)}`, {
                headers: { Authorization: "Bearer " + platformRiskToken },
              });
              if (riskRes.ok) {
                const riskData = await riskRes.json() as any;
                const rd = riskData.data;
                if (rd) {
                  riskInfo = `\n\n📊 CREDIT SCORE / AFFIDABILITÀ:
- Risk Score: ${rd.risk_score || "N/D"} (${rd.risk_score_description || ""})
- Rating: ${rd.rating || "N/D"}
- Severità rischio: ${rd.risk_severity ?? "N/D"}/990
- Limite credito operativo: €${rd.operational_credit_limit?.toLocaleString("it-IT") || "N/D"}`;
                }
              }
            } catch { /* risk score non disponibile, non blocca */ }
          }

          // 3. Build structured response
          const addr = company.address?.registeredOffice;
          const ateco = company.atecoClassification?.ateco2007 || company.atecoClassification?.ateco;
          const balance = company.balanceSheets?.last;
          const legalForm = company.detailedLegalForm;
          const shareholders = company.shareHolders || [];

          let result = `🏢 DATI AZIENDALI TROVATI:

📋 ANAGRAFICA:
- Ragione Sociale: ${company.companyName || "N/D"}
- Partita IVA: ${company.vatCode || piva}
- Codice Fiscale: ${company.taxCode || piva}
- Forma Giuridica: ${legalForm?.description || "N/D"}
- Stato Attività: ${company.activityStatus || "N/D"}
- Data Inizio: ${company.startDate || "N/D"}
- Data Iscrizione CCIAA: ${company.registrationDate || "N/D"}

📍 SEDE LEGALE:
- Indirizzo: ${addr?.streetName || "N/D"}
- CAP: ${addr?.zipCode || "N/D"}
- Città: ${addr?.town || "N/D"}
- Provincia: ${addr?.province || "N/D"}
- Regione: ${addr?.region?.description || "N/D"}

🏭 ATTIVITÀ:
- Codice ATECO: ${ateco?.code || "N/D"}
- Descrizione: ${ateco?.description || "N/D"}

📬 CONTATTI:
- PEC: ${company.pec || "N/D"}
- Codice SDI: ${company.sdiCode || "N/D"}`;

          if (balance) {
            result += `\n\n💰 BILANCIO (${balance.year || "ultimo"}):
- Fatturato: €${balance.turnover?.toLocaleString("it-IT") || "N/D"}
- Patrimonio Netto: €${balance.netWorth?.toLocaleString("it-IT") || "N/D"}
- Totale Attivo: €${balance.totalAssets?.toLocaleString("it-IT") || "N/D"}
- Capitale Sociale: €${balance.shareCapital?.toLocaleString("it-IT") || "N/D"}
- Dipendenti: ${balance.employees ?? "N/D"}
- Costo Personale: €${balance.totalStaffCost?.toLocaleString("it-IT") || "N/D"}`;
          }

          if (shareholders.length > 0) {
            result += "\n\n👥 SOCI:";
            for (const sh of shareholders) {
              const name = sh.companyName || `${sh.name || ""} ${sh.surname || ""}`.trim() || "N/D";
              result += `\n- ${name} (${sh.percentShare || "?"}%)`;
            }
          }

          result += riskInfo;

          return result;
        } catch {
          return "Errore di connessione al servizio. Chiedi i dati aziendali manualmente.";
        }
      }

      case "salva_info_azienda": {
        const fields = toolInput as Record<string, string>;
        // Map tool snake_case keys → Drizzle camelCase columns
        const fieldMap: Record<string, string> = {
          ragione_sociale: "ragioneSociale", partita_iva: "partitaIva", codice_fiscale: "codiceFiscale",
          forma_giuridica: "formaGiuridica", stato_attivita: "statoAttivita", data_inizio: "dataInizio",
          settore: "settore", indirizzo: "indirizzo", citta: "citta", cap: "cap",
          provincia: "provincia", regione: "regione", telefono: "telefono", email: "email",
          whatsapp: "whatsapp", pec: "pec", codice_sdi: "codiceSdi", sito_web: "sitoWeb",
          dipendenti: "dipendenti", fatturato: "fatturato", patrimonio_netto: "patrimonioNetto",
          capitale_sociale: "capitaleSociale", totale_attivo: "totaleAttivo",
          risk_score: "riskScore", rating: "rating", risk_severity: "riskSeverity",
          credit_limit: "creditLimit", soci: "soci", note: "note",
          orari_apertura: "orariApertura", giorno_chiusura: "giornoChiusura", note_orari: "noteOrari",
        };
        const dbData: Record<string, unknown> = { updatedAt: new Date() };
        for (const [k, v] of Object.entries(fields)) {
          if (v && typeof v === "string" && v.trim()) {
            const dbCol = fieldMap[k];
            if (dbCol) dbData[dbCol] = v.trim();
          }
        }
        const existing = await db.select({ id: companyProfiles.id }).from(companyProfiles)
          .where(eq(companyProfiles.companyId, companyId))
          .then((r) => r[0]);
        if (existing) {
          await db.update(companyProfiles).set(dbData).where(eq(companyProfiles.companyId, companyId));
        } else {
          await db.insert(companyProfiles).values({ companyId, ...dbData } as any);
        }
        const savedFields = Object.keys(fields).filter(k => fields[k]?.trim()).join(", ");
        return "Info azienda aggiornate: " + savedFields;
      }

      case "salva_nota": {
        const { contenuto, categoria } = toolInput as { contenuto: string; categoria?: string };
        if (!contenuto) return "Errore: contenuto della nota obbligatorio.";
        const nota = { contenuto, categoria: categoria || "generale", data: new Date().toISOString().split("T")[0] };
        const memRows = await db.execute(sql`SELECT notes FROM ceo_memory WHERE company_id = ${companyId}`);
        const mRows = (memRows as any).rows || memRows;
        if (mRows.length > 0) {
          const notes = Array.isArray(mRows[0].notes) ? mRows[0].notes : [];
          notes.push(nota);
          await db.execute(sql`UPDATE ceo_memory SET notes = ${JSON.stringify(notes)}::jsonb, updated_at = NOW() WHERE company_id = ${companyId}`);
        } else {
          await db.execute(sql`INSERT INTO ceo_memory (company_id, notes) VALUES (${companyId}, ${JSON.stringify([nota])}::jsonb)`);
        }
        return "Nota salvata: " + contenuto.substring(0, 100);
      }

      case "leggi_memoria": {
        // Read company profile from company_profiles
        const profileRow = await db.select().from(companyProfiles)
          .where(eq(companyProfiles.companyId, companyId))
          .then((r) => r[0]);
        // Read notes/preferences from ceo_memory
        const memResult = await db.execute(sql`SELECT notes, preferences FROM ceo_memory WHERE company_id = ${companyId}`);
        const memR = (memResult as any).rows || memResult;

        let output = "";
        if (profileRow) {
          const profileFields: [string, unknown][] = [
            ["Ragione Sociale", profileRow.ragioneSociale], ["P.IVA", profileRow.partitaIva],
            ["Codice Fiscale", profileRow.codiceFiscale], ["Forma Giuridica", profileRow.formaGiuridica],
            ["Stato Attività", profileRow.statoAttivita], ["Data Inizio", profileRow.dataInizio],
            ["Settore", profileRow.settore], ["Indirizzo", profileRow.indirizzo],
            ["Città", profileRow.citta], ["CAP", profileRow.cap],
            ["Provincia", profileRow.provincia], ["Regione", profileRow.regione],
            ["Telefono", profileRow.telefono], ["Email", profileRow.email],
            ["WhatsApp", profileRow.whatsapp], ["PEC", profileRow.pec],
            ["Codice SDI", profileRow.codiceSdi], ["Sito Web", profileRow.sitoWeb],
            ["Dipendenti", profileRow.dipendenti], ["Fatturato", profileRow.fatturato],
            ["Patrimonio Netto", profileRow.patrimonioNetto], ["Capitale Sociale", profileRow.capitaleSociale],
            ["Totale Attivo", profileRow.totaleAttivo], ["Risk Score", profileRow.riskScore],
            ["Rating", profileRow.rating], ["Severità Rischio", profileRow.riskSeverity],
            ["Limite Credito", profileRow.creditLimit], ["Soci", profileRow.soci],
          ];
          const filled = profileFields.filter(([, v]) => v != null && v !== "");
          if (filled.length > 0) {
            output += "DATI AZIENDA:\n";
            for (const [label, val] of filled) {
              output += "- " + label + ": " + val + "\n";
            }
          }
        }
        const mem = memR[0];
        if (mem?.notes && Array.isArray(mem.notes) && mem.notes.length > 0) {
          output += "\nNOTE SALVATE:\n";
          for (const n of mem.notes) {
            output += "- [" + (n.categoria || "generale") + " " + (n.data || "") + "] " + n.contenuto + "\n";
          }
        }
        // Add product catalog
        const products = await db.select().from(companyProducts)
          .where(eq(companyProducts.companyId, companyId))
          .orderBy(asc(companyProducts.category), asc(companyProducts.name));
        if (products.length > 0) {
          output += "\nCATALOGO PRODOTTI/SERVIZI:\n";
          for (const p of products) {
            const prices = [
              p.priceB2b ? `B2B: €${p.priceB2b}` : "",
              p.priceB2c ? `B2C: €${p.priceB2c}` : "",
            ].filter(Boolean).join(" | ");
            output += `- ${p.name}${p.category ? " [" + p.category + "]" : ""} — ${prices || "prezzo su richiesta"}${p.available === false ? " [NON DISPONIBILE]" : ""}\n`;
          }
        }
        return output || "Memoria vuota.";
      }

      case "esegui_task_agente": {
        if (!apiKey) return "Errore: API key non disponibile per esecuzione agente.";
        const targetId = toolInput.agente_id as string;
        const instructions = toolInput.istruzioni as string;
        const context = toolInput.contesto as string | undefined;
        if (!targetId || !instructions) return "Errore: agente_id e istruzioni sono obbligatori.";
        console.log("[direttore] Delegating task to agent:", targetId, "->", instructions.substring(0, 100));
        const result = await executeAgentTask(db, companyId, targetId, instructions, apiKey, context, onProgress);
        console.log("[direttore] Agent result:", result.substring(0, 200));
        return result;
      }

      case "lista_pec": {
        const { getPecCreds: getPec, listPecMessages } = await import("./pec.js");
        const pecCreds = await getPec(db, companyId);
        if (!pecCreds) return "PEC non connessa. Collega la casella PEC da Connettori.";
        const limit = (toolInput.limit as number) || 10;
        const messages = await listPecMessages(db, companyId, "INBOX", limit);
        if (messages.length === 0) return "Nessuna email PEC ricevuta.";
        return messages.map((m) =>
          `UID: ${m.uid} | ${m.seen ? "✓" : "●"} | Da: ${m.from} | Oggetto: ${m.subject} | Data: ${m.date.substring(0, 10)}`
        ).join("\n");
      }

      case "leggi_pec": {
        const { readPecMessage } = await import("./pec.js");
        const uid = toolInput.uid as number;
        if (!uid) return "Errore: uid obbligatorio.";
        const msg = await readPecMessage(db, companyId, uid);
        let out = `Da: ${msg.from}\nA: ${msg.to}\nData: ${msg.date}\nOggetto: ${msg.subject}\n\n${msg.body.substring(0, 2000)}`;
        if (msg.daticert && Object.keys(msg.daticert).length > 0) {
          out += "\n\n--- CERTIFICAZIONE PEC ---\n";
          for (const [k, v] of Object.entries(msg.daticert)) out += `${k}: ${v}\n`;
        }
        return out;
      }

      case "invia_pec": {
        const { getPecCreds: getPec, sendPecMessage } = await import("./pec.js");
        const pecCreds = await getPec(db, companyId);
        if (!pecCreds) return "PEC non connessa. Collega la casella PEC da Connettori.";
        const dest = toolInput.destinatario as string;
        const ogg = toolInput.oggetto as string;
        const testo = toolInput.testo as string;
        await sendPecMessage(pecCreds, dest, ogg, testo);
        return `PEC inviata con successo a ${dest}. Oggetto: "${ogg}"`;
      }

      case "rispondi_pec": {
        const { getPecCreds: getPec, sendPecMessage } = await import("./pec.js");
        const pecCreds = await getPec(db, companyId);
        if (!pecCreds) return "PEC non connessa. Collega la casella PEC da Connettori.";
        const dest = toolInput.destinatario as string;
        const ogg = toolInput.oggetto as string;
        const testo = toolInput.testo as string;
        const replySubject = ogg.startsWith("Re:") ? ogg : "Re: " + ogg;
        await sendPecMessage(pecCreds, dest, replySubject, testo);
        return `Risposta PEC inviata a ${dest}. Oggetto: "${replySubject}"`;
      }

      case "leggi_file_progetto": {
        const projectId = toolInput.project_id as string;
        if (!projectId) return "project_id obbligatorio.";
        return await getProjectFilesContent(db, projectId);
      }

      case "cerca_file_drive": {
        const googleToken = await getGoogleTokenForChat(db, companyId);
        if (!googleToken) return "Google Drive non connesso. Collega Google da Connettori.";
        const q = encodeURIComponent(`name contains '${(toolInput.query as string).replace(/'/g, "\\'")}' and trashed=false`);
        const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=20`, {
          headers: { Authorization: "Bearer " + googleToken },
        });
        if (!r.ok) return "Errore ricerca Drive: " + r.status;
        const data = await r.json() as { files: Array<{ id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string }> };
        if (!data.files.length) return `Nessun file trovato per "${toolInput.query}".`;
        const typeLabel = (m: string) => m.includes("document") ? "Google Doc" : m.includes("spreadsheet") ? "Foglio" : m.includes("presentation") ? "Presentazione" : m.includes("folder") ? "Cartella" : m.includes("zip") ? "ZIP" : "File";
        return data.files.map((f) => `📄 ${f.name} [${typeLabel(f.mimeType)}] | ID: ${f.id} | ${f.modifiedTime?.split("T")[0] || ""} | ${f.webViewLink || ""}`).join("\n");
      }

      case "leggi_file_drive": {
        const googleToken = await getGoogleTokenForChat(db, companyId);
        if (!googleToken) return "Google Drive non connesso.";
        const fileId = toolInput.file_id as string;
        // First get file metadata to know the type
        const metaR = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size`, {
          headers: { Authorization: "Bearer " + googleToken },
        });
        if (!metaR.ok) return "File non trovato o non accessibile (ID: " + fileId + ")";
        const meta = await metaR.json() as { name: string; mimeType: string; size?: string };
        const isGoogleDoc = meta.mimeType === "application/vnd.google-apps.document";
        const isGoogleSheet = meta.mimeType === "application/vnd.google-apps.spreadsheet";
        const isText = meta.mimeType.startsWith("text/") || meta.mimeType === "application/json";
        if (isGoogleDoc) {
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: "Bearer " + googleToken } });
          if (!r.ok) return "Errore esportazione Google Doc: " + r.status;
          const text = await r.text();
          return `📄 ${meta.name}\n\n${text.substring(0, 8000)}${text.length > 8000 ? "\n\n[...troncato a 8000 caratteri]" : ""}`;
        } else if (isGoogleSheet) {
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: { Authorization: "Bearer " + googleToken } });
          if (!r.ok) return "Errore esportazione foglio: " + r.status;
          const text = await r.text();
          return `📊 ${meta.name}\n\n${text.substring(0, 8000)}`;
        } else if (isText) {
          const fileSize = parseInt(meta.size || "0");
          if (fileSize > 500000) return `File troppo grande (${Math.round(fileSize / 1024)}KB). Massimo supportato: 500KB.`;
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: "Bearer " + googleToken } });
          if (!r.ok) return "Errore download file: " + r.status;
          const text = await r.text();
          return `📄 ${meta.name}\n\n${text.substring(0, 8000)}${text.length > 8000 ? "\n\n[...troncato]" : ""}`;
        } else {
          return `Il file "${meta.name}" (${meta.mimeType}) non può essere letto come testo. Sono supportati: Google Doc, Google Fogli, file TXT/CSV. Per file ZIP: estrai prima il contenuto e caricalo come file TXT.`;
        }
      }

      case "stripe_lista_clienti": {
        const stripeKey = await getStripeApiKey(db, companyId);
        if (!stripeKey) return "Stripe non connesso. Collega il tuo account Stripe da Connettori.";
        const limit = Math.min(toolInput.limite as number || 20, 50);
        const r = await fetch(`https://api.stripe.com/v1/customers?limit=${limit}`, {
          headers: { Authorization: "Bearer " + stripeKey },
        });
        if (!r.ok) return "Errore recupero clienti Stripe: " + r.status;
        const data = await r.json() as { data: Array<{ id: string; name?: string; email?: string; created: number }> };
        if (!data.data.length) return "Nessun cliente trovato su Stripe.";
        return data.data.map((c) => `ID: ${c.id} | ${c.name || "–"} | ${c.email || "–"} | ${new Date(c.created * 1000).toLocaleDateString("it-IT")}`).join("\n");
      }

      case "stripe_cerca_cliente": {
        const stripeKey = await getStripeApiKey(db, companyId);
        if (!stripeKey) return "Stripe non connesso.";
        const query = toolInput.query as string;
        const r = await fetch(`https://api.stripe.com/v1/customers/search?query=${encodeURIComponent(`email:"${query}" OR name~"${query}"`)}&limit=10`, {
          headers: { Authorization: "Bearer " + stripeKey },
        });
        if (!r.ok) {
          // Fallback: list and filter
          const lr = await fetch(`https://api.stripe.com/v1/customers?limit=100`, { headers: { Authorization: "Bearer " + stripeKey } });
          if (!lr.ok) return "Errore ricerca Stripe: " + lr.status;
          const ld = await lr.json() as { data: Array<{ id: string; name?: string; email?: string }> };
          const filtered = ld.data.filter((c) => c.name?.toLowerCase().includes(query.toLowerCase()) || c.email?.toLowerCase().includes(query.toLowerCase()));
          if (!filtered.length) return `Nessun cliente trovato per "${query}".`;
          return filtered.map((c) => `ID: ${c.id} | ${c.name || "–"} | ${c.email || "–"}`).join("\n");
        }
        const data = await r.json() as { data: Array<{ id: string; name?: string; email?: string }> };
        if (!data.data.length) return `Nessun cliente trovato per "${query}".`;
        return data.data.map((c) => `ID: ${c.id} | ${c.name || "–"} | ${c.email || "–"}`).join("\n");
      }

      case "stripe_crea_cliente": {
        const stripeKey = await getStripeApiKey(db, companyId);
        if (!stripeKey) return "Stripe non connesso.";
        const body = new URLSearchParams();
        body.append("name", toolInput.nome as string);
        body.append("email", toolInput.email as string);
        if (toolInput.telefono) body.append("phone", toolInput.telefono as string);
        if (toolInput.descrizione) body.append("description", toolInput.descrizione as string);
        const r = await fetch("https://api.stripe.com/v1/customers", {
          method: "POST", headers: { Authorization: "Bearer " + stripeKey, "Content-Type": "application/x-www-form-urlencoded" }, body,
        });
        if (!r.ok) { const e = await r.json() as { error?: { message: string } }; return "Errore creazione cliente: " + (e.error?.message || r.status); }
        const data = await r.json() as { id: string; name?: string; email?: string };
        return `Cliente Stripe creato! ID: ${data.id} | Nome: ${data.name} | Email: ${data.email}`;
      }

      case "stripe_lista_pagamenti": {
        const stripeKey = await getStripeApiKey(db, companyId);
        if (!stripeKey) return "Stripe non connesso.";
        const limit = Math.min(toolInput.limite as number || 10, 30);
        const stato = toolInput.stato as string || "";
        const url = `https://api.stripe.com/v1/payment_intents?limit=${limit}`;
        const r = await fetch(url, { headers: { Authorization: "Bearer " + stripeKey } });
        if (!r.ok) return "Errore recupero pagamenti: " + r.status;
        const data = await r.json() as { data: Array<{ id: string; amount: number; currency: string; status: string; created: number; description?: string }> };
        if (!data.data.length) return "Nessun pagamento trovato.";
        const statusLabel = (s: string) => ({ succeeded: "✅ Pagato", pending: "⏳ In attesa", failed: "❌ Fallito" }[s] || s);
        return data.data.map((p) => `${statusLabel(p.status)} | €${(p.amount / 100).toFixed(2)} | ${p.description || "–"} | ${new Date(p.created * 1000).toLocaleDateString("it-IT")}`).join("\n");
      }

      case "stripe_crea_link_pagamento": {
        const stripeKey = await getStripeApiKey(db, companyId);
        if (!stripeKey) return "Stripe non connesso.";
        // Create a price on the fly
        const amountCents = Math.round((toolInput.importo_eur as number) * 100);
        const priceBody = new URLSearchParams();
        priceBody.append("unit_amount", String(amountCents));
        priceBody.append("currency", "eur");
        priceBody.append("product_data[name]", toolInput.descrizione as string);
        const priceRes = await fetch("https://api.stripe.com/v1/prices", {
          method: "POST", headers: { Authorization: "Bearer " + stripeKey, "Content-Type": "application/x-www-form-urlencoded" }, body: priceBody,
        });
        if (!priceRes.ok) { const e = await priceRes.json() as { error?: { message: string } }; return "Errore creazione prezzo: " + (e.error?.message || priceRes.status); }
        const price = await priceRes.json() as { id: string };
        const linkBody = new URLSearchParams();
        linkBody.append("line_items[0][price]", price.id);
        linkBody.append("line_items[0][quantity]", "1");
        const linkRes = await fetch("https://api.stripe.com/v1/payment_links", {
          method: "POST", headers: { Authorization: "Bearer " + stripeKey, "Content-Type": "application/x-www-form-urlencoded" }, body: linkBody,
        });
        if (!linkRes.ok) { const e = await linkRes.json() as { error?: { message: string } }; return "Errore creazione link: " + (e.error?.message || linkRes.status); }
        const link = await linkRes.json() as { url: string; id: string };
        return `Link pagamento creato! 💳\nImporto: €${(amountCents / 100).toFixed(2)}\nDescrizione: ${toolInput.descrizione}\nLink: ${link.url}`;
      }

      case "stripe_verifica_abbonamento": {
        const stripeKey = await getStripeApiKey(db, companyId);
        if (!stripeKey) return "Stripe non connesso.";
        let customerId = toolInput.cliente_id as string | undefined;
        if (!customerId && toolInput.email) {
          const r = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(toolInput.email as string)}&limit=1`, { headers: { Authorization: "Bearer " + stripeKey } });
          const d = await r.json() as { data: Array<{ id: string }> };
          customerId = d.data[0]?.id;
        }
        if (!customerId) return "Cliente non trovato. Specifica cliente_id o email valida.";
        const r = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&limit=5`, { headers: { Authorization: "Bearer " + stripeKey } });
        if (!r.ok) return "Errore recupero abbonamenti: " + r.status;
        const data = await r.json() as { data: Array<{ id: string; status: string; current_period_end: number; items: { data: Array<{ price: { unit_amount: number; recurring?: { interval: string } } }> } }> };
        if (!data.data.length) return "Nessun abbonamento trovato per questo cliente.";
        return data.data.map((s) => {
          const item = s.items.data[0];
          const amount = item ? (item.price.unit_amount / 100).toFixed(2) : "–";
          const interval = item?.price.recurring?.interval || "–";
          const end = new Date(s.current_period_end * 1000).toLocaleDateString("it-IT");
          const statusLabel = { active: "✅ Attivo", past_due: "⚠️ Scaduto", canceled: "❌ Cancellato", trialing: "🔄 Trial" }[s.status] || s.status;
          return `${statusLabel} | €${amount}/${interval} | Rinnovo: ${end}`;
        }).join("\n");
      }

      case "riassunto_conversazioni_wa": {
        const input = toolInput as { ore?: number; numero?: string };
        const hours = input.ore || 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const cleanNum = input.numero ? input.numero.replace(/[^0-9]/g, "") : "";
        const rows = await db.execute(
          cleanNum
            ? sql`SELECT remote_jid, from_name, message_text, direction, message_type, created_at FROM whatsapp_messages WHERE company_id = ${companyId} AND created_at >= ${since} AND (from_name LIKE ${"%" + cleanNum + "%"} OR remote_jid LIKE ${"%" + cleanNum + "%"}) ORDER BY remote_jid, created_at ASC LIMIT 500`
            : sql`SELECT remote_jid, from_name, message_text, direction, message_type, created_at FROM whatsapp_messages WHERE company_id = ${companyId} AND created_at >= ${since} ORDER BY remote_jid, created_at ASC LIMIT 500`
        ) as any[];
        if (!rows || rows.length === 0) return `Nessuna conversazione WhatsApp nelle ultime ${hours} ore.`;

        // Group by remote_jid
        const convos: Record<string, Array<{ from: string; text: string; dir: string; time: string; type: string }>> = {};
        for (const r of rows) {
          const jid = r.remote_jid || "unknown";
          if (!convos[jid]) convos[jid] = [];
          convos[jid].push({
            from: r.from_name || (r.direction === "outgoing" ? "Agente" : jid),
            text: r.message_text || "",
            dir: r.direction,
            time: new Date(r.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
            type: r.message_type || "text",
          });
        }

        const parts: string[] = [];
        for (const [jid, msgs] of Object.entries(convos)) {
          const contactName = msgs.find(m => m.dir === "incoming")?.from || jid;
          const msgCount = msgs.length;
          const inCount = msgs.filter(m => m.dir === "incoming").length;
          const outCount = msgs.filter(m => m.dir === "outgoing").length;

          let convoText = `\n📱 ${contactName} (${inCount} ricevuti, ${outCount} inviati)\n`;
          for (const m of msgs) {
            const arrow = m.dir === "incoming" ? "⬅️" : "➡️";
            const typeTag = m.type !== "text" ? ` [${m.type}]` : "";
            convoText += `  ${m.time} ${arrow} ${m.text.substring(0, 200)}${typeTag}\n`;
          }
          parts.push(convoText);
        }

        return `📊 RIASSUNTO CONVERSAZIONI WA — ultime ${hours}h\nTotale: ${Object.keys(convos).length} conversazioni, ${rows.length} messaggi\n` + parts.join("\n---") + "\n\nAnalizza queste conversazioni e riporta al titolare: punti chiave, richieste importanti, cose da sapere, e eventuali follow-up necessari.";
      }

      case "genera_immagine": {
        const input = toolInput as { prompt: string; aspect_ratio?: string };
        // Get FAL key
        const falSecret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "fal_api_key")))
          .then(r => r[0]);
        if (!falSecret?.description) return "Fal.ai non configurato. Collega il servizio da Connettori.";
        const falKey = decrypt(falSecret.description);

        // Submit generation request
        const falRes = await fetch("https://queue.fal.run/fal-ai/nano-banana-2", {
          method: "POST",
          headers: { Authorization: "Key " + falKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: input.prompt,
            num_images: 1,
            image_size: input.aspect_ratio || "square_hd",
            enable_safety_checker: false,
          }),
        });
        if (!falRes.ok) return "Errore FAL: " + falRes.status + " " + (await falRes.text()).substring(0, 200);
        const falData = await falRes.json() as { request_id?: string; status_url?: string; response_url?: string; images?: Array<{ url: string }> };

        // If synchronous result (rare)
        if (falData.images?.[0]?.url) {
          return `Immagine generata!\nURL: ${falData.images[0].url}\n\nUsa questo URL con pubblica_social per pubblicare sui social.`;
        }

        // Poll for result (queue mode)
        if (!falData.request_id) return "Errore: nessun request_id da FAL";
        const statusUrl = `https://queue.fal.run/fal-ai/nano-banana-2/requests/${falData.request_id}/status`;
        const resultUrl = `https://queue.fal.run/fal-ai/nano-banana-2/requests/${falData.request_id}`;

        // Poll up to 60 seconds
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const statusRes = await fetch(statusUrl, { headers: { Authorization: "Key " + falKey } });
          if (statusRes.ok) {
            const status = await statusRes.json() as { status: string };
            if (status.status === "COMPLETED") {
              const resultRes = await fetch(resultUrl, { headers: { Authorization: "Key " + falKey } });
              if (resultRes.ok) {
                const result = await resultRes.json() as { images?: Array<{ url: string; content_type?: string }> };
                if (result.images?.[0]?.url) {
                  return `Immagine generata!\nURL: ${result.images[0].url}\n\nUsa questo URL con pubblica_social per pubblicare sui social.`;
                }
              }
              return "Generazione completata ma nessuna immagine nel risultato.";
            }
            if (status.status === "FAILED") return "Generazione fallita.";
          }
        }
        return "Timeout: la generazione sta richiedendo troppo tempo. Riprova.";
      }

      case "pubblica_social": {
        const input = toolInput as { testo: string; image_url?: string; piattaforme: string[] };

        // Get Meta tokens
        const metaSecret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "meta_tokens")))
          .then(r => r[0]);

        const results: string[] = [];

        if (metaSecret?.description) {
          const meta = JSON.parse(decrypt(metaSecret.description));

          // Download image if URL provided
          let imageBuffer: Buffer | null = null;
          let imageMime = "image/jpeg";
          if (input.image_url) {
            try {
              const dlRes = await fetch(input.image_url);
              if (dlRes.ok) {
                imageBuffer = Buffer.from(await dlRes.arrayBuffer());
                imageMime = dlRes.headers.get("content-type") || "image/jpeg";
              }
            } catch {}
          }

          // Facebook
          for (const p of input.piattaforme.filter(t => t.startsWith("fb_"))) {
            const pageId = p.replace("fb_", "");
            const page = (meta.pages || []).find((pg: any) => pg.id === pageId);
            if (!page) { results.push(`Facebook ${pageId}: pagina non trovata`); continue; }
            const token = page.accessToken || meta.accessToken;
            if (imageBuffer) {
              const fd = new FormData();
              fd.append("source", new Blob([new Uint8Array(imageBuffer)], { type: imageMime }), "post.jpg");
              fd.append("caption", input.testo);
              fd.append("access_token", token);
              const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, { method: "POST", body: fd });
              results.push(`Facebook ${page.name}: ${r.ok ? "pubblicato" : "errore " + (await r.text()).substring(0, 100)}`);
            } else {
              const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ message: input.testo, access_token: token }) });
              results.push(`Facebook ${page.name}: ${r.ok ? "pubblicato" : "errore " + (await r.text()).substring(0, 100)}`);
            }
          }

          // Instagram
          for (const p of input.piattaforme.filter(t => t.startsWith("ig_"))) {
            const igUsername = p.replace("ig_", "");
            const ig = (meta.instagram || []).find((i: any) => i.username === igUsername);
            if (!ig) { results.push(`Instagram @${igUsername}: account non trovato`); continue; }
            if (!imageBuffer) { results.push(`Instagram @${igUsername}: serve un'immagine. Usa genera_immagine prima.`); continue; }

            const page = (meta.pages || []).find((pg: any) => pg.id === ig.pageId) || (meta.pages || [])[0];
            if (!page) { results.push(`Instagram @${igUsername}: nessuna pagina Facebook collegata`); continue; }
            const token = page.accessToken || meta.accessToken;

            // Upload unpublished to FB page to get public URL
            const uploadFd = new FormData();
            uploadFd.append("source", new Blob([new Uint8Array(imageBuffer)], { type: imageMime }), "post.jpg");
            uploadFd.append("published", "false");
            uploadFd.append("access_token", token);
            const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}/photos`, { method: "POST", body: uploadFd });
            if (!uploadRes.ok) { results.push(`Instagram @${igUsername}: errore upload immagine`); continue; }
            const uploadData = await uploadRes.json() as { id?: string };
            if (!uploadData.id) { results.push(`Instagram @${igUsername}: nessun ID foto`); continue; }

            // Get image URL
            const imgUrlRes = await fetch(`https://graph.facebook.com/v21.0/${uploadData.id}?fields=images`, { headers: { Authorization: "Bearer " + token } });
            const imgUrlData = await imgUrlRes.json() as { images?: Array<{ source: string }> };
            const publicUrl = imgUrlData.images?.[0]?.source;
            if (!publicUrl) { results.push(`Instagram @${igUsername}: impossibile ottenere URL immagine`); continue; }

            // Create IG container
            const containerRes = await fetch(`https://graph.facebook.com/v21.0/${ig.id}/media`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ image_url: publicUrl, caption: input.testo, access_token: token }),
            });
            const containerData = await containerRes.json() as { id?: string };
            if (!containerData.id) { results.push(`Instagram @${igUsername}: errore creazione container`); continue; }

            // Poll until ready (max 20s)
            let ready = false;
            for (let i = 0; i < 10; i++) {
              await new Promise(r => setTimeout(r, 2000));
              const statusRes = await fetch(`https://graph.facebook.com/v21.0/${containerData.id}?fields=status_code`, { headers: { Authorization: "Bearer " + token } });
              const statusData = await statusRes.json() as { status_code?: string };
              if (statusData.status_code === "FINISHED") { ready = true; break; }
              if (statusData.status_code === "ERROR") break;
            }
            if (!ready) { results.push(`Instagram @${igUsername}: timeout attesa pubblicazione`); continue; }

            // Publish
            const publishRes = await fetch(`https://graph.facebook.com/v21.0/${ig.id}/media_publish`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ creation_id: containerData.id, access_token: token }),
            });
            results.push(`Instagram @${igUsername}: ${publishRes.ok ? "pubblicato" : "errore " + (await publishRes.text()).substring(0, 100)}`);
          }
        }

        // LinkedIn
        for (const p of input.piattaforme.filter(t => t === "li")) {
          const liSecret = await db.select().from(companySecrets)
            .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "linkedin_tokens")))
            .then(r => r[0]);
          if (!liSecret?.description) { results.push("LinkedIn: non connesso"); continue; }
          const li = JSON.parse(decrypt(liSecret.description));
          const liToken = li.access_token;
          const personUrn = li.person_urn || `urn:li:person:${li.sub}`;

          let imageUrn = "";
          if (input.image_url) {
            // Initialize upload
            const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
              method: "POST",
              headers: { Authorization: "Bearer " + liToken, "Content-Type": "application/json", "LinkedIn-Version": "202401" },
              body: JSON.stringify({ initializeUploadRequest: { owner: personUrn } }),
            });
            if (initRes.ok) {
              const initData = await initRes.json() as { value?: { uploadUrl?: string; image?: string } };
              if (initData.value?.uploadUrl) {
                const dlRes = await fetch(input.image_url);
                if (dlRes.ok) {
                  const buf = Buffer.from(await dlRes.arrayBuffer());
                  await fetch(initData.value.uploadUrl, { method: "PUT", headers: { Authorization: "Bearer " + liToken }, body: buf });
                  imageUrn = initData.value.image || "";
                }
              }
            }
          }

          const postBody: any = {
            author: personUrn,
            commentary: input.testo,
            visibility: "PUBLIC",
            distribution: { feedDistribution: "MAIN_FEED" },
            lifecycleState: "PUBLISHED",
          };
          if (imageUrn) {
            postBody.content = { media: { id: imageUrn } };
          }

          const postRes = await fetch("https://api.linkedin.com/rest/posts", {
            method: "POST",
            headers: { Authorization: "Bearer " + liToken, "Content-Type": "application/json", "LinkedIn-Version": "202401" },
            body: JSON.stringify(postBody),
          });
          results.push(`LinkedIn: ${postRes.ok || postRes.status === 201 ? "pubblicato" : "errore " + (await postRes.text()).substring(0, 100)}`);
        }

        if (results.length === 0) return "Nessuna piattaforma target specificata. Usa formato: ['ig_energizzo.it'] per Instagram, ['fb_PAGEID'] per Facebook, ['li'] per LinkedIn.";
        return "Risultati pubblicazione:\n" + results.map(r => "- " + r).join("\n");
      }

      // Catalogo prodotti tools
      case "lista_prodotti": {
        const catFilter = toolInput.categoria as string;
        const conditions = [eq(companyProducts.companyId, companyId)];
        if (catFilter) conditions.push(eq(companyProducts.category, catFilter));
        const prods = await db.select().from(companyProducts)
          .where(and(...conditions))
          .orderBy(asc(companyProducts.category), asc(companyProducts.name));
        if (prods.length === 0) return "Nessun prodotto o servizio nel catalogo. Il titolare può aggiungerli dalla pagina Profilo > Catalogo, oppure puoi aggiungerli tu con il tool aggiungi_prodotto.";
        let result = `Catalogo (${prods.length} prodotti):\n\n`;
        let currentCat = "";
        for (const p of prods) {
          if (p.category && p.category !== currentCat) { currentCat = p.category; result += `\n[${currentCat}]\n`; }
          const prices = [p.priceB2b ? `B2B: €${p.priceB2b}` : "", p.priceB2c ? `B2C: €${p.priceB2c}` : ""].filter(Boolean).join(" | ");
          result += `• ${p.name}${p.unit ? " (" + p.unit + ")" : ""} — ${prices || "prezzo su richiesta"}${!p.available ? " [NON DISPONIBILE]" : ""}${p.sku ? " [SKU: " + p.sku + "]" : ""} [ID: ${p.id}]\n`;
          if (p.description) result += `  ${p.description}\n`;
        }
        return result;
      }

      case "aggiungi_prodotto": {
        const nome = toolInput.nome as string;
        if (!nome) return "Specifica il nome del prodotto.";
        const created = await db.insert(companyProducts).values({
          companyId,
          type: (toolInput.tipo as string) || "product",
          name: nome,
          description: (toolInput.descrizione as string) || null,
          category: (toolInput.categoria as string) || null,
          unit: (toolInput.unita as string) || null,
          priceB2b: (toolInput.prezzo_b2b as string) || null,
          priceB2c: (toolInput.prezzo_b2c as string) || null,
          sku: (toolInput.sku as string) || null,
          stockQty: (toolInput.quantita_magazzino as string) || null,
          vatRate: (toolInput.iva as string) || null,
        }).returning();
        return `Prodotto aggiunto: ${nome} [ID: ${created[0].id}]`;
      }

      case "modifica_prodotto": {
        const prodId = toolInput.prodotto_id as string;
        if (!prodId) return "Specifica prodotto_id (usa lista_prodotti per ottenerlo).";
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (toolInput.nome) updates.name = toolInput.nome as string;
        if (toolInput.prezzo_b2b !== undefined) updates.priceB2b = (toolInput.prezzo_b2b as string) || null;
        if (toolInput.prezzo_b2c !== undefined) updates.priceB2c = (toolInput.prezzo_b2c as string) || null;
        if (toolInput.disponibile !== undefined) updates.available = toolInput.disponibile as boolean;
        if (toolInput.descrizione !== undefined) updates.description = (toolInput.descrizione as string) || null;
        if (toolInput.categoria !== undefined) updates.category = (toolInput.categoria as string) || null;
        if (toolInput.unita !== undefined) updates.unit = (toolInput.unita as string) || null;
        if (toolInput.sku !== undefined) updates.sku = (toolInput.sku as string) || null;
        if (toolInput.quantita_magazzino !== undefined) updates.stockQty = (toolInput.quantita_magazzino as string) || null;
        if (toolInput.iva !== undefined) updates.vatRate = (toolInput.iva as string) || null;
        const updated = await db.update(companyProducts).set(updates)
          .where(and(eq(companyProducts.id, prodId), eq(companyProducts.companyId, companyId)))
          .returning();
        if (!updated.length) return "Prodotto non trovato con questo ID.";
        return `Prodotto aggiornato: ${updated[0].name}`;
      }

      case "elimina_prodotto": {
        const delId = toolInput.prodotto_id as string;
        if (!delId) return "Specifica prodotto_id.";
        const deleted = await db.delete(companyProducts)
          .where(and(eq(companyProducts.id, delId), eq(companyProducts.companyId, companyId)))
          .returning();
        if (!deleted.length) return "Prodotto non trovato.";
        return `Prodotto eliminato: ${deleted[0].name}`;
      }

      // A2A — Rete B2B tools (delegated to a2a-tools service)
      case "cerca_azienda_a2a":
      case "lista_partner_a2a":
      case "invia_task_a2a":
      case "rispondi_task_a2a":
      case "lista_task_a2a":
      case "aggiorna_stato_task_a2a":
      case "messaggio_a2a": {
        return await executeA2aTool(db, companyId, toolName, toolInput);
      }

      case "crea_connettore_custom": {
        const input = toolInput as { nome: string; base_url: string; api_key: string; descrizione?: string; auth_type?: string };
        if (!input.nome || !input.base_url || !input.api_key) return "Errore: nome, base_url e api_key obbligatori.";
        try {
          const parsed = new URL(input.base_url);
          if (parsed.protocol !== "https:") return "Errore: solo URL HTTPS consentiti.";
          const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"];
          if (blocked.some(h => parsed.hostname === h) || parsed.hostname.startsWith("10.") || parsed.hostname.startsWith("192.168.") || parsed.hostname.startsWith("172.")) return "Errore: URL non consentito.";
        } catch { return "Errore: URL non valido."; }
        const slug = input.nome.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").substring(0, 30);
        const existingCount = await db.select({ id: customConnectors.id }).from(customConnectors).where(eq(customConnectors.companyId, companyId));
        if (existingCount.length >= 10) return "Errore: massimo 10 connettori custom per azienda.";
        try {
          const [row] = await db.insert(customConnectors).values({
            companyId, name: input.nome, slug, baseUrl: input.base_url,
            authType: input.auth_type || "bearer", description: input.descrizione || null, actions: [],
          }).returning();
          await db.insert(companySecrets).values({ id: randomUUID(), companyId, name: `custom_api_${row.id}`, provider: "encrypted", description: encrypt(input.api_key) });
          const { upsertConnectorAccount } = await import("../utils/connector-sync.js");
          await upsertConnectorAccount(db, companyId, `custom_${slug}`, row.id, input.nome);
          return `Connettore "${input.nome}" creato (id: ${row.id}). Ora dimmi quali operazioni vuoi fare con questo servizio.`;
        } catch (err: any) {
          if (err.code === "23505") return "Errore: connettore con questo nome esiste già.";
          return "Errore creazione connettore: " + (err.message || "").substring(0, 100);
        }
      }

      case "aggiungi_azione_custom": {
        const input = toolInput as { connector_id: string; nome: string; label?: string; descrizione?: string; metodo: string; path: string; parametri?: any[] };
        if (!input.connector_id || !input.nome || !input.metodo || !input.path) return "Errore: connector_id, nome, metodo e path obbligatori.";
        const connector = await db.select().from(customConnectors)
          .where(and(eq(customConnectors.id, input.connector_id), eq(customConnectors.companyId, companyId))).then(r => r[0]);
        if (!connector) return "Errore: connettore non trovato.";
        const actions = (connector.actions as any[]) || [];
        if (actions.length >= 20) return "Errore: massimo 20 azioni per connettore.";
        const actionSlug = input.nome.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        if (actions.some((a: any) => a.name === actionSlug)) return "Errore: azione già esistente.";
        actions.push({ name: actionSlug, label: input.label || input.nome, description: input.descrizione || "", method: input.metodo.toUpperCase(), path: input.path, params: input.parametri || [], body_template: null });
        await db.update(customConnectors).set({ actions, updatedAt: new Date() }).where(eq(customConnectors.id, connector.id));
        return `Azione "${input.label || input.nome}" aggiunta a "${connector.name}". Tool: custom_${connector.slug}_${actionSlug}. Altre azioni?`;
      }

      case "lista_connettori_custom": {
        const connectors = await db.select().from(customConnectors).where(eq(customConnectors.companyId, companyId));
        if (connectors.length === 0) return "Nessun connettore custom configurato.";
        return connectors.map(c => {
          const acts = (c.actions as any[]) || [];
          const al = acts.map((a: any) => `  - ${a.label || a.name} (${a.method} ${a.path})`).join("\n");
          return `📡 ${c.name} (${c.baseUrl}) — id: ${c.id}\n${al || "  Nessuna azione configurata"}`;
        }).join("\n\n");
      }

      case "rimuovi_connettore_custom": {
        const cid = toolInput.connector_id as string;
        if (!cid) return "Errore: connector_id obbligatorio.";
        const connector = await db.select().from(customConnectors)
          .where(and(eq(customConnectors.id, cid), eq(customConnectors.companyId, companyId))).then(r => r[0]);
        if (!connector) return "Errore: connettore non trovato.";
        await db.delete(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`)));
        const { removeConnectorAccount: rmConn } = await import("../utils/connector-sync.js");
        await rmConn(db, companyId, `custom_${connector.slug}`);
        await db.delete(customConnectors).where(eq(customConnectors.id, connector.id));
        return `Connettore "${connector.name}" rimosso.`;
      }

      case "testa_connettore_custom": {
        const cid = toolInput.connector_id as string;
        if (!cid) return "Errore: connector_id obbligatorio.";
        const connector = await db.select().from(customConnectors)
          .where(and(eq(customConnectors.id, cid), eq(customConnectors.companyId, companyId))).then(r => r[0]);
        if (!connector) return "Errore: connettore non trovato.";
        const secret = await db.select().from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, `custom_api_${connector.id}`))).then(r => r[0]);
        try {
          const headers: Record<string, string> = {};
          if (secret?.description && connector.authType !== "none") {
            const key = decrypt(secret.description);
            headers[connector.authHeader || "Authorization"] = `${connector.authPrefix || "Bearer"} ${key}`.trim();
          }
          const r = await fetch(connector.baseUrl, { headers, signal: AbortSignal.timeout(10000) });
          return r.ok ? `Test OK — ${connector.name} risponde (status ${r.status}).` : `Test FALLITO — status ${r.status}.`;
        } catch (err) { return `Test FALLITO — ${(err as Error).message}`; }
      }

      default:
        return "Tool sconosciuto: " + toolName;
    }
  } catch (err) {
    return "Errore: " + (err instanceof Error ? err.message : String(err));
  }
}



// Expose CEO prompt for UI display
export function getCeoPromptBase(): string {
  return CEO_PROMPT_BASE;
}

// Simple in-memory rate limiter for AI endpoints (per-company, sliding window)
const aiRateLimits = new Map<string, number[]>();
const AI_RATE_LIMIT = 20; // max requests per window
const AI_RATE_WINDOW = 60_000; // 1 minute window

function checkAiRateLimit(companyId: string): boolean {
  const now = Date.now();
  const timestamps = aiRateLimits.get(companyId) || [];
  const recent = timestamps.filter(t => now - t < AI_RATE_WINDOW);
  if (recent.length >= AI_RATE_LIMIT) return false;
  recent.push(now);
  aiRateLimits.set(companyId, recent);
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of aiRateLimits) {
    const recent = timestamps.filter(t => now - t < AI_RATE_WINDOW);
    if (recent.length === 0) aiRateLimits.delete(key);
    else aiRateLimits.set(key, recent);
  }
}, 300_000);

export function chatRoutes(db: Db) {
  const router = Router();

  async function saveChatMessage(companyId: string, userId: string, role: string, msgContent: string) {
    try {
      await db.execute(
        sql`INSERT INTO chat_messages (company_id, user_id, role, content) VALUES (${companyId}, ${userId}, ${role}, ${msgContent})`
      );
    } catch (e) {
      console.error("Chat save error:", e);
    }
  }

  // GET /chat/history?companyId=xxx&limit=50 - Load chat history
  router.get("/chat/history", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    if (!companyId) { res.json({ messages: [] }); return; }
    try {
      const safeLimit = Math.min(Math.max(limit, 1), 200);
      const rows = await db.execute(sql`SELECT id, role, content, created_at FROM chat_messages WHERE company_id = ${companyId} AND user_id = ${actor.userId} ORDER BY created_at ASC LIMIT ${safeLimit}`);
      res.json({ messages: rows || [] });
    } catch (err) {
      console.error("Chat history error:", err);
      res.json({ messages: [] });
    }
  });

  // DELETE /chat/history?companyId=xxx - Clear chat history
  router.delete("/chat/history", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ cleared: true }); return; }
    await db.execute(sql`DELETE FROM chat_messages WHERE company_id = ${companyId} AND user_id = ${actor.userId}`);
    res.json({ cleared: true });
  });

  // Clear pending messages after ChatPage picks them up
  router.post("/chat/clear-pending", async (req, res) => {
    const actor = req.actor as { type?: string; userId?: string } | undefined;
    if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
    const companyId = req.query.companyId as string;
    if (!companyId) { res.json({ cleared: true }); return; }
    await db.execute(sql`DELETE FROM chat_messages WHERE company_id = ${companyId} AND user_id = ${actor.userId} AND content LIKE '__PENDING__%'`);
    res.json({ cleared: true });
  });

  // Queue a message to be auto-sent when ChatPage loads
  router.post("/chat/queue-message", async (req, res) => {
    try {
      const actor = req.actor as { type?: string; userId?: string } | undefined;
      if (!actor?.userId) { res.status(401).json({ error: "Non autenticato" }); return; }
      const { companyId, message } = req.body as { companyId: string; message: string };
      if (!companyId || !message) { res.status(400).json({ error: "companyId e message obbligatori" }); return; }
      // Save as user message with __PENDING__ prefix to mark it for auto-send
      await db.execute(sql`INSERT INTO chat_messages (id, company_id, user_id, role, content, created_at) VALUES (${randomUUID()}, ${companyId}, ${actor.userId}, 'user', ${"__PENDING__" + message}, NOW())`);
      res.json({ queued: true });
    } catch (e) {
      console.error("Queue message error:", e);
      res.status(500).json({ error: "Errore" });
    }
  });

  router.post("/chat", async (req, res) => {
    try {
      const actor = req.actor as { type?: string; userId?: string; companyIds?: string[] } | undefined;
      if (!actor || actor.type !== "board" || !actor.userId) {
        res.status(401).json({ error: "Autenticazione richiesta" });
        return;
      }

      const { companyId, agentId, message, history } = req.body as {
        companyId: string;
        agentId?: string;
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      };

      if (!companyId || !message) {
        res.status(400).json({ error: "companyId e message sono obbligatori" });
        return;
      }

      // Rate limit: max 20 AI requests per company per minute
      if (!checkAiRateLimit(companyId)) {
        res.status(429).json({ error: "Troppe richieste. Riprova tra un minuto." });
        return;
      }

      const membership = await db.select().from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, actor.userId)))
        .then((rows) => rows[0]);

      if (!membership) {
        res.status(403).json({ error: "Accesso non autorizzato" });
        return;
      }

      const secret = await db.select().from(companySecrets)
        .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, "claude_api_key")))
        .then((rows) => rows[0]);

      if (!secret?.description) {
        res.status(400).json({ error: "API key Claude non configurata. Vai su Impostazioni per inserirla." });
        return;
      }

      let apiKey: string;
      try {
        apiKey = decrypt(secret.description);
        console.info("[chat] decrypt OK");
      } catch (decErr) {
        console.error("[chat] decrypt FAILED:", decErr);
        console.error("[chat] BETTER_AUTH_SECRET set:", !!process.env.BETTER_AUTH_SECRET);
        console.error("[chat] secret.description starts:", secret.description.substring(0, 20));
        res.status(500).json({ error: "Errore decrittazione API key" });
        return;
      }

      let systemPrompt = "Sei un assistente AI di GoItalIA. Rispondi in italiano in modo professionale e conciso.";
      let agentModel = "claude-sonnet-4-6";
      let agentRole = "ceo";
      let agentConnectors: Record<string, boolean> = {};
      let resolvedAgentId = agentId || "";

      if (agentId) {
        const agent = await db.select().from(agents)
          .where(eq(agents.id, agentId))
          .then((rows) => rows[0]);

        if (agent) {
          resolvedAgentId = agent.id;
          const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
          agentRole = agent.role || "general";
          const legacyConn = (adapterConfig?.connectors as Record<string, boolean>) || {};
          agentConnectors = await getAgentConnectorsFromDb(db, agent.id, legacyConn);
          const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
          if (typeof adapterConfig?.model === "string" && adapterConfig.model) { agentModel = adapterConfig.model; }
          const capabilities = agent.capabilities ?? "";

          // CEO gets the hardcoded prompt, other agents get their custom prompt
          if (agent.role === "ceo") {
            systemPrompt = buildCeoPrompt();
            // Append custom instructions if any
            const customInstructions = typeof adapterConfig?.customInstructions === "string" ? adapterConfig.customInstructions : "";
            if (customInstructions.trim()) {
              systemPrompt += "\n\n## ISTRUZIONI PERSONALIZZATE DAL CLIENTE\n" + customInstructions;
            }
          } else {
            const basePrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\n\nCompetenze: ${capabilities}\n\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo professionale e conciso.`;
            const customInstructions = typeof adapterConfig?.customInstructions === "string" ? adapterConfig.customInstructions : "";
            systemPrompt = customInstructions.trim() ? basePrompt + "\n\n## ISTRUZIONI AGGIUNTIVE\n" + customInstructions : basePrompt;
          }
        }
      }

      // Load company profile + CEO notes
      let memoryContext = "";
      try {
        // Read structured profile from company_profiles
        const profileRow = await db.select().from(companyProfiles)
          .where(eq(companyProfiles.companyId, companyId))
          .then((r) => r[0]);
        if (profileRow) {
          const fields: [string, unknown][] = [
            ["ragione_sociale", profileRow.ragioneSociale], ["partita_iva", profileRow.partitaIva],
            ["codice_fiscale", profileRow.codiceFiscale], ["forma_giuridica", profileRow.formaGiuridica],
            ["stato_attivita", profileRow.statoAttivita], ["data_inizio", profileRow.dataInizio],
            ["settore", profileRow.settore], ["indirizzo", profileRow.indirizzo],
            ["citta", profileRow.citta], ["cap", profileRow.cap],
            ["provincia", profileRow.provincia], ["regione", profileRow.regione],
            ["telefono", profileRow.telefono], ["email", profileRow.email],
            ["whatsapp", profileRow.whatsapp], ["pec", profileRow.pec],
            ["codice_sdi", profileRow.codiceSdi], ["sito_web", profileRow.sitoWeb],
            ["dipendenti", profileRow.dipendenti], ["fatturato", profileRow.fatturato],
            ["patrimonio_netto", profileRow.patrimonioNetto], ["capitale_sociale", profileRow.capitaleSociale],
            ["totale_attivo", profileRow.totaleAttivo], ["risk_score", profileRow.riskScore],
            ["rating", profileRow.rating], ["risk_severity", profileRow.riskSeverity],
            ["credit_limit", profileRow.creditLimit], ["soci", profileRow.soci],
          ];
          const filled = fields.filter(([, v]) => v != null && v !== "");
          if (filled.length > 0) {
            memoryContext += "\n\n--- MEMORIA AZIENDA ---\n";
            for (const [k, v] of filled) {
              memoryContext += k + ": " + v + "\n";
            }
          }
        }
        // Read notes from ceo_memory
        const memResult = await db.execute(sql`SELECT notes, preferences FROM ceo_memory WHERE company_id = ${companyId}`);
        const memRows = (memResult as any).rows || memResult;
        if (memRows.length > 0 && memRows[0]) {
          const mem = memRows[0];
          if (mem.notes && Array.isArray(mem.notes) && mem.notes.length > 0) {
            memoryContext += "\nNOTE SALVATE:\n";
            for (const n of (mem.notes as Array<{contenuto: string; categoria?: string; data?: string}>)) {
              memoryContext += "- [" + (n.categoria || "generale") + "] " + n.contenuto + "\n";
            }
          }
        }
        // Load product catalog
        const products = await db.select().from(companyProducts)
          .where(eq(companyProducts.companyId, companyId))
          .orderBy(asc(companyProducts.category), asc(companyProducts.name));
        if (products.length > 0) {
          memoryContext += "\nCATALOGO PRODOTTI/SERVIZI:\n";
          let currentCat = "";
          for (const p of products) {
            if (p.category && p.category !== currentCat) {
              currentCat = p.category;
              memoryContext += `\n[${currentCat}]\n`;
            }
            const prices = [
              p.priceB2b ? `B2B: €${p.priceB2b}` : "",
              p.priceB2c ? `B2C: €${p.priceB2c}` : "",
            ].filter(Boolean).join(" | ");
            memoryContext += `- ${p.name}${p.unit ? " (" + p.unit + ")" : ""} — ${prices || "prezzo su richiesta"}${p.available === false ? " [NON DISPONIBILE]" : ""}${p.sku ? " [SKU: " + p.sku + "]" : ""}\n`;
            if (p.description) memoryContext += `  ${p.description}\n`;
          }
        }
        if (memoryContext) memoryContext += "--- FINE MEMORIA ---";
      } catch (e) { console.error("Memory load error:", e); }
      systemPrompt += memoryContext;

      // Build dynamic context for Direttore
      let dynamicContext = "";
      try {
        // Get all agents
        const companyAgents = await db.select({
          id: agents.id,
          name: agents.name,
          title: agents.title,
          role: agents.role,
          status: agents.status,
        }).from(agents).where(eq(agents.companyId, companyId));

        // Get connector status from connector_accounts table
        const companyConnectorRows = await db.select({
          connectorType: connectorAccounts.connectorType,
          accountId: connectorAccounts.accountId,
          accountLabel: connectorAccounts.accountLabel,
        }).from(connectorAccounts).where(eq(connectorAccounts.companyId, companyId));

        // Map connector_type to CONNECTOR_GUIDES keys
        const typeToGuideKey: Record<string, string> = {
          google: "google", telegram: "telegram", whatsapp: "whatsapp",
          meta_ig: "meta", meta_fb: "meta",
          linkedin: "linkedin", fal: "fal", fic: "fic",
          openapi: "openapi", voice: "voice", pec: "pec",
        };

        const activeGuideKeys = new Set<string>();
        const activeDetails: string[] = [];
        for (const row of companyConnectorRows) {
          const guideKey = typeToGuideKey[row.connectorType] || row.connectorType;
          activeGuideKeys.add(guideKey);
          activeDetails.push(`${row.connectorType}:${row.accountLabel || row.accountId}`);
        }

        // Fallback: also check secrets for connectors not yet migrated
        const secrets = await db.select({ name: companySecrets.name }).from(companySecrets).where(eq(companySecrets.companyId, companyId));
        const secretNames = secrets.map((s) => s.name);
        const connectorSecretMap: Record<string, string> = {
          google_oauth_tokens: "google", telegram_bots: "telegram",
          whatsapp_sessions: "whatsapp", meta_tokens: "meta",
          linkedin_tokens: "linkedin", fal_api_key: "fal",
          fattureincloud_tokens: "fic", openapi_it_creds: "openapi",
          openai_api_key: "voice", pec_credentials: "pec",
        };
        for (const [secretName, guideKey] of Object.entries(connectorSecretMap)) {
          if (secretNames.includes(secretName)) activeGuideKeys.add(guideKey);
        }

        const activeConnectors = Array.from(activeGuideKeys);
        const inactiveConnectors = CONNECTOR_GUIDES
          .filter((g) => !activeGuideKeys.has(g.key))
          .map((g) => g.key);

        const hasClaudeKey = secretNames.includes("claude_api_key");

        dynamicContext = "\n\n--- STATO ATTUALE DELL'IMPRESA ---\n";

        const activeAgents = companyAgents.filter(a => a.status !== "terminated");
        if (activeAgents.length > 0) {
          // Batch load all agent connectors in one query (avoid N+1)
          const allAgentConns = await db.select({
            agentId: agentConnectorAccounts.agentId,
            connectorType: connectorAccounts.connectorType,
            accountId: connectorAccounts.accountId,
          })
            .from(agentConnectorAccounts)
            .innerJoin(connectorAccounts, eq(agentConnectorAccounts.connectorAccountId, connectorAccounts.id))
            .where(inArray(agentConnectorAccounts.agentId, activeAgents.map(a => a.id)));

          const connByAgent = new Map<string, string[]>();
          for (const row of allAgentConns) {
            if (!connByAgent.has(row.agentId)) connByAgent.set(row.agentId, []);
            connByAgent.get(row.agentId)!.push(`${row.connectorType}:${row.accountId}`);
          }

          dynamicContext += "Agenti e loro connettori:\n";
          for (const a of activeAgents) {
            const connStr = connByAgent.get(a.id)?.join(", ") || "nessun connettore";
            dynamicContext += `- ${a.name} (${a.title || a.role || ""}) — id: ${a.id} — connettori: ${connStr}\n`;
          }
        } else {
          dynamicContext += "Nessun agente creato.\n";
        }

        dynamicContext += "\nConnettori attivi:\n";
        if (activeConnectors.length === 0) {
          dynamicContext += "- Nessun connettore attivo\n";
        } else {
          for (const key of activeConnectors) {
            const guide = CONNECTOR_GUIDES.find(g => g.key === key);
            if (guide) dynamicContext += `- ${guide.label} (${guide.capabilities}): connesso\n`;
          }
        }

        if (inactiveConnectors.length > 0) {
          dynamicContext += "\nConnettori disponibili ma non attivi:\n";
          for (const key of inactiveConnectors) {
            const guide = CONNECTOR_GUIDES.find(g => g.key === key);
            if (guide) dynamicContext += `- ${guide.label} (vai su Connettori per collegare)\n`;
          }
        }

        if (!hasClaudeKey) dynamicContext += "\n⚠️ API key Claude NON configurata!\n";

        // Custom connectors
        const customConns = await db.select().from(customConnectors)
          .where(eq(customConnectors.companyId, companyId));
        if (customConns.length > 0) {
          dynamicContext += "\nConnettori API custom:\n";
          for (const c of customConns) {
            const acts = (c.actions as any[]) || [];
            const actionNames = acts.map((a: any) => a.label || a.name).join(", ");
            dynamicContext += `- ${c.name} (${c.baseUrl}) — id: ${c.id} — azioni: ${actionNames || "nessuna"}\n`;
          }
        }

        dynamicContext += "--- FINE STATO ---\n\nUsa lista_agenti + esegui_task_agente per delegare operazioni ai tuoi agenti. Se un connettore è attivo ma non ha un agente, crealo con crea_agente prima di delegare. Se il connettore non è attivo, suggerisci al cliente di attivarlo da Connettori.";
      } catch (e) {
        console.error("Dynamic context error:", e);
      }

      systemPrompt += dynamicContext;

      // Build messages from history
      type ApiMessage = { role: "user" | "assistant"; content: unknown };
      const messages: ApiMessage[] = [];
      if (history && Array.isArray(history)) {
        for (const msg of history.slice(-20)) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      messages.push({ role: "user", content: message });
      // Save user message to DB
      if (actor.userId) {
        await saveChatMessage(companyId, actor.userId, "user", message);
      }

      // Multi-turn tool loop
      const MAX_TURNS = 8;
      let finalText = "";

      // Set SSE headers — X-Accel-Buffering disables nginx proxy buffering
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      // Load custom tools once before the loop
      const customTools = await getCustomToolsForCompany(db, companyId);
      const allTools = [...filterToolsForAgent(agentRole, agentConnectors), ...customTools];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: agentModel,
            max_tokens: 4096,
            system: systemPrompt,
            messages,
            tools: allTools,
          }),
        });

        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          console.error("Claude API error:", claudeRes.status, errText);
          res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: "Errore comunicazione Claude AI" } }) + "\n\n");
          break;
        }

        const data = await claudeRes.json() as {
          content?: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
          stop_reason?: string;
        };

        const content = data.content || [];
        const textBlocks = content.filter((c) => c.type === "text");
        const toolUseBlocks = content.filter((c) => c.type === "tool_use");

        // Stream text blocks
        for (const block of textBlocks) {
          if (block.text) {
            finalText += block.text;
            res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: block.text } }) + "\n\n");
          }
        }

        // If no tool calls, done
        if (!toolUseBlocks.length || data.stop_reason === "end_turn") {
          break;
        }

        // Stream tool activity as agent_progress events (rendered specially in frontend)
        for (const block of toolUseBlocks) {
          if (block.name === "esegui_task_agente") {
            // Delegating — extract agent name from input if possible
            const agentId = (block.input as Record<string, unknown>)?.agente_id as string;
            res.write("data: " + JSON.stringify({ type: "agent_progress", connector: "delegate", label: "Delegando compito all'agente..." }) + "\n\n");
          } else {
            const label = TOOL_PROGRESS_LABELS[block.name || ""] || `Eseguendo ${block.name}...`;
            const connector = TOOL_CONNECTOR[block.name || ""] || "system";
            res.write("data: " + JSON.stringify({ type: "agent_progress", connector, label }) + "\n\n");
          }
          (res as any).flush?.();
        }

        // Add assistant message
        messages.push({ role: "assistant", content });

        // Execute tools — pass SSE progress callback for agent delegation
        const sseProgress = (msg: string, toolName?: string) => {
          const connector = toolName ? (TOOL_CONNECTOR[toolName] || "system") : "system";
          res.write("data: " + JSON.stringify({ type: "agent_progress", connector, label: msg }) + "\n\n");
          (res as any).flush?.();
        };
        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
        for (const block of toolUseBlocks) {
          const result = await executeChatTool(
            block.name || "unknown",
            (block.input || {}) as ToolInput,
            db,
            companyId,
            resolvedAgentId,
            apiKey,
            sseProgress,
          );
          toolResults.push({ type: "tool_result", tool_use_id: block.id || "", content: result });
        }

        messages.push({ role: "user", content: toolResults });
      }

      // Save assistant response to DB
      if (actor?.userId && finalText) {
        await saveChatMessage(companyId, actor.userId, "assistant", finalText);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Errore nella chat" });
      } else {
        res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: "Errore interno" } }) + "\n\n");
        res.end();
      }
    }
  });

  return router;
}

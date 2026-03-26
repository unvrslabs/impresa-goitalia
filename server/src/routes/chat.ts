import { Router } from "express";
import type { Db } from "@goitalia/db";
import { companySecrets, agents, companyMemberships, companies, issues } from "@goitalia/db";
import { eq, and, ne, inArray, desc, sql, asc } from "drizzle-orm";
import { decrypt as decryptSecret, decrypt, encrypt } from "../utils/crypto.js";
import { randomUUID } from "node:crypto";

// Tool definitions (same as adapter)
const TOOLS = [
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
    description: "Delega un compito a un agente specifico. L'agente lo eseguirà usando i suoi tool e connettori, poi ti restituirà il risultato. Usa lista_agenti per trovare l'agente giusto.",
    input_schema: {
      type: "object" as const,
      properties: {
        agente_id: { type: "string", description: "ID dell'agente a cui delegare il compito" },
        istruzioni: { type: "string", description: "Istruzioni dettagliate su cosa deve fare l'agente" },
      },
      required: ["agente_id", "istruzioni"],
    },
  },
  {
    name: "salva_info_azienda",
    description: "Salva o aggiorna le informazioni dell'azienda del cliente in memoria (ragione sociale, P.IVA, CF, indirizzo, settore, PEC, telefono, email, sito web, ecc.)",
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
        settore: { type: "string", description: "Settore / attività principale" },
        pec: { type: "string", description: "Indirizzo PEC" },
        telefono: { type: "string", description: "Telefono" },
        email: { type: "string", description: "Email di contatto" },
        codice_sdi: { type: "string", description: "Codice destinatario SDI" },
        sito_web: { type: "string", description: "Sito web" },
        note: { type: "string", description: "Note aggiuntive sull'azienda" },
      },
      required: [],
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
];

// Map each tool to the connector key it requires. null = always available.
const TOOL_CONNECTOR: Record<string, string | null> = {
  lista_agenti: null,
  crea_task: null,
  stato_task: null,
  commenta_task: null,
  elimina_agente: null,
  crea_agente: null,
  esegui_task_agente: null,
  salva_info_azienda: null,
  salva_nota: null,
  leggi_memoria: null,
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
2. Chiedi le informazioni aziendali essenziali: ragione sociale, P.IVA, CF, indirizzo sede, settore/attività, PEC, telefono, email, sito web
3. Salva TUTTO in memoria con salva_info_azienda
4. DOPO IL RIEPILOGO: mostra i dati ricevuti, poi scrivi ESATTAMENTE: "Perfetto! Premi il bottone qui sotto per andare ai Connettori e collegare i tuoi servizi (Google, WhatsApp, Telegram, ecc.). Dopo aver collegato i connettori potrai creare i tuoi agenti AI specializzati."
5. NON proporre agenti da creare. NON elencare agenti possibili. Il cliente deve PRIMA collegare i connettori.

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

## ORCHESTRAZIONE — Dopo la creazione

Una volta creati, gli agenti sono il tuo team. Tu orchestra:
- SINGOLO AGENTE: delega diretta (es: "Manda fattura" → Agente FattureCloud)
- MULTI-AGENTE: coordina catena (es: "Fai fattura a Rossi e avvisalo" → FattureCloud emette + WhatsApp notifica)
- NESSUN AGENTE: "Per questo serve il connettore [X]. Vuoi attivarlo?"
- NON fare tu il lavoro se c'è un agente specializzato — delega con esegui_task_agente!

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

// Build tool list section dynamically from TOOLS + TOOL_CONNECTOR
function buildToolList(): string {
  let s = "\n\n## TOOL DISPONIBILI\n\n### Sempre disponibili\n";
  // Group connector tools by parent connector key
  const connectorTools: Record<string, string[]> = {};
  // Map sub-keys to parent connector (e.g. oai_company → openapi)
  const subKeyMap: Record<string, string> = {
    oai_company: "openapi", oai_risk: "openapi", oai_cap: "openapi",
  };
  for (const tool of TOOLS) {
    const req = TOOL_CONNECTOR[tool.name];
    if (req === null || req === undefined) {
      s += `- ${tool.name}: ${tool.description}\n`;
    } else {
      const parentKey = subKeyMap[req] || req;
      if (!connectorTools[parentKey]) connectorTools[parentKey] = [];
      connectorTools[parentKey].push(`${tool.name}: ${tool.description}`);
    }
  }
  for (const [connector, tools] of Object.entries(connectorTools)) {
    const guide = CONNECTOR_GUIDES.find(g => g.key === connector);
    const label = guide?.label || connector;
    s += `\n### ${label} (se connesso)\n`;
    for (const t of tools) s += `- ${t}\n`;
  }
  return s;
}

// Assemble the full CEO prompt (called at request time, so new connectors/tools are picked up)
function buildCeoPrompt(): string {
  return CEO_PROMPT_BASE + buildConnectorGuides() + buildToolList();
}

function filterToolsForAgent(agentRole: string, connectors: Record<string, boolean>): typeof TOOLS {
  // CEO/Direttore gets all tools
  if (agentRole === "ceo") return TOOLS;
  
  return TOOLS.filter((tool) => {
    const required = TOOL_CONNECTOR[tool.name];
    // Tool with no connector requirement = always available
    if (required === null || required === undefined) return true;
    // Check if connector is explicitly enabled (default is false for non-ceo)
    return connectors[required] === true;
  });
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


async function executeAgentTask(
  db: Db,
  companyId: string,
  targetAgentId: string,
  istruzioni: string,
  apiKey: string,
): Promise<string> {
  // 1. Load the target agent
  const agent = await db.select().from(agents)
    .where(eq(agents.id, targetAgentId))
    .then((rows) => rows[0]);
  
  if (!agent) return "Errore: agente non trovato con ID " + targetAgentId;

  const adapterConfig = agent.adapterConfig as Record<string, unknown> | null;
  const agentModel = (typeof adapterConfig?.model === "string" && adapterConfig.model) || "claude-haiku-4-5-20251001";
  const connectors = (adapterConfig?.connectors as Record<string, boolean>) || {};
  const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
  const capabilities = agent.capabilities ?? "";

  // 2. Build agent system prompt
  const systemPrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\nCompetenze: ${capabilities}\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo conciso e operativo.`;

  // 3. Get agent's tools based on connectors
  const agentTools = filterToolsForAgent(agent.role || "general", connectors);
  
  if (agentTools.length === 0) {
    return "Errore: l'agente " + agent.name + " non ha connettori attivi. Attiva i connettori dalla pagina dell'agente.";
  }

  // 4. Execute multi-turn tool loop (max 3 turns)
  const MAX_AGENT_TURNS = 3;
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: istruzioni },
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
      console.log("[agent-task]", agent.name, "calls tool:", toolUse.name);
      const result = await executeChatTool(
        toolUse.name || "",
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

async function executeChatTool(
  toolName: string,
  toolInput: ToolInput,
  db: Db,
  companyId: string,
  agentId: string,
  apiKey?: string,
): Promise<string> {
  try {
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
        if (target.role === "ceo") return "Il Direttore AI non può essere eliminato.";
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
        return `Agente creato: ${input.nome} (${input.titolo}) — id: ${newAgent.id} — connettore: ${conn || "nessuno"}. L'agente ha attivo solo il connettore ${conn}. Il cliente può abilitare altri connettori dalla pagina agente > Connettori.`;
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

      case "salva_info_azienda": {
        const fields = toolInput as Record<string, string>;
        // Load existing memory
        const existingMem = await db.execute(sql`SELECT company_info FROM ceo_memory WHERE company_id = ${companyId}`);
        const rows = (existingMem as any).rows || existingMem;
        const existing = rows[0]?.company_info || {};
        // Merge non-empty fields
        const updated: Record<string, string> = { ...existing };
        for (const [k, v] of Object.entries(fields)) {
          if (v && typeof v === "string" && v.trim()) updated[k] = v.trim();
        }
        if (rows.length > 0) {
          await db.execute(sql`UPDATE ceo_memory SET company_info = ${JSON.stringify(updated)}::jsonb, updated_at = NOW() WHERE company_id = ${companyId}`);
        } else {
          await db.execute(sql`INSERT INTO ceo_memory (company_id, company_info) VALUES (${companyId}, ${JSON.stringify(updated)}::jsonb)`);
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
        const memResult = await db.execute(sql`SELECT company_info, notes, preferences FROM ceo_memory WHERE company_id = ${companyId}`);
        const memR = (memResult as any).rows || memResult;
        if (memR.length === 0) return "Nessuna informazione salvata in memoria per questa azienda.";
        const mem = memR[0];
        let output = "";
        if (mem.company_info && Object.keys(mem.company_info).length > 0) {
          output += "DATI AZIENDA:\n";
          for (const [k, v] of Object.entries(mem.company_info)) {
            output += "- " + k + ": " + v + "\n";
          }
        }
        if (mem.notes && Array.isArray(mem.notes) && mem.notes.length > 0) {
          output += "\nNOTE SALVATE:\n";
          for (const n of mem.notes) {
            output += "- [" + (n.categoria || "generale") + " " + (n.data || "") + "] " + n.contenuto + "\n";
          }
        }
        return output || "Memoria vuota.";
      }

      case "esegui_task_agente": {
        if (!apiKey) return "Errore: API key non disponibile per esecuzione agente.";
        const targetId = toolInput.agente_id as string;
        const instructions = toolInput.istruzioni as string;
        if (!targetId || !instructions) return "Errore: agente_id e istruzioni sono obbligatori.";
        console.log("[direttore] Delegating task to agent:", targetId, "->", instructions.substring(0, 100));
        const result = await executeAgentTask(db, companyId, targetId, instructions, apiKey);
        console.log("[direttore] Agent result:", result.substring(0, 200));
        return result;
      }

      default:
        return "Tool sconosciuto: " + toolName;
    }
  } catch (err) {
    return "Errore: " + (err instanceof Error ? err.message : String(err));
  }
}



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
      const rows = await db.execute(sql`SELECT id, role, content, created_at FROM chat_messages WHERE company_id = ${companyId} AND user_id = ${actor.userId} ORDER BY created_at ASC LIMIT 50`);
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
        apiKey = decryptSecret(secret.description);
        console.info("[chat] decrypt OK, key starts with:", apiKey.substring(0, 10));
      } catch (decErr) {
        console.error("[chat] decrypt FAILED:", decErr);
        console.error("[chat] BETTER_AUTH_SECRET set:", !!process.env.BETTER_AUTH_SECRET);
        console.error("[chat] secret.description starts:", secret.description.substring(0, 20));
        res.status(500).json({ error: "Errore decrittazione API key" });
        return;
      }

      let systemPrompt = "Sei un assistente AI di GoItalIA. Rispondi in italiano in modo professionale e conciso.";
      let agentModel = "claude-opus-4-6";
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
          agentConnectors = (adapterConfig?.connectors as Record<string, boolean>) || {};
          const promptTemplate = typeof adapterConfig?.promptTemplate === "string" ? adapterConfig.promptTemplate : "";
          if (typeof adapterConfig?.model === "string" && adapterConfig.model) { agentModel = adapterConfig.model; }
          const capabilities = agent.capabilities ?? "";

          // CEO gets the hardcoded prompt, other agents get their custom prompt
          if (agent.role === "ceo") {
            systemPrompt = buildCeoPrompt();
          } else {
            systemPrompt = promptTemplate || `Sei ${agent.name}, ${agent.title ?? agent.role} presso l'azienda del cliente.\n\nCompetenze: ${capabilities}\n\nEsegui il compito assegnato usando i tool a disposizione. Rispondi in italiano, in modo professionale e conciso.`;
          }
        }
      }

      // Load CEO memory
      let memoryContext = "";
      try {
        const memResult = await db.execute(sql`SELECT company_info, notes, preferences FROM ceo_memory WHERE company_id = ${companyId}`);
        const memRows = (memResult as any).rows || memResult;
        if (memRows.length > 0 && memRows[0]) {
          const mem = memRows[0];
          if (mem.company_info && Object.keys(mem.company_info).length > 0) {
            memoryContext += "\n\n--- MEMORIA AZIENDA ---\n";
            for (const [k, v] of Object.entries(mem.company_info)) {
              memoryContext += k + ": " + v + "\n";
            }
          }
          if (mem.notes && Array.isArray(mem.notes) && mem.notes.length > 0) {
            memoryContext += "\nNOTE SALVATE:\n";
            for (const n of (mem.notes as Array<{contenuto: string; categoria?: string; data?: string}>)) {
              memoryContext += "- [" + (n.categoria || "generale") + "] " + n.contenuto + "\n";
            }
          }
          memoryContext += "--- FINE MEMORIA ---";
        }
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

        // Get connector status — check all connectors dynamically
        const secrets = await db.select({ name: companySecrets.name }).from(companySecrets).where(eq(companySecrets.companyId, companyId));
        const secretNames = secrets.map((s) => s.name);

        // Map secret names to connector keys
        const connectorSecretMap: Record<string, string> = {
          google_oauth_tokens: "google",
          telegram_bots: "telegram",
          wasender_sessions: "whatsapp",
          meta_oauth_tokens: "meta",
          linkedin_oauth_tokens: "linkedin",
          fal_api_key: "fal",
          fic_token: "fic",
          openapi_it_creds: "openapi",
          openai_voice_key: "voice",
        };

        const activeConnectors: string[] = [];
        const inactiveConnectors: string[] = [];
        for (const guide of CONNECTOR_GUIDES) {
          const secretKey = Object.entries(connectorSecretMap).find(([_, v]) => v === guide.key)?.[0];
          if (secretKey && secretNames.includes(secretKey)) {
            activeConnectors.push(guide.key);
          } else {
            inactiveConnectors.push(guide.key);
          }
        }

        const hasClaudeKey = secretNames.includes("claude_api_key");

        dynamicContext = "\n\n--- STATO ATTUALE DELL'IMPRESA ---\n";

        if (companyAgents.length > 0) {
          dynamicContext += "Agenti:\n";
          for (const a of companyAgents) {
            dynamicContext += "- " + a.name + " (" + (a.title || a.role || "") + ") — id: " + a.id + " — stato: " + (a.status || "idle") + "\n";
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

        dynamicContext += "--- FINE STATO ---\n\nUsa queste informazioni per rispondere. NON creare agenti duplicati. Se l'utente chiede qualcosa che richiede un connettore non attivo, suggerisci di attivarlo da Connettori.";
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

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

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
            tools: agentId ? filterToolsForAgent(agentRole || 'general', agentConnectors || {}) : TOOLS,
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

        // Stream tool activity
        for (const block of toolUseBlocks) {
          res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: "\n🔧 Esecuzione: " + block.name + "...\n" } }) + "\n\n");
        }

        // Add assistant message
        messages.push({ role: "assistant", content });

        // Execute tools
        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
        for (const block of toolUseBlocks) {
          const result = await executeChatTool(
            block.name || "unknown",
            (block.input || {}) as ToolInput,
            db,
            companyId,
            resolvedAgentId,
            apiKey,
          );
          toolResults.push({ type: "tool_result", tool_use_id: block.id || "", content: result });
          // tool result logged silently
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

# Contesto: Nuovo Connettore PEC per GoItalIA Impresa

## Progetto
- **Repo locale**: `/Users/emanuelemaccari/impresa-goitalia`
- **Repo GitHub**: `unvrslabs/impresa-goitalia` (master)
- **VPS**: `root@89.167.3.74`, path `/var/www/impresa-goitalia`
- **PM2**: `goitalia-impresa`, porta 3102
- **DB**: PostgreSQL porta 5435 (container `goitalia-pg`), database `goitalia_impresa`
- **Prod**: https://impresa.goitalia.eu
- **Deploy**: `git pull && npm run build && cp ui/public/sw.js ui/dist/sw.js && pm2 restart goitalia-impresa`

## Stack
- Backend: Node.js + Express + TypeScript, in `server/src/`
- Frontend: React + TypeScript + Vite, in `ui/src/`
- ORM: Drizzle + PostgreSQL
- DB Schema: `packages/db/src/schema/`
- Shared types: `packages/shared/src/`

## Architettura Connettori Attuale

Ogni connettore ha:
1. **Route backend** (`server/src/routes/<connettore>.ts`) — endpoints connect/disconnect/status + logica operativa
2. **Sync con connector_accounts** — alla connessione, INSERT in tabella `connector_accounts`; alla disconnessione, DELETE
3. **Credenziali** — salvate in tabella `company_secrets` (campo `description` crittato con AES-256-CBC)
4. **Pagina frontend** — UI dedicata per interagire col connettore
5. **Registrazione in app.ts** — import + `api.use()`

### Tabelle relazionali connettori
- `connector_accounts` (company_id, connector_type, account_id, account_label) — account collegati
- `agent_connector_accounts` (agent_id, connector_account_id) — associazione agente-connettore

### Helper per sync
```typescript
// server/src/utils/connector-sync.ts
import { upsertConnectorAccount, removeConnectorAccount } from "../utils/connector-sync.js";
// upsertConnectorAccount(db, companyId, connectorType, accountId, accountLabel?)
// removeConnectorAccount(db, companyId, connectorType, accountId?)
```

### Crittografia secrets
```typescript
// server/src/utils/crypto.ts
import { encrypt, decrypt } from "../utils/crypto.js";
// encrypt(plaintext) → "iv_hex:encrypted_hex"
// decrypt(ciphertext) → plaintext
```

### Pattern di un connettore (esempio: Google OAuth)
```
server/src/routes/google-oauth.ts  → OAuth flow, salva tokens in company_secrets
server/src/routes/gmail.ts         → Operazioni: lista mail, leggi mail, invia, rispondi
ui/src/pages/MailPage.tsx          → UI lista email con bottone "Genera risposta AI"
```

### Registrazione in app.ts
```typescript
// server/src/app.ts
import { pecRoutes } from "./routes/pec.js";
// ...
api.use(pecRoutes(db));
```

### Sidebar
In `ui/src/components/Sidebar.tsx`:
- Ogni connettore ha un check status via fetch (`/api/pec/status?companyId=xxx`)
- Se connesso, mostra la voce nel menu

### PluginManager (pagina Connettori)
In `ui/src/pages/PluginManager.tsx`:
- Card per ogni connettore con stato connesso/non connesso
- Form di connessione (input credenziali)
- Bottone disconnect
- Bottone "Crea agente"

## Connettori Esistenti (per riferimento pattern)

| Connettore | Route | connector_type | Secret name | Multi-account |
|-----------|-------|---------------|-------------|---------------|
| Google OAuth | google-oauth.ts | google | google_oauth_tokens | SI (array per email) |
| Gmail | gmail.ts | - | - | (usa google) |
| Telegram | telegram.ts | telegram | telegram_bots | SI (array per username) |
| WhatsApp | whatsapp.ts | whatsapp | whatsapp_sessions | SI (array per numero) |
| Meta (IG+FB) | meta.ts | meta_ig, meta_fb | meta_tokens | NO |
| LinkedIn | linkedin.ts | linkedin | linkedin_tokens | SI (array per email) |
| Fal.ai | fal-ai.ts | fal | fal_api_key | NO |
| Fatture in Cloud | fattureincloud.ts | fic | fattureincloud_tokens | NO |
| OpenAPI.it | openapi-it.ts | openapi | openapi_it_creds | NO |
| Voice | voice.ts | voice | openai_api_key | NO |

## Chat e Tool Agenti

Il sistema CEO/agenti è in `server/src/routes/chat.ts`:
- `TOOLS` array — definizione tool con input_schema
- `TOOL_CONNECTOR` map — mappa tool → connettore richiesto (null = sempre disponibile)
- `filterToolsForAgent()` — filtra tool in base ai connettori attivi dell'agente
- `executeChatTool()` — esegue il tool e ritorna risultato stringa
- `CONNECTOR_GUIDES` — guida per il CEO su come suggerire connettori durante creazione agente

Per aggiungere tool PEC:
1. Aggiungere definizioni tool in TOOLS (es: `lista_pec`, `leggi_pec`, `invia_pec`)
2. Aggiungere mapping in TOOL_CONNECTOR (es: `lista_pec: "pec"`)
3. Aggiungere case nello switch di `executeChatTool`
4. Aggiungere entry in CONNECTOR_GUIDES

## Auto-Reply

Gli agenti possono avere `autoReply: true` in `adapterConfig`. Quando un messaggio arriva via webhook, se l'agente associato ha autoReply attivo, genera e invia risposta automatica via Claude API. Questo pattern si applica anche alla PEC per risposta automatica a email PEC ricevute.

---

# Specifiche Connettore PEC

## Obiettivo
Permettere alle PMI di collegare la propria casella PEC e:
- Ricevere e leggere email PEC
- Inviare email PEC
- Rispondere a email PEC
- Visualizzare stato certificazione (accettazione, consegna, errore)
- Parsare automaticamente daticert.xml per metadati certificazione
- Auto-reply opzionale via agente AI

## Approccio Tecnico: IMAP/SMTP Diretto

La PEC è email standard con certificazione. Si integra via protocolli standard IMAP + SMTP.

### Provider Principali

**Aruba PEC:**
- IMAP: `imaps.pec.aruba.it` porta 993 (SSL)
- SMTP: `smtps.pec.aruba.it` porta 465 (SSL)
- POP3: `pop3s.pec.aruba.it` porta 995 (SSL)

**Poste Italiane (Postecertifica):**
- IMAP: `mail.postecertifica.it` porta 993 (SSL)
- SMTP: `mail.postecertifica.it` porta 465 (SSL)

**Legalmail (InfoCert):**
- IMAP: `mbox.cert.legalmail.it` porta 993
- SMTP: `sendm.cert.legalmail.it` porta 465

### Librerie Node.js
- **`imapflow`** — client IMAP moderno, async/await, supporta IDLE per notifiche push
- **`nodemailer`** — invio SMTP, supporta SSL/TLS
- **`mailparser`** (da `mailparser` o builtin di imapflow) — parsing email MIME

### Struttura Messaggio PEC Ricevuto
Ogni email PEC ha allegati specifici:
- `daticert.xml` — dati di certificazione strutturati (mittente, destinatari, tipo, data)
- `postacert.eml` — il messaggio originale (corpo + allegati del mittente)
- `smime.p7s` — firma digitale S/MIME

### Tipi di Messaggio PEC
- **posta-certificata** — messaggio PEC regolare
- **accettazione** — ricevuta di accettazione dal gestore mittente
- **avvenuta-consegna** — ricevuta di consegna dal gestore destinatario
- **non-accettazione** — rifiuto dal gestore mittente
- **errore-consegna** — errore di consegna
- **preavviso-errore-consegna** — preavviso di mancata consegna

### Parsing daticert.xml (esempio struttura)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<postacert tipo="avvenuta-consegna" errore="nessuno">
  <intestazione>
    <mittente>mario@pec.azienda.it</mittente>
    <destinatari tipo="certificato">fornitore@pec.fornitore.it</destinatari>
    <risposte>mario@pec.azienda.it</risposte>
    <oggetto>Ordine di acquisto n. 2024/123</oggetto>
  </intestazione>
  <dati>
    <gestore-emittente>Aruba PEC S.p.A.</gestore-emittente>
    <data zona="+0200">
      <giorno>26/03/2026</giorno>
      <ora>14:30:22</ora>
    </data>
    <identificativo>opec2026032614302200001@pec.aruba.it</identificativo>
    <msgid>abc123@pec.azienda.it</msgid>
  </dati>
</postacert>
```

## Implementazione Prevista

### Backend: `server/src/routes/pec.ts`

**Endpoints:**
- `POST /pec/connect` — salva credenziali IMAP/SMTP (email, password, provider o host custom)
- `GET /pec/status?companyId=xxx` — verifica connessione (tenta login IMAP)
- `POST /pec/disconnect?companyId=xxx` — rimuove credenziali
- `GET /pec/messages?companyId=xxx&folder=INBOX&limit=50` — lista messaggi con parsing daticert.xml
- `GET /pec/message/:uid?companyId=xxx` — leggi messaggio completo + allegati + stato certificazione
- `POST /pec/send` — invia PEC via SMTP
- `POST /pec/reply` — rispondi a PEC
- `GET /pec/unread-count?companyId=xxx` — conteggio non letti (per badge sidebar)

**Credenziali salvate in company_secrets:**
- name: `pec_credentials`
- description (crittato): `{ email, password, imapHost, imapPort, smtpHost, smtpPort, provider }`

**Provider presets:**
```typescript
const PEC_PROVIDERS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  aruba: { imapHost: "imaps.pec.aruba.it", imapPort: 993, smtpHost: "smtps.pec.aruba.it", smtpPort: 465 },
  poste: { imapHost: "mail.postecertifica.it", imapPort: 993, smtpHost: "mail.postecertifica.it", smtpPort: 465 },
  legalmail: { imapHost: "mbox.cert.legalmail.it", imapPort: 993, smtpHost: "sendm.cert.legalmail.it", smtpPort: 465 },
  custom: { imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 465 },
};
```

### Frontend: `ui/src/pages/PecPage.tsx`
- Lista email PEC con badge stato certificazione (accettazione, consegna, errore)
- Dettaglio messaggio con metadati da daticert.xml
- Composizione nuova PEC
- Rispondi a PEC
- Bottone "Genera risposta AI"
- Badge non letti nella sidebar

### PluginManager: card PEC
- Form connessione: dropdown provider (Aruba, Poste, Legalmail, Custom) + email + password
- Test connessione prima di salvare
- Disconnect

### Tool CEO in chat.ts
```typescript
// Nuovi tool
{ name: "lista_pec", description: "Elenca le email PEC ricevute" }
{ name: "leggi_pec", description: "Leggi una email PEC specifica con metadati certificazione" }
{ name: "invia_pec", description: "Invia una email PEC certificata" }
{ name: "rispondi_pec", description: "Rispondi a una email PEC" }

// TOOL_CONNECTOR
lista_pec: "pec",
leggi_pec: "pec",
invia_pec: "pec",
rispondi_pec: "pec",
```

### Connector sync
```typescript
// Alla connessione:
await upsertConnectorAccount(db, companyId, "pec", email, email);
// Alla disconnessione:
await removeConnectorAccount(db, companyId, "pec", email);
```

### CONNECTOR_GUIDES entry
```typescript
{
  key: "pec",
  label: "PEC (Posta Certificata)",
  capabilities: "Invio e ricezione PEC, ricevute di accettazione e consegna, valore legale",
  questions: [
    "Quale provider PEC usi? (Aruba, Poste, Legalmail, altro)",
    "Per cosa usi principalmente la PEC? Fatture, contratti, comunicazioni PA?",
    "Vuoi che l'agente risponda automaticamente alle PEC o preferisci approvare?",
  ],
  suggestions: [
    "Posso monitorare le PEC in arrivo e avvisarti delle più importanti",
    "Posso preparare risposte PEC e farle approvare prima dell'invio",
    "Posso collegare PEC + Fatture in Cloud per inviare fatture via PEC",
  ],
}
```

## Dipendenze npm da installare
```bash
npm install imapflow nodemailer
npm install -D @types/nodemailer
# imapflow ha i tipi inclusi
```

## Note Importanti
- La PEC è un connettore SEPARATO da Gmail (diverso valore legale, parsing diverso)
- Il polling IMAP va fatto periodicamente (es. ogni 60s) oppure via IMAP IDLE per notifiche push
- Le ricevute di accettazione/consegna vanno mostrate come stato nella lista messaggi
- L'invio PEC ha valore legale — la modalità di default per l'agente deve essere con approvazione
- Password PEC vanno crittate come tutti gli altri secrets
- IMPORTANTE: dopo build UI, SEMPRE `cp ui/public/sw.js ui/dist/sw.js && pm2 restart goitalia-impresa`

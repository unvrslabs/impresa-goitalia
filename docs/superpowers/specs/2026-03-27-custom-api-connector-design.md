# Custom API Connector — Design Spec

## Goal

Permettere alle PMI di collegare qualsiasi servizio esterno con API REST (CRM, gestionale, magazzino, ecc.) alla piattaforma GoItalIA. Il CEO configura il connettore via chat, gli agenti lo usano tramite tool dinamici generati dalle azioni definite.

## Architecture

### Data Model

**Nuova tabella `custom_connectors`:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK → companies | Company proprietaria |
| `name` | text NOT NULL | Nome leggibile ("Il mio CRM") |
| `slug` | text NOT NULL | Nome normalizzato per i tool (`mio_crm`) |
| `base_url` | text NOT NULL | URL base API (`https://api.miocrm.com`) |
| `auth_type` | text NOT NULL | `bearer` \| `header` \| `none` |
| `auth_header` | text | Nome header (default `Authorization`) |
| `auth_prefix` | text | Prefisso valore (default `Bearer `) |
| `description` | text | Cosa fa — iniettato nel prompt agente |
| `actions` | jsonb NOT NULL DEFAULT '[]' | Array azioni configurate |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

Unique index su `(company_id, slug)`.

Credenziali (API key) salvate in `company_secrets` con nome `custom_api_{connector_id}`, cifrate con il sistema esistente.

**Struttura singola azione (dentro `actions` JSON):**

```json
{
  "name": "lista_clienti",
  "label": "Lista Clienti",
  "description": "Recupera la lista dei clienti dal CRM",
  "method": "GET",
  "path": "/api/clients",
  "params": [
    { "name": "search", "type": "string", "required": false, "in": "query", "description": "Filtro ricerca" },
    { "name": "limit", "type": "number", "required": false, "in": "query", "description": "Max risultati" }
  ],
  "body_template": null
}
```

Campi azione:
- `name`: identificativo snake_case usato nel tool name
- `label`: nome human-readable
- `description`: cosa fa — diventa la tool description per Claude
- `method`: GET | POST | PUT | PATCH | DELETE
- `path`: path relativo al base_url (può contenere `{param}` per path params)
- `params`: parametri accettati con tipo, posizione (query/path/body), e se obbligatori
- `body_template`: template JSON opzionale per POST/PUT (null = parametri diventano body JSON)

### Registrazione nel sistema connettori esistente

Il connettore custom si registra come qualsiasi altro connettore:
- `connector_accounts`: tipo `custom_{slug}`, account_id = connector id
- `agent_connector_accounts`: agente → connettore custom
- `company_secrets`: API key cifrata

Questo permette di usare l'infrastruttura esistente (toggle connettori su agente, stato dinamico CEO, ecc.) senza modifiche.

### Tool Generation — Come diventano tool Claude

Quando si assemblano i tool per un agente (in `filterToolsForAgent` o al momento della chat):

1. Query `custom_connectors` della company
2. Per ogni connettore custom, controlla se l'agente ha il connettore attivo in `agent_connector_accounts`
3. Per ogni azione del connettore attivo, genera un tool definition:

```typescript
{
  name: `custom_${connector.slug}_${action.name}`,
  description: `[${connector.name}] ${action.description}`,
  input_schema: {
    type: "object",
    properties: /* generato da action.params */,
    required: /* params con required: true */,
  }
}
```

4. Nel tool dispatcher (`executeChatTool`), tutti i tool che iniziano con `custom_` vengono gestiti dal dispatcher generico che:
   - Estrae connector slug e action name dal tool name
   - Carica il connettore dal DB
   - Decripta la API key da company_secrets
   - Costruisce la HTTP request (base_url + path + auth + params)
   - Esegue e ritorna il risultato (troncato a 3000 chars)

### Tool CEO (nuovi, in CEO_TOOLS)

**`crea_connettore_custom`:**
- Input: nome, base_url, api_key, auth_type (default bearer), description
- Genera slug da nome
- Salva in `custom_connectors` + cifra API key in `company_secrets`
- Registra in `connector_accounts`
- Ritorna: id connettore creato

**`aggiungi_azione_custom`:**
- Input: connector_id, name, label, description, method, path, params (JSON array)
- Append all'array `actions` del connettore
- Ritorna: azione aggiunta

**`modifica_azione_custom`:**
- Input: connector_id, action_name, campi da aggiornare
- Aggiorna l'azione nell'array JSON
- Ritorna: azione aggiornata

**`rimuovi_azione_custom`:**
- Input: connector_id, action_name
- Rimuove dall'array
- Ritorna: conferma

**`lista_connettori_custom`:**
- Input: nessuno (usa companyId dal contesto)
- Ritorna: lista connettori con azioni

**`testa_connettore_custom`:**
- Input: connector_id, action_name (opzionale)
- Se action_name: esegue l'azione e mostra risultato
- Se no action_name: fa GET al base_url per verificare connettività
- Ritorna: risultato test

**`rimuovi_connettore_custom`:**
- Input: connector_id
- Rimuove connettore + secrets + connector_accounts
- Ritorna: conferma

### CEO Prompt — Flusso configurazione guidata

Aggiungere sezione nel CEO prompt (dentro ORCHESTRAZIONE o dedicata):

```
## CONNETTORI CUSTOM — API Esterne
Se il cliente dice di avere un CRM, gestionale, o qualsiasi servizio con API:
1. Chiedi: "Come si chiama il servizio?"
2. Chiedi: "Qual è l'URL delle API?" (es: https://api.miocrm.com)
3. Chiedi: "Hai una API key o token di accesso?"
4. Usa crea_connettore_custom per registrarlo
5. Chiedi: "Cosa vuoi poterci fare? Ad esempio: cercare clienti, creare ordini, vedere fatture..."
6. Per ogni operazione, chiedi i dettagli tecnici se servono (endpoint, metodo) oppure prova a dedurli
7. Usa aggiungi_azione_custom per ogni operazione
8. Testa con testa_connettore_custom
9. Crea l'agente con crea_agente connettore=custom slug=xxx
```

### Contesto dinamico

Nel blocco "STATO ATTUALE DELL'IMPRESA" che il CEO riceve ad ogni messaggio, i connettori custom vengono elencati con le loro azioni:

```
Connettori custom:
- Il Mio CRM (https://api.miocrm.com) — azioni: lista_clienti, crea_contatto, cerca_ordini
```

### UI — PluginManager

Nuova sezione in PluginManager sotto i connettori standard:

**"API Custom"** — card espandibile con:
- Se nessun connettore custom: messaggio "Puoi collegare qualsiasi servizio con API. Chiedi al CEO nella chat o configura manualmente qui."
- Lista connettori custom esistenti, ognuno con:
  - Nome, URL, numero azioni
  - Espandibile: lista azioni con nome, metodo, path
  - Bottone "Modifica" (form strutturato)
  - Bottone "Elimina"
  - Bottone "Crea Agente"
- Bottone "+ Aggiungi Connettore" → form: nome, URL, API key, auth type
- Dopo creazione connettore → form per aggiungere azioni: nome, metodo, path, parametri

Il form è il backup manuale — il flusso primario è via CEO chat.

### CONNECTOR_GUIDES

Aggiungere un guide generico per il connettore custom:

```typescript
{
  key: "custom",
  label: "API Custom",
  capabilities: "Collegamento a qualsiasi servizio esterno con API REST",
  questions: [
    "Che servizio vuoi collegare? (CRM, gestionale, magazzino, ecc.)",
    "Hai l'URL delle API e una API key?",
    "Che operazioni vuoi fare con questo servizio?",
  ],
  suggestions: [
    "Posso collegare qualsiasi servizio con API REST — CRM, gestionali, e-commerce, magazzino",
  ],
}
```

### Sicurezza

- API key cifrata in company_secrets (sistema esistente)
- SSRF protection: base_url deve essere HTTPS, no IP private/localhost (stessa validazione di voice/transcribe)
- Rate limiting: le chiamate custom passano per il rate limiter esistente (20/min per company)
- Il CEO non vede mai la API key dopo il salvataggio — solo conferma che è configurata
- Max 10 connettori custom per company, max 20 azioni per connettore

### File da creare/modificare

**Creare:**
- `packages/db/src/schema/custom_connectors.ts` — schema tabella
- `server/src/routes/custom-connectors.ts` — route CRUD REST per UI
- Migration SQL per la nuova tabella

**Modificare:**
- `packages/db/src/index.ts` — export nuovo schema
- `server/src/routes/chat.ts` — nuovi tool CEO, tool dispatcher custom, CONNECTOR_GUIDES, CEO_TOOLS set, contesto dinamico
- `server/src/app.ts` — registrare route
- `ui/src/pages/PluginManager.tsx` — sezione API Custom
- `ui/src/pages/AgentDetail.tsx` — toggle connettori custom su agente (se necessario, potrebbe funzionare già con connector_accounts generico)

### Non in scope (futuro)

- OAuth2 client credentials flow
- Basic Auth
- Import da file OpenAPI/Swagger
- Webhook in ingresso (il servizio esterno chiama GoItalIA)
- Template CRM pre-configurati (HubSpot, Salesforce, Pipedrive)
- MCP server integration

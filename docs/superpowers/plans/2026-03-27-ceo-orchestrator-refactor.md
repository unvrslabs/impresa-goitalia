# CEO Orchestrator Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare il CEO da esecutore diretto (52 tool) a orchestratore puro che delega agli agenti specializzati, con auto-creazione agenti mancanti.

**Architecture:** Il CEO mantiene solo tool di orchestrazione (lista_agenti, esegui_task_agente, crea_agente), memoria, catalogo, A2A. Tutti i tool connettore (Gmail, Drive, FIC, PEC, Stripe, WhatsApp, FAL, social, OpenAPI) vengono rimossi dal CEO e restano solo sugli agenti. Se il CEO deve delegare e non esiste un agente per quel connettore, lo crea automaticamente con `crea_agente` e poi delega. `executeAgentTask()` usa stop-reason based loop con safety cap a 10 turn.

**Tech Stack:** TypeScript, Claude API, Drizzle ORM, PostgreSQL

**File interessati:**
- `server/src/routes/chat.ts` — unico file da modificare (3011 righe)

---

### Task 1: Refactor executeAgentTask — stop-reason based loop + contesto

**Files:**
- Modify: `server/src/routes/chat.ts:1247-1354` (funzione executeAgentTask)
- Modify: `server/src/routes/chat.ts:86-95` (schema tool esegui_task_agente)

**Obiettivo:** L'agente gira finché Claude ritorna `stop_reason: "end_turn"` (cioè ha finito), con un safety cap a 10 turn per evitare loop infiniti. Aggiungere parametro `contesto` opzionale a `esegui_task_agente` per passare info dalla conversazione CEO.

- [ ] **Step 1: Aggiornare lo schema di esegui_task_agente**

In `chat.ts` riga 86-95, aggiungere il campo `contesto` opzionale:

```typescript
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
}
```

- [ ] **Step 2: Aggiornare la firma di executeAgentTask per accettare contesto**

```typescript
async function executeAgentTask(
  db: Db,
  companyId: string,
  targetAgentId: string,
  istruzioni: string,
  apiKey: string,
  contesto?: string,
): Promise<string> {
```

- [ ] **Step 3: Iniettare il contesto nel messaggio iniziale all'agente**

Sostituire la creazione del messaggio iniziale (riga 1282-1284):

```typescript
  // 4. Execute multi-turn tool loop (stop-reason based, safety cap 10)
  const MAX_AGENT_TURNS = 10;
  const userMessage = contesto
    ? `## CONTESTO\n${contesto}\n\n## COMPITO\n${istruzioni}`
    : istruzioni;
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: userMessage },
  ];
```

- [ ] **Step 4: Cambiare la condizione di uscita a stop-reason based**

Sostituire la condizione di break (riga 1326-1328). La logica cambia: l'agente gira finché stop_reason è "end_turn" O non ci sono tool calls. Il safety cap è il for loop a 10.

```typescript
    // Stop when agent is done (end_turn) or no more tool calls
    if (toolUseBlocks.length === 0 || data.stop_reason === "end_turn") {
      break;
    }
```

Nota: questa condizione è identica a quella attuale. La vera differenza è il MAX_AGENT_TURNS che passa da 3 a 10. Il loop già usciva su end_turn — ora ha più spazio per task complessi.

- [ ] **Step 5: Aggiornare il case "esegui_task_agente" per passare contesto**

In riga 2003-2012, aggiungere il passaggio del contesto:

```typescript
      case "esegui_task_agente": {
        if (!apiKey) return "Errore: API key non disponibile per esecuzione agente.";
        const targetId = toolInput.agente_id as string;
        const instructions = toolInput.istruzioni as string;
        const context = toolInput.contesto as string | undefined;
        if (!targetId || !instructions) return "Errore: agente_id e istruzioni sono obbligatori.";
        console.log("[direttore] Delegating task to agent:", targetId, "->", instructions.substring(0, 100));
        const result = await executeAgentTask(db, companyId, targetId, instructions, apiKey, context);
        console.log("[direttore] Agent result:", result.substring(0, 200));
        return result;
      }
```

- [ ] **Step 6: Build e verifica compilazione**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

Expected: compilazione OK, zero errori TypeScript.

- [ ] **Step 7: Commit**

```bash
cd /Users/emanuelemaccari/impresa-goitalia
git add server/src/routes/chat.ts
git commit -m "refactor: executeAgentTask stop-reason based loop (cap 10) + contesto param"
```

---

### Task 2: Spostare pubblica_social e genera_immagine ai connettori

**Files:**
- Modify: `server/src/routes/chat.ts:654-716` (TOOL_CONNECTOR mapping)

**Obiettivo:** `pubblica_social` va assegnato al connettore social (meta) e `genera_immagine` resta su "fal". Entrambi non devono più essere `null` (sempre disponibili al CEO).

- [ ] **Step 1: Aggiornare TOOL_CONNECTOR**

In riga 702, cambiare:

```typescript
  // PRIMA:
  // pubblica_social: null, // CEO always has access, checks connectors internally
  // genera_immagine è già "fal"

  // DOPO:
  pubblica_social: "meta",  // delegato all'agente con connettore Meta attivo
```

Nota: `genera_immagine` è già mappato a `"fal"` (riga 701), non serve toccarlo.

- [ ] **Step 2: Build e verifica compilazione**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/emanuelemaccari/impresa-goitalia
git add server/src/routes/chat.ts
git commit -m "refactor: pubblica_social mappato a connettore meta (non più null)"
```

---

### Task 3: Definire i tool CEO-only e rimuovere tool connettore dal CEO

**Files:**
- Modify: `server/src/routes/chat.ts:1106-1117` (filterToolsForAgent)

**Obiettivo:** Il CEO non riceve più TUTTI i tool. Riceve solo i tool di orchestrazione (null in TOOL_CONNECTOR). I tool connettore li hanno solo gli agenti.

- [ ] **Step 1: Creare la lista CEO_ONLY_TOOLS**

Aggiungere prima di filterToolsForAgent (prima della riga 1106):

```typescript
// Tools the CEO can use directly (no connector required)
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
]);
```

- [ ] **Step 2: Modificare filterToolsForAgent per il CEO**

Sostituire la funzione (riga 1106-1117):

```typescript
export function filterToolsForAgent(agentRole: string, connectors: Record<string, boolean>): typeof TOOLS {
  if (agentRole === "ceo") {
    // CEO gets only orchestration tools, not connector tools
    return TOOLS.filter((tool) => CEO_TOOLS.has(tool.name));
  }

  return TOOLS.filter((tool) => {
    const required = TOOL_CONNECTOR[tool.name];
    // Tool with no connector requirement = always available
    if (required === null || required === undefined) return true;
    // Check if connector is explicitly enabled
    return connectors[required] === true;
  });
}
```

- [ ] **Step 3: Aggiornare anche la riga 2933 nella route /chat**

Riga 2933 ha: `tools: agentId ? filterToolsForAgent(agentRole || 'general', agentConnectors || {}) : TOOLS`

Quando non c'è agentId (chat diretta), usa TOOLS (tutti). Ma ora il CEO deve usare i tool filtrati. Cambiare:

```typescript
          tools: filterToolsForAgent(agentRole, agentConnectors),
```

Questo funziona perché `agentRole` è già inizializzato a `"ceo"` di default (riga 2700).

- [ ] **Step 4: Build e verifica**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/emanuelemaccari/impresa-goitalia
git add server/src/routes/chat.ts
git commit -m "refactor: CEO usa solo tool orchestrazione, tool connettore rimossi dal CEO"
```

---

### Task 4: Aggiornare buildCeoPrompt — istruzioni delegazione

**Files:**
- Modify: `server/src/routes/chat.ts:813-819` (sezione ORCHESTRAZIONE nel CEO_PROMPT_BASE)
- Modify: `server/src/routes/chat.ts:1049-1073` (buildToolList)
- Modify: `server/src/routes/chat.ts:1102-1104` (buildCeoPrompt)

**Obiettivo:** Il CEO prompt deve spiegare chiaramente che deve delegare e come. Include istruzioni per auto-creazione agenti mancanti.

- [ ] **Step 1: Riscrivere la sezione ORCHESTRAZIONE nel CEO_PROMPT_BASE**

Sostituire le righe 813-861 (da "## ORCHESTRAZIONE" fino a fine del prompt base prima di `\``) con:

```typescript
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
```

- [ ] **Step 2: Aggiornare buildToolList per riflettere i tool CEO**

La funzione buildToolList() (riga 1049-1073) attualmente lista TUTTI i tool divisi per connettore. Ma il CEO non ha più i tool connettore — non ha senso listarglieli. Riscrivere:

```typescript
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
```

- [ ] **Step 3: Build e verifica**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/emanuelemaccari/impresa-goitalia
git add server/src/routes/chat.ts
git commit -m "refactor: CEO prompt con istruzioni delegazione obbligatoria e auto-creazione agenti"
```

---

### Task 5: Aggiornare il contesto dinamico per supportare la delegazione

**Files:**
- Modify: `server/src/routes/chat.ts:2803-2890` (sezione dynamic context nella route /chat)

**Obiettivo:** Il contesto dinamico (STATO ATTUALE DELL'IMPRESA) deve mostrare al CEO non solo gli agenti e connettori, ma anche QUALI connettori ha ogni agente — così sa a chi delegare cosa.

- [ ] **Step 1: Arricchire il contesto dinamico con connettori per agente**

Dopo il loop degli agenti (riga 2861-2868), aggiungere il dettaglio connettori per ogni agente. Sostituire il blocco agenti:

```typescript
        if (companyAgents.length > 0) {
          dynamicContext += "Agenti e loro connettori:\n";
          for (const a of companyAgents) {
            if (a.status === "terminated") continue;
            // Get agent's connectors
            const agentConn = await getAgentConnectorsFromDb(db, a.id);
            const connKeys = Object.keys(agentConn).filter(k => agentConn[k]);
            const connStr = connKeys.length > 0 ? connKeys.join(", ") : "nessun connettore";
            dynamicContext += `- ${a.name} (${a.title || a.role || ""}) — id: ${a.id} — connettori: ${connStr}\n`;
          }
        } else {
          dynamicContext += "Nessun agente creato.\n";
        }
```

- [ ] **Step 2: Aggiornare il messaggio finale del contesto dinamico**

Sostituire riga 2890:

```typescript
        dynamicContext += "--- FINE STATO ---\n\nUsa lista_agenti + esegui_task_agente per delegare operazioni ai tuoi agenti. Se un connettore è attivo ma non ha un agente, crealo con crea_agente prima di delegare. Se il connettore non è attivo, suggerisci al cliente di attivarlo da Connettori.";
```

- [ ] **Step 3: Build e verifica**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/emanuelemaccari/impresa-goitalia
git add server/src/routes/chat.ts
git commit -m "refactor: contesto dinamico mostra connettori per agente per delegazione CEO"
```

---

### Task 6: Test end-to-end e deploy

**Files:**
- Modify: nessuno — solo test e deploy

**Obiettivo:** Verificare che il flusso completo funzioni: CEO riceve richiesta → identifica agente → delega → risultato. E anche: CEO riceve richiesta → nessun agente → crea agente → delega → risultato.

- [ ] **Step 1: Build finale**

```bash
cd /Users/emanuelemaccari/impresa-goitalia/server && npm run build
```

Expected: zero errori.

- [ ] **Step 2: Verifica che i tool CEO siano corretti**

Aggiungere un log temporaneo o leggere il codice per confermare che `filterToolsForAgent("ceo", {})` ritorna solo i tool in CEO_TOOLS (27 tool di orchestrazione) e NON i tool connettore (25 tool come gmail, fatture, stripe, etc.).

- [ ] **Step 3: Verifica che gli agenti ricevano i tool corretti**

Confermare che `filterToolsForAgent("general", { gmail: true, calendar: true, drive: true })` ritorna i tool null + i tool Google (cerca_file_drive, leggi_file_drive) ma NON i tool di altri connettori.

- [ ] **Step 4: Deploy su VPS**

```bash
cd /Users/emanuelemaccari/impresa-goitalia && git push
ssh root@89.167.3.74 "cd /root/impresa-goitalia && git pull && cd server && npm run build && pm2 restart goitalia-impresa"
```

- [ ] **Step 5: Test manuale sulla piattaforma**

Testare i seguenti scenari su https://impresa.goitalia.ai:
1. Chiedere al CEO "mandami una mail" → deve delegare a un agente Gmail (o crearlo se non esiste)
2. Chiedere al CEO "che agenti ho?" → deve usare lista_agenti direttamente
3. Chiedere al CEO "salva questa nota: test" → deve usare salva_nota direttamente
4. Chiedere al CEO qualcosa che richiede un connettore non attivo → deve suggerire di attivarlo

- [ ] **Step 6: Commit tag versione**

```bash
cd /Users/emanuelemaccari/impresa-goitalia
git tag v2-ceo-orchestrator
git push --tags
```

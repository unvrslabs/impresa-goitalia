# Attività Programmate + Auto-Reply Agenti — Design Spec

## Obiettivo

Aggiungere due funzionalità indipendenti ma complementari:

1. **Toggle Auto-Reply** su agenti conversazionali — risposta automatica a messaggi in arrivo
2. **Attività Programmate (Cron)** — azioni schedulate con approvazione opzionale

## Principi

- L'attività programmata è solo un trigger. L'agente esegue tramite i tool esistenti (social post, email, fattura, ecc.) e i risultati appaiono dove appaiono normalmente (pagina Social, Mail, Fatturazione, ecc.)
- Due modalità per attività: automatica (esegue e logga) o manuale (prepara bozza, chiede approvazione)
- L'approvazione arriva sia in chat CEO sia nella sezione Attività Programmate
- Il toggle auto-reply è a livello agente, il toggle automatico/manuale è a livello singola attività

---

## Componente 1: Toggle Auto-Reply su Agente

### Cosa fa

Permette a un agente di rispondere automaticamente ai messaggi in arrivo su connettori conversazionali, senza intervento della PMI.

### Dove si vede

Tab Connettori di AgentDetail — un toggle "Risposta automatica" sotto i connettori conversazionali (WhatsApp, Telegram, Instagram DM, Facebook DM, Gmail).

### Come funziona

- Campo `autoReply: boolean` in `adapterConfig` dell'agente (default: `false`)
- **OFF** (default): messaggio arriva → mostrato in UI della pagina connettore (WhatsAppPage, TelegramPage, MailPage) → bottone "Genera risposta AI" → risposta generata nel campo input → PMI modifica se vuole → invia
- **ON**: messaggio arriva via webhook → route connettore chiama l'agente via Claude API con il messaggio + system prompt dell'agente → agente genera risposta → route invia automaticamente → log nella conversazione

### Backend

- Le route webhook (telegram.ts, whatsapp.ts, meta.ts, gmail.ts) già ricevono i messaggi. Devono:
  1. Trovare l'agente associato al connector_account (via `agent_connector_accounts`)
  2. Controllare `agent.adapterConfig.autoReply`
  3. Se `true`: chiamare Claude API con il messaggio e il prompt dell'agente, inviare la risposta
  4. Se `false`: solo salvare il messaggio per la UI (comportamento attuale)

### Frontend

- Toggle nella tab Connettori dell'agente, sotto ogni connettore conversazionale
- PATCH su `adapterConfig.autoReply` via API agente esistente

---

## Componente 2: Attività Programmate

### Infrastruttura esistente (da Paperclip)

Già presente nel codebase e nel DB:

| Cosa | File | Stato |
|------|------|-------|
| Tabelle DB | `routines`, `routine_triggers`, `routine_runs` | Schema drizzle esistente |
| Cron parser | `server/src/services/cron.ts` | Funzionante, timezone-aware |
| Route API | `server/src/routes/routines.ts` | CRUD completo |
| Frontend lista | `ui/src/pages/Routines.tsx` | Esistente (da adattare stile) |
| Frontend dettaglio | `ui/src/pages/RoutineDetail.tsx` | Esistente (da adattare) |
| Cron editor UI | `ui/src/components/ScheduleEditor.tsx` | Preset + custom cron |
| Plugin job scheduler | `server/src/services/plugin-job-scheduler.ts` | Modello per il nostro scheduler |

### Cosa manca e va costruito

#### 2.1 RoutineScheduler — Tick Loop

Nuovo service `server/src/services/routine-scheduler.ts`, modellato su `pluginJobScheduler`:

- **Tick**: ogni 30 secondi
- **Query**: `SELECT * FROM routine_triggers WHERE next_run_at <= now() AND enabled = true AND kind = 'cron'`
- **Per ogni trigger due**:
  1. Controlla `concurrency_policy` della routine (skip/coalesce/allow)
  2. Crea `routine_run` con `status = 'received'`, `source = 'cron'`
  3. Determina se `approval_required`:
     - Se `false` → chiama `executeRoutineAction()` subito
     - Se `true` → chiama `prepareRoutineDraft()` che genera la bozza
  4. Aggiorna `routine_triggers.next_run_at` con `nextCronTickInTimeZone()`
  5. Aggiorna `routine_triggers.last_fired_at`

#### 2.2 Esecuzione Routine → Agente Claude API

`executeRoutineAction(db, routineRun)`:

1. Carica la routine con agente assegnato (`assignee_agent_id`)
2. Carica il prompt dell'agente (promptTemplate + customInstructions)
3. Carica i connettori dell'agente (via `getAgentConnectorsFromDb`)
4. Filtra i tool con `filterToolsForAgent`
5. Chiama Claude API con:
   - System prompt dell'agente
   - User message: la `description` della routine (es. "Pubblica un post su Instagram per Energizzo con contenuto coinvolgente sul risparmio energetico")
   - Tool filtrati
6. Esegue il multi-turn tool loop (come in `executeAgentTask` di chat.ts)
7. Salva il risultato in `routine_runs.trigger_payload` (JSONB)
8. Aggiorna status: `completed` o `failed`
9. Manda messaggio in chat CEO: "Attività completata: [titolo routine] — [riepilogo risultato]"

`prepareRoutineDraft(db, routineRun)`:

1. Come `executeRoutineAction` ma con istruzione aggiuntiva nel system prompt: "IMPORTANTE: prepara il contenuto ma NON eseguire l'azione finale. Restituisci la bozza completa pronta per l'approvazione."
2. L'agente genera il contenuto (testo post, email, ecc.) ma non chiama il tool di invio
3. Salva la bozza in `routine_runs.trigger_payload` con struttura: `{ draft: true, content: "...", action: "publish_ig_post", params: {...} }`
4. Status: `pending_approval`
5. Manda messaggio in chat CEO con preview + bottoni Approva/Modifica
6. Badge nella sidebar "Attività Programmate"

#### 2.3 Approvazione

Nuovi endpoint:

- `POST /api/routines/:routineId/runs/:runId/approve` — prende la bozza da `trigger_payload`, esegue l'azione finale (chiama il tool), aggiorna status a `completed`
- `POST /api/routines/:routineId/runs/:runId/approve` con `body.modifiedContent` — sostituisce il contenuto della bozza prima di eseguire
- `POST /api/routines/:routineId/runs/:runId/reject` — status `failed`, reason "rejected_by_user"

#### 2.4 Tool CEO

Tre nuovi tool in `chat.ts`:

**`crea_attivita_programmata`**
```
Input: {
  agente_id: string,           // ID dell'agente che esegue
  descrizione: string,         // Cosa deve fare (diventa il prompt della routine)
  orario: string,              // Linguaggio naturale: "ogni giorno alle 12", "ogni lunedi alle 9"
  approvazione: boolean        // true = manuale, false = automatico
}
```
- Il CEO converte l'orario in cron expression (mapping nel tool)
- Crea la routine con `assignee_agent_id`, `title` dalla descrizione, `description` come prompt
- Crea il trigger cron con timezone `Europe/Rome`
- Imposta `approval_required` nel campo metadata della routine

**`lista_attivita_programmate`**
```
Input: { stato?: "active" | "paused" | "all" }
```
- Restituisce lista routine con prossima esecuzione, agente, stato

**`elimina_attivita_programmata`**
```
Input: { routine_id: string }
```
- Soft delete: status → "archived"

#### 2.5 Campo approval_required

Dove salvare il flag automatico/manuale per ogni routine:
- Colonna nella tabella `routines` oppure campo in metadata JSONB
- Decisione: usare il campo `metadata` JSONB già esistente: `metadata.approval_required: boolean`
- Default: `true` (manuale — più sicuro)

#### 2.6 Mapping Linguaggio Naturale → Cron

Gestito nel tool `crea_attivita_programmata`:

| Input | Cron |
|-------|------|
| "ogni giorno alle 12" | `0 12 * * *` |
| "ogni giorno alle 9:30" | `30 9 * * *` |
| "ogni lunedì alle 9" | `0 9 * * 1` |
| "ogni ora" | `0 * * * *` |
| "ogni 30 minuti" | `*/30 * * * *` |
| "il primo del mese alle 10" | `0 10 1 * *` |
| "dal lunedì al venerdì alle 8" | `0 8 * * 1-5` |

Per casi complessi: Claude (il CEO) è un LLM — sa convertire linguaggio naturale in cron expression. Il tool accetta sia `orario` (naturale) sia `cron` (expression diretta). Il CEO sceglie.

### Frontend

#### Sidebar

- Nuova voce: "Attività Programmate" con icona `CalendarClock`
- Badge numerico per bozze `pending_approval`
- Posizione: dopo "Social", prima di "Connettori"

#### Pagina Lista (`/scheduled`)

- Tabella: Titolo, Agente (con icona connettore), Prossima esecuzione, Ultima esecuzione, Stato, Toggle auto/manuale
- Filtro per agente
- Tab "Da approvare" con le bozze pending
- Bottone "+ Nuova" che porta alla chat CEO con messaggio precompilato

#### Pagina Dettaglio (`/scheduled/:id`)

- Info routine: titolo, descrizione/prompt, agente assegnato
- Schedulazione: cron editor (riuso `ScheduleEditor.tsx`)
- Toggle automatico/manuale
- Storico esecuzioni con stato e risultato
- Se pending_approval: mostra bozza con bottoni Approva/Modifica/Rifiuta

#### Chat CEO

- Quando una bozza è pronta, messaggio tipo:
  ```
  📋 Attività programmata pronta per approvazione:

  **Post Instagram @energizzo.it**
  "Il risparmio energetico inizia dalle piccole scelte quotidiane.
  Scopri come ridurre i consumi del 30% con i nostri consigli.
  #energizzo #risparmioenergetico #green"

  [Approva] [Modifica] [Rifiuta]
  ```
- I bottoni chiamano gli endpoint di approvazione

---

## Startup e Lifecycle

Il `RoutineScheduler` viene avviato in `app.ts` come il `pluginJobScheduler`:
- Start al boot del server
- Stop al shutdown
- Non richiede worker separati — gira nello stesso processo Node.js
- Il tick loop è leggero: una query SQL ogni 30s

---

## Non in scope (per ora)

- Notifiche push/WhatsApp per approvazioni (solo chat + UI)
- Retry automatico su fallimento (la PMI può ri-triggerare manualmente)
- Dipendenze tra routine (catene di attività)
- Template di routine predefiniti

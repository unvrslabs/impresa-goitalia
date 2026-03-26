import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Upload, ExternalLink, Phone, User, FileText, ChevronDown, ChevronRight, X, Search, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Contact {
  id: string;
  phoneNumber: string;
  name: string | null;
  notes: string | null;
  customInstructions: string | null;
  autoMode: "auto" | "manual" | "inherit";
  lastSummary: string | null;
  lastSummaryAt: string | null;
  createdAt: string;
  files: ContactFile[];
}

interface ContactFile {
  id: string;
  name: string;
  type: string;
  driveUrl: string | null;
  createdAt: string;
}

const autoModeLabels: Record<string, { label: string; color: string }> = {
  auto: { label: "Risposta automatica", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  manual: { label: "Risposta manuale", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  inherit: { label: "Default agente", color: "bg-white/10 text-white/60 border-white/20" },
};

export function WhatsappContactsTab({ agentId, companyId }: { agentId: string; companyId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Add form
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [newAutoMode, setNewAutoMode] = useState<"auto" | "manual" | "inherit">("inherit");

  // Drive link
  const [driveUrl, setDriveUrl] = useState("");
  const [driveLinking, setDriveLinking] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const loadContacts = async () => {
    try {
      const r = await fetch(`/api/whatsapp-contacts?agentId=${agentId}`, { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setContacts(data.contacts || []);
      }
    } catch (err) { console.error("Load contacts error:", err); }
    setLoading(false);
  };

  useEffect(() => { loadContacts(); }, [agentId]);

  const addContact = async () => {
    if (!newPhone.trim()) return;
    const r = await fetch("/api/whatsapp-contacts", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId, agentId,
        phoneNumber: newPhone.trim(),
        name: newName.trim() || null,
        notes: newNotes.trim() || null,
        customInstructions: newInstructions.trim() || null,
        autoMode: newAutoMode,
      }),
    });
    if (r.ok) {
      setShowAdd(false);
      setNewPhone(""); setNewName(""); setNewNotes(""); setNewInstructions(""); setNewAutoMode("inherit");
      loadContacts();
    } else {
      const err = await r.json();
      alert(err.error || "Errore");
    }
  };

  const updateContact = async (id: string, data: Partial<Contact>) => {
    await fetch(`/api/whatsapp-contacts/${id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    loadContacts();
  };

  const deleteContact = async (id: string) => {
    if (!confirm("Eliminare questo contatto e tutti i file allegati?")) return;
    await fetch(`/api/whatsapp-contacts/${id}`, { method: "DELETE", credentials: "include" });
    loadContacts();
  };

  const cycleAutoMode = (contact: Contact) => {
    const modes: Array<"inherit" | "auto" | "manual"> = ["inherit", "auto", "manual"];
    const next = modes[(modes.indexOf(contact.autoMode) + 1) % modes.length];
    updateContact(contact.id, { autoMode: next });
  };

  const uploadFile = async (contactId: string, file: File) => {
    setUploadingFor(contactId);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("companyId", companyId);
    await fetch(`/api/whatsapp-contacts/${contactId}/files/upload`, {
      method: "POST", credentials: "include", body: fd,
    });
    setUploadingFor(null);
    loadContacts();
  };

  const addDriveLink = async (contactId: string) => {
    if (!driveUrl.trim()) return;
    setDriveLinking(true);
    await fetch(`/api/whatsapp-contacts/${contactId}/files/drive-link`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, driveUrl: driveUrl.trim() }),
    });
    setDriveUrl("");
    setDriveLinking(false);
    loadContacts();
  };

  const deleteFile = async (contactId: string, fileId: string) => {
    await fetch(`/api/whatsapp-contacts/${contactId}/files/${fileId}`, { method: "DELETE", credentials: "include" });
    loadContacts();
  };

  if (loading) return <div className="text-sm text-muted-foreground p-4">Caricamento rubrica...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Rubrica Contatti</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Personalizza risposte e automazione per ogni numero WhatsApp</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          {showAdd ? "Annulla" : "Aggiungi"}
        </Button>
      </div>

      {/* Search */}
      {contacts.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            placeholder="Cerca per nome o numero..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors"
          />
        </div>
      )}

      {/* Add contact form */}
      {showAdd && (
        <div className="glass-card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">Numero telefono *</label>
              <input
                placeholder="+393401234567"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">Nome</label>
              <input
                placeholder="Mario Rossi"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/70">Note</label>
            <textarea
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors resize-none"
              rows={2}
              placeholder="Note sul contatto..."
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/70">Istruzioni personalizzate per l'agente</label>
            <textarea
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 focus:bg-white/8 transition-colors resize-none"
              rows={2}
              placeholder="Es: Rispondi sempre in inglese con questo cliente..."
              value={newInstructions}
              onChange={e => setNewInstructions(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs font-medium text-white/70 mr-1">Modalità risposta:</span>
            {(["inherit", "auto", "manual"] as const).map(mode => (
              <button key={mode} onClick={() => setNewAutoMode(mode)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${newAutoMode === mode ? autoModeLabels[mode].color + " font-medium" : "border-white/10 text-white/30 hover:text-white/50 hover:border-white/20"}`}>
                {autoModeLabels[mode].label}
              </button>
            ))}
          </div>
          <div className="pt-1">
            <Button size="sm" onClick={addContact} disabled={!newPhone.trim()}>Salva contatto</Button>
          </div>
        </div>
      )}

      {/* Contact list */}
      {contacts.length === 0 && !showAdd && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Nessun contatto in rubrica
        </div>
      )}

      {contacts.filter(c => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (c.name || "").toLowerCase().includes(q) || c.phoneNumber.includes(q);
      }).map(contact => {
        const expanded = expandedId === contact.id;
        const editing = editingId === contact.id;
        const mode = autoModeLabels[contact.autoMode] || autoModeLabels.inherit;

        return (
          <div key={contact.id} className="glass-card overflow-hidden">
            {/* Contact header */}
            <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpandedId(expanded ? null : contact.id)}>
              {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
              <User className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{contact.name || contact.phoneNumber}</span>
                  {contact.name && <span className="text-xs text-muted-foreground">{contact.phoneNumber}</span>}
                </div>
                {contact.notes && <p className="text-xs text-muted-foreground truncate mt-0.5">{contact.notes}</p>}
              </div>
              <button onClick={(e) => { e.stopPropagation(); cycleAutoMode(contact); }}
                className={`text-xs px-2 py-0.5 rounded border shrink-0 ${mode.color}`}>
                {mode.label}
              </button>
              {contact.files.length > 0 && (
                <span className="text-xs text-muted-foreground shrink-0">{contact.files.length} file</span>
              )}
              <button onClick={(e) => { e.stopPropagation(); deleteContact(contact.id); }}
                className="text-red-400/60 hover:text-red-400 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Expanded details */}
            {expanded && (
              <div className="border-t border-white/8 p-4 space-y-4">
                {/* Summary — most important, shown first */}
                {contact.lastSummary && (
                  <div className="rounded-lg bg-amber-500/8 border border-amber-500/15 p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <MessageSquare className="w-3 h-3 text-amber-400/70" />
                      <span className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wider">Ultimo riassunto</span>
                      {contact.lastSummaryAt && <span className="text-[10px] text-white/25 ml-auto">{new Date(contact.lastSummaryAt).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                    </div>
                    <p className="text-xs text-white/70 whitespace-pre-line leading-relaxed">{contact.lastSummary}</p>
                  </div>
                )}

                {/* Info grid — compact 2-col layout */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <EditableField label="Nome" value={contact.name || ""} onSave={v => updateContact(contact.id, { name: v || null } as any)} />
                  <EditableField label="Note" value={contact.notes || ""} onSave={v => updateContact(contact.id, { notes: v || null } as any)} />
                </div>
                <EditableField label="Istruzioni agente" value={contact.customInstructions || ""} onSave={v => updateContact(contact.id, { customInstructions: v || null } as any)} multiline />

                {/* Files — compact inline */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">File</span>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={e => {
                      if (e.target.files?.[0]) uploadFile(contact.id, e.target.files[0]);
                      e.target.value = "";
                    }} />
                    <button className="text-[10px] text-white/30 hover:text-white/60 transition-colors" onClick={() => fileInputRef.current?.click()} disabled={uploadingFor === contact.id}>
                      {uploadingFor === contact.id ? "..." : "+ Upload"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {contact.files.map(file => (
                      <div key={file.id} className="inline-flex items-center gap-1.5 text-[11px] rounded-md bg-white/5 border border-white/8 px-2 py-1 group">
                        <FileText className="w-3 h-3 text-amber-400/70 shrink-0" />
                        <span className="text-white/60 max-w-[120px] truncate">{file.name}</span>
                        {file.driveUrl && (
                          <a href={file.driveUrl} target="_blank" rel="noopener" className="text-blue-400/50 hover:text-blue-400" onClick={e => e.stopPropagation()}>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                        <button onClick={() => deleteFile(contact.id, file.id)} className="text-white/0 group-hover:text-white/30 hover:!text-red-400 transition-colors">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Drive link — compact */}
                  <div className="flex items-center gap-1.5">
                    <input
                      placeholder="Link Google Drive..."
                      className="flex-1 h-6 rounded border border-white/8 bg-transparent px-2 text-[11px] text-white/50 placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
                      value={driveUrl}
                      onChange={e => setDriveUrl(e.target.value)}
                    />
                    {driveUrl.trim() && (
                      <button className="text-[10px] text-white/40 hover:text-white/70" onClick={() => addDriveLink(contact.id)} disabled={driveLinking}>
                        {driveLinking ? "..." : "Aggiungi"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Storico conversazioni */}
                <ConversationHistory contactId={contact.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface WaMessage {
  message_text: string;
  direction: "incoming" | "outgoing";
  from_name: string;
  message_type: string;
  media_url: string | null;
  created_at: string;
}

function ConversationHistory({ contactId }: { contactId: string }) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (messages.length > 0) { setOpen(!open); return; }
    setLoading(true);
    setOpen(true);
    try {
      const r = await fetch(`/api/whatsapp-contacts/${contactId}/messages?limit=50`, { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setMessages(data.messages || []);
      }
    } catch {}
    setLoading(false);
  };

  // Group messages by date
  const groupByDate = (msgs: WaMessage[]) => {
    const groups: Record<string, WaMessage[]> = {};
    for (const m of msgs) {
      const date = new Date(m.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
      if (!groups[date]) groups[date] = [];
      groups[date].push(m);
    }
    return groups;
  };

  return (
    <div className="space-y-2 pt-2">
      <button onClick={load} className="flex items-center gap-2 text-xs font-medium text-white/70 hover:text-white/90 transition-colors">
        <MessageSquare className="w-3.5 h-3.5" />
        <span>Storico conversazioni</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {messages.length > 0 && <span className="text-white/30">({messages.length} msg)</span>}
      </button>

      {open && (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-white/8 bg-black/20">
          {loading && <div className="p-3 text-xs text-white/30">Caricamento...</div>}
          {!loading && messages.length === 0 && <div className="p-3 text-xs text-white/30">Nessun messaggio</div>}
          {!loading && Object.entries(groupByDate(messages)).map(([date, msgs]) => (
            <div key={date}>
              <div className="sticky top-0 bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] text-white/30 font-medium">{date}</div>
              {msgs.map((m, i) => {
                const time = new Date(m.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                const isOut = m.direction === "outgoing";
                return (
                  <div key={i} className={`px-3 py-1.5 flex gap-2 ${isOut ? "flex-row-reverse" : ""}`}>
                    <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs ${isOut ? "bg-green-900/30 text-green-200/90 ml-auto" : "bg-white/8 text-white/70"}`}>
                      <div>{m.message_text || `[${m.message_type}]`}</div>
                      <div className={`text-[10px] mt-0.5 ${isOut ? "text-green-300/40 text-right" : "text-white/25"}`}>{time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditableField({ label, value, onSave, multiline }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  useEffect(() => { setVal(value); }, [value]);

  if (!editing) {
    return (
      <div className="flex items-start gap-2 text-xs cursor-pointer hover:bg-white/5 rounded-lg px-3 py-2 -mx-1 transition-colors" onClick={() => setEditing(true)}>
        <span className="text-white/40 shrink-0 w-28 font-medium">{label}:</span>
        <span className={value ? "text-white/80" : "text-white/25 italic"}>{value || "Clicca per aggiungere"}</span>
      </div>
    );
  }

  const save = () => { onSave(val); setEditing(false); };

  return (
    <div className="space-y-1.5 px-3 -mx-1">
      <span className="text-xs font-medium text-white/50">{label}</span>
      {multiline ? (
        <textarea className="w-full rounded-lg border border-white/15 bg-white/8 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/30 transition-colors resize-none" rows={2} value={val} onChange={e => setVal(e.target.value)} onBlur={save} autoFocus />
      ) : (
        <input className="w-full h-7 rounded-lg border border-white/15 bg-white/8 px-3 text-xs text-white focus:outline-none focus:border-white/30 transition-colors" value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => e.key === "Enter" && save()} autoFocus />
      )}
    </div>
  );
}

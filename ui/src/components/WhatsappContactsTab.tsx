import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Upload, ExternalLink, Phone, User, FileText, ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Contact {
  id: string;
  phoneNumber: string;
  name: string | null;
  notes: string | null;
  customInstructions: string | null;
  autoMode: "auto" | "manual" | "inherit";
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

      {contacts.map(contact => {
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
              <div className="border-t border-white/8 p-4 space-y-3">
                {/* Editable fields */}
                <EditableField label="Nome" value={contact.name || ""} onSave={v => updateContact(contact.id, { name: v || null } as any)} />
                <EditableField label="Note" value={contact.notes || ""} onSave={v => updateContact(contact.id, { notes: v || null } as any)} multiline />
                <EditableField label="Istruzioni agente" value={contact.customInstructions || ""} onSave={v => updateContact(contact.id, { customInstructions: v || null } as any)} multiline />

                {/* Files section */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-white/40" />
                    <span className="text-xs font-medium text-white/70">File allegati</span>
                  </div>

                  {contact.files.map(file => (
                    <div key={file.id} className="flex items-center gap-2 text-xs rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                      <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="flex-1 truncate text-white/80">{file.name}</span>
                      {file.driveUrl && (
                        <a href={file.driveUrl} target="_blank" rel="noopener" className="text-blue-400 hover:text-blue-300 transition-colors" onClick={e => e.stopPropagation()}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button onClick={() => deleteFile(contact.id, file.id)} className="text-white/20 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Upload + Drive link */}
                  <div className="flex items-center gap-2 pt-1">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={e => {
                      if (e.target.files?.[0]) uploadFile(contact.id, e.target.files[0]);
                      e.target.value = "";
                    }} />
                    <Button size="sm" variant="ghost" className="text-xs h-7 text-white/50 hover:text-white/80" onClick={() => fileInputRef.current?.click()} disabled={uploadingFor === contact.id}>
                      <Upload className="w-3.5 h-3.5 mr-1" />
                      {uploadingFor === contact.id ? "Caricamento..." : "Upload"}
                    </Button>
                    <div className="flex-1 flex items-center gap-1.5">
                      <input
                        placeholder="Link Google Drive..."
                        className="flex-1 h-7 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors"
                        value={driveUrl}
                        onChange={e => setDriveUrl(e.target.value)}
                      />
                      <Button size="sm" variant="ghost" className="text-xs h-7 px-2 text-white/50 hover:text-white/80" onClick={() => addDriveLink(contact.id)} disabled={!driveUrl.trim() || driveLinking}>
                        {driveLinking ? "..." : "Aggiungi"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
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

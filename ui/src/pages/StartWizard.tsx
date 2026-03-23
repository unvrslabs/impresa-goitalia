import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Users, Building2, CreditCard, CheckCircle, ArrowRight, ArrowLeft, Bot } from "lucide-react";

// Shared styles matching goitalia.eu
const styles = {
  // Background matching goitalia.eu mesh-gradient
  page: "min-h-screen text-[hsl(0,0%,98%)] relative",
  pageBg: {
    background: `
      radial-gradient(ellipse at 20% 20%, hsl(158 64% 42% / 0.15) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 10%, hsl(170 50% 50% / 0.08) 0%, transparent 40%),
      radial-gradient(ellipse at 50% 60%, hsl(158 64% 42% / 0.06) 0%, transparent 50%),
      radial-gradient(ellipse at 85% 80%, hsl(158 50% 40% / 0.1) 0%, transparent 45%),
      linear-gradient(180deg, hsl(220 40% 10%) 0%, hsl(220 35% 7%) 50%, hsl(220 30% 5%) 100%)
    `,
  } as React.CSSProperties,
  // Liquid glass card
  glass: "relative overflow-hidden rounded-[2rem] border border-[hsl(0,0%,100%,0.18)] backdrop-blur-[40px]",
  glassBg: {
    background: "linear-gradient(135deg, hsl(0 0% 100% / 0.12) 0%, hsl(0 0% 100% / 0.06) 50%, hsl(0 0% 100% / 0.03) 100%)",
    boxShadow: "0 8px 32px hsl(0 0% 0% / 0.12), inset 0 1px 0 0 hsl(0 0% 100% / 0.15), inset 0 -1px 0 0 hsl(0 0% 0% / 0.05)",
  } as React.CSSProperties,
  // Smaller glass card
  glassCard: "relative overflow-hidden rounded-2xl border border-[hsl(0,0%,100%,0.12)] backdrop-blur-[40px]",
  glassCardBg: {
    background: "linear-gradient(135deg, hsl(0 0% 100% / 0.08) 0%, hsl(0 0% 100% / 0.04) 50%, hsl(0 0% 100% / 0.02) 100%)",
    boxShadow: "0 4px 24px hsl(0 0% 0% / 0.1), inset 0 1px 0 0 hsl(0 0% 100% / 0.1)",
  } as React.CSSProperties,
  // Premium green button
  btnPremium: "relative overflow-hidden px-8 py-4 rounded-full font-semibold transition-all duration-300 text-white",
  btnPremiumBg: {
    background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))",
    boxShadow: "0 4px 20px hsl(158 64% 42% / 0.35), 0 0 0 1px hsl(158 64% 42% / 0.1) inset",
  } as React.CSSProperties,
  // Secondary button
  btnSecondary: "relative overflow-hidden px-8 py-4 rounded-full font-semibold transition-all duration-300",
  btnSecondaryBg: {
    background: "hsl(158 64% 42% / 0.15)",
    color: "hsl(158 64% 50%)",
    boxShadow: "0 0 0 1px hsl(158 64% 42% / 0.3) inset",
  } as React.CSSProperties,
  // Input
  input: "w-full px-4 py-3 rounded-2xl border border-[hsl(0,0%,100%,0.15)] text-white text-sm placeholder:text-[hsl(215,20%,55%)] focus:border-[hsl(158,64%,42%)] focus:outline-none transition-colors",
  inputBg: {
    background: "hsl(215 30% 12%)",
  } as React.CSSProperties,
  // Label
  label: "text-xs text-[hsl(215,20%,70%)] mb-1.5 block font-medium",
  // Primary color
  primary: "hsl(158 64% 42%)",
  muted: "hsl(215 20% 60%)",
};

// Types
interface TeamMember {
  id: string;
  name: string;
  role: string;
  department: string;
  software: string;
  description: string;
}

interface CompanyData {
  companyName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

// Step indicator
function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: "Team" },
    { num: 2, label: "Organigramma AI" },
    { num: 3, label: "Account" },
    { num: 4, label: "Attivazione" },
  ];

  return (
    <div className="flex items-center justify-center gap-3 mb-12">
      {steps.map((step, i) => (
        <div key={step.num} className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all"
              style={{
                background: currentStep === step.num
                  ? "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))"
                  : currentStep > step.num
                    ? "hsl(158 64% 42% / 0.2)"
                    : "hsl(0 0% 100% / 0.06)",
                border: currentStep >= step.num ? "1px solid hsl(158 64% 42% / 0.3)" : "1px solid hsl(0 0% 100% / 0.1)",
                color: currentStep >= step.num ? "white" : "hsl(215 20% 45%)",
              }}
            >
              {currentStep > step.num ? <CheckCircle className="w-4 h-4" /> : step.num}
            </div>
            <span
              className="text-xs font-medium hidden sm:block"
              style={{ color: currentStep === step.num ? "hsl(0 0% 98%)" : "hsl(215 20% 50%)" }}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className="w-10 h-px" style={{ background: currentStep > step.num ? "hsl(158 64% 42% / 0.4)" : "hsl(0 0% 100% / 0.1)" }} />
          )}
        </div>
      ))}
    </div>
  );
}

// Step 1: Team members
function Step1Team({
  members,
  setMembers,
  onNext,
}: {
  members: TeamMember[];
  setMembers: (m: TeamMember[]) => void;
  onNext: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", role: "", department: "", software: "", description: "" });

  const resetForm = () => { setForm({ name: "", role: "", department: "", software: "", description: "" }); setEditingId(null); setShowForm(false); };

  const addOrUpdateMember = () => {
    if (!form.name || !form.role || !form.department) return;
    if (editingId) {
      setMembers(members.map((m) => m.id === editingId ? { ...m, ...form } : m));
    } else {
      setMembers([...members, { id: crypto.randomUUID(), ...form }]);
    }
    resetForm();
  };

  const editMember = (member: TeamMember) => {
    setForm({ name: member.name, role: member.role, department: member.department, software: member.software, description: member.description });
    setEditingId(member.id);
    setShowForm(true);
  };

  const removeMember = (id: string) => setMembers(members.filter((m) => m.id !== id));

  const departments = members.reduce<Record<string, TeamMember[]>>((acc, m) => {
    if (!acc[m.department]) acc[m.department] = [];
    acc[m.department].push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-black mb-3" style={{ color: "hsl(0 0% 98%)" }}>Descrivi il tuo team</h2>
        <p style={{ color: styles.muted }} className="text-base max-w-md mx-auto">
          Aggiungi i membri della tua azienda. Per ogni persona, indicaci il ruolo, il reparto e cosa fa.
        </p>
      </div>

      {/* Member list grouped by department */}
      {Object.keys(departments).length > 0 && (
        <div className="space-y-6 mb-8">
          {Object.entries(departments).map(([dept, deptMembers]) => (
            <div key={dept}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] mb-3" style={{ color: styles.primary }}>{dept}</h3>
              <div className="space-y-2">
                {deptMembers.map((member) => (
                  <div
                    key={member.id}
                    className={styles.glassCard + " p-4 cursor-pointer hover:border-[hsl(158,64%,42%,0.3)] transition-all"}
                    style={styles.glassCardBg}
                    onClick={() => editMember(member)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)" }}>
                            <Users className="w-3.5 h-3.5" style={{ color: styles.primary }} />
                          </div>
                          <span className="font-semibold text-sm" style={{ color: "hsl(0 0% 98%)" }}>{member.name}</span>
                          <span className="text-xs" style={{ color: styles.muted }}>{member.role}</span>
                        </div>
                        {member.description && (
                          <p className="text-xs mt-1.5 pl-9 truncate" style={{ color: "hsl(215 20% 45%)" }}>{member.description}</p>
                        )}
                        {member.software && (
                          <div className="flex gap-1.5 mt-2 pl-9 flex-wrap">
                            {member.software.split(",").map((s, i) => (
                              <span key={i} className="text-[10px] px-2.5 py-0.5 rounded-full border" style={{ borderColor: "hsl(158 64% 42% / 0.2)", color: styles.primary, background: "hsl(158 64% 42% / 0.08)" }}>
                                {s.trim()}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeMember(member.id); }} className="p-2 rounded-lg transition-colors hover:bg-[hsl(0,0%,100%,0.06)]">
                        <Trash2 className="w-4 h-4" style={{ color: "hsl(215 20% 45%)" }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {showForm ? (
        <div className={styles.glass + " p-6 md:p-8 mb-8"} style={styles.glassBg}>
          <h3 className="text-base font-bold mb-5" style={{ color: "hsl(0 0% 98%)" }}>
            {editingId ? "Modifica membro" : "Nuovo membro del team"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={styles.label}>Nome *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="es. Marco Rossi" className={styles.input} style={styles.inputBg} autoComplete="off" />
            </div>
            <div>
              <label className={styles.label}>Ruolo *</label>
              <input type="text" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="es. Responsabile vendite" className={styles.input} style={styles.inputBg} autoComplete="off" />
            </div>
            <div>
              <label className={styles.label}>Reparto *</label>
              <input type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="es. Commerciale" className={styles.input} style={styles.inputBg} autoComplete="off" />
            </div>
            <div>
              <label className={styles.label}>Software utilizzati</label>
              <input type="text" value={form.software} onChange={(e) => setForm({ ...form, software: e.target.value })} placeholder="es. Excel, Salesforce, WhatsApp" className={styles.input} style={styles.inputBg} autoComplete="off" />
            </div>
            <div className="sm:col-span-2">
              <label className={styles.label}>Descrizione del compito</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="es. Gestisce i contatti con i clienti, prepara preventivi, segue il post-vendita" rows={2} className={styles.input + " resize-none"} style={styles.inputBg} />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={resetForm} className={styles.btnSecondary + " !px-5 !py-2.5 text-sm"} style={styles.btnSecondaryBg}>Annulla</button>
            <button onClick={addOrUpdateMember} disabled={!form.name || !form.role || !form.department} className={styles.btnPremium + " !px-5 !py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"} style={styles.btnPremiumBg}>
              {editingId ? "Salva modifiche" : "Aggiungi"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-dashed transition-all text-sm font-medium mb-8"
          style={{ borderColor: "hsl(158 64% 42% / 0.3)", color: styles.primary }}
        >
          <Plus className="w-4 h-4" />
          Aggiungi membro del team
        </button>
      )}

      <div className="flex justify-end">
        <button onClick={onNext} disabled={members.length === 0} className={styles.btnPremium + " flex items-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"} style={styles.btnPremiumBg}>
          Genera organigramma AI <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Step 2: AI Organigramma
function Step2Organigramma({ members, onNext, onBack }: { members: TeamMember[]; onNext: () => void; onBack: () => void }) {
  const departments = members.reduce<Record<string, TeamMember[]>>((acc, m) => {
    if (!acc[m.department]) acc[m.department] = [];
    acc[m.department].push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-black mb-3" style={{ color: "hsl(0 0% 98%)" }}>Il tuo organigramma AI</h2>
        <p style={{ color: styles.muted }} className="text-base max-w-md mx-auto">
          Ecco come i tuoi Agenti AI sostituiranno il team attuale. Conferma per procedere.
        </p>
      </div>

      {/* CEO node */}
      <div className="flex flex-col items-center mb-8">
        <div className="px-8 py-4 rounded-2xl border text-center" style={{ borderColor: "hsl(158 64% 42% / 0.3)", background: "hsl(158 64% 42% / 0.1)" }}>
          <p className="font-bold text-base" style={{ color: styles.primary }}>CEO / Titolare</p>
          <p className="text-xs mt-0.5" style={{ color: styles.muted }}>{members.length} Agenti AI attivi</p>
        </div>
        <div className="w-px h-8" style={{ background: "linear-gradient(to bottom, hsl(158 64% 42% / 0.3), hsl(0 0% 100% / 0.1))" }} />
      </div>

      {/* Departments */}
      <div className={`grid gap-4 mb-10 ${Object.keys(departments).length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
        {Object.entries(departments).map(([dept, deptMembers]) => (
          <div key={dept} className={styles.glassCard + " overflow-hidden"} style={styles.glassCardBg}>
            <div className="px-5 py-4 border-b" style={{ borderColor: "hsl(0 0% 100% / 0.08)", background: "hsl(0 0% 100% / 0.03)" }}>
              <p className="font-bold text-sm" style={{ color: "hsl(0 0% 98%)" }}>{dept}</p>
              <p className="text-xs mt-0.5" style={{ color: styles.muted }}>{deptMembers.length} agenti</p>
            </div>
            <div className="p-3 space-y-2">
              {deptMembers.map((member) => (
                <div key={member.id} className="p-3 rounded-xl border" style={{ borderColor: "hsl(0 0% 100% / 0.06)", background: "hsl(0 0% 100% / 0.03)" }}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)" }}>
                      <Bot className="w-3.5 h-3.5" style={{ color: styles.primary }} />
                    </div>
                    <div>
                      <span className="text-sm font-semibold" style={{ color: "hsl(0 0% 98%)" }}>Agente {member.name}</span>
                      <p className="text-xs" style={{ color: styles.muted }}>{member.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className={styles.btnSecondary + " flex items-center gap-2 text-sm !px-5 !py-2.5"} style={styles.btnSecondaryBg}>
          <ArrowLeft className="w-4 h-4" /> Indietro
        </button>
        <button onClick={onNext} className={styles.btnPremium + " flex items-center gap-2 text-sm"} style={styles.btnPremiumBg}>
          Conferma organigramma <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Step 3: Company data
function Step3Account({ companyData, setCompanyData, onNext, onBack }: { companyData: CompanyData; setCompanyData: (d: CompanyData) => void; onNext: () => void; onBack: () => void }) {
  const update = (field: keyof CompanyData, value: string) => setCompanyData({ ...companyData, [field]: value });
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyData.email);
  const passwordsMatch = companyData.password && companyData.confirmPassword && companyData.password === companyData.confirmPassword;
  const isValid = companyData.companyName && isEmailValid && companyData.password && companyData.password.length >= 8 && passwordsMatch;

  return (
    <div>
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-black mb-3" style={{ color: "hsl(0 0% 98%)" }}>Crea il tuo account</h2>
        <p style={{ color: styles.muted }} className="text-base max-w-md mx-auto">
          Inserisci i dati per accedere alla tua dashboard.
        </p>
      </div>

      <div className={styles.glass + " p-6 md:p-8 max-w-md mx-auto mb-8"} style={styles.glassBg}>
        <div className="space-y-4">
          <div>
            <label className={styles.label}>Nome azienda *</label>
            <input type="text" value={companyData.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="es. Rossi & Partners S.r.l." className={styles.input} style={styles.inputBg} autoComplete="off" />
          </div>
          <div>
            <label className={styles.label}>Email *</label>
            <input type="email" value={companyData.email} onChange={(e) => update("email", e.target.value)} placeholder="es. info@azienda.it" className={styles.input} style={styles.inputBg} autoComplete="off" />
            {companyData.email && !isEmailValid && (
              <p className="text-xs mt-1" style={{ color: "hsl(0 65% 55%)" }}>Inserisci un indirizzo email valido</p>
            )}
          </div>
          <div>
            <label className={styles.label}>Password *</label>
            <input type="password" value={companyData.password} onChange={(e) => update("password", e.target.value)} placeholder="Minimo 8 caratteri" className={styles.input} style={styles.inputBg} autoComplete="off" />
            {companyData.password && companyData.password.length < 8 && (
              <p className="text-xs mt-1" style={{ color: "hsl(0 65% 55%)" }}>La password deve avere almeno 8 caratteri</p>
            )}
          </div>
          <div>
            <label className={styles.label}>Conferma password *</label>
            <input type="password" value={companyData.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} placeholder="Ripeti la password" className={styles.input} style={styles.inputBg} autoComplete="off" />
            {companyData.confirmPassword && companyData.password !== companyData.confirmPassword && (
              <p className="text-xs mt-1" style={{ color: "hsl(0 65% 55%)" }}>Le password non corrispondono</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className={styles.btnSecondary + " flex items-center gap-2 text-sm !px-5 !py-2.5"} style={styles.btnSecondaryBg}>
          <ArrowLeft className="w-4 h-4" /> Indietro
        </button>
        <button onClick={onNext} disabled={!isValid} className={styles.btnPremium + " flex items-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"} style={styles.btnPremiumBg}>
          Inizia prova gratuita <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Step 4: Trial activation
function Step4Trial({ companyData, members, onBack }: { companyData: CompanyData; members: TeamMember[]; onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  // Check localStorage for previously completed activation
  const [done, setDone] = useState(() => {
    try { return localStorage.getItem("goitalia_activated") === companyData.email; } catch { return false; }
  });
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false); // Prevent double-click

  const activate = async () => {
    // Double-click guard (synchronous check before async)
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyData.companyName,
          email: companyData.email,
          password: companyData.password,
          members: members.map((m) => ({
            name: m.name,
            role: m.role,
            department: m.department,
            software: m.software,
            description: m.description,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Errore durante l'attivazione");
        setLoading(false);
        submittingRef.current = false;
        return;
      }
      // Persist success in localStorage for idempotency
      try { localStorage.setItem("goitalia_activated", companyData.email); } catch {}
      setDone(true);
    } catch {
      setError("Errore di connessione. Riprova.");
      submittingRef.current = false;
    }
    setLoading(false);
  };

  if (done) {
    return (
      <div className="text-center">
        <div className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center" style={{ background: "hsl(158 64% 42% / 0.15)", border: "1px solid hsl(158 64% 42% / 0.25)" }}>
          <CheckCircle className="w-10 h-10" style={{ color: styles.primary }} />
        </div>
        <h2 className="text-3xl font-black mb-3" style={{ color: "hsl(0 0% 98%)" }}>Benvenuto!</h2>
        <p style={{ color: styles.muted }} className="text-base mb-8">
          I tuoi {members.length} agenti AI sono pronti. La prova gratuita di 14 giorni è attiva.
        </p>
        <a
          href="/auth"
          className={styles.btnPremium + " inline-flex items-center gap-2 text-sm"}
          style={styles.btnPremiumBg}
        >
          Accedi alla dashboard <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-black mb-3" style={{ color: "hsl(0 0% 98%)" }}>Inizia la prova gratuita</h2>
        <p style={{ color: styles.muted }} className="text-base max-w-md mx-auto">
          14 giorni gratis, nessuna carta di credito richiesta.
        </p>
      </div>

      <div className={styles.glass + " p-8 md:p-10 max-w-md mx-auto text-center"} style={styles.glassBg}>
        {/* Trial summary */}
        <div className="space-y-4 mb-8 text-left">
          <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: "hsl(0 0% 100% / 0.08)" }}>
            <span style={{ color: styles.muted }} className="text-sm">Azienda</span>
            <span className="text-sm font-semibold" style={{ color: "hsl(0 0% 98%)" }}>{companyData.companyName}</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: "hsl(0 0% 100% / 0.08)" }}>
            <span style={{ color: styles.muted }} className="text-sm">Email</span>
            <span className="text-sm font-semibold" style={{ color: "hsl(0 0% 98%)" }}>{companyData.email}</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: "hsl(0 0% 100% / 0.08)" }}>
            <span style={{ color: styles.muted }} className="text-sm">Agenti AI</span>
            <span className="text-sm font-semibold" style={{ color: styles.primary }}>{members.length} agenti</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span style={{ color: styles.muted }} className="text-sm">Prova gratuita</span>
            <span className="text-sm font-semibold" style={{ color: styles.primary }}>14 giorni</span>
          </div>
        </div>

        <button
          onClick={activate}
          disabled={loading}
          className={styles.btnPremium + " w-full flex items-center justify-center gap-2 text-sm disabled:opacity-60"}
          style={styles.btnPremiumBg}
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Creazione in corso...
            </>
          ) : (
            <>
              Attiva prova gratuita <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {error && (
          <p className="text-xs mt-4 px-4 py-2 rounded-xl" style={{ color: "hsl(0 65% 65%)", background: "hsl(0 65% 50% / 0.1)" }}>
            {error}
          </p>
        )}
        {!error && (
          <p className="text-xs mt-4" style={{ color: "hsl(215 20% 45%)" }}>
            Nessuna carta di credito. Dopo 14 giorni scegli il piano che preferisci.
          </p>
        )}
      </div>

      <div className="flex justify-start mt-10">
        <button onClick={onBack} className={styles.btnSecondary + " flex items-center gap-2 text-sm !px-5 !py-2.5"} style={styles.btnSecondaryBg}>
          <ArrowLeft className="w-4 h-4" /> Indietro
        </button>
      </div>
    </div>
  );
}

// Main wizard
export function StartWizard() {
  const [step, setStep] = useState(1);
  const [members, setMembers] = useState<TeamMember[]>([]);

  // Override body overflow:hidden from Paperclip's global CSS
  useEffect(() => {
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    return () => {
      document.body.style.overflow = "";
      document.body.style.height = "";
    };
  }, []);
  const [companyData, setCompanyData] = useState<CompanyData>({
    companyName: "", email: "", password: "", confirmPassword: "",
  });

  return (
    <div className={styles.page} style={styles.pageBg}>
      {/* Grain overlay like goitalia.eu */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", opacity: 0.02, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")" }} />

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <span className="text-2xl font-black tracking-tight">
            <span style={{ color: "hsl(0 65% 50%)" }}>GO</span>{" "}
            <span style={{ color: "hsl(0 0% 98%)" }}>ITAL</span>{" "}
            <span style={{ color: "hsl(158 64% 42%)" }}>IA</span>
          </span>
          <p className="text-xs mt-1 font-medium" style={{ color: styles.muted }}>Impresa</p>
        </div>

        <StepIndicator currentStep={step} />

        {step === 1 && <Step1Team members={members} setMembers={setMembers} onNext={() => setStep(2)} />}
        {step === 2 && <Step2Organigramma members={members} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <Step3Account companyData={companyData} setCompanyData={setCompanyData} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && <Step4Trial companyData={companyData} members={members} onBack={() => setStep(3)} />}
      </div>
    </div>
  );
}

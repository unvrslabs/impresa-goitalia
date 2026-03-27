import { ChangeEvent, useEffect, useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { assetsApi } from "../api/assets";
import { queryKeys } from "../lib/queryKeys";
import { authApi } from "../api/auth";
import { Button } from "@/components/ui/button";
import { Settings, Check, Download, Upload, LogOut, Mail, Plus, Trash2, Package, Clock, Building2, FileUp } from "lucide-react";
import { companyProductsApi, type CompanyProduct } from "../api/company-products";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import {
  Field,
  ToggleField,
  HintIcon
} from "../components/agent-config-primitives";

type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  // Generale settings local state
  const sessionQ = useQuery({ queryKey: ["auth", "session"], queryFn: () => fetch("/api/auth/get-session", { credentials: "include" }).then(r => r.json()) });
  const userEmail = sessionQ.data?.user?.email || "";

  // Profile fields from ceo_memory
  const PROFILE_FIELDS = [
    { key: "ragione_sociale", label: "Ragione Sociale" },
    { key: "partita_iva", label: "Partita IVA" },
    { key: "codice_fiscale", label: "Codice Fiscale" },
    { key: "settore", label: "Settore / Attività" },
    { key: "indirizzo", label: "Indirizzo Sede" },
    { key: "citta", label: "Città" },
    { key: "cap", label: "CAP" },
    { key: "provincia", label: "Provincia" },
    { key: "telefono", label: "Telefono" },
    { key: "email", label: "Email Contatto" },
    { key: "pec", label: "PEC" },
    { key: "sito_web", label: "Sito Web" },
    { key: "dipendenti", label: "Numero Dipendenti" },
  ];
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [profileSaved, setProfileSaved] = useState<Record<string, string>>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"dati" | "catalogo" | "orari">("dati");
  const [products, setProducts] = useState<CompanyProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Partial<CompanyProduct> | null>(null);
  const [productSaving, setProductSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompanyId) return;
    fetch("/api/company-profile?companyId=" + selectedCompanyId, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { setProfile(d.profile || {}); setProfileSaved(d.profile || {}); })
      .catch(() => {});
  }, [selectedCompanyId]);

  const profileDirty = JSON.stringify(profile) !== JSON.stringify(profileSaved);

  // Load products
  const loadProducts = async () => {
    if (!selectedCompanyId) return;
    setProductsLoading(true);
    try {
      const data = await companyProductsApi.list(selectedCompanyId);
      setProducts(data);
    } catch { /* ignore */ }
    setProductsLoading(false);
  };

  useEffect(() => { loadProducts(); }, [selectedCompanyId]);

  const saveProduct = async () => {
    if (!editingProduct?.name || !selectedCompanyId) return;
    setProductSaving(true);
    try {
      if (editingProduct.id) {
        await companyProductsApi.update(editingProduct.id, editingProduct);
      } else {
        await companyProductsApi.create({ companyId: selectedCompanyId, ...editingProduct } as any);
      }
      setEditingProduct(null);
      await loadProducts();
    } catch { /* ignore */ }
    setProductSaving(false);
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(reader.result as string);
      setShowImport(true);
      setImportResult(null);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (!selectedCompanyId || !importText.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await companyProductsApi.importCsv(selectedCompanyId, importText);
      setImportResult(`${res.imported} prodotti importati`);
      setImportText("");
      setShowImport(false);
      await loadProducts();
    } catch (err: any) {
      setImportResult(err?.message || "Errore durante l'importazione");
    }
    setImporting(false);
  };

  const deleteProduct = async (id: string) => {
    if (!selectedCompanyId) return;
    await companyProductsApi.remove(id, selectedCompanyId);
    await loadProducts();
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      await fetch("/api/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, profile }),
      });
      setProfileSaved({ ...profile });
    } catch {} finally { setProfileSaving(false); }
  };

  const [companyName, setCompanyName] = useState("");
  const [description, setDescrizione] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescrizione(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
    setLogoUrl(selectedCompany.logoUrl ?? "");
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createOpenClawInvitePrompt(selectedCompanyId!),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      let snippet: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null
        });
      } catch {
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates: null,
          testResolutionUrl: null
        });
      }
      setInviteSnippet(snippet);
      try {
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(true);
        setSnippetCopyDelightId((prev) => prev + 1);
        setTimeout(() => setSnippetCopied(false), 2000);
      } catch {
        /* clipboard may not be available */
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
      });
    },
    onError: (err) => {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invite"
      );
    }
  });

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
  }, [selectedCompanyId]);

  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGenerale() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null
    });
  }

  const tabDef = [
    { key: "dati" as const, label: "Dati Aziendali", icon: Building2 },
    { key: "catalogo" as const, label: "Catalogo", icon: Package },
    { key: "orari" as const, label: "Orari", icon: Clock },
  ];

  const inputCls = "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-[hsl(158_64%_42%/0.5)] transition-colors";
  const selectCls = inputCls + " pr-8";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Profilo Impresa</h1>
      </div>

      {/* Tab navigation */}
      <div className="glass-card p-1 flex gap-1">
        {tabDef.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 flex flex-row items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
              style={isActive ? { background: "linear-gradient(135deg, hsl(158 64% 42% / 0.25), hsl(158 64% 42% / 0.12))", border: "1px solid hsl(158 64% 42% / 0.3)" } : {}}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* ==================== TAB: DATI AZIENDALI ==================== */}
      {activeTab === "dati" && <>
        {/* Generale */}
        <div className="space-y-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Generale</div>
          <div className="glass-card px-5 py-5 space-y-3">
            <div className="flex items-center gap-4 pb-3 border-b border-white/5">
              <div className="relative shrink-0">
                <CompanyPatternIcon companyName={companyName || selectedCompany.name} logoUrl={logoUrl || null} brandColor={brandColor || null} className="rounded-[14px]" />
                {logoUrl && (
                  <button onClick={handleClearLogo} disabled={clearLogoMutation.isPending} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center transition-colors">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
              <div>
                <label className="relative cursor-pointer px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  Scegli file
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={handleLogoFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                </label>
                {logoUploadMutation.isPending && <span className="text-xs text-muted-foreground ml-2">Caricamento...</span>}
              </div>
            </div>
            <div className="space-y-3">
              <Field label="Email" hint="Email usata per la registrazione.">
                <input className={inputCls + " opacity-60"} type="text" value={userEmail} readOnly />
              </Field>
              <Field label="Password">
                <input className={inputCls} type="password" value="••••••••" readOnly />
              </Field>
            </div>
          </div>
        </div>
        {generalDirty && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSaveGenerale} disabled={generalMutation.isPending || !companyName.trim()}>
              {generalMutation.isPending ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          </div>
        )}




      {/* Profilo Aziendale */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Profilo Aziendale
        </div>
        <p className="text-xs text-muted-foreground">Dati usati dal CEO AI come contesto. Compilati automaticamente dalla Partita IVA. Puoi modificarli in qualsiasi momento.</p>

        {/* Identità */}
        <div className="glass-card px-5 py-5 space-y-3">
          <div className="text-xs font-medium pb-1">Identità</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "ragione_sociale", label: "Ragione Sociale" },
              { key: "partita_iva", label: "Partita IVA" },
              { key: "codice_fiscale", label: "Codice Fiscale" },
              { key: "settore", label: "Settore / Attività (ATECO)" },
              { key: "forma_giuridica", label: "Forma Giuridica" },
              { key: "stato_attivita", label: "Stato Attività" },
              { key: "data_inizio", label: "Data Inizio Attività" },
            ].map((f) => (
              <Field key={f.key} label={f.label}>
                <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none" type="text" value={profile[f.key] || ""} onChange={(e) => setProfile((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.label} />
              </Field>
            ))}
          </div>
        </div>

        {/* Sede e Contatti */}
        <div className="glass-card px-5 py-5 space-y-3">
          <div className="text-xs font-medium pb-1">Sede e Contatti</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "indirizzo", label: "Indirizzo Sede" },
              { key: "citta", label: "Città" },
              { key: "cap", label: "CAP" },
              { key: "provincia", label: "Provincia" },
              { key: "regione", label: "Regione" },
              { key: "telefono", label: "Telefono" },
              { key: "email", label: "Email Contatto" },
              { key: "whatsapp", label: "WhatsApp" },
              { key: "pec", label: "PEC" },
              { key: "codice_sdi", label: "Codice SDI" },
              { key: "sito_web", label: "Sito Web" },
            ].map((f) => (
              <Field key={f.key} label={f.label}>
                <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none" type="text" value={profile[f.key] || ""} onChange={(e) => setProfile((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.label} />
              </Field>
            ))}
          </div>
        </div>

        {/* Dati Economici */}
        <div className="glass-card px-5 py-5 space-y-3">
          <div className="text-xs font-medium pb-1">Dati Economici e Bilancio</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "dipendenti", label: "Dipendenti" },
              { key: "fatturato", label: "Fatturato" },
              { key: "patrimonio_netto", label: "Patrimonio Netto" },
              { key: "capitale_sociale", label: "Capitale Sociale" },
              { key: "totale_attivo", label: "Totale Attivo" },
            ].map((f) => (
              <Field key={f.key} label={f.label}>
                <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none" type="text" value={profile[f.key] || ""} onChange={(e) => setProfile((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.label} />
              </Field>
            ))}
          </div>
        </div>

        {/* Affidabilità */}
        <div className="glass-card px-5 py-5 space-y-3">
          <div className="text-xs font-medium pb-1">Affidabilità (Credit Score)</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "risk_score", label: "Risk Score" },
              { key: "rating", label: "Rating" },
              { key: "risk_severity", label: "Severità Rischio" },
              { key: "credit_limit", label: "Limite Credito Operativo" },
            ].map((f) => (
              <Field key={f.key} label={f.label}>
                <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none" type="text" value={profile[f.key] || ""} onChange={(e) => setProfile((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.label} />
              </Field>
            ))}
          </div>
        </div>

        {/* Soci */}
        <div className="glass-card px-5 py-5 space-y-3">
          <div className="text-xs font-medium pb-1">Soci</div>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Soci (dal registro)">
              <input className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none" type="text" value={profile.soci || ""} onChange={(e) => setProfile((prev) => ({ ...prev, soci: e.target.value }))} placeholder="Es: Mario Rossi (60%), Luca Bianchi (40%)" />
            </Field>
          </div>
        </div>

        {profileDirty && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveProfile} disabled={profileSaving}>
              {profileSaving ? "Salvataggio..." : "Salva Profilo"}
            </Button>
          </div>
        )}
      </div>
      </>}

      {/* ==================== TAB: CATALOGO ==================== */}
      {activeTab === "catalogo" && <>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prodotti e Servizi</div>
            <div className="flex gap-2">
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 transition-all cursor-pointer">
                <FileUp className="w-3.5 h-3.5" /> Importa CSV
                <input type="file" accept=".csv,.txt,.tsv" onChange={handleImportFile} className="hidden" />
              </label>
              <button
                onClick={() => setEditingProduct({ type: "product", name: "", currency: "EUR", available: true })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ background: "hsl(158 64% 42%)", color: "#fff" }}
              >
                <Plus className="w-3.5 h-3.5" /> Aggiungi
              </button>
            </div>
          </div>

          {/* Import CSV panel */}
          {showImport && (
            <div className="glass-card px-5 py-5 space-y-3">
              <div className="text-xs font-medium pb-1">Importa da CSV</div>
              <p className="text-xs text-muted-foreground">Il file deve avere un header con le colonne: <strong>nome</strong> (obbligatorio), categoria, unita, prezzo_b2b, prezzo_b2c, descrizione, sku. Separatore: virgola, punto e virgola, o tab.</p>
              <textarea
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-xs outline-none focus:border-emerald-500/50 font-mono"
                rows={6}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"nome;categoria;prezzo_b2b;prezzo_b2c;unita\nAspirina 500mg;Farmaci;3.50;5.90;pz\nTachipirina 1000;Farmaci;4.00;6.50;pz"}
              />
              {importResult && <p className="text-xs text-emerald-400">{importResult}</p>}
              <div className="flex gap-2">
                <button onClick={doImport} disabled={importing || !importText.trim()} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40" style={{ background: "hsl(158 64% 42%)", color: "#fff" }}>
                  {importing ? "Importazione..." : "Importa"}
                </button>
                <button onClick={() => { setShowImport(false); setImportText(""); setImportResult(null); }} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 transition-all">
                  Annulla
                </button>
              </div>
            </div>
          )}

          {/* Form nuovo/modifica prodotto */}
          {editingProduct && (
            <div className="glass-card px-5 py-5 space-y-3">
              <div className="text-xs font-medium pb-1">{editingProduct.id ? "Modifica prodotto" : "Nuovo prodotto/servizio"}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome *">
                  <input className={inputCls} value={editingProduct.name || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, name: e.target.value }))} placeholder="Es: Aspirina 500mg" />
                </Field>
                <Field label="Tipo">
                  <select className={selectCls} value={editingProduct.type || "product"} onChange={(e) => setEditingProduct((p) => ({ ...p!, type: e.target.value as "product" | "service" }))}>
                    <option value="product">Prodotto</option>
                    <option value="service">Servizio</option>
                  </select>
                </Field>
                <Field label="Categoria">
                  <input className={inputCls} value={editingProduct.category || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, category: e.target.value }))} placeholder="Es: Farmaci" />
                </Field>
                <Field label="Unità">
                  <input className={inputCls} value={editingProduct.unit || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, unit: e.target.value }))} placeholder="Es: pz, kg, ora" />
                </Field>
                <Field label="Prezzo B2B">
                  <input className={inputCls} value={editingProduct.priceB2b || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, priceB2b: e.target.value }))} placeholder="Es: 3.50" />
                </Field>
                <Field label="Prezzo B2C">
                  <input className={inputCls} value={editingProduct.priceB2c || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, priceB2c: e.target.value }))} placeholder="Es: 5.90" />
                </Field>
                <Field label="Codice SKU">
                  <input className={inputCls} value={editingProduct.sku || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, sku: e.target.value }))} placeholder="Opzionale" />
                </Field>
                <Field label="Quantità Magazzino">
                  <input className={inputCls} value={editingProduct.stockQty || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, stockQty: e.target.value }))} placeholder="Es: 100" />
                </Field>
                <Field label="IVA %">
                  <input className={inputCls} value={editingProduct.vatRate || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, vatRate: e.target.value }))} placeholder="Es: 22, 10, 4" />
                </Field>
                <Field label="Disponibile">
                  <select className={selectCls} value={editingProduct.available !== false ? "true" : "false"} onChange={(e) => setEditingProduct((p) => ({ ...p!, available: e.target.value === "true" }))}>
                    <option value="true">Disponibile</option>
                    <option value="false">Non disponibile</option>
                  </select>
                </Field>
              </div>
              <Field label="Descrizione">
                <input className={inputCls} value={editingProduct.description || ""} onChange={(e) => setEditingProduct((p) => ({ ...p!, description: e.target.value }))} placeholder="Descrizione opzionale" />
              </Field>
              <div className="flex gap-2 pt-2">
                <button onClick={saveProduct} disabled={productSaving || !editingProduct.name} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40" style={{ background: "hsl(158 64% 42%)", color: "#fff" }}>
                  {productSaving ? "Salvataggio..." : "Salva"}
                </button>
                <button onClick={() => setEditingProduct(null)} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 transition-all">
                  Annulla
                </button>
              </div>
            </div>
          )}

          {/* Lista prodotti */}
          {productsLoading ? (
            <div className="glass-card p-8 text-center text-sm text-muted-foreground">Caricamento...</div>
          ) : products.length === 0 && !editingProduct ? (
            <div className="glass-card p-8 text-center">
              <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nessun prodotto o servizio.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Aggiungi prodotti e servizi con i relativi prezzi B2B e B2C. Il CEO li userà per rispondere alle richieste nella rete A2A.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {products.map((p) => (
                <div key={p.id} className="glass-card px-4 py-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      {p.category && <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{p.category}</span>}
                      {p.type === "service" && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Servizio</span>}
                      {!p.available && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">Non disponibile</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      {p.priceB2b && <span>B2B: €{p.priceB2b}</span>}
                      {p.priceB2c && <span>B2C: €{p.priceB2c}</span>}
                      {p.unit && <span>({p.unit})</span>}
                      {p.sku && <span>SKU: {p.sku}</span>}
                      {p.stockQty && <span>Mag: {p.stockQty}</span>}
                      {p.vatRate && <span>IVA: {p.vatRate}%</span>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0 ml-3">
                    <button onClick={() => setEditingProduct(p)} className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 transition-all" title="Modifica">
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteProduct(p.id)} className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all" title="Elimina">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </>}

      {/* ==================== TAB: ORARI ==================== */}
      {activeTab === "orari" && <>
        <div className="space-y-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Orari e Apertura</div>
          <p className="text-xs text-muted-foreground">Inserisci gli orari di apertura della tua attività. Il CEO li userà per rispondere alle richieste dei partner.</p>

          <div className="glass-card px-5 py-5 space-y-3">
            <Field label="Orari di Apertura" hint="Es: Lun-Ven 9:00-19:00, Sab 9:00-13:00">
              <input className={inputCls} value={profile.orari_apertura || ""} onChange={(e) => setProfile((prev) => ({ ...prev, orari_apertura: e.target.value }))} placeholder="Es: Lun-Ven 9:00-19:00, Sab 9:00-13:00" />
            </Field>
            <Field label="Giorno di Chiusura" hint="Es: Domenica, Festivi">
              <input className={inputCls} value={profile.giorno_chiusura || ""} onChange={(e) => setProfile((prev) => ({ ...prev, giorno_chiusura: e.target.value }))} placeholder="Es: Domenica" />
            </Field>
            <Field label="Note sugli Orari" hint="Es: Chiusura estiva, orari speciali">
              <input className={inputCls} value={profile.note_orari || ""} onChange={(e) => setProfile((prev) => ({ ...prev, note_orari: e.target.value }))} placeholder="Es: Chiuso per ferie dal 10 al 25 agosto" />
            </Field>
          </div>

          {profileDirty && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? "Salvataggio..." : "Salva Orari"}
              </Button>
            </div>
          )}
        </div>
      </>}

    </div>
  );
}

function AccountSection() {
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);

  const email = sessionQuery.data?.user?.email;
  const name = sessionQuery.data?.user?.name;

  return (
    <div className="space-y-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Account
      </div>
      <div className="space-y-3 rounded-md border border-border px-4 py-4">
        {email && (
          <div className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Loggato come</span>
            <span className="font-medium">{email}</span>
            {name && <span className="text-muted-foreground">({name})</span>}
          </div>
        )}
        <div className="pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              try {
                await authApi.signOut();
                await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
                window.location.href = "/auth";
              } catch {
                setLoggingOut(false);
              }
            }}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            {loggingOut ? "Disconnessione..." : "Logout"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in Paperclip, then retry.
Suggested steps:
- choose a hostname that resolves to the GoItalia host from your runtime
- run: pnpm goitalia allowed-hostname <host>
- restart GoItalia
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in Paperclip, restart, and retry.
Suggested command:
- pnpm goitalia allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test GoItalia-to-gateway reachability, call: ${resolutionTestUrl}?url=<urlencoded-gateway-url> (using the hostname that worked above). Do not assume your 172.x is necessarily reachable from GoItalia. Test it. `
    : "";

  return `You're invited to join a GoItalia organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than Paperclip, GoItalia must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a gateway URL that GoItalia can access. Check your config and include that URL.${resolutionLine}

---

This onboarding flow is for OpenClaw Gateway.
When you submit the join request, use:
- \`adapterType: "openclaw_gateway"\`
- \`agentDefaultsPayload.url\` as your \`ws://\` or \`wss://\` gateway URL
- \`agentDefaultsPayload.headers["x-openclaw-token"]\` with your gateway token
- (legacy accepted) \`agentDefaultsPayload.headers["x-openclaw-auth"]\`
- Keep device auth enabled (recommended). If \`devicePrivateKeyPem\` is omitted, GoItalia will generate and persist one during join so pairing approvals remain stable.
- Only use \`disableDeviceAuth=true\` for special environments where pairing cannot be completed.

Do NOT use \`/v1/responses\` or \`/hooks/*\` in this join flow.

Before you do anything, please respond to your user that you understand the instructions and you're going to work on them. Then do the step above in another session called "paperclip-onboarding" and then tell your user when you're done. Update your user in intermediate steps along the way so they know what's going on.

Then after you've connected to GoItalia (exchanged keys etc.) you MUST review and follow the onboarding instructions in onboarding.txt they give you.

`;
}

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}

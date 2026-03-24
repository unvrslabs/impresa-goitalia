import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { HardDrive, Folder, FileText, Sheet, Presentation, File, Image, Search, ChevronLeft, ExternalLink } from "lucide-react";

interface DriveFile { id: string; name: string; mimeType: string; type: string; modifiedTime: string; size: number | null; webViewLink: string; isFolder: boolean; }

const typeIcons: Record<string, typeof FileText> = { doc: FileText, sheet: Sheet, slide: Presentation, folder: Folder, image: Image, pdf: FileText, file: File };

export function DrivePage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "Il mio Drive" }]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ index: number; email: string }>>([]);
  const [selectedAccount, setSelectedAccount] = useState(0);

  useEffect(() => { setBreadcrumbs([{ label: "Documenti" }]); }, [setBreadcrumbs]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/drive/accounts?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts || []))
      .catch(() => {});
  }, [selectedCompany?.id]);

  const currentFolder = folderStack[folderStack.length - 1];

  const fetchFiles = async (folderId?: string, search?: string) => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId: selectedCompany.id });
    params.set("account", String(selectedAccount));
    if (search) { params.set("q", search); } else { params.set("folderId", folderId || currentFolder.id); }
    try {
      const res = await fetch("/api/drive/files?" + params, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      setFiles(data.files || []);
      setNextPageToken(data.nextPageToken || null);
    } catch { setError("Errore connessione"); }
    setLoading(false);
  };

  useEffect(() => { if (!searching) fetchFiles(); }, [selectedCompany?.id, currentFolder.id, selectedAccount]);

  const openFolder = (file: DriveFile) => {
    setSearching(false); setSearchQuery("");
    setFolderStack([...folderStack, { id: file.id, name: file.name }]);
  };
  const goBack = () => { if (folderStack.length > 1) { setFolderStack(folderStack.slice(0, -1)); setSearching(false); setSearchQuery(""); } };
  const goToRoot = () => { setFolderStack([{ id: "root", name: "Il mio Drive" }]); setSearching(false); setSearchQuery(""); };

  const doSearch = () => { if (searchQuery.trim()) { setSearching(true); fetchFiles(undefined, searchQuery.trim()); } };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  };

  const formatDate = (d: string) => { try { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); } catch { return ""; } };

  if (error && !files.length) return (
    <div className="p-6"><div className="glass-card p-6 text-center space-y-3">
      <HardDrive className="w-10 h-10 mx-auto text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{error}</p>
      <a href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"} className="text-sm text-green-400 hover:underline">Vai su Plugin per collegare Google</a>
    </div></div>
  );

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="w-5 h-5" />
          <h1 className="text-xl font-semibold">Documenti</h1>
        </div>
      </div>

      {/* Account selector */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Account:</span>
          {accounts.map((acc) => (
            <button
              key={acc.index}
              onClick={() => { setSelectedAccount(acc.index); setFolderStack([{ id: "root", name: "Il mio Drive" }]); setSearching(false); }}
              className={"px-2.5 py-1 rounded-lg text-xs font-medium transition-all truncate max-w-[180px] " + (selectedAccount === acc.index ? "text-white" : "text-muted-foreground")}
              style={selectedAccount === acc.index ? { background: "rgba(66, 133, 244, 0.2)", border: "1px solid rgba(66, 133, 244, 0.3)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {acc.email}
            </button>
          ))}
        </div>
      )}

      {/* Search + Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {folderStack.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              <button onClick={() => setFolderStack(folderStack.slice(0, i + 1))} className="hover:text-foreground transition-colors">{f.name}</button>
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <input
            className="px-3 py-1.5 rounded-lg text-xs bg-transparent border border-white/10 outline-none w-40"
            placeholder="Cerca file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <button onClick={doSearch} className="p-1.5 rounded-lg hover:bg-white/10"><Search className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {folderStack.length > 1 && !searching && (
        <button onClick={goBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-3.5 h-3.5" /> Indietro
        </button>
      )}
      {searching && (
        <button onClick={goToRoot} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-3.5 h-3.5" /> Torna al Drive
        </button>
      )}

      {loading ? <div className="text-sm text-muted-foreground p-4">Caricamento...</div> : files.length === 0 ? (
        <div className="glass-card p-6 text-center text-sm text-muted-foreground">Nessun file trovato.</div>
      ) : (
        <div className="glass-card overflow-hidden divide-y divide-white/5">
          {files.map((file) => {
            const Icon = typeIcons[file.type] || File;
            const iconColor = file.isFolder ? "text-amber-400" : file.type === "doc" ? "text-blue-400" : file.type === "sheet" ? "text-green-400" : file.type === "slide" ? "text-orange-400" : "text-muted-foreground";
            return (
              <div key={file.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors">
                <Icon className={"w-5 h-5 shrink-0 " + iconColor} />
                <div className="flex-1 min-w-0">
                  {file.isFolder ? (
                    <button onClick={() => openFolder(file)} className="text-sm font-medium hover:underline text-left truncate block w-full">{file.name}</button>
                  ) : (
                    <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline truncate block no-underline">{file.name}</a>
                  )}
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{formatSize(file.size)}</div>
                <div className="text-xs text-muted-foreground shrink-0 w-20 text-right">{formatDate(file.modifiedTime)}</div>
                {!file.isFolder && file.webViewLink && (
                  <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

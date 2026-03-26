import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { FolderOpen, Plus, Upload, File, FileText, Image, Video, Trash2, ExternalLink, X } from "lucide-react";

interface PmiProject {
  id: string;
  name: string;
  description?: string;
  storage_type: string;
  drive_folder_id?: string;
  created_at: string;
  github_repo?: string;
}

interface ProjectFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  source: string;
  webViewLink?: string;
  storageRef?: string;
  isDir?: boolean;
  path?: string;
  downloadUrl?: string;
  htmlUrl?: string;
}

const fileIcon = (mime?: string) => {
  if (mime === "directory") return <FolderOpen className="w-4 h-4 text-amber-400" />;
  if (mime === "directory") return <FolderOpen className="w-4 h-4 text-amber-400" />;
  if (!mime) return <File className="w-4 h-4" />;
  if (mime.startsWith("image/")) return <Image className="w-4 h-4 text-pink-400" />;
  if (mime.startsWith("video/")) return <Video className="w-4 h-4 text-blue-400" />;
  if (mime.includes("pdf") || mime.includes("document") || mime.includes("text")) return <FileText className="w-4 h-4 text-amber-400" />;
  return <File className="w-4 h-4 text-muted-foreground" />;
};

const formatSize = (bytes?: number) => {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
};

export function ProjectsPmi() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [projects, setProjects] = useState<PmiProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<PmiProject | null>(null);
  const searchParams = new URLSearchParams(window.location.search);
  const urlProjectId = searchParams.get("project");
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ghPath, setGhPath] = useState("");
  const [showLinkRepo, setShowLinkRepo] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoToken, setRepoToken] = useState("");
  const [linkingRepo, setLinkingRepo] = useState(false);
  const [showDriveInput, setShowDriveInput] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [addingDrive, setAddingDrive] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => { setBreadcrumbs([{ label: "Progetti" }]); }, [setBreadcrumbs]);

  const fetchProjects = async () => {
    if (!selectedCompany?.id) return;
    try {
      const r = await fetch("/api/pmi-projects?companyId=" + selectedCompany.id, { credentials: "include" });
      const d = await r.json();
      setProjects(d.projects || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchProjects(); }, [selectedCompany?.id]);
  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch(`/api/google/status?companyId=${selectedCompany.id}`, { credentials: "include" })
      .then((r) => r.json()).then((d) => setGoogleConnected(d.connected || false)).catch(() => {});
  }, [selectedCompany?.id]);

  const fetchFiles = async (project: PmiProject) => {
    if (!selectedCompany?.id) return;
    try {
      const r = await fetch("/api/pmi-projects/" + project.id + "/files?companyId=" + selectedCompany.id + (ghPath ? "&path=" + encodeURIComponent(ghPath) : ""), { credentials: "include" });
      const d = await r.json();
      setFiles(d.files || []);
    } catch {}
  };

  useEffect(() => {
    if (urlProjectId && projects.length > 0 && !selectedProject) {
      const p = projects.find((p) => p.id === urlProjectId);
      if (p) setSelectedProject(p);
    }
  }, [urlProjectId, projects]);
  
  useEffect(() => { setGhPath(""); }, [selectedProject?.id]);
  useEffect(() => { if (selectedProject) fetchFiles(selectedProject); }, [selectedProject, ghPath]);

  const createProject = async () => {
    if (!selectedCompany?.id || !newName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/pmi-projects", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ companyId: selectedCompany.id, name: newName, description: newDesc }),
      });
      if (r.ok) { setShowNewForm(false); setNewName(""); setNewDesc(""); fetchProjects(); }
    } catch {}
    setCreating(false);
  };

  const deleteProject = async (id: string) => {
    if (!selectedCompany?.id) return;
    await fetch("/api/pmi-projects/" + id + "?companyId=" + selectedCompany.id, { method: "DELETE", credentials: "include" });
    if (selectedProject?.id === id) { setSelectedProject(null); setFiles([]); }
    fetchProjects();
    queryClient.invalidateQueries({ queryKey: ["pmi-projects"] });
  };

  const addDriveLink = async () => {
    if (!selectedCompany?.id || !selectedProject || !driveUrl.trim()) return;
    setAddingDrive(true);
    try {
      const r = await fetch("/api/project-files/drive-link", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProject.id, companyId: selectedCompany.id, driveUrl: driveUrl.trim() }),
      });
      const d = await r.json();
      if (r.ok) {
        setDriveUrl(""); setShowDriveInput(false);
        // Add synthetic file entry to list
        setFiles((prev) => [...prev, { id: d.file.id, name: d.file.name, webViewLink: d.file.driveUrl || driveUrl, mimeType: "application/drive-link", size: 0, createdAt: new Date().toISOString(), source: "drive" }]);
      } else alert(d.error || "Errore");
    } catch {}
    setAddingDrive(false);
  };

  const uploadFile = async (file: File) => {
    if (!selectedCompany?.id || !selectedProject) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("companyId", selectedCompany.id);
      await fetch("/api/pmi-projects/" + selectedProject.id + "/upload", { method: "POST", credentials: "include", body: fd });
      fetchFiles(selectedProject);
    } catch {}
    setUploading(false);
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return ""; }
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Caricamento...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-3">
          <FolderOpen className="w-5 h-5" />
          <h1 className="text-xl font-semibold">Progetti</h1>
        </div>

      </div>



      <div className="flex-1 flex flex-col min-h-0">
        {!selectedProject ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Seleziona un progetto dalla sidebar
          </div>
        ) : (
            <>
              {/* Project header */}
              <div className="flex items-center justify-between pb-3">
                <div>
                  <h2 className="text-sm font-semibold">{selectedProject.name}</h2>
                  {selectedProject.description && <p className="text-xs text-muted-foreground">{selectedProject.description}</p>}
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    {selectedProject.storage_type === "github" ? (
                      <><span className="w-1.5 h-1.5 rounded-full bg-white" /> GitHub</>
                    ) : selectedProject.storage_type === "drive" ? (
                      <><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Google Drive</>
                    ) : selectedProject.storage_type === "github" ? (
                      <><span className="w-1.5 h-1.5 rounded-full bg-white" /> GitHub {selectedProject.github_repo?.replace("https://github.com/", "")}</>
                    ) : (
                      <><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Storage locale</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => { Array.from(e.target.files || []).forEach(uploadFile); e.target.value = ""; }} />
                  {googleConnected && (
                    <button onClick={() => setShowDriveInput(!showDriveInput)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(66,133,244,0.1)", border: "1px solid rgba(66,133,244,0.25)", color: "rgba(255,255,255,0.7)" }}>
                      🔗 Drive
                    </button>
                  )}
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.8)" }}>
                    <Upload className="w-3.5 h-3.5" /> {uploading ? "Caricamento..." : "Carica file"}
                  </button>
                  <button onClick={() => deleteProject(selectedProject.id)} className="p-1.5 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Elimina progetto">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Drive link input */}
              {showDriveInput && (
                <div className="flex gap-2 mb-2">
                  <input
                    type="url" value={driveUrl} onChange={(e) => setDriveUrl(e.target.value)}
                    placeholder="Incolla link Google Drive..."
                    className="flex-1 px-3 py-2 rounded-xl text-xs bg-transparent outline-none"
                    style={{ border: "1px solid rgba(66,133,244,0.3)" }}
                    onKeyDown={(e) => { if (e.key === "Enter") addDriveLink(); if (e.key === "Escape") setShowDriveInput(false); }}
                    autoFocus
                  />
                  <button onClick={addDriveLink} disabled={addingDrive || !driveUrl.trim()} className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40" style={{ background: "rgba(66,133,244,0.2)", border: "1px solid rgba(66,133,244,0.3)", color: "rgba(66,133,244,0.9)" }}>
                    {addingDrive ? "..." : "Aggiungi"}
                  </button>
                  <button onClick={() => setShowDriveInput(false)} className="text-xs text-muted-foreground px-2">✕</button>
                </div>
              )}

              {/* GitHub path breadcrumb */}
              {selectedProject.storage_type === "github" && ghPath && (
                <div className="flex items-center gap-1 pb-2 text-xs text-muted-foreground">
                  <button onClick={() => setGhPath("")} className="hover:text-foreground">/</button>
                  {ghPath.split("/").map((part, i, arr) => (
                    <span key={i} className="flex items-center gap-1">
                      <span>/</span>
                      <button onClick={() => setGhPath(arr.slice(0, i + 1).join("/"))} className="hover:text-foreground">{part}</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Link GitHub repo button for local projects */}
              {selectedProject.storage_type === "local" && !showLinkRepo && (
                <button onClick={() => setShowLinkRepo(true)} className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  Collega repo GitHub
                </button>
              )}
              {showLinkRepo && (
                <div className="mb-2 glass-card p-3 space-y-2">
                  <input className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }} placeholder="https://github.com/user/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
                  <input className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }} placeholder="Token GitHub (opzionale, per repo privati)" type="password" value={repoToken} onChange={(e) => setRepoToken(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      if (!repoUrl.trim() || !selectedCompany?.id || !selectedProject) return;
                      setLinkingRepo(true);
                      await fetch("/api/pmi-projects/" + selectedProject.id + "/link-github", {
                        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                        body: JSON.stringify({ companyId: selectedCompany.id, githubRepo: repoUrl, githubToken: repoToken || undefined }),
                      });
                      setShowLinkRepo(false); setRepoUrl(""); setRepoToken("");
                      fetchProjects(); setLinkingRepo(false);
                      // Reload project
                      const updated = { ...selectedProject, storage_type: "github", github_repo: repoUrl };
                      setSelectedProject(updated as any);
                    }} disabled={linkingRepo || !repoUrl.trim()} className="px-3 py-1.5 rounded-xl text-xs font-medium text-white disabled:opacity-30" style={{ background: "hsl(158 64% 42%)" }}>
                      {linkingRepo ? "..." : "Collega"}
                    </button>
                    <button onClick={() => setShowLinkRepo(false)} className="text-xs text-muted-foreground">Annulla</button>
                  </div>
                </div>
              )}

              {/* Drop zone + file list */}
              <div
                className="flex-1 glass-card overflow-y-auto"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "hsl(158 64% 42%)"; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = ""; }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = ""; Array.from(e.dataTransfer.files).forEach(uploadFile); }}
              >
                {files.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
                    <Upload className="w-10 h-10 opacity-30" />
                    <p className="text-sm">Trascina file qui o usa il bottone "Carica file"</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {files.map((f) => (
                      <div key={f.id} className={"px-4 py-2.5 flex items-center gap-3 hover:bg-white/5 transition-colors" + (f.isDir ? " cursor-pointer" : "")} onClick={() => { if (f.isDir && f.path) setGhPath(f.path); }}>
                        {fileIcon(f.mimeType)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{f.name}</div>
                          <div className="text-[10px] text-muted-foreground">{formatSize(f.size)} &middot; {formatDate(f.createdAt)}</div>
                        </div>
                        {f.webViewLink && (
                          <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="p-1 text-muted-foreground hover:text-foreground">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {f.source === "local" && (
                          <a href={"/api/pmi-projects/" + selectedProject.id + "/files/" + f.id + "/download"} className="p-1 text-muted-foreground hover:text-foreground no-underline">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {f.source === "github" && f.htmlUrl && !f.isDir && (
                          <a href={f.htmlUrl} target="_blank" rel="noopener noreferrer" className="p-1 text-muted-foreground hover:text-foreground no-underline">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
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
}

const fileIcon = (mime?: string) => {
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const fetchFiles = async (project: PmiProject) => {
    if (!selectedCompany?.id) return;
    try {
      const r = await fetch("/api/pmi-projects/" + project.id + "/files?companyId=" + selectedCompany.id, { credentials: "include" });
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
  
  useEffect(() => { if (selectedProject) fetchFiles(selectedProject); }, [selectedProject]);

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
                    {selectedProject.storage_type === "drive" ? (
                      <><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Google Drive</>
                    ) : (
                      <><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Storage locale</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => { Array.from(e.target.files || []).forEach(uploadFile); e.target.value = ""; }} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(66, 133, 244, 0.15)", border: "1px solid rgba(66, 133, 244, 0.3)", color: "rgba(255,255,255,0.8)" }}>
                    <Upload className="w-3.5 h-3.5" /> {uploading ? "Caricamento..." : "Carica file"}
                  </button>
                  <button onClick={() => deleteProject(selectedProject.id)} className="p-1.5 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Elimina progetto">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

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
                      <div key={f.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/5 transition-colors">
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

import { useState, useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Download, Share2, ExternalLink, Plus, X, ImageIcon, Loader2 } from "lucide-react";

interface SocialPost {
  id: string;
  platform: "instagram" | "facebook" | "linkedin";
  type: "image" | "video" | "text" | "carousel";
  text: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp: string;
  accountName: string;
  likes?: number;
  comments?: number;
}

const platformIcons: Record<string, React.ReactNode> = {
  instagram: <svg width="14" height="14" viewBox="0 0 24 24" fill="url(#ig-s)"><defs><linearGradient id="ig-s" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#feda75"/><stop offset="50%" stopColor="#d62976"/><stop offset="100%" stopColor="#4f5bd5"/></linearGradient></defs><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8z"/></svg>,
  facebook: <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>,
  linkedin: <svg width="14" height="14" viewBox="0 0 24 24" fill="#0077B5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>,
};

const platformColors: Record<string, string> = {
  instagram: "bg-gradient-to-r from-amber-500/20 via-pink-500/20 to-purple-500/20 border-pink-500/30",
  facebook: "bg-blue-600/20 border-blue-600/30",
  linkedin: "bg-sky-600/20 border-sky-600/30",
};

export function SocialPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [accounts, setAccounts] = useState<Array<{ id: string; platform: string; name: string; icon: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [publishText, setPublishText] = useState("");
  const [publishImage, setPublishImage] = useState<File | null>(null);
  const [publishTargets, setPublishTargets] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<Array<{ platform: string; success: boolean; error?: string }> | null>(null);
  const fileInputRef = { current: null as HTMLInputElement | null };

  
  const resizeForIG = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = Math.min(img.width, img.height, 1080);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
        canvas.toBlob((blob) => resolve(blob!), "image/jpeg", 0.9);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const handlePublish = async () => {
    if (!selectedCompany?.id || !publishText.trim()) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const fd = new FormData();
      fd.append("companyId", selectedCompany.id);
      fd.append("text", publishText);
      fd.append("platforms", JSON.stringify(Array.from(publishTargets)));
      if (publishImage) {
        // If Instagram targets, resize to square
        const hasIG = Array.from(publishTargets).some((t) => t.startsWith("ig_"));
        const isImage = publishImage.type.startsWith("image/");
        if (hasIG && isImage) {
          const resized = await resizeForIG(publishImage);
          fd.append("image", resized, "post.jpg");
        } else {
          fd.append("image", publishImage);
        }
      }
      const res = await fetch("/api/social/publish", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) {
        const errText = await res.text();
        setPublishResult([{ platform: "server", success: false, error: res.status + ": " + errText }]);
        setPublishing(false);
        return;
      }
      const data = await res.json();
      setPublishResult(data.results || []);
      if (data.results?.every((r: any) => r.success)) {
        setTimeout(() => { setShowPublish(false); setPublishText(""); setPublishImage(null); setPublishTargets(new Set()); setPublishResult(null); fetchPosts(); }, 2000);
      }
    } catch (err: any) { setPublishResult([{ platform: "all", success: false, error: err?.message || "Errore di connessione" }]); }
    setPublishing(false);
  };

  const toggleTarget = (id: string) => {
    setPublishTargets((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  useEffect(() => { setBreadcrumbs([{ label: "Social" }]); }, [setBreadcrumbs]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetch("/api/oauth/meta/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const accs: Array<{ id: string; platform: string; name: string; icon: string }> = [];
        if (d.instagram) {
          for (const ig of d.instagram) {
            accs.push({ id: "ig_" + ig.username, platform: "instagram", name: "@" + ig.username, icon: "instagram" });
          }
        }
        if (d.pages) {
          for (const p of d.pages) {
            accs.push({ id: "fb_" + p.id, platform: "facebook", name: p.name, icon: "facebook" });
          }
        }
        setAccounts(accs);
      })
      .catch(() => {});
    fetch("/api/oauth/linkedin/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.connected) {
          setAccounts((prev) => [...prev, { id: "li_" + d.name, platform: "linkedin", name: d.name, icon: "linkedin" }]);
        }
      })
      .catch(() => {});
  }, [selectedCompany?.id]);

  const fetchPosts = async () => {
    if (!selectedCompany?.id) return;
    try {
      const res = await fetch("/api/social/posts?companyId=" + selectedCompany.id + (filter !== "all" ? "&platform=" + filter : ""), { credentials: "include" });
      const data = await res.json();
      if (!res.ok) { setError(data.error); } else { setPosts(data.posts || []); }
    } catch { setError("Errore connessione"); }
    setLoading(false);
  };

  useEffect(() => { fetchPosts(); }, [selectedCompany?.id, filter]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (!selectedCompany?.id) return;
    const interval = setInterval(() => fetchPosts(), 60000);
    return () => clearInterval(interval);
  }, [selectedCompany?.id, filter]);

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  const filtered = filter === "all" ? posts : posts.filter((p) => {
    if (filter.startsWith("ig_")) return p.platform === "instagram" && p.accountName === filter.replace("ig_", "");
    if (filter.startsWith("fb_")) return p.platform === "facebook" && p.accountName === filter.replace("fb_", "");
    if (filter.startsWith("li_")) return p.platform === "linkedin";
    return p.platform === filter;
  });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Caricamento post...</div>;
  if (error && !posts.length) return (
    <div className="p-6"><div className="glass-card p-6 text-center space-y-3">
      <Share2 className="w-10 h-10 mx-auto text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{error}</p>
      <a href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"} className="text-sm text-blue-400 hover:underline">Collega i social da Plugin</a>
    </div></div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Share2 className="w-5 h-5" />
          <h1 className="text-xl font-semibold">Social</h1>
        </div>
        <button onClick={() => setShowPublish(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" }}>
          <Plus className="w-3.5 h-3.5" /> Crea post
        </button>
      </div>

      {/* Account filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={"px-3 py-1.5 rounded-lg text-xs font-medium transition-all " + (filter === "all" ? "text-white" : "text-muted-foreground")}
          style={filter === "all" ? { background: "linear-gradient(135deg, hsl(158 64% 42% / 0.2), hsl(158 64% 42% / 0.1))", border: "1px solid hsl(158 64% 42% / 0.3)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          Tutti
        </button>
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setFilter(acc.id)}
            className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all " + (filter === acc.id ? "text-white" : "text-muted-foreground")}
            style={filter === acc.id ? { background: "linear-gradient(135deg, hsl(158 64% 42% / 0.2), hsl(158 64% 42% / 0.1))", border: "1px solid hsl(158 64% 42% / 0.3)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {platformIcons[acc.icon]}
            <span>{acc.name}</span>
          </button>
        ))}
      </div>


      {/* Publish modal */}
      {showPublish && (
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Crea nuovo post</h3>
            <button onClick={() => { setShowPublish(false); setPublishResult(null); }}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <textarea
            value={publishText}
            onChange={(e) => setPublishText(e.target.value)}
            placeholder="Scrivi il testo del post..."
            rows={3}
            className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <div className="flex items-center gap-2">
            <input type="file" ref={(el) => { fileInputRef.current = el; }} className="hidden" accept="image/*,video/*" onChange={(e) => { setPublishImage(e.target.files?.[0] || null); }} />
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <ImageIcon className="w-3.5 h-3.5" /> {publishImage ? publishImage.name : "Aggiungi media"}
            </button>
            {publishImage && <button onClick={() => setPublishImage(null)} className="text-xs text-red-400">Rimuovi</button>}
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">Pubblica su:</div>
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => toggleTarget(acc.id)}
                  className={"flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all " + (publishTargets.has(acc.id) ? "text-white ring-1 ring-green-500" : "text-muted-foreground")}
                  style={publishTargets.has(acc.id) ? { background: "rgba(34, 197, 94, 0.15)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {platformIcons[acc.icon]} {acc.name}
                </button>
              ))}
            </div>
          </div>
          {publishResult && (
            <div className="space-y-1">
              {publishResult.map((r, i) => (
                <div key={i} className={"text-xs px-2 py-1 rounded " + (r.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                  {r.platform}: {r.success ? "Pubblicato!" : r.error || "Errore"}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={handlePublish}
            disabled={publishing || !publishText.trim() || publishTargets.size === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-30"
            style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" }}
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            {publishing ? "Pubblicazione..." : "Pubblica"}
          </button>
        </div>
      )}

      {/* Posts grid */}
      {filtered.length === 0 ? (
        <div className="glass-card p-6 text-center text-sm text-muted-foreground">Nessun post trovato. Collega i social da Plugin e pubblica contenuti.</div>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((post) => (
            <div key={post.id} className="glass-card overflow-hidden">
              {/* Media */}
              {post.mediaUrl && (
                <div className="relative aspect-[4/3] bg-black/20">
                  {post.type === "video" ? (
                    <video src={post.mediaUrl} className="w-full h-full object-cover" controls />
                  ) : (
                    <img src={post.thumbnailUrl || post.mediaUrl} alt="" className="w-full h-full object-cover" />
                  )}
                  {/* Platform badge */}
                  <div className={"absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1 " + platformColors[post.platform]}>
                    {platformIcons[post.platform]}
                    <span className="capitalize">{post.platform}</span>
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="p-2.5 space-y-1.5">
                {!post.mediaUrl && (
                  <div className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border " + platformColors[post.platform]}>
                    {platformIcons[post.platform]}
                    <span className="capitalize">{post.platform}</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{post.accountName}</div>
                {post.text && <p className="text-xs line-clamp-2">{post.text}</p>}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{formatDate(post.timestamp)}</span>
                  <div className="flex items-center gap-3">
                    {post.likes !== undefined && <span>{post.likes} ❤️</span>}
                    {post.comments !== undefined && <span>{post.comments} 💬</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  {post.mediaUrl && (
                    <a href={post.mediaUrl} download target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-muted-foreground hover:text-foreground transition-all" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <Download className="w-3 h-3" /> Scarica
                    </a>
                  )}
                  {post.permalink && (
                    <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-muted-foreground hover:text-foreground transition-all no-underline" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <ExternalLink className="w-3 h-3" /> Apri
                    </a>
                  )}
                  {post.permalink && (
                    <button onClick={() => { navigator.clipboard.writeText(post.permalink || ""); }} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-muted-foreground hover:text-foreground transition-all" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <Share2 className="w-3 h-3" /> Condividi
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

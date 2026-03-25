import { useState, useEffect, useRef, useCallback } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  Sparkles, Image, Video, Upload, Loader2, Download, Trash2,
  ChevronDown, ChevronUp, X, Share2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────
type MainTab = "images" | "video";
type ImageSubTab = "text-to-image" | "image-edit";

type VideoModel = "veo" | "kling" | "seedance";
type VeoMode = "text-to-video" | "img-to-video" | "frame-to-video" | "extend-video" | "ref-to-video";
type SimpleMode = "text-to-video" | "img-to-video";

interface ActiveJob {
  id: string;
  modelKey: string;
  requestId: string;
  companyId: string;
  type: "image" | "video";
  status: "pending" | "polling" | "done" | "failed";
}

interface ResultItem {
  id: string;
  url: string;
  type: "image" | "video";
}

// ── Model key mapping ──────────────────────────────────────────────
function getModelKey(tab: MainTab, imageSubTab: ImageSubTab, videoModel: VideoModel, videoMode: string): string {
  if (tab === "images") {
    return imageSubTab === "text-to-image" ? "nano-banana-2" : "nano-banana-2-edit";
  }
  const map: Record<string, string> = {
    "veo:text-to-video": "veo31-text",
    "veo:img-to-video": "veo31-img2vid",
    "veo:extend-video": "veo31-extend",
    "veo:frame-to-video": "veo31-frames",
    "veo:ref-to-video": "veo31-ref",
    "kling:text-to-video": "kling-text",
    "kling:img-to-video": "kling-img2vid",
    "seedance:text-to-video": "seedance-text",
    "seedance:img-to-video": "seedance-img2vid",
  };
  return map[`${videoModel}:${videoMode}`] || "veo31-text";
}

// ── Helpers ────────────────────────────────────────────────────────
const glassCard = "rounded-2xl border backdrop-blur-xl";
const glassBg = { background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.1)" };
const inputStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" };
const greenGradient = { background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" };
const greenShadow = { ...greenGradient, boxShadow: "0 4px 20px hsla(158,64%,42%,0.35)" };

function PillTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  active: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl p-1" style={{ background: "rgba(255,255,255,0.06)" }}>
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={
            "px-4 py-1.5 rounded-lg text-sm font-medium transition-all " +
            (active === t.value ? "text-white shadow-lg" : "text-muted-foreground hover:text-white/70")
          }
          style={active === t.value ? greenGradient : undefined}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-xl text-xs outline-none cursor-pointer text-white appearance-none pr-7"
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "#1a1a2e" }}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function UploadZone({
  file,
  onFile,
  onClear,
  accept,
  label,
}: {
  file: File | null;
  onFile: (f: File) => void;
  onClear: () => void;
  accept: string;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={
        "relative rounded-xl border-2 border-dashed transition-all p-6 text-center cursor-pointer " +
        (dragOver ? "border-green-500/60 bg-green-500/5" : "border-white/10 hover:border-white/20")
      }
      onClick={() => !file && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {file ? (
        <div className="flex items-center justify-center gap-2">
          <span className="text-sm text-white truncate max-w-[200px]">{file.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="p-1 rounded-lg hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <Upload className="w-6 h-6 mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        className={"relative w-9 h-5 rounded-full transition-colors " + (checked ? "bg-green-600" : "bg-white/15")}
        onClick={() => onChange(!checked)}
      >
        <div
          className={
            "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform " +
            (checked ? "translate-x-4" : "translate-x-0.5")
          }
        />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </label>
  );
}

// ── Main Component ─────────────────────────────────────────────────
export function GenerateAI() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  // Connection
  const [connected, setConnected] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);

  // Tabs
  const [mainTab, setMainTab] = useState<MainTab>("images");
  const [imageSubTab, setImageSubTab] = useState<ImageSubTab>("text-to-image");
  const [videoModel, setVideoModel] = useState<VideoModel>("veo");
  const [veoMode, setVeoMode] = useState<VeoMode>("text-to-video");
  const [klingMode, setKlingMode] = useState<SimpleMode>("text-to-video");
  const [seedanceMode, setSeedanceMode] = useState<SimpleMode>("text-to-video");

  // Generation params
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [showNegPrompt, setShowNegPrompt] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("1K");
  const [outputFormat, setOutputFormat] = useState("png");
  const [numImages, setNumImages] = useState(1);
  const [duration, setDuration] = useState("8s");
  const [generateAudio, setGenerateAudio] = useState(true);

  // File uploads
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [lastFrameFile, setLastFrameFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);

  // Generation state
  const [generatingImage, setGeneratingImage] = useState(() => {
    try { return JSON.parse(localStorage.getItem("goitalia_gen_jobs") || "[]").some((j: any) => (j.status === "pending" || j.status === "polling") && j.type === "image"); } catch { return false; }
  });
  const [generatingVideo, setGeneratingVideo] = useState(() => {
    try { return JSON.parse(localStorage.getItem("goitalia_gen_jobs") || "[]").some((j: any) => (j.status === "pending" || j.status === "polling") && j.type === "video"); } catch { return false; }
  });
  const [imageProgress, setImageProgress] = useState("");
  const [videoProgress, setVideoProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("goitalia_gen_results") || "[]"); } catch { return []; }
  });
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>(() => {
    try { return JSON.parse(localStorage.getItem("goitalia_gen_jobs") || "[]").filter((j: any) => j.status !== "done"); } catch { return []; }
  });
  const [publishingResult, setPublishingResult] = useState<ResultItem | null>(null);
  const [publishText, setPublishText] = useState("");
  const [publishTargets, setPublishTargets] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<Array<{ platform: string; success: boolean; error?: string }> | null>(null);
  const [socialAccounts, setSocialAccounts] = useState<Array<{ id: string; platform: string; name: string; icon: string }>>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist results to localStorage
  useEffect(() => {
    localStorage.setItem("goitalia_gen_results", JSON.stringify(results.slice(0, 50)));
  }, [results]);

  // Persist active jobs
  useEffect(() => {
    localStorage.setItem("goitalia_gen_jobs", JSON.stringify(activeJobs));
  }, [activeJobs]);

  // Fetch social accounts for publish
  useEffect(() => {
    if (!selectedCompany?.id) return;
    const accs: Array<{ id: string; platform: string; name: string; icon: string }> = [];
    fetch("/api/oauth/meta/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.instagram) d.instagram.forEach((ig: any) => accs.push({ id: "ig_" + ig.username, platform: "instagram", name: "@" + ig.username, icon: "instagram" }));
        if (d.pages) d.pages.forEach((p: any) => accs.push({ id: "fb_" + p.id, platform: "facebook", name: p.name, icon: "facebook" }));
        setSocialAccounts((prev) => [...prev.filter((a) => a.platform !== "instagram" && a.platform !== "facebook"), ...accs]);
      }).catch(() => {});
    fetch("/api/oauth/linkedin/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.connected) setSocialAccounts((prev) => [...prev.filter((a) => a.platform !== "linkedin"), { id: "li_" + d.name, platform: "linkedin", name: d.name, icon: "linkedin" }]); })
      .catch(() => {});
  }, [selectedCompany?.id]);

  // Resume polling for active jobs on mount
  useEffect(() => {
    if (!selectedCompany?.id || activeJobs.length === 0) return;
    activeJobs.forEach((job) => {
      if (job.status === "pending" || job.status === "polling") {
        pollJob(job);
      }
    });
  }, [selectedCompany?.id]);

  const pollJob = useCallback((job: ActiveJob) => {
    setActiveJobs((prev) => prev.map((j: ActiveJob) => j.id === job.id ? { ...j, status: "polling" } : j));
    const interval = setInterval(async () => {
      try {
        const sr = await fetch("/api/fal/status/" + job.modelKey + "/" + job.requestId + "?companyId=" + job.companyId, { credentials: "include" });
        const status = await sr.json();
        if (status.status === "COMPLETED") {
          clearInterval(interval);
          const rr = await fetch("/api/fal/result/" + job.modelKey + "/" + job.requestId + "?companyId=" + job.companyId, { credentials: "include" });
          const res = await rr.json();
          const newResults: ResultItem[] = [];
          if (res.images) res.images.forEach((img: any) => newResults.push({ id: crypto.randomUUID(), url: img.url, type: "image" }));
          if (res.video) newResults.push({ id: crypto.randomUUID(), url: res.video.url, type: "video" });
          setResults((prev) => [...newResults, ...prev]);
          setActiveJobs((prev) => prev.map((j: ActiveJob) => j.id === job.id ? { ...j, status: "done" } : j));
          mainTab === "images" ? setGeneratingImage(false) : setGeneratingVideo(false);
          setImageProgress(""); setVideoProgress("");
        } else if (status.status === "FAILED") {
          clearInterval(interval);
          setActiveJobs((prev) => prev.map((j: ActiveJob) => j.id === job.id ? { ...j, status: "failed" } : j));
          mainTab === "images" ? setGeneratingImage(false) : setGeneratingVideo(false);
        }
      } catch {}
    }, 3000);
  }, []);

  useEffect(() => {
    setBreadcrumbs([{ label: "Genera Contenuti" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    setCheckingConnection(true);
    fetch("/api/fal/status?companyId=" + selectedCompany.id, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setConnected(d.connected))
      .catch(() => setConnected(false))
      .finally(() => setCheckingConnection(false));
  }, [selectedCompany?.id]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Computed ──
  const currentVideoMode = videoModel === "veo" ? veoMode : videoModel === "kling" ? klingMode : seedanceMode;
  const modelKey = getModelKey(mainTab, imageSubTab, videoModel, currentVideoMode);
  const isVideo = mainTab === "video";
  const needsImage =
    (mainTab === "images" && imageSubTab === "image-edit") ||
    (isVideo && ["img-to-video", "frame-to-video", "ref-to-video"].includes(currentVideoMode));
  const needsVideo = isVideo && currentVideoMode === "extend-video";

  // ── Aspect ratio options per context ──
  const imageAspectRatios = [
    { value: "auto", label: "Auto" },
    { value: "1:1", label: "1:1" },
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
    { value: "4:3", label: "4:3" },
    { value: "3:2", label: "3:2" },
    { value: "21:9", label: "21:9" },
  ];

  const videoAspectRatios = [
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
    { value: "1:1", label: "1:1" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
    { value: "3:2", label: "3:2" },
  ];

  // ── Duration options per model ──
  function getDurationOptions(): { value: string; label: string }[] {
    if (videoModel === "veo") {
      return [
        { value: "4s", label: "4s" },
        { value: "6s", label: "6s" },
        { value: "8s", label: "8s" },
      ];
    }
    const max = videoModel === "kling" ? 15 : 12;
    return Array.from({ length: max - 2 }, (_, i) => ({
      value: String(i + 3),
      label: `${i + 3}s`,
    }));
  }

  // ── Resolution options ──
  function getResolutionOptions(): { value: string; label: string }[] {
    if (!isVideo) {
      return [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ];
    }
    const opts = [
      { value: "720p", label: "720p" },
      { value: "1080p", label: "1080p" },
    ];
    if (videoModel === "veo") opts.push({ value: "4k", label: "4K" });
    return opts;
  }

  // ── Generate ──
  const generate = useCallback(async () => {
    if (!selectedCompany?.id || !prompt.trim()) return;
    mainTab === "images" ? setGeneratingImage(true) : setGeneratingVideo(true);
    setError(null);
    mainTab === "images" ? setImageProgress("Invio richiesta...") : setVideoProgress("Invio richiesta...");

    try {
      const fd = new FormData();
      fd.append("companyId", selectedCompany.id);
      fd.append("model", modelKey);
      fd.append("prompt", prompt);
      fd.append("aspect_ratio", aspectRatio);

      if (isVideo) {
        fd.append("duration", duration);
        fd.append("resolution", resolution);
        fd.append("generate_audio", String(generateAudio));
        if (negativePrompt.trim()) fd.append("negative_prompt", negativePrompt);
      } else {
        fd.append("output_format", outputFormat);
        fd.append("resolution", resolution);
        fd.append("num_images", String(numImages));
      }

      if (imageFile) fd.append("image", imageFile);
      if (lastFrameFile && currentVideoMode === "frame-to-video") {
        // Upload last frame separately - for now pass as URL after first upload
        // The backend handles first_frame_url from the uploaded file
        // For last frame we need to upload it to fal CDN separately
        fd.append("last_frame_file", lastFrameFile);
      }
      if (videoFile) fd.append("image", videoFile); // backend handles as file upload

      const r = await fetch("/api/fal/generate", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Errore generazione");
        mainTab === "images" ? setGeneratingImage(false) : setGeneratingVideo(false);
        setImageProgress(""); setVideoProgress("");
        return;
      }

      const { requestId } = data;
      // Create background job
      const job: ActiveJob = { id: crypto.randomUUID(), modelKey, requestId, companyId: selectedCompany!.id, type: mainTab === "images" ? "image" : "video", status: "pending" };
      setActiveJobs((prev) => [job, ...prev]);
      mainTab === "images" ? setImageProgress("Generazione in corso...") : setVideoProgress("Generazione in corso...");
      pollJob(job);
      // Keep old polling for progress display only
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const sr = await fetch(`/api/fal/status/${modelKey}/${requestId}?companyId=${selectedCompany!.id}`, { credentials: "include" });
          const status = await sr.json();
          if (status.status === "COMPLETED" || status.status === "FAILED") {
            if (pollRef.current) clearInterval(pollRef.current);
          } else if (status.status === "IN_PROGRESS") {
            mainTab === "images" ? setImageProgress("Generazione in corso...") : setVideoProgress("Generazione in corso...");
          } else {
            
            mainTab === "images" ? setImageProgress("In coda...") : setVideoProgress("In coda...");
          }

          if (attempts > 300) {
            if (pollRef.current) clearInterval(pollRef.current);
            setError("Timeout — la generazione sta impiegando troppo tempo");
            mainTab === "images" ? setGeneratingImage(false) : setGeneratingVideo(false);
            setImageProgress(""); setVideoProgress("");
          }
        } catch {
          // ignore poll errors, retry
        }
      }, 3000);
    } catch {
      setError("Errore di connessione");
      mainTab === "images" ? setGeneratingImage(false) : setGeneratingVideo(false);
      setImageProgress(""); setVideoProgress("");
    }
  }, [
    selectedCompany, prompt, modelKey, aspectRatio, duration, resolution,
    generateAudio, negativePrompt, outputFormat, numImages, imageFile,
    videoFile, isVideo,
  ]);

  const deleteResult = (id: string) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  const downloadResult = async (url: string, type: "image" | "video") => {
    try {
      const r = await fetch(url);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `goitalia-${type}-${Date.now()}.${type === "image" ? "png" : "mp4"}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  // ── Not Connected ──
  if (checkingConnection) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto pt-12">
        <div className="flex items-center gap-3 justify-center">
          <Sparkles className="w-6 h-6 text-green-500" />
          <h1 className="text-2xl font-bold">Genera AI</h1>
        </div>
        <div className={glassCard + " p-8 text-center space-y-4"} style={glassBg}>
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
            <Sparkles className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Connetti fal.ai</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Per generare immagini e video con AI, collega il tuo account fal.ai dalla sezione Connettori.
          </p>
          <a
            href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"}
            className="inline-block px-6 py-2.5 rounded-xl text-sm font-medium text-white no-underline transition-all hover:scale-105"
            style={greenShadow}
          >
            Vai ai Connettori
          </a>
        </div>
      </div>
    );
  }

  // ── Connected: Main UI ──
  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ background: "rgba(34,197,94,0.15)" }}>
            <Sparkles className="w-5 h-5 text-green-500" />
          </div>
          <h1 className="text-xl font-bold">Genera AI</h1>
        </div>
      </div>

      {/* Main Tabs */}
      <PillTabs
        tabs={[
          { value: "images" as MainTab, label: "Genera Immagini" },
          { value: "video" as MainTab, label: "Genera Video" },
        ]}
        active={mainTab}
        onChange={setMainTab}
      />

      {/* ─── IMAGES TAB ─── */}
      {mainTab === "images" && (
        <div className="space-y-5">
          {/* Sub-tabs */}
          <PillTabs
            tabs={[
              { value: "text-to-image" as ImageSubTab, label: "Testo \u2192 Immagine" },
              { value: "image-edit" as ImageSubTab, label: "Modifica Immagine" },
            ]}
            active={imageSubTab}
            onChange={setImageSubTab}
          />

          <div className={glassCard + " p-5 space-y-5"} style={glassBg}>
            {/* Upload zone for image edit */}
            {imageSubTab === "image-edit" && (
              <UploadZone
                file={imageFile}
                onFile={setImageFile}
                onClear={() => setImageFile(null)}
                accept="image/*"
                label="Trascina o clicca per caricare l'immagine da modificare"
              />
            )}

            {/* Prompt */}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                imageSubTab === "text-to-image"
                  ? "Descrivi l'immagine che vuoi generare..."
                  : "Descrivi le modifiche da applicare..."
              }
              rows={3}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none text-white placeholder:text-white/30"
              style={inputStyle}
            />

            {/* Parameters row */}
            <div className="flex flex-wrap gap-3 items-end">
              <Select
                label="Aspect Ratio"
                value={aspectRatio}
                onChange={setAspectRatio}
                options={imageAspectRatios}
              />
              <Select
                label="Risoluzione"
                value={resolution}
                onChange={setResolution}
                options={getResolutionOptions()}
              />
              <Select
                label="Formato"
                value={outputFormat}
                onChange={setOutputFormat}
                options={[
                  { value: "png", label: "PNG" },
                  { value: "jpeg", label: "JPEG" },
                  { value: "webp", label: "WebP" },
                ]}
              />
            </div>

            {/* Number of images */}
            <div className="space-y-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Numero immagini
              </span>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setNumImages(n)}
                    className={
                      "w-10 h-10 rounded-xl text-sm font-medium transition-all " +
                      (numImages === n ? "text-white shadow-lg" : "text-muted-foreground hover:text-white/70")
                    }
                    style={numImages === n ? greenGradient : inputStyle}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={generate}
              disabled={(mainTab === "images" ? generatingImage : generatingVideo) || !prompt.trim()}
              className="flex items-center gap-2.5 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-30 hover:scale-[1.02] active:scale-[0.98]"
              style={greenShadow}
            >
              {(mainTab === "images" ? generatingImage : generatingVideo) ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {(mainTab === "images" ? generatingImage : generatingVideo) ? (mainTab === "images" ? imageProgress : videoProgress) || "Generazione..." : "Genera"}
            </button>

            {error && (
              <div className="rounded-xl px-4 py-3 text-sm text-red-400 border border-red-500/20" style={{ background: "rgba(239,68,68,0.08)" }}>
                {error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── VIDEO TAB ─── */}
      {mainTab === "video" && (
        <div className="space-y-5">
          {/* Model selector */}
          <Select
            label="Modello"
            value={videoModel}
            onChange={(v) => {
              setVideoModel(v as VideoModel);
              if (v === "kling") setKlingMode("text-to-video");
              if (v === "seedance") setSeedanceMode("text-to-video");
              if (v === "veo") setVeoMode("text-to-video");
            }}
            options={[
              { value: "veo", label: "Veo 3.1 Fast" },
              { value: "kling", label: "Kling v3 Pro" },
              { value: "seedance", label: "Seedance 1.5 Pro" },
            ]}
          />

          {/* Mode tabs per model */}
          {videoModel === "veo" && (
            <PillTabs
              tabs={[
                { value: "text-to-video" as VeoMode, label: "Testo\u2192Video" },
                { value: "img-to-video" as VeoMode, label: "Img\u2192Video" },
                { value: "frame-to-video" as VeoMode, label: "First & Last Frame" },
                { value: "extend-video" as VeoMode, label: "Estendi" },
                { value: "ref-to-video" as VeoMode, label: "Riferimento" },
              ]}
              active={veoMode}
              onChange={setVeoMode}
            />
          )}
          {videoModel === "kling" && (
            <PillTabs
              tabs={[
                { value: "text-to-video" as SimpleMode, label: "Testo\u2192Video" },
                { value: "img-to-video" as SimpleMode, label: "Img\u2192Video" },
              ]}
              active={klingMode}
              onChange={setKlingMode}
            />
          )}
          {videoModel === "seedance" && (
            <PillTabs
              tabs={[
                { value: "text-to-video" as SimpleMode, label: "Testo\u2192Video" },
                { value: "img-to-video" as SimpleMode, label: "Img\u2192Video" },
              ]}
              active={seedanceMode}
              onChange={setSeedanceMode}
            />
          )}

          <div className={glassCard + " p-5 space-y-5"} style={glassBg}>
            {/* Image upload for img-to-video, reference modes */}
            {needsImage && currentVideoMode !== "frame-to-video" && (
              <UploadZone
                file={imageFile}
                onFile={setImageFile}
                onClear={() => setImageFile(null)}
                accept="image/*"
                label={
                  currentVideoMode === "ref-to-video"
                    ? "Carica immagine di riferimento"
                    : "Carica immagine sorgente"
                }
              />
            )}

            {/* First & Last Frame - two upload zones side by side */}
            {currentVideoMode === "frame-to-video" && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1.5">Primo Frame</div>
                  <UploadZone
                    file={imageFile}
                    onFile={setImageFile}
                    onClear={() => setImageFile(null)}
                    accept="image/*"
                    label="First"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1.5">Ultimo Frame</div>
                  <UploadZone
                    file={lastFrameFile}
                    onFile={setLastFrameFile}
                    onClear={() => setLastFrameFile(null)}
                    accept="image/*"
                    label="Last"
                  />
                </div>
              </div>
            )}

            {/* Video upload for extend mode */}
            {needsVideo && (
              <UploadZone
                file={videoFile}
                onFile={setVideoFile}
                onClear={() => setVideoFile(null)}
                accept="video/*"
                label="Carica il video da estendere"
              />
            )}

            {/* Prompt */}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Descrivi il video che vuoi generare..."
              rows={3}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none text-white placeholder:text-white/30"
              style={inputStyle}
            />

            {/* Parameters */}
            <div className="flex flex-wrap gap-3 items-end">
              <Select
                label="Aspect Ratio"
                value={aspectRatio}
                onChange={setAspectRatio}
                options={videoAspectRatios}
              />
              <Select
                label="Durata"
                value={duration}
                onChange={setDuration}
                options={getDurationOptions()}
              />
              <Select
                label="Risoluzione"
                value={resolution}
                onChange={setResolution}
                options={getResolutionOptions()}
              />
              <div className="flex flex-col gap-1 justify-end pb-0.5">
                <ToggleSwitch
                  checked={generateAudio}
                  onChange={setGenerateAudio}
                  label="Audio"
                />
              </div>
            </div>

            {/* Negative prompt (collapsible) */}
            <div>
              <button
                onClick={() => setShowNegPrompt(!showNegPrompt)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white/70 transition-colors"
              >
                {showNegPrompt ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Prompt negativo
              </button>
              {showNegPrompt && (
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="Cosa NON vuoi nel video..."
                  rows={2}
                  className="w-full mt-2 rounded-xl px-4 py-3 text-sm outline-none resize-none text-white placeholder:text-white/30"
                  style={inputStyle}
                />
              )}
            </div>

            {/* Generate button */}
            <button
              onClick={generate}
              disabled={generatingVideo || !prompt.trim()}
              className="flex items-center gap-2.5 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-30 hover:scale-[1.02] active:scale-[0.98]"
              style={greenShadow}
            >
              {generatingVideo ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {generatingVideo ? videoProgress || "Generazione..." : "Genera"}
            </button>

            {error && (
              <div className="rounded-xl px-4 py-3 text-sm text-red-400 border border-red-500/20" style={{ background: "rgba(239,68,68,0.08)" }}>
                {error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── RESULTS GALLERY ─── */}
      {(results.length > 0 || generatingImage || generatingVideo) && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Risultati
          </h2>

          {/* Image results grid */}
          {results.some((r) => r.type === "image") && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {generatingImage && !isVideo && (
                <div
                  className="aspect-square rounded-xl flex items-center justify-center border border-white/10"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <div className="text-center space-y-2">
                    <Loader2 className="w-6 h-6 animate-spin text-green-500 mx-auto" />
                    <p className="text-[10px] text-muted-foreground">Generazione...</p>
                  </div>
                </div>
              )}
              {results
                .filter((r) => r.type === "image")
                .map((r) => (
                  <div key={r.id} className="group relative aspect-square rounded-xl overflow-hidden">
                    <img
                      src={r.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <button
                        onClick={() => downloadResult(r.url, "image")}
                        className="p-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors"
                        title="Scarica"
                      >
                        <Download className="w-4 h-4 text-white" />
                      </button>
                      {socialAccounts.length > 0 && (
                        <button
                          onClick={() => { setPublishingResult(r); setPublishText(""); setPublishTargets(new Set()); setPublishResult(null); }}
                          className="p-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors"
                          title="Pubblica sui social"
                        >
                          <Share2 className="w-4 h-4 text-white" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteResult(r.id)}
                        className="p-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/40 transition-colors"
                        title="Elimina"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Video results grid */}
          {results.some((r) => r.type === "video") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {generatingVideo && isVideo && (
                <div
                  className="aspect-video rounded-xl flex items-center justify-center border border-white/10"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <div className="text-center space-y-2">
                    <Loader2 className="w-8 h-8 animate-spin text-green-500 mx-auto" />
                    <p className="text-xs text-muted-foreground">{imageProgress || "Generazione..."}</p>
                  </div>
                </div>
              )}
              {results
                .filter((r) => r.type === "video")
                .map((r) => (
                  <div key={r.id} className="space-y-2">
                    <div className="rounded-xl overflow-hidden border border-white/10">
                      <video src={r.url} controls className="w-full" />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => downloadResult(r.url, "video")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white hover:bg-white/10 transition-colors"
                        style={inputStyle}
                      >
                        <Download className="w-3.5 h-3.5" /> Scarica
                      </button>
                      <button
                        onClick={() => deleteResult(r.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                        style={inputStyle}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Elimina
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Loading placeholder when no results yet */}
          {(generatingImage || generatingVideo) && results.length === 0 && (
            <div
              className={
                (isVideo ? "aspect-video max-w-lg" : "aspect-square max-w-[200px]") +
                " rounded-xl flex items-center justify-center border border-white/10"
              }
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <div className="text-center space-y-2">
                <Loader2 className="w-8 h-8 animate-spin text-green-500 mx-auto" />
                <p className="text-xs text-muted-foreground">{videoProgress || "Generazione..."}</p>
              </div>
            </div>
          )}
        </div>
      )}


            {/* Publish modal */}
      {publishingResult && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setPublishingResult(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative max-w-md w-full mx-4 p-5 space-y-3 rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ background: "linear-gradient(135deg, rgba(20,30,40,0.98), rgba(15,25,35,0.98))", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Pubblica immagine</h3>
              <button onClick={() => setPublishingResult(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <img src={publishingResult.url} alt="" className="w-full rounded-xl max-h-48 object-cover" />
            <textarea value={publishText} onChange={(e) => setPublishText(e.target.value)} placeholder="Testo del post (opzionale)..." rows={2} className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none" style={inputStyle} />
            <div className="text-xs text-muted-foreground">Pubblica su:</div>
            <div className="flex flex-wrap gap-1.5">
              {socialAccounts.map((acc) => (
                <button key={acc.id} onClick={() => { const n = new Set(publishTargets); if (n.has(acc.id)) n.delete(acc.id); else n.add(acc.id); setPublishTargets(n); }} className={"flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all " + (publishTargets.has(acc.id) ? "text-white ring-1 ring-green-500" : "text-muted-foreground")} style={publishTargets.has(acc.id) ? { background: "rgba(34,197,94,0.15)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {acc.platform === "instagram" && <svg width="14" height="14" viewBox="0 0 24 24" fill="url(#ig-pub)"><defs><linearGradient id="ig-pub" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#feda75"/><stop offset="50%" stopColor="#d62976"/><stop offset="100%" stopColor="#4f5bd5"/></linearGradient></defs><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8z"/></svg>}
                  {acc.platform === "facebook" && <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>}
                  {acc.platform === "linkedin" && <svg width="14" height="14" viewBox="0 0 24 24" fill="#0077B5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>}
                  {acc.name}
                </button>
              ))}
            </div>
            {publishResult && publishResult.map((r: any, i: number) => (
              <div key={i} className={"text-xs px-2 py-1 rounded " + (r.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                {r.platform}: {r.success ? "Pubblicato!" : r.error || "Errore"}
              </div>
            ))}
            <button onClick={async () => {
              if (!selectedCompany?.id || publishTargets.size === 0) return;
              setPublishing(true);
              try {
                const imgRes = await fetch(publishingResult.url);
                const imgBlob = await imgRes.blob();
                const fd = new FormData();
                fd.append("companyId", selectedCompany.id);
                fd.append("text", publishText);
                fd.append("platforms", JSON.stringify(Array.from(publishTargets)));
                fd.append("image", imgBlob, "generated.jpg");
                const res = await fetch("/api/social/publish", { method: "POST", credentials: "include", body: fd });
                const data = await res.json();
                setPublishResult(data.results || []);
                if (data.results?.every((r: any) => r.success)) setTimeout(() => setPublishingResult(null), 2000);
              } catch { setPublishResult([{ platform: "all", success: false, error: "Errore" }]); }
              setPublishing(false);
            }} disabled={publishing || publishTargets.size === 0} className="w-full py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-30" style={greenShadow}>
              {publishing ? "Pubblicazione..." : "Pubblica"}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
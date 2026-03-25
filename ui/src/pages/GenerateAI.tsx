import { useState, useEffect, useRef } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Sparkles, Image, Video, Upload, Loader2, Download, Play, ChevronDown } from "lucide-react";

interface FalModel { key: string; id: string; name: string; type: string; description: string; }

export function GenerateAI() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [models, setModels] = useState<FalModel[]>([]);
  const [connected, setConnected] = useState(false);
  const [selectedModel, setSelectedModel] = useState<FalModel | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  // Options
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState("8s");
  const [resolution, setResolution] = useState("720p");
  const [outputFormat, setOutputFormat] = useState("png");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  useEffect(() => { setBreadcrumbs([{ label: "Genera AI" }]); }, [setBreadcrumbs]);

  useEffect(() => {
    fetch("/api/fal/models").then(r => r.json()).then(d => setModels(d.models || [])).catch(() => {});
    if (selectedCompany?.id) {
      fetch("/api/fal/status?companyId=" + selectedCompany.id, { credentials: "include" })
        .then(r => r.json()).then(d => setConnected(d.connected)).catch(() => {});
    }
  }, [selectedCompany?.id]);

  const generate = async () => {
    if (!selectedCompany?.id || !selectedModel || !prompt.trim()) return;
    setGenerating(true); setResult(null); setError(null); setProgress("Invio richiesta...");
    try {
      const fd = new FormData();
      fd.append("companyId", selectedCompany.id);
      fd.append("model", selectedModel.key);
      fd.append("prompt", prompt);
      fd.append("aspect_ratio", aspectRatio);
      fd.append("generate_audio", String(generateAudio));
      if (selectedModel.type.includes("video")) {
        fd.append("duration", duration);
        fd.append("resolution", resolution);
      } else {
        fd.append("output_format", outputFormat);
        fd.append("resolution", resolution === "720p" ? "1K" : resolution === "1080p" ? "2K" : "1K");
      }
      if (imageUrl) fd.append("image_url", imageUrl);
      if (videoUrl) fd.append("video_url", videoUrl);
      if (uploadedFile) fd.append("image", uploadedFile);

      const r = await fetch("/api/fal/generate", { method: "POST", credentials: "include", body: fd });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Errore"); setGenerating(false); setProgress(""); return; }

      // Poll for result
      const { requestId, modelId } = data;
      setProgress("In coda...");
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const sr = await fetch("/api/fal/status/" + selectedModel.key + "/" + requestId + "?companyId=" + selectedCompany!.id, { credentials: "include" });
          const status = await sr.json();
          if (status.status === "COMPLETED") {
            clearInterval(poll);
            setProgress("Download risultato...");
            const rr = await fetch("/api/fal/result/" + selectedModel.key + "/" + requestId + "?companyId=" + selectedCompany!.id, { credentials: "include" });
            const res = await rr.json();
            setResult(res);
            setGenerating(false); setProgress("");
          } else if (status.status === "IN_PROGRESS") {
            setProgress("Generazione in corso..." + (status.logs ? " " + JSON.stringify(status.logs).slice(0, 50) : ""));
          } else if (status.status === "FAILED") {
            clearInterval(poll);
            setError("Generazione fallita");
            setGenerating(false); setProgress("");
          } else {
            setProgress("In coda... (posizione: " + (status.queue_position ?? "?") + ")");
          }
          if (attempts > 300) { clearInterval(poll); setError("Timeout"); setGenerating(false); setProgress(""); }
        } catch {}
      }, 3000);
    } catch { setError("Errore connessione"); setGenerating(false); setProgress(""); }
  };

  const imageModels = models.filter(m => m.type.includes("image"));
  const videoModels = models.filter(m => m.type.includes("video"));

  if (!connected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3"><Sparkles className="w-5 h-5" /><h1 className="text-xl font-semibold">Genera AI</h1></div>
        <div className="glass-card p-6 text-center space-y-3">
          <Sparkles className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Collega fal.ai da Connettori per generare immagini e video con AI</p>
          <a href={"/" + (selectedCompany?.issuePrefix || "") + "/plugins"} className="inline-block px-4 py-2 rounded-xl text-sm font-medium text-white no-underline" style={{ background: "linear-gradient(135deg, hsl(158 64% 42%), hsl(160 70% 36%))" }}>Vai ai Connettori</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><Sparkles className="w-5 h-5" /><h1 className="text-xl font-semibold">Genera AI</h1></div>

      {/* Model selector */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Immagini</h3>
        <div className="flex flex-wrap gap-2">
          {imageModels.map(m => (
            <button key={m.key} onClick={() => { setSelectedModel(m); setResult(null); setError(null); }} className={"px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 " + (selectedModel?.key === m.key ? "text-white ring-1 ring-green-500" : "text-muted-foreground")} style={selectedModel?.key === m.key ? { background: "rgba(34,197,94,0.15)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <Image className="w-3 h-3" /> {m.name}
            </button>
          ))}
        </div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Video</h3>
        <div className="flex flex-wrap gap-2">
          {videoModels.map(m => (
            <button key={m.key} onClick={() => { setSelectedModel(m); setResult(null); setError(null); }} className={"px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 " + (selectedModel?.key === m.key ? "text-white ring-1 ring-blue-500" : "text-muted-foreground")} style={selectedModel?.key === m.key ? { background: "rgba(59,130,246,0.15)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <Video className="w-3 h-3" /> {m.name}
            </button>
          ))}
        </div>
      </div>

      {selectedModel && (
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">{selectedModel.name}</h3>
              <p className="text-xs text-muted-foreground">{selectedModel.description}</p>
            </div>
          </div>

          {/* Prompt */}
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Descrivi cosa vuoi generare..." rows={3} className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }} />

          {/* Options row */}
          <div className="flex flex-wrap gap-2">
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
              <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
              <option value="4:3">4:3</option><option value="3:4">3:4</option><option value="3:2">3:2</option>
              {!selectedModel.type.includes("video") && <><option value="21:9">21:9</option><option value="4:5">4:5</option></>}
            </select>
            {selectedModel.type.includes("video") && (
              <select value={duration} onChange={e => setDuration(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
                {selectedModel.key.includes("kling") || selectedModel.key.includes("seedance") ? (
                  <>{[3,4,5,6,7,8,9,10,11,12].map(d => <option key={d} value={String(d)}>{d}s</option>)}{selectedModel.key.includes("kling") && [13,14,15].map(d => <option key={d} value={String(d)}>{d}s</option>)}</>
                ) : (
                  <><option value="4s">4s</option><option value="6s">6s</option><option value="8s">8s</option></>
                )}
              </select>
            )}
            <select value={resolution} onChange={e => setResolution(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
              {selectedModel.type.includes("video") ? (
                <><option value="720p">720p</option><option value="1080p">1080p</option>{selectedModel.key.includes("veo") && <option value="4k">4K</option>}</>
              ) : (
                <><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></>
              )}
            </select>
            {selectedModel.type.includes("video") && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={generateAudio} onChange={e => setGenerateAudio(e.target.checked)} /> Audio</label>
            )}
          </div>

          {/* Image/video URL input for models that need it */}
          {(selectedModel.type === "image-to-video" || selectedModel.type === "image-edit" || selectedModel.type === "reference-to-video" || selectedModel.type === "frame-to-video") && (
            <div className="space-y-2">
              <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => setUploadedFile(e.target.files?.[0] || null)} />
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <Upload className="w-3.5 h-3.5" /> {uploadedFile ? uploadedFile.name : "Carica immagine"}
              </button>
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="Oppure incolla URL immagine" className="w-full rounded-lg px-3 py-1.5 text-xs outline-none" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }} />
            </div>
          )}
          {selectedModel.type === "extend-video" && (
            <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="URL del video da estendere" className="w-full rounded-lg px-3 py-1.5 text-xs outline-none" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }} />
          )}

          {/* Generate button */}
          <button onClick={generate} disabled={generating || !prompt.trim()} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-30" style={{ background: "linear-gradient(135deg, hsl(280 80% 55%), hsl(320 80% 55%))", boxShadow: "0 4px 20px hsl(300 80% 50% / 0.3)" }}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? progress || "Generazione..." : "Genera"}
          </button>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* Result */}
          {result && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              {result.images && result.images.map((img: any, i: number) => (
                <div key={i} className="space-y-1">
                  <img src={img.url} alt="" className="max-w-full rounded-xl" />
                  <a href={img.url} download className="flex items-center gap-1 text-xs text-blue-400 hover:underline no-underline"><Download className="w-3 h-3" /> Scarica</a>
                </div>
              ))}
              {result.video && (
                <div className="space-y-1">
                  <video src={result.video.url} controls className="max-w-full rounded-xl" />
                  <a href={result.video.url} download className="flex items-center gap-1 text-xs text-blue-400 hover:underline no-underline"><Download className="w-3 h-3" /> Scarica video</a>
                </div>
              )}
              {result.description && <p className="text-xs text-muted-foreground">{result.description}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, FolderOpen } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { cn } from "../lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface PmiProject {
  id: string;
  name: string;
  storage_type: string;
  created_at: string;
}

export function SidebarProjects() {
  const [open, setOpen] = useState(true);
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { isMobile, setSidebarOpen } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const { data: projects } = useQuery({
    queryKey: ["pmi-projects", selectedCompanyId],
    queryFn: async () => {
      const r = await fetch("/api/pmi-projects?companyId=" + selectedCompanyId, { credentials: "include" });
      const d = await r.json();
      return (d.projects || []) as PmiProject[];
    },
    enabled: !!selectedCompanyId,
    refetchInterval: 30000,
  });

  const visibleProjects = useMemo(() => projects || [], [projects]);

  const createProject = async () => {
    if (!selectedCompanyId || creating || !newProjectName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/pmi-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, name: newProjectName.trim() }),
      });
      if (r.ok) {
        const d = await r.json();
        queryClient.invalidateQueries({ queryKey: ["pmi-projects", selectedCompanyId] });
        setShowNameInput(false);
        setNewProjectName("");
        navigate("/" + (selectedCompany?.issuePrefix || "") + "/progetti?project=" + d.project.id);
      }
    } catch {}
    setCreating(false);
  };

  const activeProjectId = new URLSearchParams(location.search).get("project");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
            Progetti
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowNameInput(!showNameInput);
            }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors ml-1.5"
            aria-label="Nuovo progetto"
          >
            <Plus className="h-3 w-3" />
          </button>
          <CollapsibleTrigger className="ml-auto flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground transition-colors">
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                open && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
        </div>
      </div>

      {showNameInput && (
        <div className="mx-2 mb-1 flex items-center gap-1">
          <input
            autoFocus
            className="flex-1 px-2 py-1 rounded-lg text-xs outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "hsl(0 0% 98%)" }}
            placeholder="Nome progetto..."
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createProject(); if (e.key === "Escape") { setShowNameInput(false); setNewProjectName(""); } }}
          />
          <button
            onClick={createProject}
            disabled={creating || !newProjectName.trim()}
            className="px-2 py-1 rounded-lg text-[10px] font-medium text-white disabled:opacity-30"
            style={{ background: "hsl(158 64% 42%)" }}
          >
            {creating ? "..." : "OK"}
          </button>
        </div>
      )}

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {visibleProjects.map((project) => (
            <NavLink
              key={project.id}
              to={"/" + (selectedCompany?.issuePrefix || "") + "/progetti?project=" + project.id}
              onClick={() => { if (isMobile) setSidebarOpen(false); }}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md text-[13px] no-underline transition-colors",
                activeProjectId === project.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
              style={activeProjectId === project.id ? {
                background: "linear-gradient(135deg, hsl(158 64% 42% / 0.12), hsl(158 64% 42% / 0.06))",
                border: "1px solid hsl(158 64% 42% / 0.15)",
              } : undefined}
            >
              <FolderOpen className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="truncate">{project.name}</span>
            </NavLink>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

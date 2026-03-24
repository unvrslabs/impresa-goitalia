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
    if (!selectedCompanyId || creating) return;
    const name = prompt("Nome del progetto:");
    if (!name?.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/pmi-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, name: name.trim() }),
      });
      if (r.ok) {
        const d = await r.json();
        queryClient.invalidateQueries({ queryKey: ["pmi-projects", selectedCompanyId] });
        // Navigate to the new project
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
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90"
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              Progetti
            </span>
          </CollapsibleTrigger>
          <button
            onClick={(e) => {
              e.stopPropagation();
              createProject();
            }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="Nuovo progetto"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {visibleProjects.length === 0 && (
            <div className="px-6 py-1 text-[10px] text-muted-foreground/40">Nessun progetto</div>
          )}
          {visibleProjects.map((project) => (
            <NavLink
              key={project.id}
              to={"/progetti?project=" + project.id}
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

import { api } from "./client.js";

export interface A2AProfile {
  id: string;
  companyId: string;
  slug: string;
  vatNumber?: string | null;
  legalName?: string | null;
  atecoCode?: string | null;
  atecoDescription?: string | null;
  address?: string | null;
  zone?: string | null;
  description?: string | null;
  riskScore?: number | null;
  tags: string[];
  services: string[];
  visibility: "public" | "hidden";
  createdAt?: string;
  updatedAt?: string;
}

export interface A2AConnection {
  id: string;
  fromCompanyId: string;
  toCompanyId: string;
  status: "pending" | "active" | "blocked";
  relationshipLabel?: string | null;
  notes?: string | null;
  createdAt: string;
  partnerName?: string;
  direction?: "in" | "out";
}

export interface A2ATask {
  id: string;
  fromCompanyId: string;
  toCompanyId: string;
  type: "message" | "quote" | "order" | "service";
  title: string;
  description?: string | null;
  status: string;
  requiresApproval: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  messages?: A2AMessage[];
}

export interface A2AMessage {
  id: string;
  taskId: string;
  fromCompanyId: string;
  role: "ceo" | "human";
  content: string;
  attachments?: Record<string, unknown>[] | null;
  createdAt: string;
}

export interface A2AUnreadCount {
  connections: number;
  tasks: number;
  total: number;
}

export const a2aApi = {
  // Profile
  getProfile: (companyId: string) =>
    api.get<A2AProfile | null>(`/a2a/profile?companyId=${companyId}`),
  saveProfile: (data: Partial<A2AProfile> & { companyId: string }) =>
    api.post<A2AProfile>("/a2a/profile", data),
  deleteProfile: (companyId: string) =>
    api.delete<void>(`/a2a/profile?companyId=${companyId}`),

  // Directory
  searchDirectory: (companyId: string, q?: string, zone?: string) => {
    const params = new URLSearchParams({ companyId });
    if (q) params.set("q", q);
    if (zone) params.set("zone", zone);
    return api.get<A2AProfile[]>(`/a2a/directory?${params}`);
  },

  // Connections
  listConnections: (companyId: string) =>
    api.get<A2AConnection[]>(`/a2a/connections?companyId=${companyId}`),
  requestConnection: (companyId: string, toCompanyId: string, label?: string, notes?: string) =>
    api.post<A2AConnection>("/a2a/connections", { companyId, toCompanyId, relationshipLabel: label, notes }),
  updateConnection: (id: string, data: { companyId: string; status?: string; relationshipLabel?: string; notes?: string }) =>
    api.put<A2AConnection>(`/a2a/connections/${id}`, data),
  deleteConnection: (id: string, companyId: string) =>
    api.delete<void>(`/a2a/connections/${id}?companyId=${companyId}`),

  // Tasks
  listTasks: (companyId: string, direction?: string, status?: string, type?: string) => {
    const params = new URLSearchParams({ companyId });
    if (direction) params.set("direction", direction);
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    return api.get<A2ATask[]>(`/a2a/tasks?${params}`);
  },
  createTask: (data: { companyId: string; toCompanyId: string; type?: string; title: string; description?: string; requiresApproval?: boolean }) =>
    api.post<A2ATask>("/a2a/tasks", data),
  getTask: (id: string) =>
    api.get<A2ATask>(`/a2a/tasks/${id}`),
  updateTaskStatus: (id: string, status: string) =>
    api.put<A2ATask>(`/a2a/tasks/${id}`, { status }),
  addMessage: (taskId: string, data: { companyId: string; role?: string; content: string }) =>
    api.post<A2AMessage>(`/a2a/tasks/${taskId}/messages`, data),

  // Badge
  unreadCount: (companyId: string) =>
    api.get<A2AUnreadCount>(`/a2a/unread-count?companyId=${companyId}`),
};

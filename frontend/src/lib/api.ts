import type { ProjectData } from "../types";

const BASE = import.meta.env?.VITE_API_BASE ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  defaultCharacter: () => request<{ name: string; skeleton: ProjectData["skeleton"] }>("/api/character/default"),
  save: (project: ProjectData) =>
    request<{ saved: boolean }>(`/api/projects/${encodeURIComponent(project.name)}`, {
      method: "PUT",
      body: JSON.stringify(project),
    }),
  load: (name: string) => request<ProjectData>(`/api/projects/${encodeURIComponent(name)}`),
  list: () => request<{ projects: string[] }>("/api/projects"),
  exportAction: (name: string, fps: number) =>
    request<unknown>(`/api/projects/${encodeURIComponent(name)}/export?fps=${fps}`, { method: "POST" }),
};

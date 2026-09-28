export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await response.json();
  if (!response.ok) throw new Error((data.errors ?? ["请求失败"]).join("\n"));
  return data as T;
}

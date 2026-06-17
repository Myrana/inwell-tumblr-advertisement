import { apiBaseUrl } from "./constants";
import { toApiAdvertisement } from "./ads";
import { fromApiTemplate, toApiTemplate } from "./templates";
import { Advertisement, ApiTemplate, SavedTemplate } from "./types";

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function saveAdvertisement(advertisement: Advertisement) {
  await apiRequest(`/advertisements/${advertisement.id}`, {
    method: "PUT",
    body: JSON.stringify(toApiAdvertisement(advertisement)),
  });
}

export async function removeAdvertisement(id: string) {
  await apiRequest(`/advertisements/${id}`, { method: "DELETE" });
}

export async function loadBackendTemplates() {
  const response = await apiRequest<{ templates: ApiTemplate[] }>("/templates");
  return response.templates.map(fromApiTemplate);
}

export async function saveTemplate(template: SavedTemplate) {
  const response = await apiRequest<{ template: ApiTemplate }>(`/templates/${template.id}`, {
    method: "PUT",
    body: JSON.stringify(toApiTemplate(template)),
  });
  return fromApiTemplate(response.template);
}

export async function removeTemplate(id: string) {
  await apiRequest(`/templates/${id}`, { method: "DELETE" });
}

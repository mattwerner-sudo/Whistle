import type { ContactPerson } from "@shared/schema";

export function exportToJSON(contacts: ContactPerson[], filename: string = "contacts.json"): void {
  const jsonString = JSON.stringify(contacts, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

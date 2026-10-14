/** Display name of a client: "first family", or the name given as a whole. */
export function contactName(c: { name?: string | null; first_name?: string | null; family_name?: string | null }): string {
  const split = [c.first_name, c.family_name].map((x) => x?.trim()).filter(Boolean).join(' ');
  return split || c.name?.trim() || '';
}

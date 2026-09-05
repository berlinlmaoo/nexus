function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function getPrimaryWorkspaceDefaults() {
  return {
    name: "Z Networks",
    slug: slugify("Z Networks"),
    description: "Primary workspace for all Nexus users",
  }
}

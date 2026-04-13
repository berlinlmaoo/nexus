function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function getPrimaryWorkspaceDefaults() {
  return {
    name: "PATS Group",
    slug: slugify("PATS Group"),
    description: "Primary workspace for all Nexus users",
  }
}

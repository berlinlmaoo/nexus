function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function buildPersonalWorkspace(user: {
  id: string
  name?: string | null
  email: string
}) {
  const baseName = (user.name || user.email.split("@")[0] || "My").trim()
  const workspaceName = `${baseName} Workspace`
  const slugBase = slugify(baseName) || "workspace"

  return {
    name: workspaceName,
    slug: `${slugBase}-${user.id.slice(-6)}`,
    description: `Personal workspace for ${baseName}`,
  }
}

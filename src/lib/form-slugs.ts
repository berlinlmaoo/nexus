import type { PrismaClient } from "@/generated/prisma"

export function slugifyFormName(name: string) {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)

  return slug || "form"
}

export async function generateUniqueFormSlug(
  prisma: PrismaClient,
  name: string,
  currentFormId?: string
) {
  const base = slugifyFormName(name)
  let slug = base
  let suffix = 2

  while (true) {
    const existing = await prisma.form.findUnique({
      where: { slug },
      select: { id: true },
    })

    if (!existing || existing.id === currentFormId) return slug

    slug = `${base}-${suffix}`
    suffix += 1
  }
}


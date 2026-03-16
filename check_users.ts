import { PrismaClient } from '@/generated/prisma'
const prisma = new PrismaClient()
async function main() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@patsgroup.id' } }, select: { id: true, name: true, email: true, password: true } })
  users.forEach(u => console.log(u.email, '| has_password:', !!u.password))
}
main().finally(() => prisma.$disconnect())

import { PrismaClient } from './src/generated/prisma/client.js'
const prisma = new PrismaClient()
const users = await prisma.user.findMany({ where: { email: { endsWith: '@patsgroup.id' } }, select: { id: true, name: true, email: true, password: true } })
users.forEach(u => console.log(u.email, '| has_password:', !!u.password))
await prisma.$disconnect()

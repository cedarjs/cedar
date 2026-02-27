import { PrismaClient } from 'src/lib/db'

export default async () => new PrismaClient()

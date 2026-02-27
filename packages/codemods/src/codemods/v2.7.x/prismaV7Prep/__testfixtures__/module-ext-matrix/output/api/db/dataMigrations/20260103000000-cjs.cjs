import { PrismaClient } from 'src/lib/db'

module.exports = async () => new PrismaClient()

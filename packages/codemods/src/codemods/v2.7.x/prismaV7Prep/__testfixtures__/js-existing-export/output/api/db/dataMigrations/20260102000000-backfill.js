import { PrismaClient } from "src/lib/db"

export default async () => {
  return new PrismaClient()
}

import { PrismaClient } from ".prisma/local-client";

export const db = new PrismaClient();

/** Initialize database connection. */
export async function initDb() {
  await db.$connect();
}

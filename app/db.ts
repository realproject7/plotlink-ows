import { PrismaClient } from "../node_modules/.prisma/local-client/index.js";

export const db = new PrismaClient();

/** Initialize database connection. */
export async function initDb() {
  await db.$connect();
}

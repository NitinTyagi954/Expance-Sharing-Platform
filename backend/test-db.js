import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DIRECT_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testConnection() {
  console.log('Testing connection to Neon PostgreSQL database...');
  try {
    // Run a simple raw SQL query to test connection
    const result = await prisma.$queryRaw`SELECT NOW() as current_time;`;
    console.log('Successfully connected to Neon PostgreSQL!');
    console.log('Database server time:', result[0].current_time);
  } catch (error) {
    console.error('Failed to connect to the database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

testConnection();

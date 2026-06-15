import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import dns from 'dns';

// Override DNS lookup for neon.tech to bypass local DNS query refusals
const originalLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname && hostname.includes('neon.tech')) {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    dns.resolve4(hostname, (err, addresses) => {
      if (err || !addresses.length) {
        originalLookup(hostname, options, callback);
      } else if (options && options.all) {
        callback(null, addresses.map(ip => ({ address: ip, family: 4 })));
      } else {
        callback(null, addresses[0], 4);
      }
    });
  } else {
    originalLookup(hostname, options, callback);
  }
};

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  max: 6, // Sufficient for concurrent page requests
  idleTimeoutMillis: 30000, // Keep connections active for 30 seconds
  connectionTimeoutMillis: 10000
});

const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter, log: ['error', 'warn'] });

export const config = {
  sifco: {
    baseURL: process.env.SIFCO_BASE_URL || 'https://sifco.example.com/sifcoweb',
    clientId: process.env.SIFCO_CLIENT_ID || '',
    clientSecret: process.env.SIFCO_CLIENT_SECRET || '',
    username: process.env.SIFCO_USERNAME || '',
    password: process.env.SIFCO_PASSWORD || '',
  },
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
  },
};

export function validateConfig() {
  const required = [
    'SIFCO_BASE_URL',
    'SIFCO_CLIENT_ID', 
    'SIFCO_CLIENT_SECRET',
    'SIFCO_USERNAME',
    'SIFCO_PASSWORD'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn(`⚠️  Missing required environment variables: ${missing.join(', ')}`);
    console.warn('   Please check .env.example for configuration details');
    return false;
  }
  
  return true;
}
export default {
    port: parseInt(process.env.PORT || "9000"),
    
    postgres: {
        host: process.env.POSTGRES_HOST || 'localhost', // Hostname or IP address of the PostgreSQL server
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10), // Port on which PostgreSQL is running (default: 5432)
        database: process.env.POSTGRES_DATABASE || 'my_database', // Name of the PostgreSQL database
        username: process.env.POSTGRES_USER || 'postgres', // Username for PostgreSQL connection
        password: process.env.POSTGRES_PASSWORD || 'password', // Password for PostgreSQL connection
    },
 
    
};
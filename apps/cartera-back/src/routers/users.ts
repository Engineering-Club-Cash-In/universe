// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { insertUsers } from '../controllers/users';
import { getUsersWithSifco } from '../controllers/users';
 

export const usersRouter = new Elysia()
  .post('/users', insertUsers)

    .get('/users-with-sifco', getUsersWithSifco); // 👈 Aquí el endpoint
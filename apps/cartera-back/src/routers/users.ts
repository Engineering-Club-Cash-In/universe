// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { insertUsers } from '../controllers/users';
 

export const usersRouter = new Elysia()
  .post('/users', insertUsers);

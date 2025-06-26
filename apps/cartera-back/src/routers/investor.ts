// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { getInvestors, insertInvestor } from '../controllers/investor';
 

export const inversionistasRouter = new Elysia()
  .post('/investor', insertInvestor)
    .get('/investor', getInvestors);

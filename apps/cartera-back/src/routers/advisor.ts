// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { getAdvisors, insertAdvisor } from '../controllers/advisor';
 

export const advisorRouter = new Elysia()
  .post('/advisor', insertAdvisor)
   .get('/advisor', getAdvisors);

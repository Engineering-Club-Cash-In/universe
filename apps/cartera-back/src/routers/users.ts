// routes/inversionistas.ts
import { Elysia } from 'elysia';
import { insertUsers } from '../controllers/users';
import {
  getCreditosOperativosParaSat,
  getUsersWithSifco,
} from '../controllers/users';
import { authMiddleware } from './midleware';
 

export const usersRouter = new Elysia()
.use(authMiddleware)
  .post('/users', insertUsers)
.get('/users-with-sifco', async ({ user, set }) => {  // 👈 user viene del derive
  try {
    console.log("👤 Usuario en endpoint:", user);
    
    const result = await getUsersWithSifco(user); // 👈 Pasar user directamente
    set.status = 200;
    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    set.status = 500;
    return {
      success: false,
      message: "Error obteniendo usuarios",
      error: String(error),
    };
  }
})
.get('/internal/sat/creditos-operativos', async ({ user, set }) => {
  if (user?.role !== 'ADMIN') {
    set.status = 403;
    return { success: false, message: 'No autorizado.' };
  }

  try {
    const data = await getCreditosOperativosParaSat();
    return { success: true, data };
  } catch (error) {
    console.error('[SAT] Error obteniendo créditos operativos:', error);
    set.status = 500;
    return {
      success: false,
      message: 'No se pudieron obtener los créditos operativos.',
    };
  }
});

import { Elysia, t } from "elysia";
import {
  createCrmPerson,
  createOpportunity,
  createTask,
  createVehicle,
} from "../controllers/crm";

const crmRouter = new Elysia({
  prefix: "/crm",
})
  .post(
    "/create-person",
    async ({ body }) => {
      try {
        const { firstName, lastName, email, city, avatarUrl } = body;
        const person = await createCrmPerson(
          firstName,
          lastName,
          email,
          city,
          avatarUrl
        );
        await createOpportunity(
          person.data.createPerson.id,
          "New Opportunity",
          1000
        );
        await createTask(
          "Contactar a la persona",
          "Contactar a la persona para obtener más información",
          new Date(Date.now() + 24 * 60 * 60 * 1000)
        );
        return {
          success: true,
          message: "Person created successfully",
          data: person,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    {
      body: t.Object({
        firstName: t.String(),
        lastName: t.String(),
        email: t.String({ format: "email" }),
        city: t.String(),
        avatarUrl: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          person: t.Optional(
            t.Object({
              firstName: t.String(),
              lastName: t.String(),
              email: t.String(),
              city: t.String(),
              avatarUrl: t.String(),
            })
          ),
        }),
        400: t.Object({
          success: t.Boolean(),
          error: t.String(),
        }),
      },
    }
  )
  .post(
    "/create-vehicle",
    async ({ body }) => {
      try {
        const { name, marca, modelo, ano, revisor, detalles } = body;
        const vehicle = await createVehicle(
          name,
          marca,
          modelo,
          ano,
          revisor,
          detalles
        );
        return {
          success: true,
          message: "Vehicle created successfully",
          data: vehicle,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
    {
      body: t.Object({
        name: t.String(),
        marca: t.String(),
        modelo: t.Number(),
        ano: t.Number(),
        revisor: t.Object({
          firstName: t.String(),
          lastName: t.String(),
        }),
        detalles: t.Object({}),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          data: t.Any(),
        }),
        400: t.Object({
          success: t.Boolean(),
          error: t.String(),
        }),
      },
    }
  );

export default crmRouter;

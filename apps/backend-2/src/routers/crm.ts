import { Elysia, t } from "elysia";
import { createCrmPerson } from "../controllers/crm";

const crmRouter = new Elysia({
  prefix: "/crm",
}).post(
  "/create-person",
  async ({ body }) => {
    try {
      const { firstName, lastName, email, city, avatarUrl } = body;
      console.log(
        "Creating person:",
        firstName,
        lastName,
        email,
        city,
        avatarUrl
      );
      const person = await createCrmPerson(
        firstName,
        lastName,
        email,
        city,
        avatarUrl
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
);

export default crmRouter;

import { Elysia, t } from "elysia";
import { sendSignatureRequest } from "../controllers/signatures";

const signaturesRouter = new Elysia({
  prefix: "/signatures",
}).post(
  "/requestSignature",
  async ({ body }) => {
    const { emails } = body;
    const signatureId = 2;
    const response = await sendSignatureRequest(signatureId, emails);
    return response;
  },
  {
    body: t.Object({
      emails: t.Array(t.String()),
    }),
  }
);

export default signaturesRouter;

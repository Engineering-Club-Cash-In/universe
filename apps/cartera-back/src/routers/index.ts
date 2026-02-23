import { advisorRouter } from "./advisor";
import defaultRouter from "./default";
import { inversionistasRouter } from "./investor";
import { usersRouter } from "./users";
import { creditRouter } from "./credits";
import { paymentRouter } from "./payments";
import { uploadRouter } from "./uploads";
import { authRouter } from "./auth";
import { sifcoRouter } from "./migration";
import { morasRouter } from "./latefee";
import { bancosRouter } from "./banks";
import {cuentasRoutes} from"./accounts"
import { paymentAgreementsRouter } from "./paymentAgree";
import { dteController } from "./cofidi";
import { recalculateFromJsonRouter } from "./recalculateFromJson";
import { mirrorInvestorRouter } from "./mirrorInvestor";
import { notificationsRouter } from "./notifications";
export {
    defaultRouter,inversionistasRouter,advisorRouter,usersRouter,creditRouter,paymentRouter,uploadRouter,sifcoRouter,authRouter,morasRouter,bancosRouter,cuentasRoutes,paymentAgreementsRouter,dteController,recalculateFromJsonRouter,mirrorInvestorRouter,notificationsRouter
}   
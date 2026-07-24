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
import { reconcileEspejoRouter } from "./reconcileEspejo";
import { investorDocumentsRouter } from "./investorDocuments";
import { abonosCapitalRouter } from "./abonosCapital";
import { recibosGenericosRouter } from "./recibosGenericos";
import { fallenCreditsRouter } from "./fallenCredits";
import { sifcoSyncRouter } from "./sifcoSync";
import { assignCapitalRouter } from "./assignCapital";
import { addInvestorToCreditRouter } from "./addInvestorToCredit";
import { completeEspejoRouter } from "./completeEspejo";
import { replaceInvestorCreditRouter } from "./replaceInvestorCredit";
import { compraCarteraAceptadaRouter } from "./compraCarteraAceptada";
import { devolucionRouter } from "./devolucion";
import { creditosNuevosConAbonosRouter } from "./creditosNuevosConAbonos";
import { cuentasExtraInversionistaRouter } from "./cuentasExtraInversionista";
import { cierreMensualRouter } from "./cierreMensual";
import { actualizarPagosExcelRouter } from "./actualizarPagosExcel";
import { reportesRouter } from "./reportes";
import { gastosAdministrativosRouter } from "./gastosAdministrativos";
import { metasFacturacionRouter } from "./metasFacturacion";
import { facturacionSnapshotRouter } from "./facturacionSnapshot";
import { ingresosCarrosRouter } from "./ingresosCarros";
import { aseguradorasRouter } from "./aseguradoras";
import { modalidadFacturacionRouter } from "./modalidadFacturacion";
export {
    defaultRouter,inversionistasRouter,advisorRouter,usersRouter,creditRouter,paymentRouter,uploadRouter,sifcoRouter,authRouter,morasRouter,bancosRouter,cuentasRoutes,paymentAgreementsRouter,dteController,recalculateFromJsonRouter,mirrorInvestorRouter,notificationsRouter,reconcileEspejoRouter,investorDocumentsRouter,abonosCapitalRouter,recibosGenericosRouter,fallenCreditsRouter,sifcoSyncRouter,assignCapitalRouter,addInvestorToCreditRouter,completeEspejoRouter,replaceInvestorCreditRouter,compraCarteraAceptadaRouter,devolucionRouter,creditosNuevosConAbonosRouter,cuentasExtraInversionistaRouter,cierreMensualRouter,actualizarPagosExcelRouter,reportesRouter,gastosAdministrativosRouter,metasFacturacionRouter,facturacionSnapshotRouter,ingresosCarrosRouter,aseguradorasRouter,modalidadFacturacionRouter
}

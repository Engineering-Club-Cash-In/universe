import { InvestorsLogo } from "@/features/footer/icons";
import { IconArrow, IconInfo } from "@/components";
import { motion } from "framer-motion";

const imgUrl = import.meta.env.VITE_IMAGE_URL + "/investors.jpg";

export const HeaderInvestor = () => {
  return (
    <section className="px-20 mt-32">
      <div className="flex gap-20">
        <div className="flex flex-col gap-12 w-3/5">
          <div>
            <InvestorsLogo width={"320px"} height={"128px"} />
          </div>
          <p className="text-header-3 pr-30">
            Multiplica tu <span className="text-secondary">patrimonio</span> con
            inversiones inteligentes
          </p>
          <p className="text-gray text-2xl">
            Accede a oportunidades exclusivas de inversión con rendimientos
            superiores al mercado. Seguridad, transparencia y asesoría
            personalizada para alcanzar tus metas financieras.
          </p>

          {/* Botones */}
          <div className="flex gap-6 mt-4 h-24 w-full lg:w-3/5">
            <motion.button
              className="flex items-center justify-center gap-4 w-full text-secondary  rounded-[10.115px] border border-secondary/50 hover:bg-secondary/10 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <div>
                <IconArrow width="24" height="24" />
              </div>
              <span className="text-lg font-semibold">
                Quiero invertir ahora
              </span>
            </motion.button>

            <motion.button
              className="flex items-center justify-center text-secondary gap-4 w-full  rounded-[10.115px] border border-secondary/50 hover:bg-secondary/10 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <div>
                <IconInfo width="24" height="24" />
              </div>
              <span className="text-lg font-semibold">
                Conoce cómo funciona
              </span>
            </motion.button>
          </div>
        </div>
        <div className="w-2/5">
          <img
            src={imgUrl}
            alt="Inversiones"
            className="w-full h-full object-cover rounded-xl"
          />
        </div>
      </div>
    </section>
  );
};

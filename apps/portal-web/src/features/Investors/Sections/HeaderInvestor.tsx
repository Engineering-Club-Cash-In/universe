import { InvestorsLogo } from "@/features/footer/icons";
import { IconArrow, IconInfo, ModalChatBot } from "@/components";
import { motion } from "framer-motion";
import { useModalOptionsCall, useIsMobile } from "@/hooks";

const imgUrl = import.meta.env.VITE_IMAGE_URL + "/investors.jpg";

export const HeaderInvestor = () => {
  const {
    isModalOpen,
    modalOptionsInvestors: modalOptions,
    setIsModalOpen,
  } = useModalOptionsCall();
  const isMobile = useIsMobile();

  return (
    <section className="px-8 lg:px-20 mt-10 lg:mt-32">
      <div className="flex gap-20">
        <div className="flex flex-col items-center lg:items-start gap-6 lg:gap-12 w-full lg:w-3/5">
          <div>
            <InvestorsLogo
              width={isMobile ? "200px" : "320px"}
              height={isMobile ? "80px" : "128px"}
            />
          </div>
          <p className="text-xl text-center lg:text-start lg:text-header-3 lg:pr-30">
            Multiplica tu <span className="text-secondary">patrimonio</span> con
            inversiones inteligentes
          </p>
          <div className="lg:hidden w-full">
          <img
            src={imgUrl}
            alt="Inversiones"
            className="w-full h-full object-cover rounded-xl"
          />
        </div>
          <p className="text-sm text-gray lg:text-2xl leading-8 lg:leading-6 text-center lg:text-start">
            Accede a oportunidades exclusivas de inversión con rendimientos
            superiores al mercado. Seguridad, transparencia y asesoría
            personalizada para alcanzar tus metas financieras.
          </p>

          {/* Botones */}
          <div className="flex gap-6 mt-4  w-full lg:w-3/4">
            <motion.button
              className="flex items-center p-4 justify-center gap-4 w-full text-secondary  rounded-xl border border-secondary/50 hover:bg-secondary/10 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              onClick={() => setIsModalOpen(true)}
            >
              <div>
                <IconArrow width={isMobile ? 16 : 24} height={isMobile ? 16 : 24} />
              </div>
              <span className="text-xs lg:text-lg font-semibold">
                Quiero invertir ahora
              </span>
            </motion.button>

            <motion.button
              className="flex items-center p-4 justify-center text-secondary gap-4 w-full  rounded-xl border border-secondary/50 hover:bg-secondary/10 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              onClick={() => {
                //navegar a la seccion con id:"how-it-works"
                const element = document.getElementById("how-it-works");
                if (element) {
                  element.scrollIntoView({ behavior: "smooth" });
                }
              }}
            >
              <div>
                <IconInfo width={isMobile ? 16 : 24} height={isMobile ? 16 : 24} />
              </div>
              <span className="text-xs lg:text-lg font-semibold">
                Conoce cómo funciona
              </span>
            </motion.button>
          </div>
        </div>
        <div className="hidden lg:block w-2/5">
          <img
            src={imgUrl}
            alt="Inversiones"
            className="w-full h-full object-cover rounded-xl"
          />
        </div>
      </div>
      <ModalChatBot
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        options={modalOptions}
      />
    </section>
  );
};

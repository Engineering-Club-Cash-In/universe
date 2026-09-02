import * as React from 'react';
import {
  Body,
  Column,
  Container,
  Font,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';

interface PasswordResetEmailAssets {
  headerBanner: string;
  footerBanner: string;
  warningIcon: string;
}

interface PasswordResetEmailProps {
  resetUrl: string;
  assets: PasswordResetEmailAssets;
}

export const PasswordResetEmail = ({ resetUrl, assets }: PasswordResetEmailProps) => (
  <Html>
    <Head>
      {/*
        La URL apunta al archivo .woff2 directo (subset latin), no al endpoint
        css2 de Google Fonts: <Font> declara la fuente con format('woff2'), así
        que un stylesheet ahí no se puede decodificar y la fuente no carga.
        Plus Jakarta Sans es variable, por lo que el mismo archivo sirve los
        pesos 400/600/700 que usa la plantilla.
      */}
      <Font
        fontFamily="Plus Jakarta Sans"
        fallbackFontFamily="Arial"
        webFont={{
          url: 'https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2',
          format: 'woff2',
        }}
        fontWeight={400}
        fontStyle="normal"
      />
    </Head>
    <Preview>Restablecer contraseña - CashIn</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src={assets.headerBanner}
          width="600"
          height="133"
          alt="CashIn"
          style={headerImg}
        />

        <Section style={content}>
          <Text style={greeting}>Estimado inversionista,</Text>

          <Section style={shadowStep6}>
            <Section style={shadowStep5}>
              <Section style={shadowStep4}>
                <Section style={shadowStep3}>
                  <Section style={shadowStep2}>
                    <Section style={shadowStep1}>
                      <Section style={card}>
                        <Text style={text}>
                          Recibimos una solicitud para restablecer la contraseña de tu cuenta del
                          Portal del Inversionista de CashIn.
                        </Text>

                        <Text style={ctaLabel}>Haz click en el botón para</Text>

                        <Section style={buttonContainer}>
                          <Link href={resetUrl} style={button}>
                            Restablecer Contraseña
                          </Link>
                        </Section>

                        <Text style={expiry}>Por seguridad, este enlace expirará en 1 hora.</Text>
                      </Section>
                    </Section>
                  </Section>
                </Section>
              </Section>
            </Section>
          </Section>

          <Row style={warningRow}>
            <Column style={warningIconColumn}>
              <Img
                src={assets.warningIcon}
                width="56"
                height="56"
                alt="Advertencia"
                style={warningIconImg}
              />
            </Column>
            <Column style={warningTextColumn}>
              <Text style={warningText}>
                Si NO solicitaste restablecer tu contraseña, puedes ignorar este correo.
                Tu contraseña NO será modificada.
              </Text>
            </Column>
          </Row>

          <Hr style={hr} />

          <Text style={linkFallback}>
            Si el botón no funciona, copia y pega este enlace en tu navegador:
          </Text>
          <Link href={resetUrl} style={linkText}>
            {resetUrl}
          </Link>
        </Section>

        <Img
          src={assets.footerBanner}
          width="600"
          alt="CashIn - @CLUBCASHIN"
          style={footerImg}
        />
      </Container>
    </Body>
  </Html>
);

export default PasswordResetEmail;

const main = {
  backgroundColor: '#f4f4f4',
  fontFamily: "'Plus Jakarta Sans', 'Inter', Arial, sans-serif",
  padding: '0',
};

const container = {
  backgroundColor: '#f4f4f4',
  borderRadius: '0',
  overflow: 'hidden' as const,
  width: '100%',
  maxWidth: '600px',
  margin: '0 auto',
};

const headerImg = {
  width: '100%',
  height: 'auto' as const,
  display: 'block' as const,
  verticalAlign: 'top' as const,
};

const content = {
  padding: '20px 48px 46px',
  backgroundColor: '#f4f4f4',
};

const greeting = {
  color: '#111111',
  fontSize: '22px',
  fontWeight: '700' as const,
  lineHeight: '30px',
  textAlign: 'center' as const,
  margin: '0 0 36px 0',
};

// La sombra difuminada se simula apilando secciones con colores muy
// próximos entre sí (Gmail ignora box-shadow real). La luz "pega" desde
// arriba-izquierda: esa esquina se mantiene pegada a la tarjeta (mismo
// radius, sin padding) en todas las capas, y el volumen de sombra crece
// solo hacia abajo/derecha, para que no se vea sombra en el lado iluminado.
const shadowStep6 = {
  backgroundColor: '#eef0f2',
  borderTopLeftRadius: '16px',
  borderTopRightRadius: '22px',
  borderBottomRightRadius: '22px',
  borderBottomLeftRadius: '22px',
  padding: '0 6px 6px 0',
};

const shadowStep5 = {
  backgroundColor: '#e9ebee',
  borderTopLeftRadius: '16px',
  borderTopRightRadius: '21px',
  borderBottomRightRadius: '21px',
  borderBottomLeftRadius: '21px',
  padding: '0 5px 5px 0',
};

const shadowStep4 = {
  backgroundColor: '#e4e6ea',
  borderTopLeftRadius: '16px',
  borderTopRightRadius: '20px',
  borderBottomRightRadius: '20px',
  borderBottomLeftRadius: '20px',
  padding: '0 4px 4px 0',
};

const shadowStep3 = {
  backgroundColor: '#dfe1e6',
  borderTopLeftRadius: '16px',
  borderTopRightRadius: '19px',
  borderBottomRightRadius: '19px',
  borderBottomLeftRadius: '19px',
  padding: '0 3px 3px 0',
};

const shadowStep2 = {
  backgroundColor: '#dadce1',
  borderTopLeftRadius: '16px',
  borderTopRightRadius: '18px',
  borderBottomRightRadius: '18px',
  borderBottomLeftRadius: '18px',
  padding: '0 2px 2px 0',
};

const shadowStep1 = {
  backgroundColor: '#d5d7dd',
  borderTopLeftRadius: '16px',
  borderTopRightRadius: '17px',
  borderBottomRightRadius: '17px',
  borderBottomLeftRadius: '17px',
  padding: '0 1px 1px 0',
};

const card = {
  backgroundColor: '#ffffff',
  // Borde con contraste propio (no casi-blanco): es el único refuerzo de
  // profundidad que sobrevive en dark mode, donde los grises de las capas
  // shadowStep* se aplanan contra el fondo oscuro y box-shadow no se aplica
  // (Gmail lo ignora por completo).
  border: '1px solid #dcdfe4',
  borderRadius: '16px',
  boxSizing: 'border-box' as const,
  padding: '24px 26px',
  textAlign: 'center' as const,
  boxShadow: '0 10px 30px rgba(20, 23, 58, 0.10)',
};

const text = {
  color: '#222222',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 26px 0',
};

const ctaLabel = {
  color: '#111111',
  fontSize: '18px',
  fontWeight: '600' as const,
  lineHeight: '24px',
  margin: '0 0 10px 0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '0 0 8px 0',
};

const button = {
  backgroundColor: '#4E57EA',
  color: '#ffffff',
  padding: '13px 24px',
  borderRadius: '50px',
  fontWeight: '600' as const,
  fontSize: '18px',
  lineHeight: '22px',
  textDecoration: 'none',
  display: 'inline-block',
};

const expiry = {
  color: '#888888',
  fontSize: '10px',
  lineHeight: '14px',
  fontStyle: 'italic' as const,
  margin: '0',
};

const warningRow = {
  width: '100%',
  maxWidth: '402px',
  margin: '32px auto 0 auto',
};

const warningIconColumn = {
  width: '72px',
  verticalAlign: 'middle' as const,
};

// Sin ancho fijo: la columna del ícono sí lo tiene (imagen de 56px), así que
// esta absorbe el espacio restante y el bloque puede encoger en pantallas
// angostas sin desbordar el contenido.
const warningTextColumn = {};

const warningIconImg = {
  width: '56px',
  height: '56px',
  display: 'block' as const,
};

const warningText = {
  color: '#222222',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0',
};

const hr = {
  borderColor: '#9da5ff',
  width: '88%',
  margin: '38px auto 25px auto',
};

const linkFallback = {
  color: '#222222',
  fontSize: '16px',
  lineHeight: '22px',
  textAlign: 'center' as const,
  maxWidth: '320px',
  margin: '0 auto 16px auto',
};

const linkText = {
  color: '#4E57EA',
  fontSize: '13px',
  lineHeight: '18px',
  wordBreak: 'break-all' as const,
  display: 'block',
  textAlign: 'center' as const,
};

const footerImg = {
  width: '100%',
  height: 'auto' as const,
  display: 'block' as const,
  verticalAlign: 'top' as const,
};

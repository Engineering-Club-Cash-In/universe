import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Font,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface PortalWelcomeEmailAssets {
  headerBanner: string;
  footerBanner: string;
}

interface PortalWelcomeEmailProps {
  /** Nombre del inversionista tal como debe saludársele. */
  investorName: string;
  /** Correo con el que inicia sesión (es también su usuario). */
  loginEmail: string;
  /** Contraseña generada por el back office. Nunca va en el asunto ni en el Preview. */
  password: string;
  /** URL del portal (login). */
  portalUrl: string;
  /**
   * Empresas que ya quedaron ligadas a la cuenta. Solo aplica cuando el
   * inversionista es representante legal de una o más sociedades; si viene
   * vacío el correo no menciona empresas.
   */
  companyNames?: string[];
  assets?: PortalWelcomeEmailAssets;
}

export const PortalWelcomeEmail = ({
  investorName,
  loginEmail,
  password,
  portalUrl,
  companyNames = [],
  assets,
}: PortalWelcomeEmailProps) => (
  <Html>
    <Head>
      {/*
        Misma carga de fuente que el correo de reset: el .woff2 directo
        (subset latin) porque <Font> declara format('woff2') y un stylesheet
        de Google Fonts no se puede decodificar ahí.
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
    {/* El Preview lo lee el cliente de correo sin abrir el mensaje: aquí NUNCA va la contraseña. */}
    <Preview>Ya puedes entrar al Portal del Inversionista de CashIn</Preview>
    <Body style={main}>
      <Container style={container}>
        {assets ? (
          <Img
            src={assets.headerBanner}
            width="600"
            height="133"
            alt="CashIn"
            style={headerImg}
          />
        ) : null}

        <Section style={content}>
          <Text style={greeting}>Bienvenido, {investorName}</Text>

          <Section style={shadowStep6}>
            <Section style={shadowStep5}>
              <Section style={shadowStep4}>
                <Section style={shadowStep3}>
                  <Section style={shadowStep2}>
                    <Section style={shadowStep1}>
                      <Section style={card}>
                        <Text style={text}>
                          Ya creamos tu cuenta del Portal del Inversionista de CashIn. Desde
                          ahí puedes consultar tus inversiones, tus liquidaciones y tus
                          documentos cuando lo necesites.
                        </Text>

                        {companyNames.length > 0 ? (
                          <Text style={text}>
                            Tu cuenta también tiene acceso a{' '}
                            <strong style={strong}>{companyNames.join(', ')}</strong>, donde
                            figuras como representante legal.
                          </Text>
                        ) : null}

                        <Text style={credentialsLabel}>Estos son tus datos de ingreso</Text>

                        <Section style={credentialsBox}>
                          <Text style={credentialLine}>
                            <span style={credentialKey}>Correo:</span>{' '}
                            <span style={credentialValue}>{loginEmail}</span>
                          </Text>
                          <Text style={credentialLineLast}>
                            <span style={credentialKey}>Contraseña:</span>{' '}
                            <span style={credentialPassword}>{password}</span>
                          </Text>
                        </Section>

                        <Section style={buttonContainer}>
                          {/*
                            <Button> y no <Link>: react-email agrega los
                            workarounds que Outlook clásico necesita para
                            respetar padding y fondo redondeado.
                          */}
                          <Button href={portalUrl} style={button}>
                            Entrar al portal
                          </Button>
                        </Section>

                        <Text style={hint}>
                          Te recomendamos cambiar la contraseña la primera vez que entres,
                          desde tu perfil.
                        </Text>
                      </Section>
                    </Section>
                  </Section>
                </Section>
              </Section>
            </Section>
          </Section>

          <Text style={note}>
            Esta contraseña es personal: no la compartas con nadie. Si crees que alguien
            más la vio, cámbiala apenas entres.
          </Text>

          <Hr style={hr} />

          <Text style={linkFallback}>
            Si el botón no funciona, copia y pega este enlace en tu navegador:
          </Text>
          <Link href={portalUrl} style={linkText}>
            {portalUrl}
          </Link>
        </Section>

        {assets ? (
          <Img
            src={assets.footerBanner}
            width="600"
            alt="CashIn - @CLUBCASHIN"
            style={footerImg}
          />
        ) : null}
      </Container>
    </Body>
  </Html>
);

export default PortalWelcomeEmail;

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

// Sombra difuminada simulada apilando secciones de grises muy próximos
// (Gmail ignora box-shadow). La luz pega desde arriba-izquierda: esa esquina
// queda pegada a la tarjeta y el volumen crece hacia abajo/derecha.
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
  // Borde con contraste propio: es el único refuerzo de profundidad que
  // sobrevive en dark mode, donde los grises de shadowStep* se aplanan.
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
  margin: '0 0 22px 0',
};

const strong = {
  color: '#4E57EA',
  fontWeight: '700' as const,
};

const credentialsLabel = {
  color: '#111111',
  fontSize: '18px',
  fontWeight: '600' as const,
  lineHeight: '24px',
  margin: '0 0 12px 0',
};

const credentialsBox = {
  backgroundColor: '#f6f7ff',
  border: '1px solid #d7dafd',
  borderRadius: '12px',
  padding: '16px 18px',
  margin: '0 0 24px 0',
  textAlign: 'left' as const,
};

const credentialLine = {
  color: '#222222',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '0 0 8px 0',
  wordBreak: 'break-all' as const,
};

const credentialLineLast = {
  ...credentialLine,
  margin: '0',
};

const credentialKey = {
  color: '#666666',
  fontWeight: '600' as const,
};

const credentialValue = {
  color: '#222222',
  fontWeight: '600' as const,
};

// Monoespaciada para que no se confundan 0/O ni l/1 al transcribirla.
const credentialPassword = {
  color: '#111111',
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '17px',
  fontWeight: '700' as const,
  letterSpacing: '1px',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '0 0 12px 0',
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

const hint = {
  color: '#888888',
  fontSize: '12px',
  lineHeight: '16px',
  fontStyle: 'italic' as const,
  margin: '0',
};

const note = {
  color: '#222222',
  fontSize: '15px',
  lineHeight: '22px',
  textAlign: 'center' as const,
  maxWidth: '420px',
  margin: '32px auto 0 auto',
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

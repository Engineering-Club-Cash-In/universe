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

interface PortalCompanyAddedEmailAssets {
  headerBanner: string;
  footerBanner: string;
}

interface PortalCompanyAddedEmailProps {
  /** Nombre de la persona (representante legal) que ya tiene cuenta. */
  investorName: string;
  /** Razón social de la empresa que se le acaba de sumar a la cuenta. */
  companyName: string;
  /** URL del portal (login). */
  portalUrl: string;
  assets?: PortalCompanyAddedEmailAssets;
}

export const PortalCompanyAddedEmail = ({
  investorName,
  companyName,
  portalUrl,
  assets,
}: PortalCompanyAddedEmailProps) => (
  <Html>
    <Head>
      {/*
        Misma carga de fuente que el resto de correos del portal: el .woff2
        directo (subset latin), porque <Font> declara format('woff2').
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
    <Preview>Agregamos una empresa más a tu cuenta del portal</Preview>
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
          <Text style={greeting}>Hola, {investorName}</Text>

          <Section style={shadowStep6}>
            <Section style={shadowStep5}>
              <Section style={shadowStep4}>
                <Section style={shadowStep3}>
                  <Section style={shadowStep2}>
                    <Section style={shadowStep1}>
                      <Section style={card}>
                        <Text style={text}>
                          Te agregamos como representante legal de{' '}
                          <strong style={strong}>{companyName}</strong> en el Portal del
                          Inversionista de CashIn.
                        </Text>

                        <Text style={text}>
                          La próxima vez que entres vas a ver esta empresa junto con lo que
                          ya tenías, y puedes cambiar entre una y otra desde el selector del
                          portal.
                        </Text>

                        <Section style={buttonContainer}>
                          <Button href={portalUrl} style={button}>
                            Entrar al portal
                          </Button>
                        </Section>

                        <Text style={hint}>
                          Entras con el mismo correo y la misma contraseña de siempre: no
                          cambia nada de tu acceso.
                        </Text>
                      </Section>
                    </Section>
                  </Section>
                </Section>
              </Section>
            </Section>
          </Section>

          <Text style={note}>
            Si no esperabas este cambio, escríbenos y lo revisamos contigo.
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

export default PortalCompanyAddedEmail;

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
// (Gmail ignora box-shadow). El volumen crece hacia abajo/derecha.
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

import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Font,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
  Hr,
} from '@react-email/components';

interface LiquidationEmailAssets {
  headerBanner: string;
  footerBanner: string;
}

interface LiquidationEmailProps {
  investorName: string;
  amount: string;
  creditNumber: string;
  date: string;
  currencySymbol?: string;
  reportUrl?: string;
  assets?: LiquidationEmailAssets;
}

export const LiquidationEmail = ({
  investorName,
  date,
  reportUrl,
  assets,
}: LiquidationEmailProps) => (
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
    <Preview>Confirmación de Liquidación - CashIn</Preview>
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
        ) : (
          <Section style={headerFallback}>
            <Text style={headerFallbackText}>CashIn</Text>
          </Section>
        )}

        <Section style={content}>
          <Heading style={h1}>Confirmación de Liquidación</Heading>

          <Text style={greeting}>
            Estimado(a) <strong>{investorName}</strong>,
          </Text>

          <Text style={text}>
            Le informamos que se ha procesado con éxito la liquidación de sus rendimientos
            correspondientes al período de <strong>{date}</strong>.
          </Text>

          {reportUrl && (
            <Section style={buttonContainer}>
              {/*
                <Button> y no <Link>: react-email le agrega los workarounds
                que Outlook clásico (renderizador de Word) necesita para
                respetar el padding y el fondo redondeado; con un anchor
                simple el CTA colapsa a texto con estilos.
              */}
              <Button href={reportUrl} style={primaryButton}>
                Descargar Reporte (Excel)
              </Button>
            </Section>
          )}

          <Section style={secondaryAction}>
            <Text style={secondaryText}>¿Deseas ver más información sobre tus inversiones?</Text>
            <Button href="https://www.clubcashin.com/login" style={secondaryButton}>
              Visita el Portal del Inversionista
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footerNote}>
            Si tiene alguna duda o consulta sobre esta transacción, nuestro equipo de soporte
            está a su disposición.
          </Text>

          <Section style={footer}>
            <Text style={footerText}>
              © {new Date().getFullYear()} Club Cash In. Todos los derechos reservados.
            </Text>
            <Text style={footerText}>
              Este es un correo automático, por favor no responda a este mensaje.
            </Text>
          </Section>
        </Section>

        {assets && (
          <Img
            src={assets.footerBanner}
            width="600"
            alt="CashIn - @CLUBCASHIN"
            style={footerImg}
          />
        )}
      </Container>
    </Body>
  </Html>
);

export default LiquidationEmail;

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

const headerFallback = {
  backgroundColor: '#111111',
  padding: '40px 20px',
  textAlign: 'center' as const,
};

const headerFallbackText = {
  fontSize: '28px',
  fontWeight: '700' as const,
  color: '#ffffff',
  letterSpacing: '1px',
  margin: '0',
};

const content = {
  padding: '20px 24px 46px',
  backgroundColor: '#f4f4f4',
};

const h1 = {
  color: '#111111',
  fontSize: '24px',
  fontWeight: '700' as const,
  textAlign: 'center' as const,
  margin: '0 0 28px',
};

const greeting = {
  color: '#111111',
  fontSize: '16px',
  lineHeight: '24px',
  textAlign: 'center' as const,
  maxWidth: '420px',
  margin: '0 auto 12px',
};

const text = {
  color: '#222222',
  fontSize: '16px',
  lineHeight: '24px',
  textAlign: 'center' as const,
  maxWidth: '420px',
  margin: '0 auto 8px',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0 8px',
};

const primaryButton = {
  backgroundColor: '#4E57EA',
  color: '#ffffff',
  padding: '13px 24px',
  borderRadius: '50px',
  fontWeight: '600' as const,
  fontSize: '16px',
  lineHeight: '22px',
  textDecoration: 'none',
  display: 'inline-block',
};

const secondaryAction = {
  marginTop: '32px',
  paddingTop: '28px',
  borderTop: '1px solid #e2e4ea',
  textAlign: 'center' as const,
};

const secondaryText = {
  color: '#666666',
  fontSize: '14px',
  marginBottom: '16px',
};

const secondaryButton = {
  backgroundColor: 'transparent',
  border: '2px solid #4E57EA',
  color: '#4E57EA',
  padding: '11px 22px',
  borderRadius: '50px',
  fontWeight: '600' as const,
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-block',
};

const hr = {
  borderColor: '#e2e4ea',
  margin: '38px 0 20px',
};

const footerNote = {
  color: '#888888',
  fontSize: '13px',
  textAlign: 'center' as const,
  fontStyle: 'italic' as const,
  marginBottom: '24px',
};

const footer = {
  textAlign: 'center' as const,
};

const footerText = {
  color: '#a0aec0',
  fontSize: '12px',
  margin: '4px 0',
};

const footerImg = {
  width: '100%',
  height: 'auto' as const,
  display: 'block' as const,
  verticalAlign: 'top' as const,
};

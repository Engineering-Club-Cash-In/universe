import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
  Link,
  Img,
} from '@react-email/components';

interface LiquidationEmailProps {
  investorName: string;
  amount: string;
  creditNumber: string;
  date: string;
  currencySymbol?: string;
  reportUrl?: string;
}

export const LiquidationEmail = ({
  investorName,
  amount,
  creditNumber,
  date,
  currencySymbol = 'Q.',
  reportUrl,
}: LiquidationEmailProps) => (
  <Html>
    <Head />
    <Preview>Confirmación de Liquidación - Club Cash In</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={logo}>CLUB CASH IN</Text>
        </Section>
        <Section style={content}>
          <Heading style={h1}>Reporte de Liquidación Disponible</Heading>
          <Text style={text}>Estimado(a) <strong>{investorName}</strong>,</Text>
          <Text style={text}>
            Le informamos que se ha procesado con éxito la liquidación de sus pagos correspondientes a <strong>{date}</strong>. Los detalles completos se encuentran en el documento adjunto.
          </Text>

          {reportUrl ? (
            <Section style={buttonContainer}>
              <Link href={reportUrl} style={button}>
                Descargar Reporte (Excel)
              </Link>
            </Section>
          ) : (
            <Text style={text}>
              Adjunto a este correo encontrará el reporte detallado con el desglose de su liquidación.
            </Text>
          )}

          <Hr style={hr} />
          
          <Text style={footer}>
            Si tiene alguna duda sobre esta transacción, por favor contáctenos.
          </Text>
          <Text style={footer}>
            © {new Date().getFullYear()} Club Cash In. Todos los derechos reservados.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export default LiquidationEmail;

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
};

const header = {
  padding: '30px',
  textAlign: 'center' as const,
};

const logo = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#004aad',
  letterSpacing: '2px',
};

const content = {
  padding: '0 48px',
};

const h1 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: 'bold',
  padding: '0',
  margin: '30px 0',
  textAlign: 'center' as const,
};

const text = {
  color: '#555',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '16px 0',
};

const detailsContainer = {
  backgroundColor: '#f9f9f9',
  padding: '20px',
  borderRadius: '8px',
  margin: '20px 0',
};

const detailItem = {
  color: '#444',
  fontSize: '15px',
  margin: '8px 0',
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
};

const footer = {
  color: '#8898aa',
  fontSize: '12px',
  textAlign: 'center' as const,
  margin: '8px 0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '24px 0',
};

const button = {
  backgroundColor: '#004aad',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
};

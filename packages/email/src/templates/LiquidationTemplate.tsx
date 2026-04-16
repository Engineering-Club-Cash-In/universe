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
  Row,
  Column,
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
          <Text style={logoText}>CLUB CASH IN</Text>
        </Section>
        
        <Section style={content}>
          <Heading style={h1}>Confirmación de Liquidación</Heading>
          
          <Text style={greeting}>
            Estimado(a) <strong>{investorName}</strong>,
          </Text>
          
          <Text style={message}>
            Le informamos que se ha procesado con éxito la liquidación de sus rendimientos correspondientes al período de <strong>{date}</strong>.
          </Text>



          <Section style={buttonGroup}>
            {reportUrl && (
              <Section style={primaryAction}>
                <Link href={reportUrl} style={primaryButton}>
                  Descargar Reporte (Excel)
                </Link>
              </Section>
            )}
            
            <Section style={secondaryAction}>
              <Text style={secondaryText}>¿Deseas ver más información sobre tus inversiones?</Text>
              <Link href="https://www.clubcashin.com/login" style={secondaryButton}>
                Visitar mi Portal de Inversionista
              </Link>
            </Section>
          </Section>

          <Hr style={hr} />
          
          <Text style={footerNote}>
            Si tiene alguna duda o consulta sobre esta transacción, nuestro equipo de soporte está a su disposición.
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
      </Container>
    </Body>
  </Html>
);

export default LiquidationEmail;

const main = {
  backgroundColor: '#f4f7f9',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '40px auto',
  maxWidth: '600px',
  borderRadius: '12px',
  overflow: 'hidden',
  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
};

const header = {
  backgroundColor: '#1a202c',
  padding: '40px 20px',
  textAlign: 'center' as const,
};

const logoText = {
  fontSize: '28px',
  fontWeight: 'bold',
  color: '#ffffff',
  letterSpacing: '3px',
  margin: '0',
};

const content = {
  padding: '40px 50px',
};

const h1 = {
  color: '#1a202c',
  fontSize: '26px',
  fontWeight: 'bold',
  textAlign: 'center' as const,
  margin: '0 0 30px',
};

const greeting = {
  color: '#2d3748',
  fontSize: '18px',
  lineHeight: '1.5',
  margin: '0 0 16px',
};

const message = {
  color: '#4a5568',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '16px 0',
};


const buttonGroup = {
  textAlign: 'center' as const,
  margin: '40px 0 20px',
};

const primaryAction = {
  marginBottom: '24px',
};

const primaryButton = {
  backgroundColor: '#004aad',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
  boxShadow: '0 4px 6px rgba(0, 74, 173, 0.2)',
};

const secondaryAction = {
  marginTop: '32px',
  paddingTop: '32px',
  borderTop: '1px solid #edf2f7',
};

const secondaryText = {
  color: '#718096',
  fontSize: '15px',
  marginBottom: '16px',
};

const secondaryButton = {
  backgroundColor: 'transparent',
  border: '2px solid #004aad',
  borderRadius: '6px',
  color: '#004aad',
  fontSize: '15px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 28px',
};

const hr = {
  borderColor: '#edf2f7',
  margin: '40px 0 20px',
};

const footerNote = {
  color: '#718096',
  fontSize: '14px',
  textAlign: 'center' as const,
  fontStyle: 'italic',
  marginBottom: '30px',
};

const footer = {
  textAlign: 'center' as const,
};

const footerText = {
  color: '#a0aec0',
  fontSize: '12px',
  margin: '4px 0',
};

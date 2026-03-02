import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface PasswordResetEmailProps {
  resetUrl: string;
}

export const PasswordResetEmail = ({ resetUrl }: PasswordResetEmailProps) => (
  <Html>
    <Head />
    <Preview>Restablecer contraseña - CashIn</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={logo}>💰 CashIn</Text>
          <Text style={subtitle}>Portal Financiero</Text>
        </Section>

        <Section style={content}>
          <Text style={h2}>🔐 Restablecer Contraseña</Text>

          <Text style={text}>Hola,</Text>
          <Text style={text}>
            Recibimos una solicitud para restablecer la contraseña de tu cuenta en{' '}
            <strong style={{ color: '#4E57EA' }}>CashIn</strong>.
          </Text>
          <Text style={text}>
            Haz clic en el siguiente botón para crear una nueva contraseña:
          </Text>

          <Section style={buttonContainer}>
            <Button href={resetUrl} style={button}>
              Restablecer Contraseña
            </Button>
          </Section>

          <Section style={warning}>
            <Text style={warningText}>
              ⚠️ Si no solicitaste restablecer tu contraseña, puedes ignorar este correo.
              Tu contraseña no será modificada.
            </Text>
          </Section>

          <Text style={expiry}>⏱️ Este enlace expirará en 1 hora por seguridad.</Text>

          <Hr style={hr} />

          <Text style={linkFallback}>
            Si el botón no funciona, copia y pega este enlace en tu navegador:
          </Text>
          <Link href={resetUrl} style={linkText}>
            {resetUrl}
          </Link>
        </Section>

        <Section style={footer}>
          <Text style={footerBrand}>💰 CashIn</Text>
          <Text style={footerCopy}>
            © {new Date().getFullYear()} CashIn. Todos los derechos reservados.
          </Text>
          <Text style={footerNote}>
            Este es un correo automático, por favor no respondas a este mensaje.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export default PasswordResetEmail;

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: "'Segoe UI', Arial, sans-serif",
  padding: '20px',
};

const container = {
  backgroundColor: '#ffffff',
  border: '1px solid #e8eaf6',
  borderRadius: '12px',
  overflow: 'hidden' as const,
  maxWidth: '600px',
  margin: '0 auto',
};

const header = {
  background: 'linear-gradient(135deg, #4E57EA 0%, #3a42c4 100%)',
  padding: '30px',
  textAlign: 'center' as const,
};

const logo = {
  color: '#D8E54A',
  fontSize: '32px',
  fontWeight: '700' as const,
  letterSpacing: '1px',
  margin: '0 0 6px 0',
};

const subtitle = {
  color: 'rgba(216, 229, 74, 0.75)',
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '2px',
  margin: '0',
};

const content = {
  padding: '30px',
  backgroundColor: '#ffffff',
};

const h2 = {
  color: '#4E57EA',
  fontSize: '20px',
  fontWeight: '600' as const,
  margin: '0 0 20px 0',
};

const text = {
  color: '#555555',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '0 0 20px 0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '30px 0',
};

const button = {
  backgroundColor: '#4E57EA',
  color: '#ffffff',
  padding: '14px 32px',
  borderRadius: '8px',
  fontWeight: '600' as const,
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-block',
};

const warning = {
  backgroundColor: 'rgba(78, 87, 234, 0.06)',
  borderLeft: '3px solid #4E57EA',
  padding: '15px',
  margin: '25px 0',
  borderRadius: '0 8px 8px 0',
};

const warningText = {
  color: '#555555',
  fontSize: '13px',
  margin: '0',
};

const expiry = {
  color: '#888888',
  fontSize: '13px',
  margin: '20px 0 0 0',
};

const hr = {
  borderColor: '#e8eaf6',
  margin: '25px 0',
};

const linkFallback = {
  color: '#888888',
  fontSize: '11px',
  textAlign: 'center' as const,
  margin: '0 0 8px 0',
};

const linkText = {
  color: '#4E57EA',
  fontSize: '10px',
  wordBreak: 'break-all' as const,
  display: 'block',
  textAlign: 'center' as const,
};

const footer = {
  backgroundColor: '#f6f9fc',
  padding: '20px',
  textAlign: 'center' as const,
  borderTop: '1px solid #e8eaf6',
};

const footerBrand = {
  color: '#4E57EA',
  fontSize: '14px',
  fontWeight: '600' as const,
  margin: '0 0 5px 0',
};

const footerCopy = {
  color: '#888888',
  fontSize: '11px',
  margin: '0',
};

const footerNote = {
  color: '#aaaaaa',
  fontSize: '10px',
  margin: '10px 0 0 0',
};

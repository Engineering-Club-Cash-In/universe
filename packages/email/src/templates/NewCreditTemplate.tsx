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
  Button,
} from '@react-email/components';

interface NewCreditEmailProps {
  clientName: string;
  creditNumber: string;
  capital: string;
  plazo: number;
  cuota: string;
  interestRate: string;
  investors: string[];
  currencySymbol?: string;
  vehiculoMarca?: string;
  vehiculoLinea?: string;
  vehiculoModelo?: string;
  vehiculoPlaca?: string;
  vehiculoVin?: string;
  montoAsegurado?: number;
  opportunityId?: string;
  aseguradora?: string;
}

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

const investorItem = {
  color: '#444',
  fontSize: '14px',
  margin: '4px 0',
  paddingLeft: '10px',
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
};

const innerHr = {
  borderColor: '#e6ebf1',
  margin: '10px 0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '30px 0',
};

const button = {
  backgroundColor: '#004aad',
  borderRadius: '5px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
};

const footer = {
  color: '#8898aa',
  fontSize: '12px',
  textAlign: 'center' as const,
  margin: '8px 0',
};

export const NewCreditEmail = ({
  clientName,
  creditNumber,
  capital,
  plazo,
  cuota,
  interestRate,
  investors,
  currencySymbol = 'Q.',
  vehiculoMarca,
  vehiculoLinea,
  vehiculoModelo,
  vehiculoPlaca,
  vehiculoVin,
  montoAsegurado,
  opportunityId,
  aseguradora,
}: NewCreditEmailProps) => {
  const hasVehicleInfo = vehiculoMarca || vehiculoLinea || vehiculoModelo || vehiculoPlaca || vehiculoVin;
  const oportunidadUrl = `https://crm.s3.devteamatcci.site/crm/opportunities?opportunityId=${opportunityId}&tab=create`;
  
  return (
  <Html>
    <Head />
    <Preview>Nuevo Crédito Creado - {creditNumber}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={logo}>CLUB CASH IN</Text>
        </Section>
        <Section style={content}>
          <Heading style={h1}>Nuevo Crédito Creado</Heading>
          <Text style={text}>
            Se ha registrado un nuevo crédito en el sistema.
          </Text>

          <Section style={detailsContainer}>
            <Text style={detailItem}><strong>Cliente:</strong> {clientName}</Text>
            <Text style={detailItem}><strong>No. Crédito:</strong> {creditNumber}</Text>
            <Text style={detailItem}><strong>Capital:</strong> {currencySymbol}{capital}</Text>
            <Text style={detailItem}><strong>Plazo:</strong> {plazo} meses</Text>
            <Text style={detailItem}><strong>Cuota:</strong> {currencySymbol}{cuota}</Text>
            <Text style={detailItem}><strong>Tasa de Interés:</strong> {interestRate}%</Text>
            {aseguradora && (
              <Text style={detailItem}><strong>Aseguradora:</strong> {aseguradora}</Text>
            )}
          </Section>

          {investors.length > 0 && (
            <Section style={detailsContainer}>
              <Text style={detailItem}><strong>Inversionistas:</strong></Text>
              {investors.map((inv, i) => (
                <Text key={i} style={investorItem}>• {inv}</Text>
              ))}
            </Section>
          )}

          {(hasVehicleInfo || montoAsegurado !== undefined) && (
            <Section style={detailsContainer}>
              <Text style={detailItem}><strong>Información del Vehículo y Seguro</strong></Text>
              <Hr style={innerHr} />
              {vehiculoMarca && <Text style={detailItem}><strong>Marca:</strong> {vehiculoMarca}</Text>}
              {vehiculoLinea && <Text style={detailItem}><strong>Línea:</strong> {vehiculoLinea}</Text>}
              {vehiculoModelo && <Text style={detailItem}><strong>Modelo:</strong> {vehiculoModelo}</Text>}
              {vehiculoPlaca && <Text style={detailItem}><strong>Placa:</strong> {vehiculoPlaca}</Text>}
              {vehiculoVin && <Text style={detailItem}><strong>VIN:</strong> {vehiculoVin}</Text>}
              {montoAsegurado !== undefined && (
                <Text style={detailItem}>
                  <strong>Monto Asegurado:</strong> {currencySymbol}{montoAsegurado.toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                </Text>
              )}
            </Section>
          )}

          {opportunityId && (
            <Section style={buttonContainer}>
              <Button 
                href={oportunidadUrl}
                style={button}
              >
                Ver Oportunidad en CRM
              </Button>
            </Section>
          )}

          <Hr style={hr} />

          <Text style={footer}>
            © {new Date().getFullYear()} Club Cash In. Todos los derechos reservados.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
  );
};

export default NewCreditEmail;



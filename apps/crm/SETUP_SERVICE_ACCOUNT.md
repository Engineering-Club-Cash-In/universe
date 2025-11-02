# Configuración de Cuenta de Servicio para Legal Docs

Este documento describe cómo configurar la cuenta de servicio necesaria para que el API de `legal-docs-blueprints` pueda guardar contratos en el CRM automáticamente.

## Requisitos Previos

- El CRM debe estar corriendo (`bun dev` en `/apps/crm`)
- Acceso a la base de datos PostgreSQL del CRM
- Acceso de administrador al CRM

## Paso 1: Crear el Usuario de Servicio

Existen dos formas de crear la cuenta de servicio:

### Opción A: Mediante la Interfaz Web del CRM (Recomendado)

1. Inicia sesión en el CRM con una cuenta de administrador
2. Ve a la sección de gestión de usuarios
3. Crea un nuevo usuario con los siguientes datos:
   - **Email**: `legal-docs-api@clubcashin.com`
   - **Nombre**: `Legal Docs API`
   - **Contraseña**: Genera una contraseña segura (guárdala para el Paso 2)
   - **Rol**: `juridico` (necesario para crear contratos legales)
4. Guarda el usuario

### Opción B: Mediante SQL Directo

Si prefieres crear el usuario directamente en la base de datos:

```sql
-- Nota: Esta opción requiere hashear la contraseña manualmente
-- Es más complejo, se recomienda usar la Opción A
```

## Paso 2: Configurar Legal Docs Blueprints

1. Navega a `/apps/legal-docs-blueprints`
2. Edita el archivo `.env`:

```bash
# CRM Integration (para guardar contratos generados)
CRM_API_URL=http://localhost:3000
CRM_SERVICE_ACCOUNT_EMAIL=legal-docs-api@clubcashin.com
CRM_SERVICE_ACCOUNT_PASSWORD=<la_contraseña_que_creaste_en_paso_1>
```

3. Si estás usando Docker, asegúrate de que el `CRM_API_URL` apunte al servicio correcto:

```bash
# En Docker Compose, usar el nombre del servicio:
CRM_API_URL=http://crm-server:3000
```

## Paso 3: Verificar la Configuración

### Verificar que el usuario existe en CRM:

```bash
# Desde el directorio /apps/crm
cd apps/crm

# Conectarse a la base de datos
psql $DATABASE_URL

# Verificar el usuario
SELECT id, email, name, role FROM "user" WHERE email = 'legal-docs-api@clubcashin.com';
```

Deberías ver algo como:
```
                  id                  |            email             |     name      |   role
--------------------------------------+------------------------------+---------------+----------
 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx | legal-docs-api@clubcashin.com | Legal Docs API | juridico
```

### Verificar que legal-docs-blueprints puede autenticarse:

1. Inicia el servidor de legal-docs-blueprints:
```bash
cd apps/legal-docs-blueprints
bun run dev
```

2. Observa los logs. Cuando se genere un documento con DPI, deberías ver:
```
[CrmApiService] Autenticación exitosa
[CrmApiService] ✓ Contrato guardado en CRM para DPI: XXXXXXXXXX
```

## Paso 4: Prueba de Integración

### Probar la integración completa:

1. Asegúrate de que ambos servicios estén corriendo:
   - CRM: `http://localhost:3000`
   - Legal Docs Blueprints: `http://localhost:4000`

2. Desde el frontend de legal-documents, genera un documento:
   - Selecciona un tipo de documento
   - Ingresa el DPI del cliente (debe existir en el CRM como lead)
   - Completa los campos requeridos
   - Genera el documento

3. Verifica que el contrato aparezca en el CRM:
   - Ve a la sección "Jurídico" del CRM
   - Busca el lead por DPI
   - Deberías ver el contrato recién creado con los signing links

## Troubleshooting

### Error: "No autorizado - se requiere autenticación"

**Causa**: Las credenciales son incorrectas o el usuario no existe.

**Solución**:
1. Verifica que el email sea exactamente `legal-docs-api@clubcashin.com`
2. Verifica que la contraseña en `.env` sea correcta
3. Intenta iniciar sesión manualmente en el CRM con esas credenciales

### Error: "No autorizado - se requiere cuenta de servicio"

**Causa**: El usuario existe pero no tiene el email correcto.

**Solución**:
1. El sistema solo acepta el email `legal-docs-api@clubcashin.com` como cuenta de servicio
2. Verifica que el usuario tenga exactamente ese email

### Error: "No se encontró lead con DPI: XXXXXXXXXX"

**Causa**: El DPI enviado no corresponde a ningún lead en el CRM.

**Solución**:
1. Verifica que el lead exista en el CRM
2. Verifica que el campo `dpi` del lead sea exactamente igual al enviado
3. Si hay múltiples leads con el mismo DPI, el sistema usa el más reciente

### Los contratos no aparecen en el CRM pero la generación funciona

**Causa**: El guardado en CRM falla pero no bloquea la generación de documentos (comportamiento intencional).

**Solución**:
1. Revisa los logs de legal-docs-blueprints para ver el error específico
2. Verifica que `CRM_API_URL` sea correcto
3. Verifica que el servidor CRM esté corriendo y accesible

## Notas de Seguridad

1. **Contraseña segura**: Usa una contraseña fuerte para la cuenta de servicio (mínimo 16 caracteres, con letras, números y símbolos)

2. **Rotación de contraseñas**: Cambia la contraseña periódicamente y actualiza el `.env` en consecuencia

3. **Permisos mínimos**: El rol `juridico` tiene solo los permisos necesarios para crear contratos, no puede modificar otros datos del CRM

4. **Logs**: Los intentos de autenticación y guardado de contratos quedan registrados en los logs para auditoría

5. **No versionar contraseñas**: Asegúrate de que `.env` esté en `.gitignore` y nunca commitees las contraseñas

## Arquitectura de la Integración

```
legal-documents (Frontend)
  ↓ genera documentos con DPI
legal-docs-blueprints API
  ↓ crea PDFs + signing links en Documenso
  ↓ autentica con cuenta de servicio
CRM /api/contracts/external
  ↓ busca lead por DPI
  ↓ crea registro en generated_legal_contracts
Database (PostgreSQL)
```

## Referencias

- Schema de contratos: `/apps/crm/apps/server/src/db/schema/legal-contracts.ts`
- Endpoint externo: `/apps/crm/apps/server/src/routes/external-contracts.ts`
- Cliente CRM: `/apps/legal-docs-blueprints/services/CrmApiService.ts`
- Generador de contratos: `/apps/legal-docs-blueprints/services/ContractGeneratorService.ts`

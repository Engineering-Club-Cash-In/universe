// apps/cartera/src/controllers/infornet.controller.ts
import { db } from '@/db';
import { renapInfo } from '@/db/schema';
import { type EstudioPersonaJSON, infornetPersonaCache } from '@/db/schema/buro';
import { eq, and, gt, lte } from 'drizzle-orm';
import { InfornetClient } from '../../../../../../packages/infornet/index';

// 🔥 Instanciar el cliente con las credenciales del .env
const infornetClient = new InfornetClient({
  username: process.env.INFORNET_USERNAME!,
  password: process.env.INFORNET_PASSWORD!,
});

export class InfornetController {
  
  /**
   * Obtiene el estudio completo de una persona por DPI
   * 1. Valida que existe en renapInfo
   * 2. Busca en caché de infornet
   * 3. Si no existe o expiró, consulta a la API de Infornet
   */
  async obtenerEstudioPorDPI(dpi: string): Promise<{
    success: boolean;
    data?: EstudioPersonaJSON;
    fromCache?: boolean;
    error?: string;
  }> {
    try {
      console.log(`\n🔍 ========== BUSCANDO ESTUDIO PARA DPI: ${dpi} ==========`);
      
      // 1. Validar que el DPI existe en renapInfo
      console.log(`   📋 1. Validando DPI en RENAP...`);
      const personaRenap = await db
        .select()
        .from(renapInfo)
        .where(eq(renapInfo.dpi, dpi))
        .limit(1);

      if (personaRenap.length === 0) {
        console.log(`   ❌ DPI no encontrado en RENAP`);
        return {
          success: false,
          error: 'DPI no encontrado en RENAP',
        };
      }

      console.log(`   ✅ DPI encontrado en RENAP: ${personaRenap[0].firstName} ${personaRenap[0].firstLastName}`);

      // 2. Buscar en caché de Infornet (que no esté expirado)
      console.log(`   💾 2. Buscando en caché de Infornet...`);
      const cache = await db
        .select()
        .from(infornetPersonaCache)
        .where(
          and(
            eq(infornetPersonaCache.dpi, dpi),
            gt(infornetPersonaCache.expiraEn, new Date())
          )
        )
        .limit(1);

      if (cache.length > 0) {
        const diasRestantes = Math.ceil(
          (cache[0].expiraEn.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );
        console.log(`   ✅ ¡CACHÉ HIT! Expira en ${diasRestantes} días`);
        console.log(`   📅 Consultado originalmente: ${cache[0].consultadoEn.toLocaleDateString()}`);
        return {
          success: true,
          data: cache[0].estudioCompleto,
          fromCache: true,
        };
      }

      console.log(`   ⚠️ No hay caché válido, consultando API...`);

      // 3. No hay caché válido, consultar a la API de Infornet
      console.log(`   🌐 3. Consultando API de Infornet...`);
      
      // 3.1 Primero buscar el código de persona
      console.log(`   🔍 3.1. Buscando código de persona en Infornet...`);
      const codigoPersona = await this.buscarCodigoPersona(dpi);
      
      if (!codigoPersona) {
        console.log(`   ❌ Persona no encontrada en Infornet`);
        return {
          success: false,
          error: 'Persona no encontrada en Infornet',
        };
      }

      console.log(`   ✅ Código de persona encontrado: ${codigoPersona}`);

      // 3.2 Obtener el estudio completo
      console.log(`   📄 3.2. Obteniendo estudio completo...`);
      const estudio = await this.obtenerEstudioDesdeAPI(codigoPersona);
      
      if (!estudio) {
        console.log(`   ❌ Error al obtener estudio de Infornet`);
        return {
          success: false,
          error: 'Error al obtener estudio de Infornet',
        };
      }

      console.log(`   ✅ Estudio obtenido exitosamente`);

      // 3.3 Guardar en caché (30 días)
      console.log(`   💾 3.3. Guardando en caché...`);
      await this.guardarEnCache(dpi, estudio, personaRenap[0]);

      console.log(`\n✅ ========== ESTUDIO COMPLETADO ==========\n`);

      return {
        success: true,
        data: estudio,
        fromCache: false,
      };

    } catch (error) {
      console.error('❌ Error en obtenerEstudioPorDPI:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }

  /**
   * Busca el código de persona en Infornet por DPI
   * Usa InfornetClient directamente (SOAP)
   */
  private async buscarCodigoPersona(dpi: string): Promise<number | null> {
    try {
      console.log(`      🔍 Buscando persona con DPI: ${dpi}`);
      
      // 🔥 Llamar directamente al cliente SOAP
      const personas = await infornetClient.busquedaPersona({
        orden: 'DPI',
        registro: dpi,
        pais: 'GT',
      });

      if (personas.length === 0) {
        console.log(`      ⚠️ No se encontraron resultados`);
        return null;
      }

      const codigo = personas[0].codigoPersona;
      console.log(`      ✅ Código encontrado: ${codigo}`);
      return codigo;
    } catch (error) {
      console.error('      ❌ Error en buscarCodigoPersona:', error);
      return null;
    }
  }

  /**
   * Obtiene el estudio completo usando InfornetClient
   * Llama directamente al SOAP de Infornet
   */
  private async obtenerEstudioDesdeAPI(
    codigoPersona: number
  ): Promise<EstudioPersonaJSON | null> {
    try {
      console.log(`      📄 Obteniendo estudio completo para código: ${codigoPersona}`);
      
      // 🔥 Llamar directamente al cliente SOAP
      const estudio = await infornetClient.estudioPersona(codigoPersona);

      console.log(`      ✅ Estudio obtenido correctamente`);
      return estudio as EstudioPersonaJSON;
    } catch (error) {
      console.error('      ❌ Error en obtenerEstudioDesdeAPI:', error);
      return null;
    }
  }

  /**
   * Guarda el estudio en caché
   */
  private async guardarEnCache(
    dpi: string,
    estudio: EstudioPersonaJSON,
    personaRenap: typeof renapInfo.$inferSelect
  ): Promise<void> {
    try {
      // Calcular fecha de expiración (30 días)
      const expiraEn = new Date();
      expiraEn.setDate(expiraEn.getDate() + 30);

      console.log(`      📊 Datos del estudio:`);
      console.log(`         - Referencias comerciales: ${estudio.referenciasComerciales.length}`);
      console.log(`         - Referencias judiciales: ${estudio.referenciasJudiciales.delitos.length} delitos`);
      console.log(`         - PEP: ${estudio.pep?.esPEP ? 'SÍ' : 'NO'}`);
      console.log(`         - Inmuebles: ${estudio.inmuebles.length}`);
      console.log(`         - Vehículos: ${estudio.vehiculos.length}`);
      console.log(`         - Empresas: ${estudio.empresasPropiedad.length}`);

      await db
        .insert(infornetPersonaCache)
        .values({
          codigoPersona: estudio.fichaPrincipal.codigo,
          dpi,
          nombres: personaRenap.firstName + (personaRenap.secondName ? ` ${personaRenap.secondName}` : ''),
          apellidos: personaRenap.firstLastName + (personaRenap.secondLastName ? ` ${personaRenap.secondLastName}` : ''),
          fechaNacimiento: personaRenap.birthDate?.toString(),
          sexo: personaRenap.gender,
          estudioCompleto: estudio,
          tieneReferenciasComerciales: estudio.referenciasComerciales.length > 0,
          tieneReferenciasJudiciales:
            estudio.referenciasJudiciales.delitos.length > 0 ||
            estudio.referenciasJudiciales.involucrados.length > 0,
          esPEP: estudio.pep?.esPEP || false,
          cantidadInmuebles: estudio.inmuebles.length,
          cantidadVehiculos: estudio.vehiculos.length,
          cantidadEmpresas: estudio.empresasPropiedad.length,
          consultadoEn: new Date(),
          expiraEn,
        })
        .onConflictDoUpdate({
          target: infornetPersonaCache.dpi,
          set: {
            estudioCompleto: estudio,
            tieneReferenciasComerciales: estudio.referenciasComerciales.length > 0,
            tieneReferenciasJudiciales:
              estudio.referenciasJudiciales.delitos.length > 0 ||
              estudio.referenciasJudiciales.involucrados.length > 0,
            esPEP: estudio.pep?.esPEP || false,
            cantidadInmuebles: estudio.inmuebles.length,
            cantidadVehiculos: estudio.vehiculos.length,
            cantidadEmpresas: estudio.empresasPropiedad.length,
            consultadoEn: new Date(),
            expiraEn,
            updatedAt: new Date(),
          },
        });

      console.log(`      ✅ Estudio guardado en caché hasta: ${expiraEn.toLocaleDateString()}`);
    } catch (error) {
      console.error('      ❌ Error al guardar en caché:', error);
      // No lanzamos el error para no bloquear la respuesta
    }
  }

  /**
   * Análisis rápido de riesgo basado en el estudio
   */
  async analizarRiesgo(dpi: string): Promise<{
    scoreRiesgo: number;
    nivelRiesgo: 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO';
    alertas: string[];
    detalles: {
      tieneDelitosPenales: boolean;
      tieneMorosidad: boolean;
      esPEP: boolean;
      tienePatrimonio: boolean;
    };
  } | null> {
    console.log(`\n📊 ========== ANÁLISIS DE RIESGO PARA DPI: ${dpi} ==========`);
    
    const resultado = await this.obtenerEstudioPorDPI(dpi);

    if (!resultado.success || !resultado.data) {
      console.log(`   ❌ No se pudo obtener el estudio para análisis`);
      return null;
    }

    const estudio = resultado.data;

    // Análisis de riesgo
    console.log(`   🔍 Analizando factores de riesgo...`);
    
    const tieneDelitosPenales = estudio.referenciasJudiciales.delitos.length > 0;
    console.log(`      ${tieneDelitosPenales ? '🚨' : '✅'} Delitos penales: ${tieneDelitosPenales ? 'SÍ' : 'NO'}`);
    
    const tieneMorosidad = estudio.referenciasComerciales.some(
      ref => ref.estado?.toUpperCase().includes('MOROSO') ||
             ref.estado?.toUpperCase().includes('VENCIDO') ||
             ref.estado?.toUpperCase().includes('MORA')
    );
    console.log(`      ${tieneMorosidad ? '🚨' : '✅'} Morosidad: ${tieneMorosidad ? 'SÍ' : 'NO'}`);
    
    const esPEP = estudio.pep?.esPEP || false;
    console.log(`      ${esPEP ? '⚠️' : '✅'} PEP: ${esPEP ? 'SÍ' : 'NO'}`);
    
    const tienePatrimonio =
      estudio.inmuebles.length > 0 ||
      estudio.vehiculos.length > 0 ||
      estudio.empresasPropiedad.length > 0;
    console.log(`      ${tienePatrimonio ? '✅' : '⚠️'} Patrimonio: ${tienePatrimonio ? 'SÍ' : 'NO'}`);

    // Calcular score (0-100)
    let score = 100;
    const alertas: string[] = [];

    if (tieneDelitosPenales) {
      score -= 40;
      alertas.push('DELITOS_PENALES');
      console.log(`      ⚠️ -40 puntos por delitos penales`);
    }
    if (tieneMorosidad) {
      score -= 30;
      alertas.push('MOROSIDAD');
      console.log(`      ⚠️ -30 puntos por morosidad`);
    }
    if (esPEP) {
      score -= 10;
      alertas.push('PEP');
      console.log(`      ⚠️ -10 puntos por ser PEP`);
    }
    if (!tienePatrimonio) {
      score -= 20;
      alertas.push('SIN_PATRIMONIO');
      console.log(`      ⚠️ -20 puntos por no tener patrimonio`);
    }

    let nivelRiesgo: 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO';
    if (score >= 80) nivelRiesgo = 'BAJO';
    else if (score >= 60) nivelRiesgo = 'MEDIO';
    else if (score >= 40) nivelRiesgo = 'ALTO';
    else nivelRiesgo = 'CRITICO';

    const emoji = 
      nivelRiesgo === 'BAJO' ? '🟢' :
      nivelRiesgo === 'MEDIO' ? '🟡' :
      nivelRiesgo === 'ALTO' ? '🟠' : '🔴';

    console.log(`\n   📊 RESULTADO: ${emoji} ${nivelRiesgo} (Score: ${score}/100)`);
    console.log(`   🚨 Alertas: ${alertas.length > 0 ? alertas.join(', ') : 'Ninguna'}`);
    console.log(`========== FIN ANÁLISIS ==========\n`);

    return {
      scoreRiesgo: score,
      nivelRiesgo,
      alertas,
      detalles: {
        tieneDelitosPenales,
        tieneMorosidad,
        esPEP,
        tienePatrimonio,
      },
    };
  }

  /**
   * Obtener estadísticas del caché
   */
  async obtenerEstadisticasCache(): Promise<{
    total: number;
    vigentes: number;
    expirados: number;
    conReferenciasComerciales: number;
    conReferenciasJudiciales: number;
    peps: number;
  }> {
    try {
      const todos = await db
        .select()
        .from(infornetPersonaCache);

      const ahora = new Date();
      const vigentes = todos.filter(c => c.expiraEn > ahora);
      const expirados = todos.filter(c => c.expiraEn <= ahora);

      return {
        total: todos.length,
        vigentes: vigentes.length,
        expirados: expirados.length,
        conReferenciasComerciales: todos.filter(c => c.tieneReferenciasComerciales).length,
        conReferenciasJudiciales: todos.filter(c => c.tieneReferenciasJudiciales).length,
        peps: todos.filter(c => c.esPEP).length,
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas del caché:', error);
      throw error;
    }
  }

  /**
   * Limpiar caché expirado
   */
  async limpiarCacheExpirado(): Promise<number> {
    try {
      const resultado = await db
        .delete(infornetPersonaCache)
        .where(
          lte(infornetPersonaCache.expiraEn, new Date())
        )
        .returning();

      console.log(`🧹 Se eliminaron ${resultado.length} registros expirados del caché`);
      return resultado.length;
    } catch (error) {
      console.error('Error limpiando caché expirado:', error);
      throw error;
    }
  }
}

// Export singleton
export const infornetController = new InfornetController();
import pandas as pd
import numpy as np
import os
from datetime import datetime
import base64

def generar_dashboard_ejecutivo():
    """
    Genera un dashboard ejecutivo HTML completo con todos los análisis
    """
    
    # Leer datos para métricas principales
    df = pd.read_csv('big_data_limpio.csv', encoding='utf-8')
    
    # Función para limpiar monedas
    def limpiar_monedas(valor):
        if isinstance(valor, str):
            limpio = valor.replace('Q', '').replace(',', '').replace(' ', '').replace('-', '')
            if limpio == '':
                return np.nan
            return float(limpio)
        return valor

    df['PRECIO PRODUCTO'] = df['PRECIO PRODUCTO'].apply(limpiar_monedas)
    df['SUELDO'] = df['SUELDO'].apply(limpiar_monedas)
    df['Cuotas pendientes actual'] = pd.to_numeric(df['Cuotas pendientes actual'], errors='coerce')
    
    # Limpiar datos para análisis
    for col in ['ESTADO CIVIL', 'OCUPACION', 'VIVIENDA PROPIA', 'VEHICULO PROPIO', 'TARJETA DE CREDITO', 'TIPO DE COMPRAS', 'UTILIZACION DINERO']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df[col] = df[col].replace('nan', np.nan)

    df_limpio = df.dropna(subset=['VIVIENDA PROPIA', 'TARJETA DE CREDITO', 'SUELDO', 'PRECIO PRODUCTO', 'Cuotas pendientes actual'])

    # Calcular métricas principales
    total_clientes = len(df_limpio)
    morosos = len(df_limpio[df_limpio['Cuotas pendientes actual'] > 1])
    tasa_morosidad = (morosos / total_clientes) * 100
    monto_promedio = df_limpio['PRECIO PRODUCTO'].mean()
    sueldo_promedio = df_limpio['SUELDO'].mean()

    # Crear perfiles crediticios para métricas dinámicas
    def crear_perfil(row):
        v = row['VIVIENDA PROPIA']
        t = row['TARJETA DE CREDITO']
        if v == 'Si' and t == 'No':
            return 'Propietario Conservador'
        elif v == 'No' and t == 'Si':
            return 'Urbano con Crédito'
        elif v == 'Si' and t == 'Si':
            return 'Establecido Premium'
        else:
            return 'Joven Emergente'

    df_limpio = df_limpio.copy()
    df_limpio['PERFIL'] = df_limpio.apply(crear_perfil, axis=1)

    # Calcular métricas por perfil
    perfiles_dist = df_limpio['PERFIL'].value_counts()
    perfiles_pct = df_limpio['PERFIL'].value_counts(normalize=True) * 100

    perfiles_morosos = df_limpio[df_limpio['Cuotas pendientes actual'] > 1]['PERFIL'].value_counts()
    perfiles_totales = df_limpio['PERFIL'].value_counts()
    tasa_morosidad_perfil = (perfiles_morosos / perfiles_totales * 100).fillna(0)

    # Identificar perfil de mayor y menor riesgo
    perfil_mayor_riesgo = tasa_morosidad_perfil.idxmax()
    perfil_menor_riesgo = tasa_morosidad_perfil.idxmin()
    perfil_mas_grande = perfiles_dist.idxmax()

    # Correlación vivienda-tarjeta
    df_limpio['VIV_NUM'] = df_limpio['VIVIENDA PROPIA'].map({'Si': 1, 'No': 0})
    df_limpio['TAR_NUM'] = df_limpio['TARJETA DE CREDITO'].map({'Si': 1, 'No': 0})
    corr_viv_tar = df_limpio[['VIV_NUM', 'TAR_NUM']].corr().iloc[0, 1]

    # Ahorro potencial
    monto_promedio_moroso = df_limpio[df_limpio['Cuotas pendientes actual'] > 1]['PRECIO PRODUCTO'].mean()
    ahorro_potencial = monto_promedio_moroso * morosos * 0.5
    
    # Función para convertir imagen a base64
    def imagen_a_base64(ruta_imagen):
        try:
            with open(ruta_imagen, "rb") as img_file:
                return base64.b64encode(img_file.read()).decode('utf-8')
        except:
            return ""
    
    # Lista de gráficas disponibles
    graficas = [
        ('hist_sueldos.png', 'Distribución de Sueldos'),
        ('hist_precio_producto.png', 'Distribución de Precio de Producto'),
        ('count_ocupacion.png', 'Clientes por Ocupación'),
        ('count_estado_civil.png', 'Clientes por Estado Civil'),
        ('pie_vivienda.png', 'Proporción de Vivienda Propia'),
        ('pie_vehiculo.png', 'Proporción de Vehículo Propio'),
        ('pie_tarjeta.png', 'Proporción de Tarjeta de Crédito'),
        ('box_sueldo_ocupacion.png', 'Sueldo por Ocupación'),
        ('cuotas_por_sueldo.png', 'Cuotas Pendientes por Nivel de Sueldo'),
        ('matriz_correlaciones.png', 'Matriz de Correlaciones'),
        ('distribucion_perfiles.png', 'Distribución de Perfiles Crediticios'),
        ('comparativa_perfiles.png', 'Comparativa de Perfiles'),
        ('matriz_estrategica_perfiles.png', 'Matriz Estratégica de Perfiles'),
        ('morosidad_por_perfil.png', 'Morosidad por Perfil Crediticio'),
        ('comparativa_morosos_al_dia.png', 'Comparativa Morosos vs Al Día'),
        ('morosidad_por_ocupacion.png', 'Morosidad por Ocupación')
    ]
    
    # Crear HTML del dashboard
    html_content = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Ejecutivo - Análisis de Clientes</title>
        <style>
            * {{
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }}
            
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f5f5f5;
            }}
            
            .header {{
                background: linear-gradient(135deg, #2c3e50, #3498db);
                color: white;
                padding: 30px 0;
                text-align: center;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            
            .header h1 {{
                font-size: 2.5em;
                margin-bottom: 10px;
                font-weight: 300;
            }}
            
            .header p {{
                font-size: 1.2em;
                opacity: 0.9;
            }}
            
            .container {{
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }}
            
            .metrics-grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin: 30px 0;
            }}
            
            .metric-card {{
                background: white;
                padding: 25px;
                border-radius: 10px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                text-align: center;
                transition: transform 0.3s ease;
            }}
            
            .metric-card:hover {{
                transform: translateY(-5px);
            }}
            
            .metric-number {{
                font-size: 2.2em;
                font-weight: bold;
                color: #2c3e50;
                margin-bottom: 10px;
            }}
            
            .metric-label {{
                font-size: 1em;
                color: #7f8c8d;
                text-transform: uppercase;
                letter-spacing: 1px;
            }}
            
            .section {{
                background: white;
                margin: 30px 0;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            }}
            
            .section h2 {{
                color: #2c3e50;
                font-size: 1.8em;
                margin-bottom: 20px;
                border-bottom: 3px solid #3498db;
                padding-bottom: 10px;
            }}
            
            .insights-grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
                margin: 20px 0;
            }}
            
            .insight-card {{
                background: #f8f9fa;
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid #3498db;
            }}
            
            .insight-card h3 {{
                color: #2c3e50;
                margin-bottom: 10px;
                font-size: 1.1em;
            }}
            
            .insight-card p {{
                color: #555;
                line-height: 1.5;
            }}
            
            .chart-container {{
                text-align: center;
                margin: 30px 0;
            }}
            
            .chart-container img {{
                max-width: 100%;
                height: auto;
                border-radius: 8px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            }}
            
            .chart-title {{
                font-size: 1.2em;
                color: #2c3e50;
                margin: 15px 0;
                font-weight: 600;
            }}
            
            .navigation {{
                background: white;
                padding: 20px;
                margin: 20px 0;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                text-align: center;
            }}
            
            .nav-button {{
                display: inline-block;
                padding: 10px 20px;
                margin: 5px;
                background: #3498db;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                transition: background 0.3s ease;
            }}
            
            .nav-button:hover {{
                background: #2980b9;
            }}
            
            .recommendations {{
                background: linear-gradient(135deg, #27ae60, #2ecc71);
                color: white;
                padding: 30px;
                border-radius: 10px;
                margin: 30px 0;
            }}
            
            .recommendations h2 {{
                color: white;
                border-bottom: 3px solid white;
            }}
            
            .rec-grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
                margin: 20px 0;
            }}
            
            .rec-card {{
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 8px;
                backdrop-filter: blur(10px);
            }}
            
            .fecha {{
                text-align: center;
                color: #7f8c8d;
                margin: 20px 0;
                font-style: italic;
            }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Dashboard Ejecutivo</h1>
            <p>Análisis Integral de Clientes - Inteligencia de Negocio</p>
        </div>
        
        <div class="container">
            <!-- Navegación -->
            <div class="navigation">
                <a href="#metricas" class="nav-button">📊 Métricas Clave</a>
                <a href="#perfiles" class="nav-button">👥 Perfiles Crediticios</a>
                <a href="#morosidad" class="nav-button">⚠️ Análisis de Morosidad</a>
                <a href="#correlaciones" class="nav-button">🔗 Correlaciones</a>
                <a href="#recomendaciones" class="nav-button">💡 Recomendaciones</a>
            </div>
            
            <!-- Métricas Principales -->
            <section id="metricas" class="section">
                <h2>📊 Métricas Principales</h2>
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-number">{total_clientes:,}</div>
                        <div class="metric-label">Total Clientes</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-number">{tasa_morosidad:.1f}%</div>
                        <div class="metric-label">Tasa de Morosidad</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-number">Q{monto_promedio:,.0f}</div>
                        <div class="metric-label">Precio Promedio Producto</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-number">Q{sueldo_promedio:,.0f}</div>
                        <div class="metric-label">Sueldo Promedio</div>
                    </div>
                </div>
            </section>
            
            <!-- Insights Clave -->
            <section class="section">
                <h2>🎯 Insights Estratégicos Clave</h2>
                <div class="insights-grid">
                    <div class="insight-card">
                        <h3>🏠 Correlación Vivienda-Crédito</h3>
                        <p>Correlación de {corr_viv_tar:.2f} entre vivienda propia y tarjeta de crédito. Los propietarios tienden a ser más conservadores financieramente.</p>
                    </div>
                    <div class="insight-card">
                        <h3>💳 Perfiles Diferenciados</h3>
                        <p>4 perfiles crediticios identificados: {', '.join(f'{p} ({perfiles_pct[p]:.1f}%)' for p in perfiles_pct.index)}.</p>
                    </div>
                    <div class="insight-card">
                        <h3>⚠️ Riesgo Concentrado</h3>
                        <p>El perfil "{perfil_mayor_riesgo}" tiene {tasa_morosidad_perfil[perfil_mayor_riesgo]:.1f}% de morosidad vs {tasa_morosidad:.1f}% promedio general. Representa {perfiles_pct[perfil_mayor_riesgo]:.1f}% de clientes.</p>
                    </div>
                    <div class="insight-card">
                        <h3>💰 Capacidad Limitada</h3>
                        <p>Los productos promedian Q{monto_promedio:,.0f} vs sueldo promedio de Q{sueldo_promedio:,.0f} (ratio {sueldo_promedio/monto_promedio:.1f}x), indicando necesidad de financiamiento a largo plazo.</p>
                    </div>
                </div>
            </section>
    """
    
    # Agregar secciones de gráficas
    secciones_graficas = {
        'demograficos': ['hist_sueldos.png', 'hist_precio_producto.png', 'count_ocupacion.png', 'count_estado_civil.png'],
        'bienes': ['pie_vivienda.png', 'pie_vehiculo.png', 'pie_tarjeta.png'],
        'correlaciones': ['matriz_correlaciones.png'],
        'perfiles': ['distribucion_perfiles.png', 'comparativa_perfiles.png', 'matriz_estrategica_perfiles.png'],
        'morosidad': ['morosidad_por_perfil.png', 'comparativa_morosos_al_dia.png', 'morosidad_por_ocupacion.png'],
        'financiero': ['box_sueldo_ocupacion.png', 'cuotas_por_sueldo.png']
    }
    
    titulos_secciones = {
        'demograficos': '👥 Análisis Demográfico',
        'bienes': '🏠 Tenencia de Bienes',
        'correlaciones': '🔗 Matriz de Correlaciones',
        'perfiles': '📊 Perfiles Crediticios',
        'morosidad': '⚠️ Análisis de Morosidad',
        'financiero': '💰 Análisis Financiero'
    }
    
    for seccion, archivos in secciones_graficas.items():
        html_content += f'''
            <section id="{seccion}" class="section">
                <h2>{titulos_secciones[seccion]}</h2>
        '''
        
        for archivo in archivos:
            ruta_completa = f'graficas_clientes/{archivo}'
            titulo_grafica = next((titulo for nombre, titulo in graficas if nombre == archivo), archivo.replace('.png', '').replace('_', ' ').title())
            imagen_base64 = imagen_a_base64(ruta_completa)
            
            if imagen_base64:
                html_content += f'''
                    <div class="chart-container">
                        <div class="chart-title">{titulo_grafica}</div>
                        <img src="data:image/png;base64,{imagen_base64}" alt="{titulo_grafica}">
                    </div>
                '''
        
        html_content += '</section>'
    
    # Sección de recomendaciones
    html_content += f'''
            <!-- Recomendaciones Estratégicas -->
            <section id="recomendaciones" class="recommendations">
                <h2>💡 Recomendaciones Estratégicas</h2>
                <div class="rec-grid">
                    <div class="rec-card">
                        <h3>🎯 Enfoque Prioritario</h3>
                        <p><strong>Perfil {perfil_menor_riesgo}:</strong> Concentrar esfuerzos en este segmento ({perfiles_pct[perfil_menor_riesgo]:.1f}% de clientes) con la menor morosidad ({tasa_morosidad_perfil[perfil_menor_riesgo]:.1f}%).</p>
                    </div>
                    <div class="rec-card">
                        <h3>⚠️ Gestión de Riesgo</h3>
                        <p><strong>Perfil {perfil_mayor_riesgo}:</strong> Implementar scoring más estricto y monitoreo especial para este segmento de mayor riesgo ({tasa_morosidad_perfil[perfil_mayor_riesgo]:.1f}% morosidad).</p>
                    </div>
                    <div class="rec-card">
                        <h3>🚀 Oportunidades de Crecimiento</h3>
                        <p><strong>Up-selling:</strong> Los perfiles con menor morosidad muestran estabilidad. Ofrecer productos complementarios y aumentar límites de crédito.</p>
                    </div>
                    <div class="rec-card">
                        <h3>🔄 Estrategia Anti-Morosidad</h3>
                        <p><strong>Prevención:</strong> Contacto proactivo con clientes en cuota 1, reestructuración para sueldos bajos, y programas de lealtad. {morosos:,} clientes actualmente morosos.</p>
                    </div>
                    <div class="rec-card">
                        <h3>📊 Scoring Crediticio</h3>
                        <p><strong>Variables clave:</strong> Vivienda propia, tarjeta de crédito, y ocupación son los mejores predictores. Actualizar algoritmos de aprobación.</p>
                    </div>
                    <div class="rec-card">
                        <h3>💰 Impacto Financiero</h3>
                        <p><strong>ROI Estimado:</strong> Reducir morosidad en 50% podría generar ahorros de Q{ahorro_potencial:,.0f}. Monto total en riesgo: Q{monto_promedio_moroso * morosos:,.0f}.</p>
                    </div>
                </div>
            </section>
            
            <!-- Conclusiones -->
            <section class="section">
                <h2>📈 Conclusiones Ejecutivas</h2>
                <div class="insights-grid">
                    <div class="insight-card">
                        <h3>✅ Fortalezas Identificadas</h3>
                        <p>Base de {total_clientes:,} clientes con 3 perfiles principales equilibrados (~30% cada uno). Tasa de morosidad general: {tasa_morosidad:.1f}%. Correlaciones claras para scoring crediticio.</p>
                    </div>
                    <div class="insight-card">
                        <h3>⚡ Acciones Inmediatas</h3>
                        <p>1) Implementar scoring diferenciado por perfil. 2) Monitoreo especial del segmento {perfil_mayor_riesgo}. 3) Estrategias de up-selling para perfiles estables.</p>
                    </div>
                    <div class="insight-card">
                        <h3>🎯 Objetivos 2026</h3>
                        <p>Reducir morosidad de {tasa_morosidad:.1f}% a &lt;10%. Incrementar penetración en Perfil {perfil_mas_grande}. Desarrollar productos específicos por perfil crediticio.</p>
                    </div>
                    <div class="insight-card">
                        <h3>📊 Próximos Análisis</h3>
                        <p>Análisis de cohortes por antigüedad. Modelo predictivo de morosidad. Segmentación geográfica. Análisis de rentabilidad por perfil.</p>
                    </div>
                </div>
            </section>
            
            <div class="fecha">
                Dashboard generado el {datetime.now().strftime("%d de %B de %Y a las %H:%M")}
            </div>
        </div>
        
        <script>
            // Smooth scrolling para navegación
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {{
                anchor.addEventListener('click', function (e) {{
                    e.preventDefault();
                    document.querySelector(this.getAttribute('href')).scrollIntoView({{
                        behavior: 'smooth'
                    }});
                }});
            }});
        </script>
    </body>
    </html>
    '''
    
    # Guardar el archivo HTML
    with open('dashboard_ejecutivo.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print("✅ Dashboard ejecutivo generado exitosamente!")
    print("📂 Archivo: dashboard_ejecutivo.html")
    print("🌐 Abrir en navegador para visualizar")
    
    return "dashboard_ejecutivo.html"

if __name__ == "__main__":
    generar_dashboard_ejecutivo() 
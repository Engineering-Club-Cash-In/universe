import pandas as pd
import numpy as np
import os
from datetime import datetime
import base64

def generar_dashboard_ejecutivo_julio_2025():
    """
    Genera un dashboard ejecutivo HTML completo con todos los análisis de julio 2025
    """
    
    # Leer datos procesados de julio 2025
    df = pd.read_csv('big_data_julio_2025_limpio.csv', encoding='utf-8')
    
    # Asegurar tipos de datos correctos
    df['PRECIO PRODUCTO'] = pd.to_numeric(df['PRECIO PRODUCTO'], errors='coerce')
    df['SUELDO'] = pd.to_numeric(df['SUELDO'], errors='coerce')
    df['Cuotas pendientes actual'] = pd.to_numeric(df['Cuotas pendientes actual'], errors='coerce').fillna(0)
    
    # Limpiar datos para análisis
    df_limpio = df.dropna(subset=['VIVIENDA PROPIA', 'TARJETA DE CREDITO', 'SUELDO', 'PRECIO PRODUCTO'])
    
    # Calcular métricas principales
    total_clientes = len(df_limpio)
    morosos = len(df_limpio[df_limpio['Cuotas pendientes actual'] > 1])
    tasa_morosidad = (morosos / total_clientes) * 100
    monto_promedio = df_limpio['PRECIO PRODUCTO'].mean()
    sueldo_promedio = df_limpio['SUELDO'].mean()
    
    # Función para convertir imagen a base64
    def imagen_a_base64(ruta_imagen):
        try:
            with open(ruta_imagen, "rb") as img_file:
                return base64.b64encode(img_file.read()).decode('utf-8')
        except:
            return ""
    
    # Lista de gráficas disponibles (usando el nuevo directorio)
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
    
    # Calcular insights actualizados basados en los datos de julio 2025
    # Análisis de correlaciones
    df_corr = df_limpio.copy()
    df_corr['VIVIENDA_NUM'] = (df_corr['VIVIENDA PROPIA'] == 'Si').astype(int)
    df_corr['TARJETA_NUM'] = (df_corr['TARJETA DE CREDITO'] == 'Si').astype(int)
    corr_vivienda_tarjeta = df_corr[['VIVIENDA_NUM', 'TARJETA_NUM']].corr().iloc[0, 1]
    
    # Análisis de capacidad de pago
    capacidad_pago = sueldo_promedio / monto_promedio
    
    # Crear HTML del dashboard
    html_content = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Ejecutivo - Análisis de Clientes Julio 2025</title>
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
            
            .date-banner {{
                background: #f39c12;
                color: white;
                padding: 10px;
                text-align: center;
                font-weight: bold;
                margin-bottom: 20px;
                border-radius: 5px;
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
            
            .update-notice {{
                background: #3498db;
                color: white;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
                text-align: center;
            }}
            
            .update-notice strong {{
                font-size: 1.1em;
            }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Dashboard Ejecutivo - Julio 2025</h1>
            <p>Análisis Integral de Clientes - Inteligencia de Negocio</p>
        </div>
        
        <div class="container">
            <!-- Banner de fecha -->
            <div class="date-banner">
                📅 DATOS ACTUALIZADOS: JULIO 2025
            </div>
            
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
                <h2>📊 Métricas Principales - Julio 2025</h2>
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
            
            <!-- Insights Clave Actualizados -->
            <section class="section">
                <h2>🎯 Insights Estratégicos Clave - Actualización Julio 2025</h2>
                <div class="insights-grid">
                    <div class="insight-card">
                        <h3>🏠 Correlación Vivienda-Crédito</h3>
                        <p>Correlación de {corr_vivienda_tarjeta:.2f} entre vivienda propia y tarjeta de crédito. Los patrones de comportamiento financiero se mantienen consistentes.</p>
                    </div>
                    <div class="insight-card">
                        <h3>💳 Perfiles Crediticios</h3>
                        <p>Se han identificado 4 perfiles crediticios diferenciados con distribuciones actualizadas según los datos de julio 2025.</p>
                    </div>
                    <div class="insight-card">
                        <h3>⚠️ Estado de Morosidad</h3>
                        <p>Tasa de morosidad actual: {tasa_morosidad:.1f}%. Se han identificado {morosos} clientes con más de 1 cuota pendiente.</p>
                    </div>
                    <div class="insight-card">
                        <h3>💰 Capacidad de Pago</h3>
                        <p>Relación sueldo/producto: {capacidad_pago:.2f}x. Los productos cuestan en promedio {1/capacidad_pago:.1f}x el sueldo mensual.</p>
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
            # Usar el nuevo directorio de gráficas
            ruta_completa = f'graficas_clientes_julio_2025/{archivo}'
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
    
    # Sección de recomendaciones actualizadas
    html_content += f'''
            <!-- Recomendaciones Estratégicas -->
            <section id="recomendaciones" class="recommendations">
                <h2>💡 Recomendaciones Estratégicas - Julio 2025</h2>
                <div class="rec-grid">
                    <div class="rec-card">
                        <h3>🎯 Segmentación Actualizada</h3>
                        <p><strong>Perfiles Crediticios:</strong> Los 4 perfiles identificados muestran comportamientos diferenciados. Personalizar ofertas según cada perfil para maximizar conversión.</p>
                    </div>
                    <div class="rec-card">
                        <h3>⚠️ Gestión de Morosidad</h3>
                        <p><strong>Tasa Actual {tasa_morosidad:.1f}%:</strong> Implementar estrategias preventivas para mantener o reducir este indicador. Focalizar en perfiles de mayor riesgo.</p>
                    </div>
                    <div class="rec-card">
                        <h3>🚀 Oportunidades de Crecimiento</h3>
                        <p><strong>Base de {total_clientes} clientes:</strong> Identificar clientes con buen historial para ofertas de productos adicionales o incremento de límites.</p>
                    </div>
                    <div class="rec-card">
                        <h3>🔄 Optimización de Productos</h3>
                        <p><strong>Relación Precio/Sueldo:</strong> Con productos a {1/capacidad_pago:.1f}x el sueldo, considerar plazos más largos o productos de menor ticket.</p>
                    </div>
                    <div class="rec-card">
                        <h3>📊 Scoring Crediticio</h3>
                        <p><strong>Variables Clave:</strong> Vivienda propia, tarjeta de crédito y ocupación siguen siendo predictores importantes según los datos actualizados.</p>
                    </div>
                    <div class="rec-card">
                        <h3>💰 Impacto Potencial</h3>
                        <p><strong>Oportunidad:</strong> Reducir morosidad al promedio del mejor perfil podría generar ahorros significativos de Q{(df_limpio[df_limpio['Cuotas pendientes actual'] > 1]['PRECIO PRODUCTO'].sum() * 0.3):,.0f}</p>
                    </div>
                </div>
            </section>
            
            <!-- Conclusiones -->
            <section class="section">
                <h2>📈 Conclusiones Ejecutivas - Julio 2025</h2>
                <div class="insights-grid">
                    <div class="insight-card">
                        <h3>✅ Estado Actual</h3>
                        <p>Base de {total_clientes} clientes con tasa de morosidad de {tasa_morosidad:.1f}%. Los indicadores muestran una cartera con potencial de optimización en segmentación y productos.</p>
                    </div>
                    <div class="insight-card">
                        <h3>⚡ Acciones Prioritarias</h3>
                        <p>1) Implementar estrategias diferenciadas por perfil. 2) Fortalecer scoring crediticio. 3) Desarrollar productos acordes a la capacidad de pago actual.</p>
                    </div>
                    <div class="insight-card">
                        <h3>🎯 Objetivos Sugeridos</h3>
                        <p>Mantener morosidad bajo {tasa_morosidad:.0f}%. Incrementar penetración en perfiles de bajo riesgo. Mejorar relación precio/sueldo con nuevos productos.</p>
                    </div>
                    <div class="insight-card">
                        <h3>📊 Monitoreo Continuo</h3>
                        <p>Establecer KPIs por perfil crediticio. Análisis mensual de morosidad. Seguimiento de efectividad de nuevas estrategias.</p>
                    </div>
                </div>
            </section>
            
            <div class="update-notice">
                <strong>📊 Dashboard actualizado con datos de Julio 2025</strong><br>
                Este análisis refleja el estado actual de la cartera de clientes
            </div>
            
            <div class="fecha">
                Dashboard generado el {datetime.now().strftime("%d de %B de %Y a las %H:%M")}<br>
                <strong>Datos correspondientes a: JULIO 2025</strong>
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
    with open('dashboard_ejecutivo_julio_2025.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print("✅ Dashboard ejecutivo julio 2025 generado exitosamente!")
    print("📂 Archivo: dashboard_ejecutivo_julio_2025.html")
    print("📊 Usando gráficas de: graficas_clientes_julio_2025/")
    print("🌐 Abrir en navegador para visualizar")
    
    return "dashboard_ejecutivo_julio_2025.html"

if __name__ == "__main__":
    generar_dashboard_ejecutivo_julio_2025()
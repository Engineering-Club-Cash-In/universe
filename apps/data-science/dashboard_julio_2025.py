import pandas as pd
import numpy as np
import os
from datetime import datetime
import base64

def generar_dashboard_julio_2025():
    """
    Genera un dashboard ejecutivo HTML con los datos de julio 2025
    """
    
    # Leer y procesar datos de julio 2025 (la segunda fila contiene los headers)
    df_raw = pd.read_csv('big_data_julio_2025.csv', encoding='utf-8', header=1)
    
    # Buscar las columnas correctas (algunas tienen nombres ligeramente diferentes)
    columnas_disponibles = df_raw.columns.tolist()
    
    # Mapeo de columnas del archivo nuevo
    columnas_mapeo = {
        'CLIENTE': 'CLIENTE',
        'PRECIO PRODUCTO': 'PRECIO PRODUCTO',
        'SUELDO': 'SUELDO',
        'EDAD (RANGO DE EDAD EN AÑOS)': 'EDAD (RANGO DE EDAD EN AÑOS)',
        'DEPENDIENTES ECONOMICOS': 'DEPENDIENTES ECONOMICOS',
        'OCUPACIÓN': 'OCUPACION',
        'ANTIGÜEDAD': 'ANTIGUEDAD',
        'ESTADO CIVIL': 'ESTADO CIVIL',
        'UTILIZACION DINERO': 'UTILIZACION DINERO',
        'VIVIENDA PROPIA': 'VIVIENDA PROPIA',
        'VEHICULO PROPIO': 'VEHICULO PROPIO',
        'TARJETA DE CREDITO': 'TARJETA DE CREDITO',
        'TIPO DE COMPRAS': 'TIPO DE COMPRAS',
        'Cuotas pendientes actual': 'Cuotas pendientes actual'
    }
    
    # Seleccionar columnas disponibles
    # Para algunas columnas, usar la primera versión disponible (sin .1, .2, etc.)
    columnas_seleccionadas = []
    for col_buscar in columnas_mapeo.keys():
        if col_buscar in columnas_disponibles:
            columnas_seleccionadas.append(col_buscar)
        else:
            # Buscar columnas similares
            encontrada = False
            for col_disponible in columnas_disponibles:
                if col_buscar in col_disponible and not encontrada:
                    columnas_seleccionadas.append(col_disponible)
                    encontrada = True
                    break
            if not encontrada:
                print(f"Advertencia: No se encontró la columna {col_buscar}")
    
    # Crear dataframe con las columnas seleccionadas
    df = df_raw[columnas_seleccionadas].copy()
    
    # Renombrar columnas para estandarizar
    nuevos_nombres = []
    for col in columnas_seleccionadas:
        for col_original, col_nuevo in columnas_mapeo.items():
            if col_original in col:
                nuevos_nombres.append(col_nuevo)
                break
    
    df.columns = nuevos_nombres
    
    # Función para limpiar monedas
    def limpiar_monedas(valor):
        if isinstance(valor, str):
            # Eliminar espacios, Q, comas y otros caracteres
            limpio = valor.replace('Q', '').replace(',', '').replace(' ', '').replace('-', '').replace('.', '')
            if limpio == '':
                return np.nan
            try:
                return float(limpio) / 100  # Dividir por 100 porque los valores parecen estar en centavos
            except:
                return np.nan
        return valor
    
    # Función para limpiar valores Si/No
    def limpiar_si_no(valor):
        if isinstance(valor, str):
            valor = valor.strip().lower()
            if valor in ['si', '1', 'sí']:
                return 'Si'
            elif valor in ['no', '2']:
                return 'No'
        return valor
    
    # Limpiar datos
    df['PRECIO PRODUCTO'] = df['PRECIO PRODUCTO'].apply(limpiar_monedas)
    df['SUELDO'] = df['SUELDO'].apply(limpiar_monedas)
    df['Cuotas pendientes actual'] = pd.to_numeric(df['Cuotas pendientes actual'], errors='coerce').fillna(0)
    
    # Limpiar columnas Si/No
    for col in ['VIVIENDA PROPIA', 'VEHICULO PROPIO', 'TARJETA DE CREDITO']:
        df[col] = df[col].apply(limpiar_si_no)
    
    # Filtrar datos válidos
    df_limpio = df.dropna(subset=['PRECIO PRODUCTO', 'SUELDO'])
    df_limpio = df_limpio[df_limpio['PRECIO PRODUCTO'] > 0]
    df_limpio = df_limpio[df_limpio['SUELDO'] > 0]
    
    # Calcular métricas principales
    total_clientes = len(df_limpio)
    morosos = len(df_limpio[df_limpio['Cuotas pendientes actual'] > 1])
    tasa_morosidad = (morosos / total_clientes) * 100 if total_clientes > 0 else 0
    monto_promedio = df_limpio['PRECIO PRODUCTO'].mean()
    sueldo_promedio = df_limpio['SUELDO'].mean()
    
    # Leer datos anteriores para comparación (si existe)
    try:
        df_anterior = pd.read_csv('big_data_limpio.csv', encoding='utf-8')
        df_anterior['PRECIO PRODUCTO'] = df_anterior['PRECIO PRODUCTO'].apply(limpiar_monedas)
        df_anterior['SUELDO'] = df_anterior['SUELDO'].apply(limpiar_monedas)
        df_anterior['Cuotas pendientes actual'] = pd.to_numeric(df_anterior['Cuotas pendientes actual'], errors='coerce')
        
        # Calcular métricas anteriores
        total_clientes_anterior = len(df_anterior)
        morosos_anterior = len(df_anterior[df_anterior['Cuotas pendientes actual'] > 1])
        tasa_morosidad_anterior = (morosos_anterior / total_clientes_anterior) * 100 if total_clientes_anterior > 0 else 0
        monto_promedio_anterior = df_anterior['PRECIO PRODUCTO'].mean()
        sueldo_promedio_anterior = df_anterior['SUELDO'].mean()
        
        # Calcular cambios
        cambio_clientes = ((total_clientes - total_clientes_anterior) / total_clientes_anterior) * 100
        cambio_morosidad = tasa_morosidad - tasa_morosidad_anterior
        cambio_monto = ((monto_promedio - monto_promedio_anterior) / monto_promedio_anterior) * 100
        cambio_sueldo = ((sueldo_promedio - sueldo_promedio_anterior) / sueldo_promedio_anterior) * 100
        
        comparacion_disponible = True
    except:
        comparacion_disponible = False
        cambio_clientes = cambio_morosidad = cambio_monto = cambio_sueldo = 0
    
    # Función para convertir imagen a base64
    def imagen_a_base64(ruta_imagen):
        try:
            with open(ruta_imagen, "rb") as img_file:
                return base64.b64encode(img_file.read()).decode('utf-8')
        except:
            return ""
    
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
                position: relative;
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
            
            .metric-change {{
                position: absolute;
                top: 10px;
                right: 10px;
                font-size: 0.9em;
                font-weight: bold;
                padding: 5px 10px;
                border-radius: 15px;
            }}
            
            .metric-change.positive {{
                color: #27ae60;
                background: #e8f8f5;
            }}
            
            .metric-change.negative {{
                color: #e74c3c;
                background: #fdeaea;
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
            
            .alert {{
                background: #fff3cd;
                border: 1px solid #ffeaa7;
                color: #856404;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
            }}
            
            .comparison-table {{
                width: 100%;
                border-collapse: collapse;
                margin-top: 20px;
            }}
            
            .comparison-table th,
            .comparison-table td {{
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #ddd;
            }}
            
            .comparison-table th {{
                background-color: #f8f9fa;
                font-weight: 600;
                color: #2c3e50;
            }}
            
            .comparison-table tr:hover {{
                background-color: #f8f9fa;
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
            
            .fecha {{
                text-align: center;
                color: #7f8c8d;
                margin: 20px 0;
                font-style: italic;
            }}
            
            .highlight {{
                background-color: #fffacd;
                padding: 2px 5px;
                border-radius: 3px;
            }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Dashboard Ejecutivo - Julio 2025</h1>
            <p>Análisis Integral de Clientes - Actualización Semestral</p>
        </div>
        
        <div class="container">
    """
    
    # Alerta sobre los datos
    html_content += """
            <div class="alert">
                <strong>📊 Datos Actualizados:</strong> Este dashboard presenta el análisis de los datos de clientes 
                correspondientes a julio 2025, permitiendo una comparación semestral con los datos anteriores.
            </div>
    """
    
    # Métricas principales con cambios
    html_content += f"""
            <section id="metricas" class="section">
                <h2>📊 Métricas Principales - Julio 2025</h2>
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-number">{total_clientes:,}</div>
                        <div class="metric-label">Total Clientes</div>
    """
    
    if comparacion_disponible:
        cambio_class = "positive" if cambio_clientes >= 0 else "negative"
        simbolo = "+" if cambio_clientes >= 0 else ""
        html_content += f'<div class="metric-change {cambio_class}">{simbolo}{cambio_clientes:.1f}%</div>'
    
    html_content += f"""
                    </div>
                    <div class="metric-card">
                        <div class="metric-number">{tasa_morosidad:.1f}%</div>
                        <div class="metric-label">Tasa de Morosidad</div>
    """
    
    if comparacion_disponible:
        cambio_class = "negative" if cambio_morosidad > 0 else "positive"
        simbolo = "+" if cambio_morosidad > 0 else ""
        html_content += f'<div class="metric-change {cambio_class}">{simbolo}{cambio_morosidad:.1f}pp</div>'
    
    html_content += f"""
                    </div>
                    <div class="metric-card">
                        <div class="metric-number">Q{monto_promedio:,.0f}</div>
                        <div class="metric-label">Precio Promedio Producto</div>
    """
    
    if comparacion_disponible:
        cambio_class = "positive" if cambio_monto >= 0 else "negative"
        simbolo = "+" if cambio_monto >= 0 else ""
        html_content += f'<div class="metric-change {cambio_class}">{simbolo}{cambio_monto:.1f}%</div>'
    
    html_content += f"""
                    </div>
                    <div class="metric-card">
                        <div class="metric-number">Q{sueldo_promedio:,.0f}</div>
                        <div class="metric-label">Sueldo Promedio</div>
    """
    
    if comparacion_disponible:
        cambio_class = "positive" if cambio_sueldo >= 0 else "negative"
        simbolo = "+" if cambio_sueldo >= 0 else ""
        html_content += f'<div class="metric-change {cambio_class}">{simbolo}{cambio_sueldo:.1f}%</div>'
    
    html_content += """
                    </div>
                </div>
            </section>
    """
    
    # Tabla comparativa
    if comparacion_disponible:
        html_content += f"""
            <section class="section">
                <h2>📈 Comparación Semestral</h2>
                <table class="comparison-table">
                    <thead>
                        <tr>
                            <th>Métrica</th>
                            <th>Datos Anteriores</th>
                            <th>Julio 2025</th>
                            <th>Cambio</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Total de Clientes</td>
                            <td>{total_clientes_anterior:,}</td>
                            <td>{total_clientes:,}</td>
                            <td class="{'highlight' if abs(cambio_clientes) > 10 else ''}">{'+' if cambio_clientes >= 0 else ''}{cambio_clientes:.1f}%</td>
                        </tr>
                        <tr>
                            <td>Tasa de Morosidad</td>
                            <td>{tasa_morosidad_anterior:.1f}%</td>
                            <td>{tasa_morosidad:.1f}%</td>
                            <td class="{'highlight' if abs(cambio_morosidad) > 2 else ''}">{'+' if cambio_morosidad > 0 else ''}{cambio_morosidad:.1f}pp</td>
                        </tr>
                        <tr>
                            <td>Precio Promedio Producto</td>
                            <td>Q{monto_promedio_anterior:,.0f}</td>
                            <td>Q{monto_promedio:,.0f}</td>
                            <td>{'+' if cambio_monto >= 0 else ''}{cambio_monto:.1f}%</td>
                        </tr>
                        <tr>
                            <td>Sueldo Promedio</td>
                            <td>Q{sueldo_promedio_anterior:,.0f}</td>
                            <td>Q{sueldo_promedio:,.0f}</td>
                            <td>{'+' if cambio_sueldo >= 0 else ''}{cambio_sueldo:.1f}%</td>
                        </tr>
                    </tbody>
                </table>
            </section>
        """
    
    # Análisis adicional de los datos actuales
    html_content += f"""
            <section class="section">
                <h2>🎯 Análisis de Datos - Julio 2025</h2>
                <div class="insights-grid">
                    <div class="insight-card">
                        <h3>📊 Distribución de Clientes</h3>
                        <p>Total de registros analizados: <strong>{total_clientes:,}</strong><br>
                        Clientes al día: <strong>{total_clientes - morosos:,}</strong> ({((total_clientes - morosos)/total_clientes*100):.1f}%)<br>
                        Clientes morosos: <strong>{morosos:,}</strong> ({tasa_morosidad:.1f}%)</p>
                    </div>
                    <div class="insight-card">
                        <h3>💰 Análisis Financiero</h3>
                        <p>Relación Precio/Sueldo: <strong>{monto_promedio/sueldo_promedio:.1f}x</strong><br>
                        Monto total en productos: <strong>Q{df_limpio['PRECIO PRODUCTO'].sum():,.0f}</strong><br>
                        Monto promedio morosos: <strong>Q{df_limpio[df_limpio['Cuotas pendientes actual'] > 1]['PRECIO PRODUCTO'].mean():,.0f}</strong></p>
                    </div>
    """
    
    # Análisis por vivienda propia
    vivienda_stats = df_limpio['VIVIENDA PROPIA'].value_counts()
    if 'Si' in vivienda_stats.index:
        pct_vivienda = (vivienda_stats['Si'] / len(df_limpio)) * 100
        html_content += f"""
                    <div class="insight-card">
                        <h3>🏠 Perfil de Propiedad</h3>
                        <p>Con vivienda propia: <strong>{pct_vivienda:.1f}%</strong><br>
        """
        
        # Morosidad por vivienda
        if len(df_limpio[df_limpio['VIVIENDA PROPIA'] == 'Si']) > 0:
            morosidad_con_vivienda = (len(df_limpio[(df_limpio['VIVIENDA PROPIA'] == 'Si') & (df_limpio['Cuotas pendientes actual'] > 1)]) / 
                                     len(df_limpio[df_limpio['VIVIENDA PROPIA'] == 'Si'])) * 100
            html_content += f"Morosidad con vivienda: <strong>{morosidad_con_vivienda:.1f}%</strong><br>"
        
        if len(df_limpio[df_limpio['VIVIENDA PROPIA'] == 'No']) > 0:
            morosidad_sin_vivienda = (len(df_limpio[(df_limpio['VIVIENDA PROPIA'] == 'No') & (df_limpio['Cuotas pendientes actual'] > 1)]) / 
                                     len(df_limpio[df_limpio['VIVIENDA PROPIA'] == 'No'])) * 100
            html_content += f"Morosidad sin vivienda: <strong>{morosidad_sin_vivienda:.1f}%</strong>"
        
        html_content += "</p></div>"
    
    html_content += """
                </div>
            </section>
    """
    
    # Recomendaciones basadas en los cambios
    if comparacion_disponible:
        html_content += """
            <section class="section">
                <h2>💡 Recomendaciones Basadas en la Evolución Semestral</h2>
                <div class="insights-grid">
        """
        
        if cambio_morosidad > 2:
            html_content += """
                    <div class="insight-card">
                        <h3>⚠️ Alerta de Morosidad</h3>
                        <p>La morosidad ha aumentado significativamente. Se recomienda implementar medidas preventivas 
                        urgentes y revisar los criterios de aprobación crediticia.</p>
                    </div>
            """
        elif cambio_morosidad < -2:
            html_content += """
                    <div class="insight-card">
                        <h3>✅ Mejora en Morosidad</h3>
                        <p>Excelente reducción en la tasa de morosidad. Las estrategias implementadas están funcionando. 
                        Considere documentar y mantener estas prácticas.</p>
                    </div>
            """
        
        if cambio_clientes > 10:
            html_content += """
                    <div class="insight-card">
                        <h3>📈 Crecimiento de Base</h3>
                        <p>Crecimiento significativo en la base de clientes. Asegúrese de mantener la calidad del servicio 
                        y monitorear de cerca los nuevos clientes para prevenir morosidad.</p>
                    </div>
            """
        
        html_content += """
                </div>
            </section>
        """
    
    # Footer
    html_content += f"""
            <div class="fecha">
                Dashboard generado el {datetime.now().strftime("%d de %B de %Y a las %H:%M")}<br>
                <small>Datos correspondientes a Julio 2025</small>
            </div>
        </div>
    </body>
    </html>
    """
    
    # Guardar el archivo HTML
    with open('dashboard_julio_2025.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    # Guardar datos procesados
    df_limpio.to_csv('big_data_julio_2025_limpio.csv', index=False, encoding='utf-8')
    
    print("✅ Dashboard Julio 2025 generado exitosamente!")
    print("📂 Archivo: dashboard_julio_2025.html")
    print("📊 Datos procesados guardados en: big_data_julio_2025_limpio.csv")
    print("🌐 Abrir en navegador para visualizar")
    
    return "dashboard_julio_2025.html"

if __name__ == "__main__":
    generar_dashboard_julio_2025()
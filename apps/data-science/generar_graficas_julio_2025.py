import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
import warnings
warnings.filterwarnings('ignore')

# Configurar estilo de gráficas
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")

def procesar_datos_julio_2025():
    """
    Procesa los datos de julio 2025 para las visualizaciones
    """
    # Leer datos procesados
    df = pd.read_csv('big_data_julio_2025_limpio.csv', encoding='utf-8')
    
    # Asegurarse de que las columnas numéricas estén en el formato correcto
    df['PRECIO PRODUCTO'] = pd.to_numeric(df['PRECIO PRODUCTO'], errors='coerce')
    df['SUELDO'] = pd.to_numeric(df['SUELDO'], errors='coerce')
    df['Cuotas pendientes actual'] = pd.to_numeric(df['Cuotas pendientes actual'], errors='coerce').fillna(0)
    
    # Limpiar valores NaN
    df = df.dropna(subset=['PRECIO PRODUCTO', 'SUELDO'])
    
    return df

def crear_directorio_graficas():
    """
    Crea el directorio para guardar las gráficas
    """
    directorio = 'graficas_clientes_julio_2025'
    if not os.path.exists(directorio):
        os.makedirs(directorio)
    return directorio

def generar_histograma_sueldos(df, directorio):
    """
    Genera histograma de distribución de sueldos
    """
    plt.figure(figsize=(10, 6))
    plt.hist(df['SUELDO'], bins=30, edgecolor='black', alpha=0.7)
    plt.title('Distribución de Sueldos - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Sueldo (Q)', fontsize=12)
    plt.ylabel('Frecuencia', fontsize=12)
    plt.grid(True, alpha=0.3)
    
    # Agregar estadísticas
    media = df['SUELDO'].mean()
    mediana = df['SUELDO'].median()
    plt.axvline(media, color='red', linestyle='dashed', linewidth=2, label=f'Media: Q{media:,.0f}')
    plt.axvline(mediana, color='green', linestyle='dashed', linewidth=2, label=f'Mediana: Q{mediana:,.0f}')
    plt.legend()
    
    plt.tight_layout()
    plt.savefig(f'{directorio}/hist_sueldos.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_histograma_precio_producto(df, directorio):
    """
    Genera histograma de distribución de precio de producto
    """
    plt.figure(figsize=(10, 6))
    plt.hist(df['PRECIO PRODUCTO'], bins=30, edgecolor='black', alpha=0.7, color='coral')
    plt.title('Distribución de Precio de Producto - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Precio Producto (Q)', fontsize=12)
    plt.ylabel('Frecuencia', fontsize=12)
    plt.grid(True, alpha=0.3)
    
    # Agregar estadísticas
    media = df['PRECIO PRODUCTO'].mean()
    mediana = df['PRECIO PRODUCTO'].median()
    plt.axvline(media, color='red', linestyle='dashed', linewidth=2, label=f'Media: Q{media:,.0f}')
    plt.axvline(mediana, color='green', linestyle='dashed', linewidth=2, label=f'Mediana: Q{mediana:,.0f}')
    plt.legend()
    
    plt.tight_layout()
    plt.savefig(f'{directorio}/hist_precio_producto.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_conteo_ocupacion(df, directorio):
    """
    Genera gráfico de barras de clientes por ocupación
    """
    plt.figure(figsize=(10, 6))
    ocupacion_counts = df['OCUPACION'].value_counts()
    
    # Crear gráfico de barras
    bars = plt.bar(range(len(ocupacion_counts)), ocupacion_counts.values, edgecolor='black')
    plt.title('Clientes por Ocupación - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Ocupación', fontsize=12)
    plt.ylabel('Número de Clientes', fontsize=12)
    plt.xticks(range(len(ocupacion_counts)), ocupacion_counts.index, rotation=45, ha='right')
    
    # Agregar valores en las barras
    for i, bar in enumerate(bars):
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height,
                f'{int(height)}', ha='center', va='bottom')
    
    plt.grid(True, alpha=0.3, axis='y')
    plt.tight_layout()
    plt.savefig(f'{directorio}/count_ocupacion.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_conteo_estado_civil(df, directorio):
    """
    Genera gráfico de barras de clientes por estado civil
    """
    plt.figure(figsize=(10, 6))
    estado_civil_counts = df['ESTADO CIVIL'].value_counts()
    
    bars = plt.bar(range(len(estado_civil_counts)), estado_civil_counts.values, 
                   edgecolor='black', color='lightgreen')
    plt.title('Clientes por Estado Civil - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Estado Civil', fontsize=12)
    plt.ylabel('Número de Clientes', fontsize=12)
    plt.xticks(range(len(estado_civil_counts)), estado_civil_counts.index)
    
    # Agregar valores en las barras
    for i, bar in enumerate(bars):
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height,
                f'{int(height)}', ha='center', va='bottom')
    
    plt.grid(True, alpha=0.3, axis='y')
    plt.tight_layout()
    plt.savefig(f'{directorio}/count_estado_civil.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_pie_vivienda(df, directorio):
    """
    Genera gráfico de pie para vivienda propia
    """
    plt.figure(figsize=(8, 8))
    vivienda_counts = df['VIVIENDA PROPIA'].value_counts()
    
    plt.pie(vivienda_counts.values, labels=vivienda_counts.index, autopct='%1.1f%%',
            startangle=90, colors=['#3498db', '#e74c3c'])
    plt.title('Proporción de Vivienda Propia - Julio 2025', fontsize=16, fontweight='bold')
    plt.axis('equal')
    
    plt.tight_layout()
    plt.savefig(f'{directorio}/pie_vivienda.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_pie_vehiculo(df, directorio):
    """
    Genera gráfico de pie para vehículo propio
    """
    plt.figure(figsize=(8, 8))
    vehiculo_counts = df['VEHICULO PROPIO'].value_counts()
    
    plt.pie(vehiculo_counts.values, labels=vehiculo_counts.index, autopct='%1.1f%%',
            startangle=90, colors=['#2ecc71', '#f39c12'])
    plt.title('Proporción de Vehículo Propio - Julio 2025', fontsize=16, fontweight='bold')
    plt.axis('equal')
    
    plt.tight_layout()
    plt.savefig(f'{directorio}/pie_vehiculo.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_pie_tarjeta(df, directorio):
    """
    Genera gráfico de pie para tarjeta de crédito
    """
    plt.figure(figsize=(8, 8))
    tarjeta_counts = df['TARJETA DE CREDITO'].value_counts()
    
    plt.pie(tarjeta_counts.values, labels=tarjeta_counts.index, autopct='%1.1f%%',
            startangle=90, colors=['#9b59b6', '#34495e'])
    plt.title('Proporción de Tarjeta de Crédito - Julio 2025', fontsize=16, fontweight='bold')
    plt.axis('equal')
    
    plt.tight_layout()
    plt.savefig(f'{directorio}/pie_tarjeta.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_box_sueldo_ocupacion(df, directorio):
    """
    Genera boxplot de sueldo por ocupación
    """
    plt.figure(figsize=(12, 8))
    
    # Filtrar ocupaciones con suficientes datos
    ocupaciones_frecuentes = df['OCUPACION'].value_counts().head(6).index
    df_filtrado = df[df['OCUPACION'].isin(ocupaciones_frecuentes)]
    
    # Crear boxplot
    sns.boxplot(data=df_filtrado, x='OCUPACION', y='SUELDO')
    plt.title('Distribución de Sueldo por Ocupación - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Ocupación', fontsize=12)
    plt.ylabel('Sueldo (Q)', fontsize=12)
    plt.xticks(rotation=45, ha='right')
    plt.grid(True, alpha=0.3, axis='y')
    
    plt.tight_layout()
    plt.savefig(f'{directorio}/box_sueldo_ocupacion.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_cuotas_por_sueldo(df, directorio):
    """
    Genera análisis de cuotas pendientes por nivel de sueldo
    """
    # Crear categorías de sueldo
    df['Categoria_Sueldo'] = pd.qcut(df['SUELDO'], q=4, labels=['Bajo', 'Medio-Bajo', 'Medio-Alto', 'Alto'])
    
    plt.figure(figsize=(10, 6))
    
    # Calcular promedio de cuotas por categoría
    cuotas_promedio = df.groupby('Categoria_Sueldo')['Cuotas pendientes actual'].mean()
    
    bars = plt.bar(range(len(cuotas_promedio)), cuotas_promedio.values, 
                   edgecolor='black', color='salmon')
    plt.title('Cuotas Pendientes Promedio por Nivel de Sueldo - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Categoría de Sueldo', fontsize=12)
    plt.ylabel('Cuotas Pendientes Promedio', fontsize=12)
    plt.xticks(range(len(cuotas_promedio)), cuotas_promedio.index)
    
    # Agregar valores en las barras
    for i, bar in enumerate(bars):
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}', ha='center', va='bottom')
    
    plt.grid(True, alpha=0.3, axis='y')
    plt.tight_layout()
    plt.savefig(f'{directorio}/cuotas_por_sueldo.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_matriz_correlaciones(df, directorio):
    """
    Genera matriz de correlaciones
    """
    # Preparar datos para correlación
    df_corr = df.copy()
    
    # Convertir variables categóricas a numéricas
    df_corr['VIVIENDA_NUM'] = (df_corr['VIVIENDA PROPIA'] == 'Si').astype(int)
    df_corr['VEHICULO_NUM'] = (df_corr['VEHICULO PROPIO'] == 'Si').astype(int)
    df_corr['TARJETA_NUM'] = (df_corr['TARJETA DE CREDITO'] == 'Si').astype(int)
    
    # Seleccionar columnas numéricas
    columnas_numericas = ['PRECIO PRODUCTO', 'SUELDO', 'VIVIENDA_NUM', 'VEHICULO_NUM', 
                         'TARJETA_NUM', 'Cuotas pendientes actual']
    
    # Calcular correlación
    corr_matrix = df_corr[columnas_numericas].corr()
    
    # Crear heatmap
    plt.figure(figsize=(10, 8))
    mask = np.triu(np.ones_like(corr_matrix, dtype=bool))
    
    sns.heatmap(corr_matrix, mask=mask, annot=True, fmt='.2f', cmap='coolwarm',
                center=0, square=True, linewidths=1, cbar_kws={"shrink": .8})
    
    plt.title('Matriz de Correlaciones - Julio 2025', fontsize=16, fontweight='bold')
    
    # Ajustar labels
    labels = ['Precio\nProducto', 'Sueldo', 'Vivienda\nPropia', 'Vehículo\nPropio', 
             'Tarjeta\nCrédito', 'Cuotas\nPendientes']
    plt.xticks(range(len(labels)), labels, rotation=45, ha='right')
    plt.yticks(range(len(labels)), labels, rotation=0)
    
    plt.tight_layout()
    plt.savefig(f'{directorio}/matriz_correlaciones.png', dpi=300, bbox_inches='tight')
    plt.close()

def generar_analisis_perfiles(df, directorio):
    """
    Genera análisis de perfiles crediticios usando clustering
    """
    # Preparar datos para clustering
    df_cluster = df.copy()
    
    # Convertir variables categóricas
    df_cluster['VIVIENDA_NUM'] = (df_cluster['VIVIENDA PROPIA'] == 'Si').astype(int)
    df_cluster['VEHICULO_NUM'] = (df_cluster['VEHICULO PROPIO'] == 'Si').astype(int)
    df_cluster['TARJETA_NUM'] = (df_cluster['TARJETA DE CREDITO'] == 'Si').astype(int)
    
    # Seleccionar features para clustering
    features = ['SUELDO', 'PRECIO PRODUCTO', 'VIVIENDA_NUM', 'VEHICULO_NUM', 'TARJETA_NUM']
    X = df_cluster[features].values
    
    # Escalar datos
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Aplicar K-means con 4 clusters
    kmeans = KMeans(n_clusters=4, random_state=42)
    df_cluster['Perfil'] = kmeans.fit_predict(X_scaled)
    
    # Generar gráfico de distribución de perfiles
    plt.figure(figsize=(10, 6))
    perfil_counts = df_cluster['Perfil'].value_counts().sort_index()
    
    bars = plt.bar(range(len(perfil_counts)), perfil_counts.values, 
                   edgecolor='black', color=['#3498db', '#e74c3c', '#2ecc71', '#f39c12'])
    
    # Nombrar perfiles basado en características
    nombres_perfiles = ['Perfil A', 'Perfil B', 'Perfil C', 'Perfil D']
    
    plt.title('Distribución de Perfiles Crediticios - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Perfil Crediticio', fontsize=12)
    plt.ylabel('Número de Clientes', fontsize=12)
    plt.xticks(range(len(perfil_counts)), nombres_perfiles)
    
    # Agregar valores y porcentajes
    total_clientes = len(df_cluster)
    for i, bar in enumerate(bars):
        height = bar.get_height()
        porcentaje = (height / total_clientes) * 100
        plt.text(bar.get_x() + bar.get_width()/2., height,
                f'{int(height)}\n({porcentaje:.1f}%)', ha='center', va='bottom')
    
    plt.grid(True, alpha=0.3, axis='y')
    plt.tight_layout()
    plt.savefig(f'{directorio}/distribucion_perfiles.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    # Generar comparativa de perfiles
    plt.figure(figsize=(12, 8))
    
    # Calcular promedios por perfil
    perfil_stats = df_cluster.groupby('Perfil').agg({
        'SUELDO': 'mean',
        'PRECIO PRODUCTO': 'mean',
        'VIVIENDA_NUM': 'mean',
        'VEHICULO_NUM': 'mean',
        'TARJETA_NUM': 'mean'
    })
    
    # Crear subplot para cada métrica
    metrics = ['SUELDO', 'PRECIO PRODUCTO', 'VIVIENDA_NUM', 'VEHICULO_NUM', 'TARJETA_NUM']
    metric_names = ['Sueldo Promedio', 'Precio Producto Promedio', '% Vivienda Propia', 
                   '% Vehículo Propio', '% Tarjeta Crédito']
    
    fig, axes = plt.subplots(2, 3, figsize=(15, 10))
    axes = axes.flatten()
    
    for i, (metric, name) in enumerate(zip(metrics, metric_names)):
        if i < len(axes):
            ax = axes[i]
            values = perfil_stats[metric].values
            
            if metric in ['VIVIENDA_NUM', 'VEHICULO_NUM', 'TARJETA_NUM']:
                values = values * 100  # Convertir a porcentaje
                
            bars = ax.bar(range(len(values)), values, 
                          color=['#3498db', '#e74c3c', '#2ecc71', '#f39c12'])
            ax.set_title(name, fontsize=12, fontweight='bold')
            ax.set_xticks(range(len(values)))
            ax.set_xticklabels(nombres_perfiles)
            ax.grid(True, alpha=0.3, axis='y')
            
            # Agregar valores en las barras
            for j, bar in enumerate(bars):
                height = bar.get_height()
                if metric in ['VIVIENDA_NUM', 'VEHICULO_NUM', 'TARJETA_NUM']:
                    ax.text(bar.get_x() + bar.get_width()/2., height,
                           f'{height:.1f}%', ha='center', va='bottom')
                else:
                    ax.text(bar.get_x() + bar.get_width()/2., height,
                           f'Q{height:,.0f}', ha='center', va='bottom')
    
    # Ocultar el sexto subplot si no se usa
    if len(metrics) < 6:
        axes[-1].set_visible(False)
    
    plt.suptitle('Comparativa de Perfiles Crediticios - Julio 2025', fontsize=16, fontweight='bold')
    plt.tight_layout()
    plt.savefig(f'{directorio}/comparativa_perfiles.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    # Generar matriz estratégica
    plt.figure(figsize=(10, 8))
    
    # Calcular morosidad y tamaño por perfil
    perfil_morosidad = df_cluster.groupby('Perfil').agg({
        'Cuotas pendientes actual': lambda x: (x > 1).mean() * 100,
        'Perfil': 'count'
    })
    perfil_morosidad.columns = ['Tasa_Morosidad', 'Cantidad']
    perfil_morosidad['Precio_Promedio'] = df_cluster.groupby('Perfil')['PRECIO PRODUCTO'].mean()
    
    # Crear scatter plot
    scatter = plt.scatter(perfil_morosidad['Tasa_Morosidad'], 
                         perfil_morosidad['Precio_Promedio'],
                         s=perfil_morosidad['Cantidad']*5,
                         c=['#3498db', '#e74c3c', '#2ecc71', '#f39c12'],
                         alpha=0.6, edgecolors='black', linewidth=2)
    
    # Agregar etiquetas
    for i, (idx, row) in enumerate(perfil_morosidad.iterrows()):
        plt.annotate(nombres_perfiles[i], 
                    (row['Tasa_Morosidad'], row['Precio_Promedio']),
                    xytext=(5, 5), textcoords='offset points', fontsize=10)
    
    plt.xlabel('Tasa de Morosidad (%)', fontsize=12)
    plt.ylabel('Precio Promedio del Producto (Q)', fontsize=12)
    plt.title('Matriz Estratégica de Perfiles - Julio 2025\n(Tamaño = Cantidad de Clientes)', 
             fontsize=16, fontweight='bold')
    plt.grid(True, alpha=0.3)
    
    # Agregar líneas de referencia
    plt.axhline(y=perfil_morosidad['Precio_Promedio'].mean(), color='gray', 
               linestyle='--', alpha=0.5, label='Precio Promedio General')
    plt.axvline(x=perfil_morosidad['Tasa_Morosidad'].mean(), color='gray', 
               linestyle='--', alpha=0.5, label='Morosidad Promedio General')
    
    plt.legend()
    plt.tight_layout()
    plt.savefig(f'{directorio}/matriz_estrategica_perfiles.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    return df_cluster

def generar_analisis_morosidad(df, df_cluster, directorio):
    """
    Genera análisis de morosidad
    """
    # Morosidad por perfil
    plt.figure(figsize=(10, 6))
    
    morosidad_perfil = df_cluster.groupby('Perfil').agg({
        'Cuotas pendientes actual': lambda x: (x > 1).mean() * 100
    })
    
    nombres_perfiles = ['Perfil A', 'Perfil B', 'Perfil C', 'Perfil D']
    
    bars = plt.bar(range(len(morosidad_perfil)), morosidad_perfil.values.flatten(),
                   edgecolor='black', color=['#3498db', '#e74c3c', '#2ecc71', '#f39c12'])
    
    plt.title('Tasa de Morosidad por Perfil Crediticio - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Perfil Crediticio', fontsize=12)
    plt.ylabel('Tasa de Morosidad (%)', fontsize=12)
    plt.xticks(range(len(morosidad_perfil)), nombres_perfiles)
    
    # Agregar valores en las barras
    for i, bar in enumerate(bars):
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}%', ha='center', va='bottom')
    
    # Línea de morosidad promedio
    morosidad_general = (df['Cuotas pendientes actual'] > 1).mean() * 100
    plt.axhline(y=morosidad_general, color='red', linestyle='--', 
               label=f'Morosidad General: {morosidad_general:.1f}%')
    
    plt.legend()
    plt.grid(True, alpha=0.3, axis='y')
    plt.tight_layout()
    plt.savefig(f'{directorio}/morosidad_por_perfil.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    # Comparativa morosos vs al día
    plt.figure(figsize=(12, 8))
    
    df['Estado_Pago'] = df['Cuotas pendientes actual'].apply(lambda x: 'Moroso' if x > 1 else 'Al día')
    
    # Comparar características
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    
    # Sueldo promedio
    ax1 = axes[0, 0]
    sueldo_estado = df.groupby('Estado_Pago')['SUELDO'].mean()
    bars1 = ax1.bar(sueldo_estado.index, sueldo_estado.values, 
                    color=['#2ecc71', '#e74c3c'], edgecolor='black')
    ax1.set_title('Sueldo Promedio', fontsize=12, fontweight='bold')
    ax1.set_ylabel('Sueldo (Q)')
    for bar in bars1:
        height = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width()/2., height,
                f'Q{height:,.0f}', ha='center', va='bottom')
    
    # Precio producto promedio
    ax2 = axes[0, 1]
    precio_estado = df.groupby('Estado_Pago')['PRECIO PRODUCTO'].mean()
    bars2 = ax2.bar(precio_estado.index, precio_estado.values, 
                    color=['#2ecc71', '#e74c3c'], edgecolor='black')
    ax2.set_title('Precio Producto Promedio', fontsize=12, fontweight='bold')
    ax2.set_ylabel('Precio (Q)')
    for bar in bars2:
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width()/2., height,
                f'Q{height:,.0f}', ha='center', va='bottom')
    
    # Proporción con vivienda propia
    ax3 = axes[1, 0]
    vivienda_estado = df.groupby('Estado_Pago')['VIVIENDA PROPIA'].apply(lambda x: (x == 'Si').mean() * 100)
    bars3 = ax3.bar(vivienda_estado.index, vivienda_estado.values, 
                    color=['#2ecc71', '#e74c3c'], edgecolor='black')
    ax3.set_title('% con Vivienda Propia', fontsize=12, fontweight='bold')
    ax3.set_ylabel('Porcentaje (%)')
    for bar in bars3:
        height = bar.get_height()
        ax3.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}%', ha='center', va='bottom')
    
    # Proporción con tarjeta de crédito
    ax4 = axes[1, 1]
    tarjeta_estado = df.groupby('Estado_Pago')['TARJETA DE CREDITO'].apply(lambda x: (x == 'Si').mean() * 100)
    bars4 = ax4.bar(tarjeta_estado.index, tarjeta_estado.values, 
                    color=['#2ecc71', '#e74c3c'], edgecolor='black')
    ax4.set_title('% con Tarjeta de Crédito', fontsize=12, fontweight='bold')
    ax4.set_ylabel('Porcentaje (%)')
    for bar in bars4:
        height = bar.get_height()
        ax4.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}%', ha='center', va='bottom')
    
    for ax in axes.flat:
        ax.grid(True, alpha=0.3, axis='y')
    
    plt.suptitle('Comparativa: Clientes Al Día vs Morosos - Julio 2025', 
                fontsize=16, fontweight='bold')
    plt.tight_layout()
    plt.savefig(f'{directorio}/comparativa_morosos_al_dia.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    # Morosidad por ocupación
    plt.figure(figsize=(12, 6))
    
    # Filtrar ocupaciones con suficientes datos
    ocupaciones_frecuentes = df['OCUPACION'].value_counts().head(8).index
    df_ocupacion = df[df['OCUPACION'].isin(ocupaciones_frecuentes)]
    
    morosidad_ocupacion = df_ocupacion.groupby('OCUPACION')['Cuotas pendientes actual'].apply(
        lambda x: (x > 1).mean() * 100
    ).sort_values(ascending=False)
    
    bars = plt.bar(range(len(morosidad_ocupacion)), morosidad_ocupacion.values,
                   edgecolor='black', color=plt.cm.RdYlGn_r(morosidad_ocupacion.values/morosidad_ocupacion.max()))
    
    plt.title('Tasa de Morosidad por Ocupación - Julio 2025', fontsize=16, fontweight='bold')
    plt.xlabel('Ocupación', fontsize=12)
    plt.ylabel('Tasa de Morosidad (%)', fontsize=12)
    plt.xticks(range(len(morosidad_ocupacion)), morosidad_ocupacion.index, rotation=45, ha='right')
    
    # Agregar valores en las barras
    for i, bar in enumerate(bars):
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height,
                f'{height:.1f}%', ha='center', va='bottom')
    
    # Línea de morosidad promedio
    plt.axhline(y=morosidad_general, color='red', linestyle='--', 
               label=f'Morosidad General: {morosidad_general:.1f}%')
    
    plt.legend()
    plt.grid(True, alpha=0.3, axis='y')
    plt.tight_layout()
    plt.savefig(f'{directorio}/morosidad_por_ocupacion.png', dpi=300, bbox_inches='tight')
    plt.close()

def main():
    """
    Función principal para generar todas las gráficas
    """
    print("🚀 Iniciando generación de gráficas para Julio 2025...")
    
    # Procesar datos
    df = procesar_datos_julio_2025()
    print(f"✅ Datos procesados: {len(df)} registros")
    
    # Crear directorio
    directorio = crear_directorio_graficas()
    print(f"📁 Directorio creado: {directorio}")
    
    # Generar gráficas
    print("📊 Generando gráficas...")
    
    generar_histograma_sueldos(df, directorio)
    print("  ✓ Histograma de sueldos")
    
    generar_histograma_precio_producto(df, directorio)
    print("  ✓ Histograma de precio producto")
    
    generar_conteo_ocupacion(df, directorio)
    print("  ✓ Conteo por ocupación")
    
    generar_conteo_estado_civil(df, directorio)
    print("  ✓ Conteo por estado civil")
    
    generar_pie_vivienda(df, directorio)
    print("  ✓ Pie de vivienda propia")
    
    generar_pie_vehiculo(df, directorio)
    print("  ✓ Pie de vehículo propio")
    
    generar_pie_tarjeta(df, directorio)
    print("  ✓ Pie de tarjeta de crédito")
    
    generar_box_sueldo_ocupacion(df, directorio)
    print("  ✓ Boxplot sueldo por ocupación")
    
    generar_cuotas_por_sueldo(df, directorio)
    print("  ✓ Cuotas por nivel de sueldo")
    
    generar_matriz_correlaciones(df, directorio)
    print("  ✓ Matriz de correlaciones")
    
    df_cluster = generar_analisis_perfiles(df, directorio)
    print("  ✓ Análisis de perfiles crediticios")
    
    generar_analisis_morosidad(df, df_cluster, directorio)
    print("  ✓ Análisis de morosidad")
    
    print(f"\n✅ Todas las gráficas generadas exitosamente en '{directorio}/'")
    print("📈 Total de gráficas generadas: 13")

if __name__ == "__main__":
    main()
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import os
import numpy as np

# Configuración de estilo
sns.set_theme(style="whitegrid")

# Leer el CSV
df = pd.read_csv('big_data_limpio.csv', encoding='utf-8')

# Limpieza de datos: quitar espacios y convertir a tipos adecuados
def limpiar_monedas(valor):
    if isinstance(valor, str):
        limpio = valor.replace('Q', '').replace(',', '').replace(' ', '').replace('-', '')
        if limpio == '':
            return np.nan
        return float(limpio)
    return valor

df['PRECIO PRODUCTO'] = df['PRECIO PRODUCTO'].apply(limpiar_monedas)
df['SUELDO'] = df['SUELDO'].apply(limpiar_monedas)
df['DEPENDIENTES ECONOMICOS'] = pd.to_numeric(df['DEPENDIENTES ECONOMICOS'], errors='coerce')
df['ANTIGUEDAD'] = df['ANTIGUEDAD'].str.extract(r'(\d+)').astype(float)
df['Cuotas pendientes actual'] = pd.to_numeric(df['Cuotas pendientes actual'], errors='coerce')

# Resetear el índice para evitar problemas de multi-index
df = df.reset_index(drop=True)

# Limpiar espacios en columnas de texto y convertir a string
for col in ['ESTADO CIVIL', 'OCUPACION', 'VIVIENDA PROPIA', 'VEHICULO PROPIO', 'TARJETA DE CREDITO', 'TIPO DE COMPRAS', 'UTILIZACION DINERO', 'EDAD (RANGO DE EDAD EN AÑOS)']:
    df[col] = df[col].astype(str).str.strip()

# Función para limpiar datos categóricos - mantener solo valores válidos
def limpiar_categoricos():
    # Definir valores válidos para cada columna
    valores_validos = {
        'ESTADO CIVIL': ['Soltero', 'Casado', 'Divorciado', 'Viudo', 'Union libre'],
        'OCUPACION': ['Empleado', 'Dueño', 'Independiente', 'Empresario', 'Jubilado'],
        'VIVIENDA PROPIA': ['Si', 'No'],
        'VEHICULO PROPIO': ['Si', 'No'],
        'TARJETA DE CREDITO': ['Si', 'No'],
        'TIPO DE COMPRAS': ['Autocompras', 'Sobre Vehiculos', 'Hipotecarios', 'Prendario'],
        'UTILIZACION DINERO': ['Consumo', 'Capital de trabajo', 'Consolidacion de deudas', 'Salud o Medico', 'Mejora Inmueble', 'Estudios'],
        'EDAD (RANGO DE EDAD EN AÑOS)': ['18-29', '30-39', '40-49', '50', '50+', '60+']
    }
    
    # Limpiar cada columna
    for col, validos in valores_validos.items():
        if col in df.columns:
            # Marcar como NaN los valores que no están en la lista de válidos
            df[col] = df[col].apply(lambda x: x if x in validos else np.nan)

# Aplicar la limpieza
limpiar_categoricos()

# Crear carpeta para gráficas
os.makedirs('graficas_clientes', exist_ok=True)

# 1. Estadísticas descriptivas generales
print("\n--- Estadísticas descriptivas numéricas ---")
print(df[['PRECIO PRODUCTO', 'SUELDO', 'DEPENDIENTES ECONOMICOS', 'ANTIGUEDAD', 'Cuotas pendientes actual']].describe())

print("\n--- Estadísticas categóricas ---")
for col in ['ESTADO CIVIL', 'OCUPACION', 'VIVIENDA PROPIA', 'VEHICULO PROPIO', 'TARJETA DE CREDITO', 'TIPO DE COMPRAS', 'UTILIZACION DINERO']:
    print(f"\n{col}:")
    # Mostrar solo valores que no son NaN
    valores_validos = df[col].dropna()
    print(valores_validos.value_counts())
    print(valores_validos.value_counts(normalize=True))

# Función para calcular límites sin outliers extremos
def calcular_limites(serie, percentil_bajo=5, percentil_alto=95):
    """Calcula límites basados en percentiles para mejorar visualización"""
    serie_limpia = serie.dropna()
    if len(serie_limpia) == 0:
        return None, None
    limite_bajo = serie_limpia.quantile(percentil_bajo/100)
    limite_alto = serie_limpia.quantile(percentil_alto/100)
    return limite_bajo, limite_alto

# Función específica para boxplots que preserva cajas y whiskers
def calcular_limites_boxplot_inteligente(serie):
    """Calcula límites para boxplots solo si hay outliers extremos"""
    serie_limpia = serie.dropna()
    if len(serie_limpia) == 0:
        return None, None
    
    # Calcular estadísticas básicas
    q1 = serie_limpia.quantile(0.25)
    q3 = serie_limpia.quantile(0.75)
    iqr = q3 - q1
    
    # Límites normales de boxplot (whiskers)
    whisker_bajo = q1 - 1.5 * iqr
    whisker_alto = q3 + 1.5 * iqr
    
    # Valores más extremos
    valor_min = serie_limpia.min()
    valor_max = serie_limpia.max()
    percentil_98 = serie_limpia.quantile(0.98)
    
    # Decidir si necesitamos límites
    # Solo aplicar límites si hay outliers realmente extremos
    ratio_extremo = valor_max / percentil_98 if percentil_98 > 0 else 1
    
    if ratio_extremo > 3:  # Si el valor máximo es 3x mayor que percentil 98
        # Hay outliers extremos, aplicar límites
        limite_bajo = 0 if valor_min >= 0 else valor_min
        limite_alto = percentil_98
        return limite_bajo, limite_alto
    else:
        # No hay outliers extremos, usar límites automáticos
        return None, None

# 2. Gráficas
# a) Distribuciones y proporciones
# Histograma de sueldos
plt.figure(figsize=(12,7))
sueldo_limpio = df['SUELDO'].dropna()
sns.histplot(sueldo_limpio, kde=True, color='skyblue', alpha=0.7)
plt.title('Distribución de Sueldos', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Sueldo (Q)', fontsize=14, fontweight='bold')
plt.ylabel('Frecuencia', fontsize=14, fontweight='bold')
# Limitar escala al 90% central de los datos
limite_bajo, limite_alto = calcular_limites(sueldo_limpio, 5, 95)
if limite_bajo is not None and limite_alto is not None:
    plt.xlim(limite_bajo, limite_alto)
# Formatear eje X con separadores de miles
plt.gca().xaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'Q{x:,.0f}'))
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/hist_sueldos.png', dpi=300, bbox_inches='tight')
plt.close()

# Histograma de precio de producto
plt.figure(figsize=(12,7))
precio_limpio = df['PRECIO PRODUCTO'].dropna()
sns.histplot(precio_limpio, kde=True, color='salmon', alpha=0.7)
plt.title('Distribución de Precio de Producto', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Precio de Producto (Q)', fontsize=14, fontweight='bold')
plt.ylabel('Frecuencia', fontsize=14, fontweight='bold')
# Limitar escala al 90% central de los datos
limite_bajo, limite_alto = calcular_limites(precio_limpio, 5, 95)
if limite_bajo is not None and limite_alto is not None:
    plt.xlim(limite_bajo, limite_alto)
# Formatear eje X con separadores de miles
plt.gca().xaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'Q{x:,.0f}'))
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/hist_precio_producto.png', dpi=300, bbox_inches='tight')
plt.close()

# Conteo de clientes por rango de edad
plt.figure(figsize=(12,7))
edad_valida = df['EDAD (RANGO DE EDAD EN AÑOS)'].dropna()
sns.countplot(y=edad_valida, palette='viridis')
plt.title('Clientes por Rango de Edad', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Número de Clientes', fontsize=14, fontweight='bold')
plt.ylabel('Rango de Edad', fontsize=14, fontweight='bold')
plt.grid(True, alpha=0.3, axis='x')
plt.tight_layout()
plt.savefig('graficas_clientes/count_edad.png', dpi=300, bbox_inches='tight')
plt.close()

# Conteo de clientes por ocupación
plt.figure(figsize=(12,7))
ocupacion_valida = df['OCUPACION'].dropna()
sns.countplot(y=ocupacion_valida, palette='Set2')
plt.title('Clientes por Ocupación', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Número de Clientes', fontsize=14, fontweight='bold')
plt.ylabel('Ocupación', fontsize=14, fontweight='bold')
plt.grid(True, alpha=0.3, axis='x')
plt.tight_layout()
plt.savefig('graficas_clientes/count_ocupacion.png', dpi=300, bbox_inches='tight')
plt.close()

# Conteo de clientes por estado civil
plt.figure(figsize=(12,7))
estado_civil_valido = df['ESTADO CIVIL'].dropna()
sns.countplot(y=estado_civil_valido, palette='husl')
plt.title('Clientes por Estado Civil', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Número de Clientes', fontsize=14, fontweight='bold')
plt.ylabel('Estado Civil', fontsize=14, fontweight='bold')
plt.grid(True, alpha=0.3, axis='x')
plt.tight_layout()
plt.savefig('graficas_clientes/count_estado_civil.png', dpi=300, bbox_inches='tight')
plt.close()

# Proporción de vivienda propia, vehículo propio y tarjeta de crédito
def plot_pie(col, fname, titulo):
    plt.figure(figsize=(10,8))
    # Usar solo valores válidos (no NaN)
    data_valida = df[col].dropna()
    colores = ['#66b3ff','#ff9999','#99ff99','#ffcc99','#ff99cc']
    data_valida.value_counts().plot.pie(autopct='%1.1f%%', colors=colores, startangle=90)
    plt.title(titulo, fontsize=16, fontweight='bold', pad=20)
    plt.ylabel('')
    plt.tight_layout()
    plt.savefig(f'graficas_clientes/{fname}', dpi=300, bbox_inches='tight')
    plt.close()

plot_pie('VIVIENDA PROPIA', 'pie_vivienda.png', 'Proporción de Clientes con Vivienda Propia')
plot_pie('VEHICULO PROPIO', 'pie_vehiculo.png', 'Proporción de Clientes con Vehículo Propio')
plot_pie('TARJETA DE CREDITO', 'pie_tarjeta.png', 'Proporción de Clientes con Tarjeta de Crédito')

# Conteo de tipo de compras
plt.figure(figsize=(12,7))
tipo_compras_valido = df['TIPO DE COMPRAS'].dropna()
sns.countplot(y=tipo_compras_valido, palette='plasma')
plt.title('Tipo de Compras', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Número de Clientes', fontsize=14, fontweight='bold')
plt.ylabel('Tipo de Compras', fontsize=14, fontweight='bold')
plt.grid(True, alpha=0.3, axis='x')
plt.tight_layout()
plt.savefig('graficas_clientes/count_tipo_compras.png', dpi=300, bbox_inches='tight')
plt.close()

# Conteo de utilización de dinero
plt.figure(figsize=(12,7))
utilizacion_valida = df['UTILIZACION DINERO'].dropna()
sns.countplot(y=utilizacion_valida, palette='tab10')
plt.title('Utilización de Dinero', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Número de Clientes', fontsize=14, fontweight='bold')
plt.ylabel('Utilización de Dinero', fontsize=14, fontweight='bold')
plt.grid(True, alpha=0.3, axis='x')
plt.tight_layout()
plt.savefig('graficas_clientes/count_utilizacion_dinero.png', dpi=300, bbox_inches='tight')
plt.close()

# b) Relación entre variables
# Boxplot de sueldo por rango de edad
plt.figure(figsize=(14,8))  # Figura grande para presentación
df_edad_sueldo = df[['EDAD (RANGO DE EDAD EN AÑOS)', 'SUELDO']].dropna()
sns.boxplot(x='EDAD (RANGO DE EDAD EN AÑOS)', y='SUELDO', data=df_edad_sueldo, palette='viridis')
plt.title('Sueldo por Rango de Edad', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Rango de Edad', fontsize=14, fontweight='bold')
plt.ylabel('Sueldo (Q)', fontsize=14, fontweight='bold')
# Límite más amplio pero enfocado en datos importantes
plt.ylim(0, 50000)
# Formatear eje Y con separadores de miles
plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'Q{x:,.0f}'))
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/box_sueldo_edad.png', dpi=300, bbox_inches='tight')
plt.close()

# Boxplot de sueldo por ocupación
plt.figure(figsize=(14,8))  # Figura grande para presentación
df_ocupacion_sueldo = df[['OCUPACION', 'SUELDO']].dropna()
sns.boxplot(x='OCUPACION', y='SUELDO', data=df_ocupacion_sueldo, palette='Set2')
plt.title('Sueldo por Ocupación', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Ocupación', fontsize=14, fontweight='bold')
plt.ylabel('Sueldo (Q)', fontsize=14, fontweight='bold')
# Límite más amplio pero enfocado en datos importantes
plt.ylim(0, 70000)
# Formatear eje Y con separadores de miles
plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'Q{x:,.0f}'))
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/box_sueldo_ocupacion.png', dpi=300, bbox_inches='tight')
plt.close()

# Boxplot de precio producto por tipo de compras
plt.figure(figsize=(14,8))  # Figura grande para presentación
df_compras_precio = df[['TIPO DE COMPRAS', 'PRECIO PRODUCTO']].dropna()
sns.boxplot(x='TIPO DE COMPRAS', y='PRECIO PRODUCTO', data=df_compras_precio, palette='husl')
plt.title('Precio de Producto por Tipo de Compras', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Tipo de Compras', fontsize=14, fontweight='bold')
plt.ylabel('Precio de Producto (Q)', fontsize=14, fontweight='bold')
# Límite más amplio pero enfocado en datos importantes
plt.ylim(0, 150000)
# Formatear eje Y con separadores de miles
plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'Q{x:,.0f}'))
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/box_precio_tipo_compras.png', dpi=300, bbox_inches='tight')
plt.close()

# Análisis de cuotas pendientes por categorías de sueldo
plt.figure(figsize=(12,8))
df_cuotas_sueldo = df[['SUELDO', 'Cuotas pendientes actual']].dropna()

# Crear categorías de sueldo para análisis más simple
def categorizar_sueldo(sueldo):
    if sueldo <= 10000:
        return 'Sueldo Bajo (≤Q10k)'
    elif sueldo <= 25000:
        return 'Sueldo Medio (Q10k-25k)'
    else:
        return 'Sueldo Alto (>Q25k)'

df_cuotas_sueldo['Categoria_Sueldo'] = df_cuotas_sueldo['SUELDO'].apply(categorizar_sueldo)

sns.boxplot(x='Categoria_Sueldo', y='Cuotas pendientes actual', data=df_cuotas_sueldo, palette='Set1')
plt.title('Cuotas Pendientes por Nivel de Sueldo', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Categoría de Sueldo', fontsize=14, fontweight='bold')
plt.ylabel('Cuotas Pendientes Actuales', fontsize=14, fontweight='bold')
# Configurar ticks al revés: pocos en 0-5 (más espacio), muchos después (menos espacio)
valor_max = df_cuotas_sueldo['Cuotas pendientes actual'].max()
ticks_espaciados = [0, 1, 2, 3, 4, 5]  # Cada 1 hasta 5 (más espacio visual)
ticks_comprimidos = [x + 0.5 for x in range(5, int(valor_max) + 1)]  # Cada 0.5 después de 5
todos_los_ticks = ticks_espaciados + ticks_comprimidos
plt.yticks(todos_los_ticks)
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/cuotas_por_sueldo.png', dpi=300, bbox_inches='tight')
plt.close()

# Análisis de cuotas pendientes por categorías de antigüedad
plt.figure(figsize=(12,8))
df_cuotas_antiguedad = df[['ANTIGUEDAD', 'Cuotas pendientes actual']].dropna()

# Crear categorías de antigüedad para análisis más simple
def categorizar_antiguedad(antiguedad):
    if antiguedad <= 1:
        return 'Nuevo (≤1 año)'
    elif antiguedad <= 5:
        return 'Intermedio (1-5 años)'
    else:
        return 'Veterano (>5 años)'

df_cuotas_antiguedad['Categoria_Antiguedad'] = df_cuotas_antiguedad['ANTIGUEDAD'].apply(categorizar_antiguedad)

sns.boxplot(x='Categoria_Antiguedad', y='Cuotas pendientes actual', data=df_cuotas_antiguedad, palette='Set2')
plt.title('Cuotas Pendientes por Antigüedad del Cliente', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Categoría de Antigüedad', fontsize=14, fontweight='bold')
plt.ylabel('Cuotas Pendientes Actuales', fontsize=14, fontweight='bold')
# Configurar ticks al revés: pocos en 0-5 (más espacio), muchos después (menos espacio)
valor_max = df_cuotas_antiguedad['Cuotas pendientes actual'].max()
ticks_espaciados = [0, 1, 2, 3, 4, 5]  # Cada 1 hasta 5 (más espacio visual)
ticks_comprimidos = [x + 0.5 for x in range(5, int(valor_max) + 1)]  # Cada 0.5 después de 5
todos_los_ticks = ticks_espaciados + ticks_comprimidos
plt.yticks(todos_los_ticks)
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/cuotas_por_antiguedad.png', dpi=300, bbox_inches='tight')
plt.close()

# c) Otras ideas
# Promedio de dependientes económicos por estado civil
estado_civil_valido = df['ESTADO CIVIL'].dropna()
prom_dep = df[df['ESTADO CIVIL'].isin(estado_civil_valido)].groupby('ESTADO CIVIL')['DEPENDIENTES ECONOMICOS'].mean()
print("\nPromedio de dependientes económicos por estado civil:")
print(prom_dep)

# Promedio de antigüedad por ocupación
ocupacion_valida = df['OCUPACION'].dropna()
prom_ant = df[df['OCUPACION'].isin(ocupacion_valida)].groupby('OCUPACION')['ANTIGUEDAD'].mean()
print("\nPromedio de antigüedad por ocupación:")
print(prom_ant)

# Comparativa de sueldos entre quienes tienen/no tienen vivienda propia, vehículo propio o tarjeta de crédito
def print_sueldo_comparativo(col):
    print(f"\nSueldo promedio según {col}:")
    # Usar solo filas donde la columna específica no es NaN
    datos_validos = df.dropna(subset=[col])
    print(datos_validos.groupby(col)['SUELDO'].mean())

print_sueldo_comparativo('VIVIENDA PROPIA')
print_sueldo_comparativo('VEHICULO PROPIO')
print_sueldo_comparativo('TARJETA DE CREDITO')

print("\n¡Listo! Las gráficas están en la carpeta 'graficas_clientes' y las estadísticas en la consola.")

# =============================================================================
# ANÁLISIS CEO: MATRIZ DE CORRELACIONES
# =============================================================================

print("\n" + "="*60)
print("     ANÁLISIS CEO: MATRIZ DE CORRELACIONES")
print("="*60)

# Preparar datos para análisis de correlación
df_corr = df.copy()

# Convertir variables categóricas a numéricas
# Variables Si/No
df_corr['VIVIENDA_PROPIA_NUM'] = df_corr['VIVIENDA PROPIA'].map({'Si': 1, 'No': 0})
df_corr['VEHICULO_PROPIO_NUM'] = df_corr['VEHICULO PROPIO'].map({'Si': 1, 'No': 0})
df_corr['TARJETA_CREDITO_NUM'] = df_corr['TARJETA DE CREDITO'].map({'Si': 1, 'No': 0})

# Edad - convertir rangos a valores promedio
edad_mapping = {
    '18-29': 23.5,
    '30-39': 34.5, 
    '40-49': 44.5,
    '50': 50,
    '50+': 55,
    '60+': 65
}
df_corr['EDAD_NUM'] = df_corr['EDAD (RANGO DE EDAD EN AÑOS)'].map(edad_mapping)

# Estado civil - ordenar por estabilidad financiera típica
estado_mapping = {
    'Soltero': 1,
    'Divorciado': 2,
    'Casado': 3,
    'Viudo': 2
}
df_corr['ESTADO_CIVIL_NUM'] = df_corr['ESTADO CIVIL'].map(estado_mapping)

# Ocupación - ordenar por estabilidad/ingresos típicos
ocupacion_mapping = {
    'Empleado': 1,
    'Dueño': 3,
    'Independiente': 2,
    'Empresario': 4,
    'Jubilado': 1
}
df_corr['OCUPACION_NUM'] = df_corr['OCUPACION'].map(ocupacion_mapping)

# Tipo de compras - ordenar por valor típico
tipo_compras_mapping = {
    'Prendario': 1,
    'Autocompras': 2,
    'Sobre Vehiculos': 3,
    'Hipotecarios': 4
}
df_corr['TIPO_COMPRAS_NUM'] = df_corr['TIPO DE COMPRAS'].map(tipo_compras_mapping)

# Utilización dinero - ordenar por propósito
utilizacion_mapping = {
    'Consumo': 1,
    'Salud o Medico': 2,
    'Estudios': 3,
    'Mejora Inmueble': 4,
    'Capital de trabajo': 5,
    'Consolidacion de deudas': 6
}
df_corr['UTILIZACION_NUM'] = df_corr['UTILIZACION DINERO'].map(utilizacion_mapping)

# Seleccionar variables para correlación
variables_analisis = [
    'PRECIO PRODUCTO', 'SUELDO', 'EDAD_NUM', 'DEPENDIENTES ECONOMICOS', 
    'ANTIGUEDAD', 'Cuotas pendientes actual', 'VIVIENDA_PROPIA_NUM',
    'VEHICULO_PROPIO_NUM', 'TARJETA_CREDITO_NUM', 'ESTADO_CIVIL_NUM',
    'OCUPACION_NUM', 'TIPO_COMPRAS_NUM', 'UTILIZACION_NUM'
]

# Crear matriz de correlación
df_analisis = df_corr[variables_analisis].dropna()
matriz_corr = df_analisis.corr()

# Renombrar para mejor visualización
nombres_bonitos = {
    'PRECIO PRODUCTO': 'Precio Producto',
    'SUELDO': 'Sueldo',
    'EDAD_NUM': 'Edad',
    'DEPENDIENTES ECONOMICOS': 'Dependientes',
    'ANTIGUEDAD': 'Antigüedad',
    'Cuotas pendientes actual': 'Cuotas Pendientes',
    'VIVIENDA_PROPIA_NUM': 'Vivienda Propia',
    'VEHICULO_PROPIO_NUM': 'Vehículo Propio',
    'TARJETA_CREDITO_NUM': 'Tarjeta Crédito',
    'ESTADO_CIVIL_NUM': 'Estado Civil',
    'OCUPACION_NUM': 'Ocupación',
    'TIPO_COMPRAS_NUM': 'Tipo Compras',
    'UTILIZACION_NUM': 'Utilización'
}

matriz_corr.index = [nombres_bonitos.get(x, x) for x in matriz_corr.index]
matriz_corr.columns = [nombres_bonitos.get(x, x) for x in matriz_corr.columns]

# Visualizar matriz de correlación
plt.figure(figsize=(16,12))
mask = np.triu(np.ones_like(matriz_corr, dtype=bool))  # Mostrar solo la mitad inferior
sns.heatmap(matriz_corr, mask=mask, annot=True, cmap='RdBu_r', center=0,
            square=True, linewidths=0.5, cbar_kws={"shrink": .5}, fmt='.2f')
plt.title('Matriz de Correlaciones - Análisis Estratégico de Variables', 
          fontsize=18, fontweight='bold', pad=30)
plt.xticks(rotation=45, ha='right')
plt.yticks(rotation=0)
plt.tight_layout()
plt.savefig('graficas_clientes/matriz_correlaciones.png', dpi=300, bbox_inches='tight')
plt.close()

# Encontrar las correlaciones más fuertes (excluyendo autocorrelaciones)
correlaciones_fuertes = []
for i in range(len(matriz_corr.columns)):
    for j in range(i+1, len(matriz_corr.columns)):
        var1 = matriz_corr.columns[i]
        var2 = matriz_corr.columns[j]
        corr_valor = matriz_corr.iloc[i, j]
        if abs(corr_valor) > 0.1:  # Solo correlaciones significativas
            correlaciones_fuertes.append((var1, var2, corr_valor))

# Ordenar por fuerza de correlación
correlaciones_fuertes.sort(key=lambda x: abs(x[2]), reverse=True)

print("\n🎯 TOP 10 CORRELACIONES MÁS FUERTES:")
print("-" * 70)
for i, (var1, var2, corr) in enumerate(correlaciones_fuertes[:10], 1):
    direccion = "📈 POSITIVA" if corr > 0 else "📉 NEGATIVA"
    print(f"{i:2d}. {var1} ↔ {var2}")
    print(f"    Correlación: {corr:.3f} ({direccion})")
    print()

print("\n💡 INTERPRETACIÓN PARA CEO:")
print("-" * 50)
if correlaciones_fuertes:
    var1, var2, corr = correlaciones_fuertes[0]
    print(f"• Relación más fuerte: {var1} y {var2} ({corr:.3f})")
    
# Correlaciones específicas con variables clave
print(f"\n🔍 CORRELACIONES CON VARIABLES CLAVE:")
print("-" * 50)

variables_clave = ['Cuotas Pendientes', 'Precio Producto', 'Sueldo']
for var_clave in variables_clave:
    if var_clave in matriz_corr.columns:
        print(f"\n{var_clave.upper()}:")
        correlaciones_var = matriz_corr[var_clave].abs().sort_values(ascending=False)
        for var, corr in correlaciones_var.head(4).items():
            if var != var_clave and abs(corr) > 0.05:
                direccion = "+" if matriz_corr[var_clave][var] > 0 else "-"
                print(f"  {direccion} {var}: {corr:.3f}")

print("\n" + "="*60)

print("\n" + "="*60)

# =============================================================================
# ANÁLISIS CEO: SEGMENTACIÓN DE PERFILES CREDITICIOS
# =============================================================================

print("\n" + "="*70)
print("     ANÁLISIS CEO: SEGMENTACIÓN DE PERFILES CREDITICIOS")
print("="*70)

# Crear segmentos basados en las correlaciones más fuertes encontradas
df_seg = df.copy()

# Limpiar datos para segmentación
df_seg = df_seg.dropna(subset=['VIVIENDA PROPIA', 'TARJETA DE CREDITO', 'UTILIZACION DINERO', 'SUELDO', 'PRECIO PRODUCTO', 'Cuotas pendientes actual'])

# Crear variable de perfil crediticio
def crear_perfil_crediticio(row):
    vivienda = row['VIVIENDA PROPIA']
    tarjeta = row['TARJETA DE CREDITO'] 
    utilizacion = row['UTILIZACION DINERO']
    
    # Basado en las correlaciones fuertes encontradas
    if vivienda == 'Si' and tarjeta == 'No':
        return 'PERFIL A: Propietario Conservador'
    elif vivienda == 'No' and tarjeta == 'Si':
        return 'PERFIL B: Urbano con Crédito'
    elif vivienda == 'Si' and tarjeta == 'Si':
        return 'PERFIL C: Establecido Premium'
    else:  # vivienda == 'No' and tarjeta == 'No'
        return 'PERFIL D: Joven Emergente'

df_seg['PERFIL_CREDITICIO'] = df_seg.apply(crear_perfil_crediticio, axis=1)

# Análisis estadístico por perfil
print("\n📊 DISTRIBUCIÓN DE PERFILES:")
print("-" * 40)
distribucion_perfiles = df_seg['PERFIL_CREDITICIO'].value_counts()
for perfil, cantidad in distribucion_perfiles.items():
    porcentaje = (cantidad / len(df_seg)) * 100
    print(f"{perfil}: {cantidad} clientes ({porcentaje:.1f}%)")

# Análisis detallado por perfil
perfiles = df_seg['PERFIL_CREDITICIO'].unique()

print("\n🎯 ANÁLISIS DETALLADO POR PERFIL:")
print("=" * 50)

resultados_perfiles = {}

for perfil in perfiles:
    print(f"\n{perfil.upper()}")
    print("-" * len(perfil))
    
    datos_perfil = df_seg[df_seg['PERFIL_CREDITICIO'] == perfil]
    
    # Estadísticas clave
    sueldo_promedio = datos_perfil['SUELDO'].mean()
    precio_promedio = datos_perfil['PRECIO PRODUCTO'].mean() 
    cuotas_promedio = datos_perfil['Cuotas pendientes actual'].mean()
    edad_promedio = datos_perfil['EDAD_NUM'].mean() if 'EDAD_NUM' in datos_perfil.columns else None
    dependientes_promedio = datos_perfil['DEPENDIENTES ECONOMICOS'].mean()
    
    # Capacidad de pago (Sueldo vs Precio)
    capacidad_pago = (sueldo_promedio / precio_promedio) if precio_promedio > 0 else 0
    
    # Riesgo crediticio
    riesgo_alto = (datos_perfil['Cuotas pendientes actual'] > 2).sum()
    riesgo_porcentaje = (riesgo_alto / len(datos_perfil)) * 100
    
    print(f"• Tamaño: {len(datos_perfil)} clientes")
    print(f"• Sueldo promedio: Q{sueldo_promedio:,.0f}")
    print(f"• Precio producto promedio: Q{precio_promedio:,.0f}")
    print(f"• Capacidad de pago: {capacidad_pago:.1f}x")
    print(f"• Cuotas pendientes promedio: {cuotas_promedio:.1f}")
    print(f"• Riesgo alto (>2 cuotas): {riesgo_porcentaje:.1f}%")
    print(f"• Dependientes promedio: {dependientes_promedio:.1f}")
    
    # Guardar para ranking
    resultados_perfiles[perfil] = {
        'tamaño': len(datos_perfil),
        'sueldo': sueldo_promedio,
        'precio': precio_promedio,
        'capacidad_pago': capacidad_pago,
        'cuotas': cuotas_promedio,
        'riesgo_alto_pct': riesgo_porcentaje,
        'dependientes': dependientes_promedio
    }

# Crear visualizaciones
# Mapa de colores fijo por perfil
COLOR_PERFIL = {
    'PERFIL A: Propietario Conservador': '#2E8B57',
    'PERFIL B: Urbano con Crédito': '#4169E1',
    'PERFIL C: Establecido Premium': '#DC143C',
    'PERFIL D: Joven Emergente': '#FF8C00',
}

# 1. Distribución de perfiles
plt.figure(figsize=(12,8))
colores_dist = [COLOR_PERFIL[p] for p in distribucion_perfiles.index]
distribucion_perfiles.plot(kind='bar', color=colores_dist, alpha=0.8)
plt.title('Distribución de Perfiles Crediticios', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Perfil Crediticio', fontsize=14, fontweight='bold')
plt.ylabel('Número de Clientes', fontsize=14, fontweight='bold')
plt.xticks(rotation=45, ha='right')
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/distribucion_perfiles.png', dpi=300, bbox_inches='tight')
plt.close()

# 2. Comparativa de riesgo por perfil
plt.figure(figsize=(14,8))
perfiles_ordenados = sorted(resultados_perfiles.keys())
riesgos = [resultados_perfiles[p]['riesgo_alto_pct'] for p in perfiles_ordenados]
sueldos = [resultados_perfiles[p]['sueldo'] for p in perfiles_ordenados]

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16,7))

# Riesgo crediticio
colores_ord = [COLOR_PERFIL[p] for p in perfiles_ordenados]
ax1.bar(range(len(perfiles_ordenados)), riesgos, color=colores_ord, alpha=0.8)
ax1.set_title('Riesgo Crediticio por Perfil', fontsize=14, fontweight='bold')
ax1.set_xlabel('Perfil', fontsize=12, fontweight='bold')
ax1.set_ylabel('% Clientes con Riesgo Alto', fontsize=12, fontweight='bold')
ax1.set_xticks(range(len(perfiles_ordenados)))
ax1.set_xticklabels([p.split(':')[0] for p in perfiles_ordenados], rotation=45, ha='right')
ax1.grid(True, alpha=0.3)

# Sueldo promedio
ax2.bar(range(len(perfiles_ordenados)), sueldos, color=colores_ord, alpha=0.8)
ax2.set_title('Sueldo Promedio por Perfil', fontsize=14, fontweight='bold')
ax2.set_xlabel('Perfil', fontsize=12, fontweight='bold')
ax2.set_ylabel('Sueldo Promedio (Q)', fontsize=12, fontweight='bold')
ax2.set_xticks(range(len(perfiles_ordenados)))
ax2.set_xticklabels([p.split(':')[0] for p in perfiles_ordenados], rotation=45, ha='right')
ax2.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'Q{x:,.0f}'))
ax2.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('graficas_clientes/comparativa_perfiles.png', dpi=300, bbox_inches='tight')
plt.close()

# 3. Matriz de perfiles (Capacidad de pago vs Riesgo)
plt.figure(figsize=(12,8))
capacidades = [resultados_perfiles[p]['capacidad_pago'] for p in perfiles_ordenados]
tamaños = [resultados_perfiles[p]['tamaño'] for p in perfiles_ordenados]

scatter = plt.scatter(capacidades, riesgos, s=[t*5 for t in tamaños],
                     c=colores_ord, alpha=0.7, edgecolors='black')

for i, perfil in enumerate(perfiles_ordenados):
    plt.annotate(perfil.split(':')[0], (capacidades[i], riesgos[i]), 
                xytext=(5, 5), textcoords='offset points', fontsize=11, fontweight='bold')

plt.title('Matriz Estratégica: Capacidad de Pago vs Riesgo Crediticio', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Capacidad de Pago (Sueldo/Precio Producto)', fontsize=14, fontweight='bold')
plt.ylabel('% Clientes con Riesgo Alto', fontsize=14, fontweight='bold')
plt.grid(True, alpha=0.3)

# Líneas de referencia estratégica
plt.axhline(y=15, color='red', linestyle='--', alpha=0.5, label='Umbral Riesgo Alto (15%)')
plt.axvline(x=1.0, color='orange', linestyle='--', alpha=0.5, label='Umbral Capacidad Mínima (1.0x)')
plt.legend()

plt.tight_layout()
plt.savefig('graficas_clientes/matriz_estrategica_perfiles.png', dpi=300, bbox_inches='tight')
plt.close()

# RANKING Y RECOMENDACIONES ESTRATÉGICAS
print("\n🏆 RANKING DE PERFILES (MEJOR A PEOR):")
print("="*50)

# Calcular score estratégico (mayor capacidad de pago, menor riesgo, mayor tamaño)
for perfil in resultados_perfiles:
    datos = resultados_perfiles[perfil]
    score = (datos['capacidad_pago'] * 30) - (datos['riesgo_alto_pct'] * 2) + (datos['tamaño'] * 0.01)
    resultados_perfiles[perfil]['score'] = score

ranking = sorted(resultados_perfiles.items(), key=lambda x: x[1]['score'], reverse=True)

for i, (perfil, datos) in enumerate(ranking, 1):
    print(f"\n{i}. {perfil}")
    print(f"   Score: {datos['score']:.1f} | Capacidad: {datos['capacidad_pago']:.1f}x | Riesgo: {datos['riesgo_alto_pct']:.1f}% | Tamaño: {datos['tamaño']}")

print("\n💡 RECOMENDACIONES ESTRATÉGICAS CEO:")
print("="*50)

mejor_perfil = ranking[0][0]
peor_perfil = ranking[-1][0]

print(f"\n🎯 ENFOQUE PRIORITARIO:")
print(f"• Concentrar esfuerzos en '{mejor_perfil}'")
print(f"• Representan el {(resultados_perfiles[mejor_perfil]['tamaño']/len(df_seg)*100):.1f}% de clientes")
print(f"• Baja morosidad ({resultados_perfiles[mejor_perfil]['riesgo_alto_pct']:.1f}%) + Alta capacidad ({resultados_perfiles[mejor_perfil]['capacidad_pago']:.1f}x)")

print(f"\n⚠️  PERFIL DE RIESGO:")
print(f"• Monitorear '{peor_perfil}'")
print(f"• Considerar estrategias de retención/mejora de perfil")
print(f"• Alto riesgo ({resultados_perfiles[peor_perfil]['riesgo_alto_pct']:.1f}%) o baja capacidad ({resultados_perfiles[peor_perfil]['capacidad_pago']:.1f}x)")

print(f"\n🚀 OPORTUNIDADES DE CRECIMIENTO:")
for perfil, datos in resultados_perfiles.items():
    if datos['capacidad_pago'] > 1.5 and datos['riesgo_alto_pct'] < 20:
        print(f"• {perfil}: Up-selling (capacidad {datos['capacidad_pago']:.1f}x, bajo riesgo)")
    elif datos['tamaño'] > len(df_seg) * 0.25:
        print(f"• {perfil}: Segmento grande ({datos['tamaño']} clientes) - optimizar ofertas")

print("\n" + "="*70)

print("\n" + "="*70)

# =============================================================================
# ANÁLISIS CEO: INTELIGENCIA DE MOROSIDAD Y RIESGO CREDITICIO
# =============================================================================

print("\n" + "="*80)
print("     ANÁLISIS CEO: INTELIGENCIA DE MOROSIDAD Y RIESGO CREDITICIO")
print("="*80)

# Crear datasets de morosos vs no morosos
df_morosos = df_seg[df_seg['Cuotas pendientes actual'] > 1].copy()
df_al_dia = df_seg[df_seg['Cuotas pendientes actual'] <= 1].copy()

print("\n📊 PANORAMA GENERAL DE MOROSIDAD:")
print("-" * 50)
total_clientes = len(df_seg)
total_morosos = len(df_morosos)
total_al_dia = len(df_al_dia)
tasa_morosidad = (total_morosos / total_clientes) * 100

print(f"• Total clientes analizados: {total_clientes:,}")
print(f"• Clientes morosos (>1 cuota): {total_morosos:,} ({tasa_morosidad:.1f}%)")
print(f"• Clientes al día (≤1 cuota): {total_al_dia:,} ({(100-tasa_morosidad):.1f}%)")

# Análisis demográfico comparativo
print("\n🔍 PERFIL DEMOGRÁFICO: MOROSOS VS AL DÍA")
print("="*60)

def analisis_comparativo(variable, titulo):
    print(f"\n{titulo.upper()}:")
    print("-" * len(titulo))
    
    # Morosos
    morosos_dist = df_morosos[variable].value_counts(normalize=True) * 100
    al_dia_dist = df_al_dia[variable].value_counts(normalize=True) * 100
    
    print("MOROSOS:")
    for cat, pct in morosos_dist.head().items():
        if pd.notna(cat):
            print(f"  {cat}: {pct:.1f}%")
    
    print("AL DÍA:")
    for cat, pct in al_dia_dist.head().items():
        if pd.notna(cat):
            print(f"  {cat}: {pct:.1f}%")
    
    # Calcular diferencias significativas
    print("DIFERENCIAS CLAVE:")
    for cat in set(morosos_dist.index) | set(al_dia_dist.index):
        if pd.notna(cat):
            moroso_pct = morosos_dist.get(cat, 0)
            al_dia_pct = al_dia_dist.get(cat, 0)
            diferencia = moroso_pct - al_dia_pct
            if abs(diferencia) > 5:  # Solo diferencias > 5%
                tendencia = "📈 MAYOR" if diferencia > 0 else "📉 MENOR"
                print(f"  {cat}: {tendencia} en morosos ({diferencia:+.1f}%)")

# Análisis por variables clave
analisis_comparativo('PERFIL_CREDITICIO', 'Distribución por Perfil Crediticio')
analisis_comparativo('OCUPACION', 'Distribución por Ocupación')
analisis_comparativo('ESTADO CIVIL', 'Distribución por Estado Civil')
analisis_comparativo('EDAD (RANGO DE EDAD EN AÑOS)', 'Distribución por Edad')

# Análisis numérico comparativo
print("\n💰 ANÁLISIS FINANCIERO: MOROSOS VS AL DÍA")
print("="*50)

variables_numericas = ['SUELDO', 'PRECIO PRODUCTO', 'DEPENDIENTES ECONOMICOS', 'ANTIGUEDAD']
comparacion_numerica = {}

for var in variables_numericas:
    morosos_media = df_morosos[var].mean()
    al_dia_media = df_al_dia[var].mean()
    diferencia_pct = ((morosos_media - al_dia_media) / al_dia_media * 100) if al_dia_media != 0 else 0
    
    comparacion_numerica[var] = {
        'morosos': morosos_media,
        'al_dia': al_dia_media,
        'diferencia_pct': diferencia_pct
    }
    
    print(f"\n{var}:")
    if 'SUELDO' in var or 'PRECIO' in var:
        print(f"  Morosos: Q{morosos_media:,.0f}")
        print(f"  Al día: Q{al_dia_media:,.0f}")
    else:
        print(f"  Morosos: {morosos_media:.1f}")
        print(f"  Al día: {al_dia_media:.1f}")
    
    if abs(diferencia_pct) > 5:
        tendencia = "📈 MAYOR" if diferencia_pct > 0 else "📉 MENOR"
        print(f"  Diferencia: {tendencia} {abs(diferencia_pct):.1f}% en morosos")

# Análisis de factores de riesgo
print("\n⚠️  FACTORES DE RIESGO IDENTIFICADOS:")
print("="*50)

factores_riesgo = []

# Factor 1: Perfil crediticio
perfil_riesgo = df_morosos['PERFIL_CREDITICIO'].value_counts(normalize=True) * 100
perfil_normal = df_al_dia['PERFIL_CREDITICIO'].value_counts(normalize=True) * 100

for perfil in perfil_riesgo.index:
    if perfil in perfil_normal.index:
        diferencia = perfil_riesgo[perfil] - perfil_normal[perfil]
        if diferencia > 5:
            factores_riesgo.append(f"Perfil '{perfil}' (+{diferencia:.1f}%)")

# Factor 2: Variables Si/No
for var in ['VIVIENDA PROPIA', 'VEHICULO PROPIO', 'TARJETA DE CREDITO']:
    morosos_si = (df_morosos[var] == 'Si').mean() * 100
    al_dia_si = (df_al_dia[var] == 'Si').mean() * 100
    diferencia = morosos_si - al_dia_si
    if abs(diferencia) > 5:
        tendencia = "Sin" if diferencia < 0 else "Con"
        factores_riesgo.append(f"{tendencia} {var.lower()} ({diferencia:+.1f}%)")

# Factor 3: Rangos financieros
sueldo_morosos = df_morosos['SUELDO'].median()
sueldo_al_dia = df_al_dia['SUELDO'].median()
if sueldo_morosos < sueldo_al_dia * 0.9:
    factores_riesgo.append(f"Sueldo bajo (Q{sueldo_morosos:,.0f} vs Q{sueldo_al_dia:,.0f})")

for i, factor in enumerate(factores_riesgo, 1):
    print(f"{i}. {factor}")

# Crear visualizaciones de morosidad
print(f"\n📊 GENERANDO VISUALIZACIONES DE MOROSIDAD...")

# 1. Comparativa de morosidad por perfil crediticio
plt.figure(figsize=(14,8))
perfiles_morosos = df_morosos['PERFIL_CREDITICIO'].value_counts()
perfiles_totales = df_seg['PERFIL_CREDITICIO'].value_counts()
tasa_morosidad_perfil = (perfiles_morosos / perfiles_totales * 100).fillna(0)

colores_morosidad = [COLOR_PERFIL[p] for p in tasa_morosidad_perfil.index]
tasa_morosidad_perfil.plot(kind='bar', color=colores_morosidad, alpha=0.8)
plt.title('Tasa de Morosidad por Perfil Crediticio', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Perfil Crediticio', fontsize=14, fontweight='bold')
plt.ylabel('Tasa de Morosidad (%)', fontsize=14, fontweight='bold')
plt.xticks(rotation=45, ha='right')
plt.grid(True, alpha=0.3)

# Agregar línea de referencia
plt.axhline(y=tasa_morosidad, color='red', linestyle='--', alpha=0.7, 
           label=f'Promedio General ({tasa_morosidad:.1f}%)')
plt.legend()
plt.tight_layout()
plt.savefig('graficas_clientes/morosidad_por_perfil.png', dpi=300, bbox_inches='tight')
plt.close()

# 2. Comparativa financiera morosos vs al día
fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(16,12))

# Sueldo
ax1.hist(df_al_dia['SUELDO'].dropna(), bins=30, alpha=0.7, label='Al día', color='green', density=True)
ax1.hist(df_morosos['SUELDO'].dropna(), bins=30, alpha=0.7, label='Morosos', color='red', density=True)
ax1.set_title('Distribución de Sueldos', fontweight='bold')
ax1.set_xlabel('Sueldo (Q)')
ax1.legend()
ax1.grid(True, alpha=0.3)

# Precio producto
ax2.hist(df_al_dia['PRECIO PRODUCTO'].dropna(), bins=30, alpha=0.7, label='Al día', color='green', density=True)
ax2.hist(df_morosos['PRECIO PRODUCTO'].dropna(), bins=30, alpha=0.7, label='Morosos', color='red', density=True)
ax2.set_title('Distribución de Precio Producto', fontweight='bold')
ax2.set_xlabel('Precio Producto (Q)')
ax2.legend()
ax2.grid(True, alpha=0.3)

# Dependientes
dependientes_data = [df_al_dia['DEPENDIENTES ECONOMICOS'].dropna(), 
                    df_morosos['DEPENDIENTES ECONOMICOS'].dropna()]
ax3.boxplot(dependientes_data, labels=['Al día', 'Morosos'])
ax3.set_title('Dependientes Económicos', fontweight='bold')
ax3.set_ylabel('Número de Dependientes')
ax3.grid(True, alpha=0.3)

# Antigüedad
antiguedad_data = [df_al_dia['ANTIGUEDAD'].dropna(), 
                  df_morosos['ANTIGUEDAD'].dropna()]
ax4.boxplot(antiguedad_data, labels=['Al día', 'Morosos'])
ax4.set_title('Antigüedad del Cliente', fontweight='bold')
ax4.set_ylabel('Años de Antigüedad')
ax4.grid(True, alpha=0.3)

plt.suptitle('Análisis Comparativo: Clientes Al Día vs Morosos', fontsize=18, fontweight='bold')
plt.tight_layout()
plt.savefig('graficas_clientes/comparativa_morosos_al_dia.png', dpi=300, bbox_inches='tight')
plt.close()

# 3. Matriz de riesgo por ocupación y estado civil
plt.figure(figsize=(12,8))
ocupaciones_morosos = df_morosos['OCUPACION'].value_counts()
ocupaciones_totales = df_seg['OCUPACION'].value_counts()
riesgo_ocupacion = (ocupaciones_morosos / ocupaciones_totales * 100).fillna(0)

riesgo_ocupacion.plot(kind='bar', color='coral', alpha=0.8)
plt.title('Tasa de Morosidad por Ocupación', fontsize=16, fontweight='bold', pad=20)
plt.xlabel('Ocupación', fontsize=14, fontweight='bold')
plt.ylabel('Tasa de Morosidad (%)', fontsize=14, fontweight='bold')
plt.xticks(rotation=45, ha='right')
plt.axhline(y=tasa_morosidad, color='red', linestyle='--', alpha=0.7, 
           label=f'Promedio General ({tasa_morosidad:.1f}%)')
plt.legend()
plt.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('graficas_clientes/morosidad_por_ocupacion.png', dpi=300, bbox_inches='tight')
plt.close()

# ESTRATEGIAS Y RECOMENDACIONES
print("\n🎯 ESTRATEGIAS ANTI-MOROSIDAD:")
print("="*50)

# Identificar el perfil de mayor riesgo
perfil_mayor_riesgo = tasa_morosidad_perfil.idxmax()
ocupacion_mayor_riesgo = riesgo_ocupacion.idxmax()

print(f"\n🚨 SEGMENTOS DE ALTO RIESGO:")
print(f"• Perfil crediticio: {perfil_mayor_riesgo} ({tasa_morosidad_perfil[perfil_mayor_riesgo]:.1f}% morosidad)")
print(f"• Ocupación: {ocupacion_mayor_riesgo} ({riesgo_ocupacion[ocupacion_mayor_riesgo]:.1f}% morosidad)")

print(f"\n💡 RECOMENDACIONES INMEDIATAS:")
print(f"1. PREVENCIÓN:")
print(f"   • Scoring crediticio más estricto para '{perfil_mayor_riesgo}'")
print(f"   • Verificación adicional de ingresos para '{ocupacion_mayor_riesgo}'")
print(f"   • Límites de crédito ajustados para segmentos de riesgo")

print(f"\n2. DETECCIÓN TEMPRANA:")
print(f"   • Monitoreo mensual de clientes con cuotas = 1")
print(f"   • Alertas automáticas para perfiles de alto riesgo")
print(f"   • Contacto proactivo antes del vencimiento")

print(f"\n3. COBRANZA INTELIGENTE:")
print(f"   • Estrategia diferenciada por perfil crediticio")
print(f"   • Reestructuración de pagos para sueldos bajos")
print(f"   • Programas de lealtad para clientes al día")

# Cálculo de impacto financiero
print(f"\n💰 IMPACTO FINANCIERO ESTIMADO:")
print("-" * 40)
monto_promedio_moroso = df_morosos['PRECIO PRODUCTO'].mean()
monto_total_en_riesgo = monto_promedio_moroso * total_morosos
print(f"• Monto promedio por moroso: Q{monto_promedio_moroso:,.0f}")
print(f"• Monto total en riesgo: Q{monto_total_en_riesgo:,.0f}")

# Si reducimos morosidad en 50%
reduccion_objetivo = 50
ahorro_potencial = (monto_total_en_riesgo * reduccion_objetivo / 100)
print(f"• Ahorro potencial (reducción {reduccion_objetivo}%): Q{ahorro_potencial:,.0f}")

print("\n" + "="*80)

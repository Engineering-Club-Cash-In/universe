import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import silhouette_score
import re

# --------------------
# Load and Preprocess Data
# --------------------

# Use 'big_data.csv' with appropriate parameters (as in random-forest.py)
def load_and_preprocess_data(file_path="big_data.csv"):
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
    # Revised regex to include the "Q " in the match
    pattern = r'(Q\s\d{1,3}(?:,\d{3})*(?:\.\d{2})?)'
    
    # Enclose the entire matched currency string in quotes
    processed_content = re.sub(pattern, r'"\1"', content)

    # Write the processed content back to a temporary file
    temp_file_path = 'processed_' + file_path
    with open(temp_file_path, 'w', encoding='utf-8') as file:
        file.write(processed_content)
    # Load data with proper handling of quoted fields
    data = pd.read_csv(temp_file_path, delimiter=',', quotechar='"', skipinitialspace=True, usecols=range(13))
    # Rename columns to fix any encoding issues
    data.rename(columns={'EDAD (RANGO DE EDAD EN A+ANE-OS)': 'EDAD (RANGO DE EDAD EN AÑOS)'}, inplace=True)
    # Drop rows where all elements are NaN
    data.dropna(how='all', inplace=True)
    return data

def clean_currency(value):
    """Convert currency formatted strings (e.g., 'Q 66,908.00') to float."""
    try:
        # Remove the currency symbol and any spaces
        value = re.sub(r'[^\d.,]', '', value)  # Remove non-numeric characters except '.' and ','
        # Replace comma with nothing and convert to float
        return float(value.replace(',', ''))
    except (ValueError, AttributeError):
        return np.nan  # Return np.nan instead of None for better handling with pandas
    
data = load_and_preprocess_data()

# Drop extra columns not needed for clustering
if 'CLIENTE' in data.columns:
    data = data.drop(['CLIENTE'], axis=1)
if 'Cuotas pendientes actual' in data.columns:
    data = data.drop(['Cuotas pendientes actual'], axis=1)


# Clean the currency columns
data['PRECIO PRODUCTO'] = data['PRECIO PRODUCTO'].apply(clean_currency)
data['SUELDO'] = data['SUELDO'].apply(clean_currency)
print(data['PRECIO PRODUCTO'].head())

# Fill NaN values with the mean
data['PRECIO PRODUCTO'] = data['PRECIO PRODUCTO'].fillna(data['PRECIO PRODUCTO'].mean())
data['SUELDO'] = data['SUELDO'].fillna(data['SUELDO'].mean())

# Ensure the data types are correct
data = data.infer_objects()

# Strip extra spaces from key categorical fields
data['EDAD (RANGO DE EDAD EN AÑOS)'] = data['EDAD (RANGO DE EDAD EN AÑOS)'].str.strip()
data['ANTIGUEDAD'] = data['ANTIGUEDAD'].str.strip()
data['ESTADO CIVIL'] = data['ESTADO CIVIL'].str.strip()
data['OCUPACION'] = data['OCUPACION'].str.strip()
data['TIPO DE COMPRAS'] = data['TIPO DE COMPRAS'].str.strip()

# Convert DEPENDIENTES ECONOMICOS to numeric
data['DEPENDIENTES ECONOMICOS'] = pd.to_numeric(data['DEPENDIENTES ECONOMICOS'], errors='coerce')
data['DEPENDIENTES ECONOMICOS'] = data['DEPENDIENTES ECONOMICOS'].fillna(data['DEPENDIENTES ECONOMICOS'].mean())

# --------------------
# Mapping Categorical Features
# --------------------

# Map the age-range
data['EDAD (RANGO DE EDAD EN AÑOS)'] = data['EDAD (RANGO DE EDAD EN AÑOS)'].map({
    '18-29': 0,
    '30-39': 1,
    '40-49': 2,
    '50': 3
})

# For OCUPACION, handle possible variations
data['OCUPACION'] = data['OCUPACION'].apply(lambda x: 1 if "Due" in str(x) else (0 if "Empl" in str(x) else np.nan))

# Map the ANTIGUEDAD values
data['ANTIGUEDAD'] = data['ANTIGUEDAD'].map({
    '0-1': 0, '0-1 año': 0,
    '1-5': 1, '1-5 años': 1,
    '5-10': 2, '5-10 años': 2,
    '10 años o más': 3, '10+': 3
})

# Map ESTADO CIVIL
data['ESTADO CIVIL'] = data['ESTADO CIVIL'].map({
    'Soltero': 0,
    'Casado': 1
})

# Map UTILIZACION DINERO
data['UTILIZACION DINERO'] = data['UTILIZACION DINERO'].apply(lambda x: 1 if x == 'Consumo' else 0)

# Map VIVIENDA PROPIA, VEHICULO PROPIO, TARJETA DE CREDITO
data['VIVIENDA PROPIA'] = data['VIVIENDA PROPIA'].apply(lambda x: 1 if x == 'Si' else 0)
data['VEHICULO PROPIO'] = data['VEHICULO PROPIO'].apply(lambda x: 1 if x == 'Si' else 0)
data['TARJETA DE CREDITO'] = data['TARJETA DE CREDITO'].apply(lambda x: 1 if x == 'Si' else 0)

# Map TIPO DE COMPRAS
data['TIPO DE COMPRAS'] = data['TIPO DE COMPRAS'].map({
    'Autocompras': 0,
    'Sobre Vehículos': 1,
    'Sobre Vehiculos': 1
})

# Fill any remaining missing values for object-type columns
categorical_cols = data.select_dtypes(include=['object']).columns
data[categorical_cols] = data[categorical_cols].fillna('Unknown')

# For numeric columns, fill any missing values with the column means
numeric_cols = data.select_dtypes(include=[np.number]).columns
data[numeric_cols] = data[numeric_cols].fillna(data[numeric_cols].mean())

# --------------------
# Scaling, Clustering & Visualization
# --------------------

# Scale all features
scaler = StandardScaler()
X_scaled = scaler.fit_transform(data)

# Ensure no NaN values remain after scaling
if np.isnan(X_scaled).any():
    raise ValueError("NaN values found in X_scaled after scaling.")

# Train K-Means with 4 clusters
kmeans = KMeans(n_clusters=4, random_state=42)
data['CLUSTER'] = kmeans.fit_predict(X_scaled)

""" # Example new client data (using the same cleaned/encoded format)
nuevo_cliente = {
    'PRECIO PRODUCTO': 150000,
    'SUELDO': 20000,
    'EDAD (RANGO DE EDAD EN AÑOS)': 0,         # (encoded value: 0 for 18-29)
    'DEPENDIENTES ECONOMICOS': 0,
    'OCUPACION': 0,                          # 0 means "Empleado"
    'ANTIGUEDAD': 0,
    'ESTADO CIVIL': 0,                       # 0 means "Soltero"
    'UTILIZACION DINERO': 1,
    'VIVIENDA PROPIA': 1,
    'VEHICULO PROPIO': 1,
    'TARJETA DE CREDITO': 1,
    'TIPO DE COMPRAS': 0                     # 0 means "Autocompras"
}

# Convert the new client into a DataFrame and scale it using the same scaler
nuevo_cliente_df = pd.DataFrame([nuevo_cliente])
nuevo_cliente_scaled = scaler.transform(nuevo_cliente_df)

# Plot clusters using the first two (scaled) features (e.g., Precio and Sueldo)
plt.figure(figsize=(10, 6))
scatter = plt.scatter(X_scaled[:, 0], X_scaled[:, 1], c=data['CLUSTER'], cmap='viridis', label='Clientes existentes')
plt.scatter(nuevo_cliente_scaled[:, 0], nuevo_cliente_scaled[:, 1], 
            color='red', marker='X', s=200, label='Nuevo Cliente')
plt.title('Segmentación de Clientes por Precio y Sueldo')
plt.xlabel('Precio Producto (normalizado)')
plt.ylabel('Sueldo (normalizado)')
cbar = plt.colorbar(scatter)
cbar.set_label('Número de Cluster')
plt.legend()
plt.show()

# --------------------
# Detailed Cluster Analysis
# --------------------
print("\nAnálisis Detallado de Clusters:")
for cluster in range(4):
    cluster_data = data[data['CLUSTER'] == cluster]
    print(f"\nCluster {cluster}:")
    print(f"Número de clientes: {len(cluster_data)}")
    print("\nEstadísticas de Precio:")
    print(f"Mínimo: Q{cluster_data['PRECIO PRODUCTO'].min():,.2f}")
    print(f"Máximo: Q{cluster_data['PRECIO PRODUCTO'].max():,.2f}")
    print(f"Promedio: Q{cluster_data['PRECIO PRODUCTO'].mean():,.2f}")
    print(f"Mediana: Q{cluster_data['PRECIO PRODUCTO'].median():,.2f}")
    
    print("\nEstadísticas de Sueldo:")
    print(f"Mínimo: Q{cluster_data['SUELDO'].min():,.2f}")
    print(f"Máximo: Q{cluster_data['SUELDO'].max():,.2f}")
    print(f"Promedio: Q{cluster_data['SUELDO'].mean():,.2f}")
    print(f"Mediana: Q{cluster_data['SUELDO'].median():,.2f}")
    
    print("\nCaracterísticas adicionales:")
    print(f"Promedio de dependientes: {cluster_data['DEPENDIENTES ECONOMICOS'].mean():.2f}")
    print(f"% con vivienda propia: {(cluster_data['VIVIENDA PROPIA'].mean()*100):.1f}%")
    print(f"% con vehículo propio: {(cluster_data['VEHICULO PROPIO'].mean()*100):.1f}%")
    print(f"% con tarjeta de crédito: {(cluster_data['TARJETA DE CREDITO'].mean()*100):.1f}%")
    
    print("\nDistribución de tipos de compra:")
    compras = cluster_data['TIPO DE COMPRAS'].value_counts(normalize=True) * 100
    for tipo, porcentaje in compras.items():
        tipo_nombre = 'Autocompras' if tipo == 0 else 'Sobre Vehículos'
        print(f"{tipo_nombre}: {porcentaje:.1f}%")

# Calculate the silhouette score for the clustering
silhouette_avg = silhouette_score(X_scaled, kmeans.labels_)
print(f"\nPuntuación de Silueta: {silhouette_avg:.3f}")

# --------------------
# Elbow Method
# --------------------
inertias = []
K = range(1, 10)
for k in K:
    km = KMeans(n_clusters=k, random_state=42)
    km.fit(X_scaled)
    inertias.append(km.inertia_)

plt.figure(figsize=(10, 6))
plt.plot(K, inertias, 'bx-')
plt.xlabel('k')
plt.ylabel('Inercia')
plt.title('Elbow Method For Optimal k')
plt.show()

# --------------------
# Silhouette Analysis
# --------------------
silhouette_scores = []
K = range(2, 10)
for k in K:
    km = KMeans(n_clusters=k, random_state=42)
    km.fit(X_scaled)
    score = silhouette_score(X_scaled, km.labels_)
    silhouette_scores.append(score)

plt.figure(figsize=(10, 6))
plt.plot(K, silhouette_scores, 'bx-')
plt.xlabel('k')
plt.ylabel('Puntuación de Silueta')
plt.title('Silhouette Score vs k')
plt.show()

# Print detailed statistics for each cluster again (optional)
print("\nEstadísticas detalladas por cluster:")
for cluster in range(4):
    cluster_data = data[data['CLUSTER'] == cluster]
    print(f"\nCluster {cluster}:")
    print("Estadísticas de precio:")
    print(f"Mínimo: Q{cluster_data['PRECIO PRODUCTO'].min():,.2f}")
    print(f"Máximo: Q{cluster_data['PRECIO PRODUCTO'].max():,.2f}")
    print(f"Promedio: Q{cluster_data['PRECIO PRODUCTO'].mean():,.2f}")
    print(f"Mediana: Q{cluster_data['PRECIO PRODUCTO'].median():,.2f}")
    print(f"Número de clientes: {len(cluster_data)}")
 """